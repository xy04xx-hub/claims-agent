# T-10: Adjuster API: queue, evidence links, resolution

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M2 |
| Depends on | T-09 |
| Judging items | SEC2, BIZ-C |
| Estimate | 3 h |
| Status | Todo |
| Branch | `<A|B>/T-10-adjuster-api` |

## Why

Adjusters see the routed queue and can decide, and every decision is audited.

## Tasks

- [ ] `GET /queue`: reads all shards of `tenantId#ROUTED_TO_ADJUSTER#shard` in parallel, merges oldest first, cursor paging.
- [ ] `GET /claims/{claimId}/evidence/{evidenceId}`: presigned GET valid 60 s, only for evidence attached to that claim, customer (own) or adjuster (tenant).
- [ ] `POST /claims/{claimId}/resolution`: `APPROVE` or `REJECT` with `reasonCode` from a fixed list and an optional note (max 500 chars). Conditional write only while status is `ROUTED_TO_ADJUSTER` (409 otherwise). Writes the audit record with the adjuster's `sub` as actor.
- [ ] Unit tests: double resolution returns 409; customer token returns 403.

## Acceptance criteria

- [ ] Queue shows only routed claims of the caller's tenant.
- [ ] A resolved claim cannot be resolved again.
- [ ] Audit row exists for every resolution.

## Verification

- [ ] Route a seeded claim, resolve it as `adjuster1`, then query `AuditLog` for the claim and see actor and reason.
- [ ] Resolve again: 409.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
