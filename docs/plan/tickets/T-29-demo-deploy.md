# T-29: Demo stage deploy and smoke test script

| Field | Value |
|---|---|
| Owner | A + B |
| Milestone | M1, M3, M5 |
| Depends on | T-15 |
| Judging items | OE1, OE3, OE4, BIZ-C |
| Estimate | 3 h |
| Status | Todo |
| Branch | `<A|B>/T-29-demo-deploy` |

## Why

Integration in one account, repeatable with one command.

## Tasks

- [ ] `scripts/smoke.ts --stage <stage> [--runs N]`: signs in as seeded users, runs scenarios A to G and the DLQ fail-safe, asserts outcomes, prints latency p50 and p95.
- [ ] Deploy `main` to the `demo` stage in the chosen account at M1, M3 and M5: `npm run deploy -- demo && npm run seed -- --stage demo && npm run smoke -- --stage demo`.
- [ ] Record the result of each checkpoint in this ticket.

## Acceptance criteria

- [ ] Smoke test passes in `demo` at each checkpoint.

## Verification

- [ ] Paste the smoke output for M1, M3 and M5 here.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
