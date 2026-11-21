# Design: T-11 Domain package

## Layout (`backend/domain/src`)
- `types.ts`: Policy, ClaimTypePack, Thresholds, RiskSignal, Decision, cause list (matches `contracts/`).
- `policy.ts`: `selectPolicyVersion`, `checkCoverage`, `computePayout`.
- `signals.ts`: `evaluateSignals(inputs, thresholds)`.
- `decide.ts`: `decide(facts, pack, thresholds, killSwitch)`.
- `fixtures.ts`: synthetic policies (v1, v2 without phone theft), phone and car packs.
- `*.test.ts`: vitest, next to the code. Own `package.json` and `tsconfig.json`.

## Decisions
- Pure functions, no I/O. The caller supplies facts (policy in force, item, evidence result, raw signal inputs, kill switch).
- `decide` collects every failed check, computes risk signals itself from raw facts, and returns `AUTO_APPROVED` only if no check failed and no signal exists. The proposal's cause can only add a routing reason (`CAUSE_CLEAR`).
- Checks: kill switch, policy in force, coverage, cause clear, required evidence, evidence match and confidence, payable amount, within limit, under cap (cap 0 always routes), no risk signals.
- A police report adds the informational flag `DOC_AUTHENTICITY_UNVERIFIED`, which does not block.
- Each failure carries adjuster `detail` and a customer-safe text. Identifiers in signals are masked.
- Routed decisions have payout 0. Coverage failures never reject.

## Tests
65 vitest tests: each rule and boundary, scenarios A to H (outputs validated against `contracts/decision.schema.json`), and a table-driven never-approve test over all causes.
Not done: coverage thresholds and the 1,000-case fast-check property test (skipped on request).
