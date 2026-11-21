# T-09: Evidence upload, claim submit, SQS + DLQ, status routes

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M1 |
| Depends on | T-08 |
| Judging items | SEC2, SEC5, OE3, COST3 |
| Estimate | 4 h |
| Status | Todo |
| Branch | `b/T-09-submit-queue` |

## Why

The customer can upload evidence and submit a claim, and the claim is handed to processing reliably.

## Tasks

- [ ] `POST /evidence/uploads`: returns an `evidenceId` and a presigned **POST** per file with conditions: content type allow-list, `content-length-range` 1 byte to 5 MB, exact key `tenantId/customerId/evidenceId`, expiry 5 min. Writes an `EvidenceIndex` row with status `UPLOADING`.
- [ ] `GET /me/policies`: the caller's active policies with insured items and, per cause, the required evidence from `ClaimTypePacks`.
- [ ] `POST /claims`: validates, checks the policy, item and every `evidenceId` belong to the caller and tenant, conditional write on `clientRequestId` (repeat returns the original claim), writes `PROCESSING`, sends the job message, returns 202.
- [ ] SQS job queue and DLQ: SSE with the data key, visibility timeout 360 s (6 x Worker timeout), `maxReceiveCount` 3, DLQ retention 14 days. Expose both queues to the Processing stack.
- [ ] `GET /claims/{claimId}` (customer: own only, adjuster: tenant only; customer view hides internal signals) and `GET /claims` (own, cursor paging).
- [ ] Unit tests for ownership checks and idempotency.

## Acceptance criteria

- [ ] A customer cannot submit with someone else's evidence or policy (403).
- [ ] Submitting twice with the same `clientRequestId` creates one claim.
- [ ] Upload over 5 MB or a wrong content type is rejected by S3.

## Verification

- [ ] Upload a 6 MB file with the presigned POST: S3 returns an error.
- [ ] Submit twice with the same `clientRequestId`: same `claimId`, one SQS message (check queue metrics).
- [ ] As `customer2`, `GET /claims/<customer1 claim>` returns 404.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
