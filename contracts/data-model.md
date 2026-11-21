# Data model (DynamoDB)

All tables are on-demand, KMS-encrypted, with point-in-time recovery. Every partition key starts with `tenantId`. The MVP runs one tenant. Policies, packs and claims are written by the seed script and the API. Only the Decision Lambda writes a decision status.

## Policies

| Key | Value |
|---|---|
| PK | `tenantId#policyId` |
| SK | `v#<version zero-padded to 6>` |
| GSI `byCustomer` | PK `tenantId#customerId`, SK `effectiveFrom` |

Attributes: `policyId`, `version`, `customerId`, `holderName`, `startDate`, `effectiveFrom`, `effectiveTo`, `deductible`, `items[]` (`itemId`, `category`, `label`, identifiers such as `imei`, `vin`, `plate`), `coverage` (category -> `{ causes[], limit }`). A change is a new version, never an edit.

Access: policy by customer and loss date (query `byCustomer`, pick the version where `effectiveFrom <= lossDate <= effectiveTo`); `GET /me/policies`.

## Claims

| Key | Value |
|---|---|
| PK | `tenantId#claimId` |
| SK | `CLAIM` |
| GSI `byCustomer` | PK `tenantId#customerId`, SK `createdAt` |
| GSI `byQueue` | PK `tenantId#status#shard`, SK `createdAt` (sparse: only `ROUTED_TO_ADJUSTER`) |
| GSI `byRequest` | PK `tenantId#customerId#clientRequestId` (idempotency) |

`shard` = hash(`claimId`) mod 8. Adjuster queue reads the 8 shards in parallel and merges by `createdAt`.

Attributes: `claimId`, `customerId`, `policyId`, `policyVersion`, `itemId`, `cause`, `clientRequestId`, `status` (`PROCESSING`, `AUTO_APPROVED`, `ROUTED_TO_ADJUSTER`, `APPROVED_BY_ADJUSTER`, `REJECTED_BY_ADJUSTER`), `amountClaimed`, `description`, `lossDate`, `evidenceIds[]`, `proposal` (see `proposal.schema.json`), `decision` (see `decision.schema.json`), `reasons`, `payout`, `slaDueAt`, `createdAt`, `decidedAt`.

Access: claims by customer; adjuster queue by tenant and status; duplicate submit; claim by ID. The decision write is conditional on `status = PROCESSING`; the resolution write is conditional on `status = ROUTED_TO_ADJUSTER`.

## EvidenceIndex

| Key | Value |
|---|---|
| PK | `tenantId#type#value` where `type` is `SHA256`, `PHASH` or `IDENTIFIER` |
| SK | `claimId#evidenceId` |
| GSI `byEvidence` | PK `tenantId#evidenceId`, SK `type` |

Attributes: `claimId`, `evidenceId`, `customerId`, `s3Key` (`tenantId/customerId/evidenceId`), `normalizedS3Key`, `contentType`, `sizeBytes`, `processingStatus` (`PENDING`, `READY`, `FAILED`), `exifDate`, `createdAt`. PHASH near-duplicate lookup compares Hamming distance against a bounded set of recent PHASH items for the tenant.

Access: evidence lookup by hash or identifier; evidence by ID.

## ClaimTypePacks

| Key | Value |
|---|---|
| PK | `tenantId#category` |
| SK | `v#<version zero-padded to 6>` |

Attributes: `causes{}` (per cause: `requiredEvidence[]`, `autoApproveCap`, 0 = always route), `identifierFields[]`, `typicalValue`, `confidenceThresholds`, `earlyClaimDays`, `maxClaimsPerWindow`, `outlierMultiplier`.

Access: pack by tenant and category (latest version).

## AuditLog

| Key | Value |
|---|---|
| PK | `tenantId#claimId` |
| SK | `<timestamp>#<seq>` |

Attributes: see `audit-record.schema.json`. Append-only: the Decision Lambda and the resolution handler have `PutItem` only, no update or delete. No photo bytes and no full personal data.

Access: audit trail by claim.

## Not in DynamoDB

- Kill switch `autoApproveEnabled` and global defaults: SSM Parameter Store `/claims/<stage>/autoApproveEnabled`.
- Evidence files: private S3 bucket, key `tenantId/customerId/evidenceId`.
