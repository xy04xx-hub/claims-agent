# T-26: README: run, deploy, seed, change thresholds

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M5 |
| Depends on | T-25 |
| Judging items | OE5 |
| Estimate | 2 h |
| Status | Todo |
| Branch | `<A|B>/T-26-readme` |

## Why

Docs is a judged item and the team's own runbook.

## Tasks

- [ ] `README.md`: what it is, architecture image (`docs/architecture.png`), prerequisites, one-time account setup (bootstrap, Bedrock access), deploy (`npm run deploy -- <stage>`), seed users and data, run the console locally, run tests, smoke test, change thresholds (pack caps in seed or config, kill switch in SSM, with exact commands), destroy, cost and value links, security notes (credentials model).
- [ ] Link the ADRs and the plan.

## Acceptance criteria

- [ ] A person who has not seen the project can deploy and run the demo from the README in a fresh account.

## Verification

- [ ] B's teammate (A) follows the README in a fresh stage name without help and notes any gap.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
