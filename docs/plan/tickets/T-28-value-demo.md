# T-28: Value slide, demo script, rehearsals

| Field | Value |
|---|---|
| Owner | A + B (B leads slides, A leads demo data) |
| Milestone | M5 |
| Depends on | T-24, T-27 |
| Judging items | BIZ-V, BIZ-P, COST5 |
| Estimate | 4 h |
| Status | Todo |
| Branch | `<A|B>/T-28-value-demo` |

## Why

Presentation and value count double.

## Tasks

- [ ] Slides: problem (one number), architecture image, live demo, impact panel, value table with sources (`docs/value-model.md`), security and cost highlights mapped to the judging items, next steps.
- [ ] Demo script from `product.md` with exact clicks and the seeded users. Backup: a screen recording of a good run in case the network fails.
- [ ] Two timed rehearsals in the `demo` stage. Record times per section.

## Acceptance criteria

- [ ] Rehearsal under 4 minutes with problem, live demo, result and next steps.
- [ ] Backup recording saved.

## Verification

- [ ] Run the smoke test before each rehearsal and note the latency.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
