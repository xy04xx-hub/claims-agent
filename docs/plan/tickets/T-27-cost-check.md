# T-27: Cost check from measured usage

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M5 |
| Depends on | T-19 |
| Judging items | COST1, COST2, COST4 |
| Estimate | 2 h |
| Status | Todo |
| Branch | `<A|B>/T-27-cost-check` |

## Why

The cost estimate must be backed by real token counts, not only assumptions.

## Tasks

- [ ] From 20 smoke runs, take average input, output, cache read and cache write tokens per claim (Worker metrics), Lambda durations, and the number of tool calls.
- [ ] Update `docs/cost-estimate.md` with the measured values next to the assumptions, re-check prices with the AWS Price List API, and recompute the monthly table.
- [ ] Show caching savings: cost per claim with and without cache from measured numbers.

## Acceptance criteria

- [ ] Every number in the cost table is either measured or labelled as an assumption with a source.

## Verification

- [ ] The table recomputes to the same totals (spreadsheet or script in `scripts/`).

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
