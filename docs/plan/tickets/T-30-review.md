# T-30: Security and Well-Architected review against judging items

| Field | Value |
|---|---|
| Owner | A + B (each reviews the other's stacks) |
| Milestone | M5 |
| Depends on | T-19, T-25 |
| Judging items | SEC1-5, OE1-5, COST1-5 |
| Estimate | 3 h |
| Status | Todo |
| Branch | `a/T-30-review` or `b/T-30-review` (whoever leads) |

## Why

A last check that every judged item is present and can be shown.

## Tasks

- [ ] Each person reviews the other person's stacks: IAM policies (no `*` without a comment), encryption, public access, logging, input validation.
- [ ] Run gitleaks on the full history and cdk-nag on all stacks.
- [ ] Walk the judging table in `docs/plan/README.md` section 8 and confirm each item has visible evidence in the demo.
- [ ] Optional: run the installed `aws-well-architected-review` skill in quick mode on the repo and fix quick wins.

## Acceptance criteria

- [ ] Every judging item has evidence and a place in the demo script.
- [ ] No unexplained cdk-nag suppression, no secrets found.

## Verification

- [ ] Attach the checklist with links to evidence in this ticket.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
