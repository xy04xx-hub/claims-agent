import { buildAudit, reasonCode } from "./audit.js";
import { evaluate, failSafeDecision, routedDecision, type Evaluation, type Proposal } from "./evaluate.js";
import { validateDecision, validateJobMessage, validateProposal } from "./schemas.js";
import type {
  ClaimRecord, DecideEvent, DecideResult, Deps, InvokeContext, SqsBatchResponse, SqsEvent,
} from "./types.js";

export interface Handlers {
  decide(event: DecideEvent, ctx: InvokeContext): Promise<DecideResult>;
  routeOnly(event: SqsEvent, ctx: InvokeContext): Promise<SqsBatchResponse>;
  /** Lambda entry point: SQS events go to routeOnly, anything else to decide. */
  handler(event: DecideEvent | SqsEvent, ctx: InvokeContext): Promise<DecideResult | SqsBatchResponse>;
}

const TENANT = /^[A-Za-z0-9._-]{1,40}$/;
const CLAIM_ID = /^CLM-[A-Za-z0-9-]{1,40}$/;

function parseEvent(event: unknown): DecideEvent {
  const e = event as Partial<DecideEvent> | null;
  if (!e || typeof e.tenantId !== "string" || !TENANT.test(e.tenantId) || typeof e.claimId !== "string" || !CLAIM_ID.test(e.claimId)) {
    throw new TypeError("decide: tenantId and claimId are required");
  }
  const jti = typeof e.jti === "string" ? e.jti : undefined;
  if (e.route !== undefined) {
    if (e.route !== "EVIDENCE_NOT_READY" && e.route !== "AUTOMATIC_CHECK_UNAVAILABLE") {
      throw new TypeError("decide: unknown route");
    }
    return { tenantId: e.tenantId, claimId: e.claimId, route: e.route, jti };
  }
  return { tenantId: e.tenantId, claimId: e.claimId, proposal: e.proposal, jti };
}

/** Fixed text per route mode, so a caller cannot inject free text. */
function routeDecision(route: NonNullable<DecideEvent["route"]>, claimId: string): Evaluation["decision"] {
  return route === "AUTOMATIC_CHECK_UNAVAILABLE"
    ? failSafeDecision(claimId)
    : routedDecision(claimId, "EVIDENCE_NOT_READY", "Evidence not ready. The claim was routed so a person can review it.");
}

/** Everything that can fail without a decision: any error becomes a fail-safe route. */
async function decideClaim(deps: Deps, claim: ClaimRecord, rawProposal: unknown): Promise<Evaluation> {
  const checked = validateProposal(rawProposal);
  if (!checked.ok) {
    return fallbackEval(claim, routedDecision(claim.claimId, "PROPOSAL_INVALID", `Proposal failed validation: ${checked.error}`));
  }
  const proposal = rawProposal as Proposal;
  const meta = { model: proposal.model, promptVersion: proposal.promptVersion };
  if (proposal.claimId !== claim.claimId) {
    return fallbackEval(claim, routedDecision(claim.claimId, "PROPOSAL_INVALID", "Proposal is for a different claim."));
  }
  try {
    return { ...(await evaluate(deps, claim, proposal)), ...meta };
  } catch (err) {
    deps.log.error("evaluation failed, routing", { claimId: claim.claimId, error: err instanceof Error ? err.name : "unknown" });
    return { ...fallbackEval(claim, failSafeDecision(claim.claimId)), ...meta };
  }
}

function fallbackEval(claim: ClaimRecord, decision: Evaluation["decision"]): Evaluation {
  return {
    decision,
    policyId: claim.policyId,
    policyVersion: Math.max(1, claim.policyVersion ?? 1),
    packVersion: 1,
    thresholds: {},
  };
}

/** AutoApproved or Routed (dimension reason), FailSafeRouted, and DecisionLatencyMs. Each is its own EMF line. */
function recordMetrics(deps: Deps, decision: Evaluation["decision"], startedAt: number): void {
  const { metrics } = deps;
  if (decision.outcome === "AUTO_APPROVED") {
    metrics.count("AutoApproved");
  } else {
    metrics.count("Routed", { reason: reasonCode(decision) ?? "UNKNOWN" });
  }
  metrics.flush();
  if (decision.failSafe) {
    metrics.count("FailSafeRouted");
    metrics.flush();
  }
  metrics.latency(deps.now().getTime() - startedAt);
  metrics.flush();
}

export function createHandlers(deps: Deps): Handlers {
  const decide: Handlers["decide"] = async (rawEvent, ctx) => {
    const startedAt = deps.now().getTime();
    const event = parseEvent(rawEvent);
    const claim = await deps.store.getClaim(event.tenantId, event.claimId);
    if (!claim) return { result: "NOT_FOUND", claimId: event.claimId };
    if (claim.status !== "PROCESSING") return { result: "ALREADY_DECIDED", claimId: event.claimId };

    const evaluation = event.route
      ? fallbackEval(claim, routeDecision(event.route, claim.claimId))
      : await decideClaim(deps, claim, event.proposal);
    const valid = validateDecision(evaluation.decision);
    if (!valid.ok) throw new Error(`decision failed schema validation: ${valid.error}`);
    const decidedAt = deps.now().toISOString();
    const audit = buildAudit({
      claim, evaluation, timestamp: decidedAt, actorId: "decision-lambda", requestId: ctx.awsRequestId, jti: event.jti,
    });
    const outcome = await deps.store.commitDecision({ claim, decision: evaluation.decision, audit, decidedAt });
    if (outcome === "ALREADY_DECIDED") {
      deps.log.warn("claim already decided, nothing written", { claimId: claim.claimId, requestId: ctx.awsRequestId });
      return { result: "ALREADY_DECIDED", claimId: claim.claimId };
    }
    recordMetrics(deps, evaluation.decision, startedAt);
    deps.log.info("decision committed", {
      claimId: claim.claimId,
      requestId: ctx.awsRequestId,
      outcome: evaluation.decision.outcome,
      reason: reasonCode(evaluation.decision),
      failSafe: evaluation.decision.failSafe === true,
    });
    return { result: "DECIDED", decision: evaluation.decision };
  };

  /** DLQ entry point. Always routes: the automatic check could not finish. Never approves. */
  const routeOne = async (record: SqsEvent["Records"][number], ctx: InvokeContext) => {
    const startedAt = deps.now().getTime();
    const body: unknown = JSON.parse(record.body);
    const valid = validateJobMessage(body);
    if (!valid.ok) throw new Error(`job message failed validation: ${valid.error}`);
    const { tenantId, claimId } = body as { tenantId: string; claimId: string };
    const claim = await deps.store.getClaim(tenantId, claimId);
    if (!claim) {
      deps.log.warn("routeOnly: claim not found, ignoring", { claimId });
      return;
    }
    if (claim.status !== "PROCESSING") return;
    const evaluation = fallbackEval(claim, failSafeDecision(claimId));
    const decidedAt = deps.now().toISOString();
    const audit = buildAudit({
      claim, evaluation, timestamp: decidedAt, actorId: "decision-lambda:routeOnly", requestId: ctx.awsRequestId,
    });
    const outcome = await deps.store.commitDecision({ claim, decision: evaluation.decision, audit, decidedAt });
    if (outcome === "ALREADY_DECIDED") return;
    recordMetrics(deps, evaluation.decision, startedAt);
    deps.log.info("fail-safe route committed", { claimId, requestId: ctx.awsRequestId });
  };

  const routeOnly: Handlers["routeOnly"] = async (event, ctx) => {
    const batchItemFailures: SqsBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        await routeOne(record, ctx);
      } catch (err) {
        deps.log.error("routeOnly: record failed", { messageId: record.messageId, error: err instanceof Error ? err.name : "unknown" });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
  const handler: Handlers["handler"] = (event, ctx) =>
    "Records" in event ? routeOnly(event, ctx) : decide(event, ctx);
  return { decide, routeOnly, handler };
}
