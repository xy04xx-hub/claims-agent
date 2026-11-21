# T-23: Adjuster console UI

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M3 |
| Depends on | T-10, T-21 |
| Judging items | BIZ-C, SEC2 |
| Estimate | 4 h |
| Status | Todo |
| Branch | `b/T-23-adjuster-ui` |

## Why

A person decides every routed claim with the evidence in front of them.

## Tasks

- [ ] Queue table: age, amount, category, reason codes, oldest first.
- [ ] Claim detail: extracted fields, policy version used, each check with pass or fail, risk signals with the adjuster text (for example "Photo matches CLM-1042"), the agent's draft, evidence images (presigned GET). For a duplicate photo, show both photos side by side.
- [ ] Approve or Reject with a reason code and note. Handle 409 (already resolved).

## Acceptance criteria

- [ ] The duplicate-photo case shows both photos and the matching claim ID.
- [ ] Resolving removes the claim from the queue.

## Verification

- [ ] Run scenario D as customer, then resolve it as adjuster. Screenshot for the PR.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
