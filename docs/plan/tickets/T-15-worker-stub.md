# T-15: Worker Lambda with stub agent

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M1 |
| Depends on | T-09, T-14 |
| Judging items | OE3, OE4, BIZ-C |
| Estimate | 3 h |
| Status | Todo |
| Branch | `<A|B>/T-15-worker-stub` |

## Why

Closes the loop for M1 so both people can see claims reach a final status before the agent exists.

## Tasks

- [ ] Lambda in the Processing stack with an SQS event source: batch size 1, partial batch responses, maximum concurrency 5 (protects Bedrock quotas later), timeout 60 s.
- [ ] Steps: load claim, wait for evidence `READY` (poll up to 5 s, else fail the attempt), build the agent input, call the agent client, validate the proposal against `contracts/proposal.json`, invoke the Decision Lambda.
- [ ] Agent client interface with two implementations: `StubAgent` (returns fields from the seed data for the evidence IDs) and `AgentCoreAgent` (T-19). Chosen by config.
- [ ] Errors: retry the agent call with exponential backoff and jitter (3 tries, cap 4 s), then throw so SQS retries. After 3 receives the DLQ handles it (T-14).
- [ ] Wire the DLQ as an event source of the Decision Lambda's `routeOnly` handler.
- [ ] Metric `StageLatencyMs` per step.

## Acceptance criteria

- [ ] End-to-end in a dev stage: submit, final status visible through `GET /claims/{id}` in under 10 s with the stub.
- [ ] A forced agent failure ends in `ROUTED_TO_ADJUSTER` with the fail-safe reason after 3 attempts.

## Verification

- [ ] Run `scripts/smoke.ts --stage dev-a` (from T-29) once it exists, or submit with curl and poll.
- [ ] Set the stub to throw (config flag), submit, watch the DLQ metric and the final status.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
