# T-25: Dashboard, alarms, AgentCore observability

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M4 |
| Depends on | T-14, T-19 |
| Judging items | OE2, OE3, OE4 |
| Estimate | 3 h |
| Status | Todo |
| Branch | `b/T-25-observability` |

## Why

Operational excellence items 2 to 4 are judged on what the dashboard shows.

## Tasks

- [ ] Ops stack: CloudWatch dashboard with auto-approved vs routed (by reason), fail-safe routes, DLQ depth, decision latency p50 and p95, stage latency, Lambda errors and throttles, Bedrock token usage and cache read tokens (from the Worker's metrics).
- [ ] Alarms (no SNS email needed for the demo, show the alarm state): DLQ depth above 0, Decision Lambda errors above 0, p95 decision latency above 6 s, API 5xx above 1%.
- [ ] Enable CloudWatch Transaction Search for AgentCore Observability through CDK if supported (for example `AWS::XRay::TransactionSearchConfig`), otherwise a documented one-time command in the README.
- [ ] Saved Logs Insights queries: claim timeline by `claimId`, errors by function.

## Acceptance criteria

- [ ] Dashboard shows live data after a smoke run.
- [ ] Each alarm can be triggered on purpose (for example a message on the DLQ).

## Verification

- [ ] Run the smoke test and open the dashboard.
- [ ] Put a message on the DLQ and see the alarm go to In alarm.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
