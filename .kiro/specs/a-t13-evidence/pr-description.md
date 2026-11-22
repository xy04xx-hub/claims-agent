# T-13: Evidence processor

## Summary
An S3 upload to the evidence bucket now triggers a Lambda that hashes the file, reads the EXIF capture date and writes
`EvidenceIndex` rows in the same shape the seed writes. A re-upload of the CLM-1042 photo is found as a duplicate.

## What changed
- **Processing stack:** `evidence-processor` Lambda (Node 22, ARM64, 1024 MB, 20 s), EventBridge rule on S3 `Object Created`
  with key shape `*/*/*`, a dead-letter queue, a role limited to `s3:GetObject` on `bucket/*/*/*`, `dynamodb:PutItem` on
  EvidenceIndex, the data key, and `sqs:SendMessage` (plus two read-only queue lookups) on the DLQ.
- **Processor:** SHA-256 for every file. pHash (dHash, 64 bit) for PNG only. EXIF `DateTimeOriginal` for JPEG only, with a
  hand-written parser. No native dependency.
- **Hash code** is a verbatim copy of `seed/lib/hashing.ts` and `png.ts`. `parity.test.ts` fails if either differs and
  checks that the processor's rows equal the CLM-1042 rows built by the seed.
- **Decision Lambda (A-owned, two small changes):** `findOtherClaims` ignores `UNASSIGNED` rows, and `evaluate` counts
  `UNASSIGNED` rows listed on the claim as the claim's own evidence. Tests added for both.
- **Foundation** gains two CloudFormation exports (evidence bucket name and ARN), created because Processing now references them. No resource changes.
- **B-owned test files, one line each, for B to review:** `infra/test/stacks.test.ts` (acknowledgment list) and
  `infra/test/claims-function.test.ts` (Processing function count 1 to 2).
- `@aws-sdk/client-s3` moved from devDependencies to dependencies of `backend/processing`.

## Decisions and deviations
- **No claim exists at upload time**, so rows carry `claimId = UNASSIGNED` and `sk = UNASSIGNED#<evidenceId>`. T-15 must assign real claim IDs.
- **Key-shape filter** (`wildcard: '*/*/*'`) instead of a prefix: the key starts with the tenant ID. CloudFormation accepted it.
- **Retries:** Lambda async invocation retries twice, then the event goes to the DLQ. The DLQ is SQS-encrypted (a KMS key would create a cross-stack cycle with the Foundation key).
- **Kind** comes from the `x-amz-meta-kind` object metadata. Without it the processor guesses from the content type and logs a warning. A wrong guess routes to an adjuster.
- **Status** values are `READY` and `FAILED` (not `REJECTED`). An undecodable PNG gets a SHA256 row and `FAILED`.
- **Guards:** objects over 2x the upload limit are skipped unread, and PNGs over 16 million pixels become `FAILED` before decoding.
- `createdAt` is the EventBridge event time, so a retry writes identical rows.

## Not in this PR (ticket items dropped by decision)
- Normalized JPEG copy (`sharp`), pHash for JPEG, near-duplicate (Hamming distance) search, so a resized copy is **not** detected yet.
- `POST /evidence/uploads` setting the `kind` metadata (owner B).
- Two new claims with the same photo do not match each other until T-15 assigns claim IDs.
- T-15's Worker should wait for the evidence rows before signing a ticket. A claim decided before they exist routes ("required evidence missing").
- DLQ depth alarm (T-25). A PNG whose header lies about its size can still use a lot of memory; it ends in the DLQ.
- Verification used a direct S3 upload with metadata, not the upload API (not built yet).

## Verification on dev-a
Checks: `npm run lint`, `npm run typecheck` and `npm test` pass (615 tests). `cdk synth` passes with cdk-nag clean.

Upload of `seed/evidence/phone-damaged-imei2.png` as `demo-insurer/cust-demo/EVD-T13-38ff243c` with `kind=DEVICE_PHOTO`:
- Two rows within 4 s: `SHA256` (`7cbac34f...55a1`, equal to the seeded CLM-1042 value) and `PHASH`, both `READY`, `DEVICE_PHOTO`, `claimId UNASSIGNED`, `sk UNASSIGNED#EVD-T13-38ff243c`, `sizeBytes 6455`, `exifDate` null.
- Query by the SHA256 partition key returned `CLM-1042#EVD-1042-1`, `CLM-SCN-D#EVD-SCN-D-1` and the new `UNASSIGNED#...` row. The PHASH key returned the same three.
- Scratch claim on `ITEM-PHONE-1` through the deployed Decision Lambda: `ROUTED_TO_ADJUSTER`, payout 0. Adjuster reasons: "Photo matches claim CLM-1042.", "Photo matches claim CLM-SCN-D.", plus the two "similar to" lines. `REQUIRED_EVIDENCE_PRESENT` passed (the unassigned row counted as the claim's evidence). Flag `EXIF_MISSING`. The customer text does not name any claim.
- Processor: `durationMs 394`, REPORT duration 421.57 ms, billed 722 ms (cold start). Target is under 2 s.
- DLQ: 0 messages.
- Cleanup removed the scratch object, the two evidence rows, the claim and its audit record. Seed data and the stack are unchanged.
