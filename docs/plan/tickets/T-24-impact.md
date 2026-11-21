# T-24: Impact panel (API + UI)

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M4 |
| Depends on | T-14, T-23 |
| Judging items | COST5, BIZ-V, OE2 |
| Estimate | 2 h |
| Status | Todo |
| Branch | `b/T-24-impact` |

## Why

Visible proof of the value claim during the demo.

## Tasks

- [ ] `GET /impact` (adjuster): counts of auto-approved and routed claims for a period, auto-handle rate, p50 decision latency, estimated hours saved = auto-handled x minutes per claim, dollars saved = hours x hourly cost. Minutes and hourly cost from config (defaults from `docs/value-model.md`: 25 min, $40/h).
- [ ] Small panel on the adjuster home with the four numbers and the assumptions shown underneath.

## Acceptance criteria

- [ ] Numbers match a manual count of the seeded and demo claims.

## Verification

- [ ] Submit 3 claims, check the counts and the computed dollars by hand.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
