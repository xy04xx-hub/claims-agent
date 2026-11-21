# T-05: Foundation stack: KMS, DynamoDB, S3 evidence, SSM

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M1 |
| Depends on | T-02, T-04 |
| Judging items | SEC4, SEC3, COST3, OE1 |
| Estimate | 3 h |
| Status | Todo |
| Branch | `b/T-05-foundation` |

## Why

All data stores, encrypted and private, created once and shared with the other stacks.

## Tasks

- [ ] KMS: customer-managed symmetric data key with rotation on.
- [ ] DynamoDB tables from `contracts/data-model.md`: `Policies`, `Claims`, `EvidenceIndex`, `ClaimTypePacks`, `AuditLog`. On-demand, KMS encryption with the data key, point-in-time recovery, deletion protection in `demo`. GSIs as in the contract (claims by customer, sharded queue index).
- [ ] S3 evidence bucket: Block Public Access, `enforceSSL`, KMS encryption, versioning off, lifecycle expiry (retention value from config), CORS allowing POST from the console origin only, EventBridge notifications on (avoids cross-stack S3 notification cycles).
- [ ] SSM parameters: `/claims/<stage>/autoApproveEnabled` (`true`), global defaults (early-claim days, frequency window and count, outlier multiple).
- [ ] Expose tables, bucket, key and parameter names as stack props for the other stacks.

## Acceptance criteria

- [ ] Stack deploys with cdk-nag clean.
- [ ] Bucket rejects public access and HTTP requests.
- [ ] Tables have PITR and KMS encryption.

## Verification

- [ ] `aws s3api get-public-access-block --bucket <bucket>` shows all four settings true.
- [ ] `aws dynamodb describe-continuous-backups --table-name <Claims>` shows PITR enabled.
- [ ] `curl http://<bucket>.s3.amazonaws.com/x` is denied (no HTTP access).

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
