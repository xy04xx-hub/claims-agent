// Investigator agent loop (Worker). The model proposes through submit_proposal, which is never executed:
// the loop captures its input and stops. It writes nothing and sets no decision.
// No content is logged here. Tool errors surface to the model as short messages only.
import type {
  ContentBlock,
  ConverseCommandInput,
  ConverseCommandOutput,
  Message,
  ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { withRetry } from "./retry.js";
import { TOOL_SPECS } from "./tools.js";

export const MAX_TURNS = 4;

export interface AgentDeps {
  converse(req: ConverseCommandInput): Promise<ConverseCommandOutput>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  config: { modelId: string; maxTokens: number; injectFailure?: boolean };
}

export interface AgentInput {
  system: string;
  userContent: ContentBlock[];
  tools: Record<string, () => Promise<unknown>>;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
}

export type AgentResult =
  | { ok: true; proposalInput: unknown; turns: number; usage: AgentUsage }
  | { ok: false; reason: "BEDROCK_UNAVAILABLE" | "NO_PROPOSAL"; turns: number; usage: AgentUsage };

const SUBMIT = "submit_proposal";

export async function runAgent(deps: AgentDeps, input: AgentInput): Promise<AgentResult> {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
  const messages: Message[] = [
    // Cache checkpoint after the evidence so later turns read the prefix from cache.
    { role: "user", content: [...input.userContent, { cachePoint: { type: "default" } }] },
  ];
  let turns = 0;

  while (turns < MAX_TURNS) {
    turns++;
    let res: ConverseCommandOutput;
    try {
      const req: ConverseCommandInput = {
        modelId: deps.config.modelId,
        system: [{ text: input.system }],
        messages,
        toolConfig: { tools: TOOL_SPECS },
        inferenceConfig: { maxTokens: deps.config.maxTokens, temperature: 0 },
      };
      if (deps.config.injectFailure) throw new Error("injected failure"); // fail fast, no retry
      res = await withRetry(() => deps.converse(req), undefined, deps.sleep, deps.random);
    } catch {
      return { ok: false, reason: "BEDROCK_UNAVAILABLE", turns, usage };
    }

    usage.inputTokens += res.usage?.inputTokens ?? 0;
    usage.outputTokens += res.usage?.outputTokens ?? 0;
    usage.cacheReadInputTokens += res.usage?.cacheReadInputTokens ?? 0;
    usage.cacheWriteInputTokens += res.usage?.cacheWriteInputTokens ?? 0;

    const content = res.output?.message?.content ?? [];
    const calls = content.flatMap((b) => (b.toolUse ? [b.toolUse] : []));
    if (res.stopReason !== "tool_use" || calls.length === 0) {
      return { ok: false, reason: "NO_PROPOSAL", turns, usage };
    }

    const submit = calls.find((c) => c.name === SUBMIT);
    if (submit) return { ok: true, proposalInput: submit.input, turns, usage };

    messages.push({ role: "assistant", content });
    const results = await Promise.all(
      calls.map(async (call): Promise<ContentBlock> => {
        const toolUseId = call.toolUseId ?? "";
        const run = call.name ? input.tools[call.name] : undefined;
        if (!run || !Object.prototype.hasOwnProperty.call(input.tools, call.name as string)) {
          return toolError(toolUseId, "Unknown tool.");
        }
        try {
          const out = await run(); // model-supplied arguments are ignored
          return { toolResult: { toolUseId, content: [{ json: toJson(out) }] } };
        } catch {
          return toolError(toolUseId, "Tool failed.");
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { ok: false, reason: "NO_PROPOSAL", turns, usage };
}

function toolError(toolUseId: string, message: string): ContentBlock {
  const content: ToolResultContentBlock[] = [{ text: message }];
  return { toolResult: { toolUseId, status: "error", content } };
}

/** Converse json blocks must be objects. */
function toJson(out: unknown): Record<string, never> {
  const obj = out !== null && typeof out === "object" && !Array.isArray(out) ? out : { result: out ?? null };
  return obj as Record<string, never>;
}
