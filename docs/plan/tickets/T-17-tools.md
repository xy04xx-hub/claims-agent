# T-17: Read-only tool Lambdas

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M3 |
| Depends on | T-11, T-12 |
| Judging items | SEC3, SEC5, BIZ-C |
| Estimate | 4 h |
| Status | Todo |
| Branch | `<A|B>/T-17-tools` |

## Why

The agent's only way to read data. Read-only and scoped to one claim.

## Tasks

- [ ] Three Lambdas in the Agent stack: `lookup_policy` (policy version by loss date, covered causes, limits, required evidence), `check_fraud_signals` (exact and near-duplicate photo, identifier reuse, early claim, frequency, outlier, timeline), `verify_evidence` (compares extracted name, IMEI or VIN and dates with the policy).
- [ ] Inputs exactly as `contracts/tools/*.json`. `claimId` and `tenantId` come only from the fields the Interceptor injects. Reject a call where they are missing.
- [ ] Each tool has its own role: `GetItem` and `Query` on the tables it needs. No writes.
- [ ] Use `backend/domain` for all logic. Results are short JSON to keep tokens low.
- [ ] Unit tests per tool, including the `CLM-1042` duplicate and the IMEI mismatch.

## Acceptance criteria

- [ ] No tool role has a write action (check the template).
- [ ] Tool output sizes under about 1,500 tokens for every seeded case.

## Verification

- [ ] Invoke each tool directly with a test event that includes the injected fields and compare with the expected JSON.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
