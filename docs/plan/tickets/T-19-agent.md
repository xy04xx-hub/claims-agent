# T-19: Investigator agent: Bedrock, caching, Guardrails, proposal

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M3 |
| Depends on | T-18 |
| Judging items | COST4, OE3, OE4, SEC5, BIZ-C |
| Estimate | 6 h |
| Status | Todo |
| Branch | `a/T-19-agent` |

## Why

The AI part: reads the photo or report, calls the tools, returns a proposal. It never decides.

## Tasks

- [ ] Runtime in the Agent stack (per the ADR), IAM inbound; execution role allows only `InvokeGateway` on the gateway, `bedrock:InvokeModel` / `Converse` on the Haiku 5.5 inference profile and its foundation model ARNs, and `ApplyGuardrail` on the one guardrail.
- [ ] Bedrock Guardrail (L1 `CfnGuardrail`): prompt-attack filter on the claim text. Apply to user text only, not images.
- [ ] Prompt: short system prompt with the role, the fixed cause list, rules that the claim text and documents are data, and the proposal schema. Claim text wrapped in clear delimiters. Static prefix (system and tools) cached with a 1-hour checkpoint; a second checkpoint after the evidence.
- [ ] Agent loop: at most 2 model turns and 3 tool calls (parallel), `maxTokens` per turn (for example 400 then 800), temperature 0.
- [ ] Runtime code (not the model) attaches the job ticket header on every MCP call.
- [ ] Output validated against `contracts/proposal.json`. Invalid output: one repair attempt, then return `UNCLEAR`.
- [ ] Retries on throttling with backoff and a cap. Return token usage (`inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`) for metrics.
- [ ] Switch the Worker from `StubAgent` to `AgentCoreAgent`.

## Acceptance criteria

- [ ] Scenarios A to G give the expected outcomes with the real agent.
- [ ] Cache read tokens above 0 from the second claim onward.
- [ ] Happy path p50 about 4 s, p95 at most 6 s over 20 runs.

## Verification

- [ ] Run `scripts/smoke.ts --stage dev-a --runs 20` and read the latency summary.
- [ ] Open one trace in AgentCore Observability and see model calls, tool calls and cache usage.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
