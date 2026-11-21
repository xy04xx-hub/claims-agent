# T-14: Decision Lambda: approve/route, kill switch, audit, metrics

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M1 |
| Depends on | T-11 |
| Judging items | OE3, OE2, SEC3, SEC5 |
| Estimate | 4 h |
| Status | Todo |
| Branch | `<A|B>/T-14-decision` |

## Why

The only component allowed to write a decision. It must be safe even if the proposal is wrong or malicious.

## Tasks

- [ ] Lambda in the Processing stack. Two entry points: `decide` (called by the Worker with `{tenantId, claimId, proposal}`) and `routeOnly` (DLQ trigger).
- [ ] Re-fetch policy (version by loss date), pack, evidence index status and signals from DynamoDB. Use the proposal only for extracted fields, re-check them against the system of record, and pass everything to `domain.decide`.
- [ ] Read `autoApproveEnabled` from SSM with a cache of at most 60 s.
- [ ] Conditional write: only from `PROCESSING` to a final status, so a claim is decided once.
- [ ] Write the audit record (inputs, policy and pack version, thresholds in force, checks, signals, outcome, actor `agent`, model and prompt version, `jti` of the ticket).
- [ ] EMF metrics: `AutoApproved`, `Routed` (dimension `reason`), `FailSafeRouted`, `DecisionLatencyMs`.
- [ ] IAM: read Policies, Packs, EvidenceIndex; update Claims; put AuditLog; read the one SSM parameter. Nothing else.
- [ ] Tests: kill switch off routes every claim; second decision attempt is rejected; `routeOnly` always routes.

## Acceptance criteria

- [ ] Only this Lambda's role has `UpdateItem` on Claims status for final statuses (check the synthesized template).
- [ ] Required test from T-11 also runs against the handler with a hostile proposal.

## Verification

- [ ] Set `autoApproveEnabled=false`, submit the happy-path claim: routed within 60 s of the change.
- [ ] Put a test message on the DLQ: the claim routes with reason `AUTOMATIC_CHECK_UNAVAILABLE`.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
