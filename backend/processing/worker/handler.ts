// Worker: SQS batch handler (batch size 1). One claim per message.
// Pipeline: LoadClaim, WaitEvidence, BuildInput, Agent, ValidateProposal, Decision.
// Every Bedrock or model problem routes the claim through the Decision Lambda and reports success.
// A Decision Lambda failure throws, so SQS redelivers (and the DLQ handler routes after 3 receives).
// Never logs the description, evidence bytes or identifiers.
import type { ConverseCommandInput, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { runAgent, type AgentUsage } from "./agent.js";
import { loadEvidenceBlocks } from "./evidence.js";
import { buildAgentInput, PROMPT_VERSION, SYSTEM_PROMPT, type EvidenceBlock } from "./prompt.js";
import { createTools, type ToolDeps } from "./tools.js";
import { validateJobMessage, validateProposal } from "../decision/schemas.js";
import type { ClaimRecord, DecideEvent, DecideResult, EvidenceRecord, LogSink } from "../decision/types.js";

export type RouteCode = NonNullable<DecideEvent["route"]>;

export const EVIDENCE_POLL_MS = 500;
export const EVIDENCE_WAIT_MS = 5000;
const CUSTOMER_TEXT_MAX = 500;
const NOT_SHOWN_PREFIX = "not shown to the model: ";

export type Stage = "LoadClaim" | "WaitEvidence" | "BuildInput" | "Agent" | "ValidateProposal" | "Decision";

export interface WorkerMetrics {
  /** StageLatencyMs with dimension Stage. */
  stage(stage: Stage, ms: number): void;
  /** TotalMs: job receipt to Decision return. */
  total(ms: number): void;
  flush(): void;
}

export interface WorkerConfig {
  modelId: string;
  maxTokens: number;
  maxEvidenceImageBytes: number;
  evidenceBucket: string;
  frequencyWindowDays: number;
  injectFailure?: boolean;
}

export interface WorkerDeps {
  store: ToolDeps["store"];
  getObject(bucket: string, key: string): Promise<{ bytes: Uint8Array; contentLength?: number }>;
  converse(req: ConverseCommandInput): Promise<ConverseCommandOutput>;
  /** Invokes the Decision Lambda decide handler. Throws on a function error or throttle. */
  invokeDecision(event: DecideEvent): Promise<DecideResult>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => Date;
  log: LogSink;
  metrics: WorkerMetrics;
  config: WorkerConfig;
}

export interface WorkerSqsEvent {
  Records: { messageId: string; body: string }[];
}
export interface WorkerBatchResponse {
  batchItemFailures: { itemIdentifier: string }[];
}

export interface Worker {
  processJob(body: string): Promise<void>;
  handler(event: WorkerSqsEvent): Promise<WorkerBatchResponse>;
}

const isReady = (e: EvidenceRecord) => e.processingStatus === "READY";

export function createWorker(deps: WorkerDeps): Worker {
  const { log, metrics } = deps;
  const nowMs = () => deps.now().getTime();

  async function timed<T>(stage: Stage, fn: () => Promise<T>): Promise<T> {
    const t0 = nowMs();
    try {
      return await fn();
    } finally {
      metrics.stage(stage, nowMs() - t0);
    }
  }

  async function processJob(body: string): Promise<void> {
    const startedAt = nowMs();

    // LoadClaim
    const loaded = await timed("LoadClaim", async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        log.error("job message is not JSON, dropped");
        return undefined;
      }
      const valid = validateJobMessage(parsed);
      if (!valid.ok) {
        log.error("job message failed validation, dropped", { error: valid.error });
        return undefined;
      }
      const msg = parsed as { tenantId: string; claimId: string; requestId: string };
      const claim = await deps.store.getClaim(msg.tenantId, msg.claimId);
      if (!claim) {
        log.warn("claim not found, dropped", { claimId: msg.claimId, requestId: msg.requestId });
        return undefined;
      }
      if (claim.status !== "PROCESSING") {
        log.info("claim is not PROCESSING, skipped", { claimId: msg.claimId, requestId: msg.requestId, status: claim.status });
        return undefined;
      }
      return { msg, claim };
    });
    if (!loaded) return;
    const { claim } = loaded;
    const { tenantId, claimId, requestId } = loaded.msg;
    const ctx = { claimId, requestId };

    const finish = (via: string) => {
      metrics.total(nowMs() - startedAt);
      log.info("claim handled", { ...ctx, via });
    };

    /** Route through the Decision Lambda. DECIDED, ALREADY_DECIDED and NOT_FOUND are all success. */
    const route = async (code: RouteCode): Promise<void> => {
      log.warn("routing claim", { ...ctx, code });
      await timed("Decision", () => deps.invokeDecision({ tenantId, claimId, route: code }));
      finish(code);
    };

    // WaitEvidence
    const evidence = await timed("WaitEvidence", async () => {
      const maxPolls = EVIDENCE_WAIT_MS / EVIDENCE_POLL_MS;
      let items: EvidenceRecord[] = [];
      for (let poll = 0; ; poll++) {
        items = await deps.store.getEvidence(tenantId, claim.evidenceIds);
        const ready = items.length >= claim.evidenceIds.length && items.every(isReady);
        if (ready) return items;
        if (poll >= maxPolls) return undefined;
        await deps.sleep(EVIDENCE_POLL_MS);
      }
    });
    if (!evidence) return route("EVIDENCE_NOT_READY");

    // BuildInput
    const userContent = await timed("BuildInput", async () => {
      const loadedEv = await loadEvidenceBlocks(
        { getObject: deps.getObject, config: { evidenceBucket: deps.config.evidenceBucket, maxEvidenceImageBytes: deps.config.maxEvidenceImageBytes } },
        evidence,
      );
      const blocks: EvidenceBlock[] = loadedEv.items.map((it) =>
        it.block
          ? { evidenceId: it.evidenceId, block: it.block }
          : { evidenceId: it.evidenceId, notShown: it.note.startsWith(NOT_SHOWN_PREFIX) ? it.note.slice(NOT_SHOWN_PREFIX.length) : it.note },
      );
      return buildAgentInput(claim, evidence, blocks);
    });

    // Agent
    let proposalInput: unknown;
    let usage: AgentUsage | undefined;
    try {
      const result = await timed("Agent", () => {
        const tools = createTools({ tenantId, claimId }, { store: deps.store, now: deps.now, config: { frequencyWindowDays: deps.config.frequencyWindowDays } });
        return runAgent(
          {
            converse: deps.converse,
            sleep: deps.sleep,
            random: deps.random,
            config: { modelId: deps.config.modelId, maxTokens: deps.config.maxTokens, injectFailure: deps.config.injectFailure },
          },
          { system: SYSTEM_PROMPT, userContent, tools },
        );
      });
      usage = result.usage;
      log.info("agent finished", { ...ctx, ok: result.ok, turns: result.turns, ...result.usage, ...(result.ok ? {} : { reason: result.reason }) });
      if (!result.ok) return route("AUTOMATIC_CHECK_UNAVAILABLE");
      proposalInput = result.proposalInput;
    } catch (err) {
      log.error("agent failed", { ...ctx, error: err instanceof Error ? err.name : "unknown", ...(usage ?? {}) });
      return route("AUTOMATIC_CHECK_UNAVAILABLE");
    }

    // ValidateProposal
    const proposal = await timed("ValidateProposal", async () => {
      if (typeof proposalInput !== "object" || proposalInput === null || Array.isArray(proposalInput)) return undefined;
      const p = {
        ...(proposalInput as Record<string, unknown>),
        claimId,
        model: deps.config.modelId,
        promptVersion: PROMPT_VERSION,
        customerText: customerText(claim),
      };
      const valid = validateProposal(p);
      if (!valid.ok) {
        log.warn("proposal failed validation", { ...ctx, error: valid.error });
        return undefined;
      }
      return p;
    });
    if (!proposal) return route("AUTOMATIC_CHECK_UNAVAILABLE");

    // Decision: a function error or throttle throws, so SQS redelivers.
    const result = await timed("Decision", () => deps.invokeDecision({ tenantId, claimId, proposal }));
    log.info("decision invoked", { ...ctx, result: result.result });
    finish("proposal");
  }

  async function handler(event: WorkerSqsEvent): Promise<WorkerBatchResponse> {
    const batchItemFailures: WorkerBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        await processJob(record.body);
      } catch (err) {
        log.error("job failed, will be redelivered", { messageId: record.messageId, error: err instanceof Error ? err.name : "unknown" });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    metrics.flush();
    return { batchItemFailures };
  }

  return { processJob, handler };
}

function customerText(claim: ClaimRecord): string {
  return (claim.description ?? "").slice(0, CUSTOMER_TEXT_MAX);
}
