# Requirements Document

## Introduction

Source of scope: `docs/plan/tickets/T-13-evidence-processor.md`. This spec covers the Evidence Processor Lambda (owner A, branch `a/T-13-evidence-processor`). When a customer uploads a file to the evidence bucket, the Evidence Processor computes its hashes and EXIF capture date and writes `EvidenceIndex` rows in the exact shape the seed script writes, so duplicate-photo detection is already possible when a claim is processed. The MVP is reduced against the ticket: SHA-256 for every file, a perceptual hash (dHash, 64 bit) for PNG only, and EXIF `DateTimeOriginal` for JPEG only. The items dropped from the ticket are listed under "Out of scope".

Two small A-owned changes in `backend/processing/decision` ship in the same PR, because evidence rows exist before a claim exists: the rows carry the placeholder claim ID `UNASSIGNED`.

Known limitation: until T-15 assigns claim IDs to evidence rows, two new claims that use the same photo are not matched against each other, because both photos sit under `UNASSIGNED`. A new claim is still matched against any earlier claim whose rows carry a real claim ID, such as `CLM-1042`.

## Glossary

- **Evidence_Processor**: The Lambda in `backend/processing/evidence-processor` that handles one S3 `Object Created` event per invocation.
- **Processing_Stack**: The CDK stack `ClaimsAgent-<stage>-Processing` in `infra/lib/stacks/processing-stack.ts`.
- **Evidence_Bucket**: The private S3 bucket that holds uploaded evidence under keys `<tenantId>/<customerId>/<evidenceId>`.
- **Evidence_Index**: The DynamoDB table `EvidenceIndex` described in `contracts/data-model.md`.
- **Evidence_Row**: One Evidence_Index item with keys `pk` = `evidenceIndexPk(tenantId, type, value)` and `sk` = `evidenceSk(claimId, evidenceId)`, built exactly as `evidenceRow` in `seed/definitions/build.ts`.
- **Seed_Lib**: The code in `seed/lib` that provides `decodePng` and `dhash64Hex`.
- **Unassigned_Claim_Id**: The literal string `UNASSIGNED`. The sort key of a row written before a claim exists is `UNASSIGNED#<evidenceId>`.
- **Kind**: The evidence kind of a file, for example `DEVICE_PHOTO`, `PLATE_PHOTO`, `POLICE_REPORT`.
- **Exif_Date**: The `DateTimeOriginal` value of a JPEG, as an ISO date string, or `null`.
- **Processing_Status**: `READY` when the file was processed, `FAILED` when a PNG could not be decoded.
- **Decision_Store**: `backend/processing/decision/dynamo-store.ts`, including `findOtherClaims`.
- **Evaluate_Module**: `backend/processing/decision/evaluate.ts`.
- **Decision_Lambda**: The Lambda from T-14 that decides a claim.
- **Seed_Duplicate_Photo**: `seed/evidence/phone-damaged-imei2.png`, the photo behind claim `CLM-1042` and its committed PHASH row.
- **Demo_Account**: The user's AWS account and the deployed stage `dev-a`.

## Requirements

### Requirement 1: Event trigger and deployment

**User Story:** As the claims platform, I want the Evidence Processor to run on every evidence upload, so that hashes exist before a claim is processed.

#### Acceptance Criteria

1. THE Processing_Stack SHALL deploy the Evidence_Processor as a Node.js 22 ARM64 Lambda built from `backend/processing/evidence-processor/index.ts`, with a deliberately set timeout.
2. THE Processing_Stack SHALL create an EventBridge rule that matches `Object Created` events from the Evidence_Bucket and targets the Evidence_Processor.
3. THE EventBridge rule SHALL filter on the evidence key shape `<tenantId>/<customerId>/<evidenceId>` (at least two slashes), so objects written elsewhere in the bucket do not invoke the Evidence_Processor.
4. THE Processing_Stack SHALL give the Evidence_Processor a dedicated IAM role that allows `s3:GetObject` on the Evidence_Bucket evidence key shape, `dynamodb:PutItem` on the Evidence_Index, use of the data KMS key, and `sqs:SendMessage` (plus the read-only `sqs:GetQueueAttributes` and `sqs:GetQueueUrl` that CDK adds) on the failed-event dead-letter queue, and nothing else.
5. THE Processing_Stack SHALL add a cdk-nag suppression with a written reason for every rule the Evidence_Processor resources trigger.
6. THE Evidence_Processor SHALL use no new native dependencies.
7. WHEN the stack is synthesized, THE Processing_Stack SHALL pass the stack assertion tests for the rule pattern, the role policy and the absence of wildcard actions.

### Requirement 2: Hashing

**User Story:** As a fraud analyst, I want every uploaded file hashed, so that exact reuse of a file is found.

#### Acceptance Criteria

1. WHEN the Evidence_Processor reads an object, THE Evidence_Processor SHALL compute the SHA-256 of the object bytes as lowercase hex.
2. WHEN the same bytes are processed twice, THE Evidence_Processor SHALL produce the same SHA-256.
3. WHEN the object is a PNG that decodes, THE Evidence_Processor SHALL compute the 64-bit perceptual hash with a copy of `dhash64Hex` and `decodePng`, and SHALL write a PHASH Evidence_Row.
4. WHEN the object is a JPEG or a PDF, THE Evidence_Processor SHALL write a SHA256 Evidence_Row and no PHASH Evidence_Row.
5. THE Evidence_Processor SHALL keep `decodePng` and `dhash64Hex` in `backend/processing/evidence-processor` identical in behavior to the versions in Seed_Lib.
6. THE test suite SHALL include a parity test that computes the PHASH of Seed_Duplicate_Photo with the processor copy and asserts equality with the committed CLM-1042 PHASH row and with the Seed_Lib result.

### Requirement 3: EXIF capture date

**User Story:** As a fraud analyst, I want the photo capture date recorded, so that a timeline mismatch with the loss date can be found.

#### Acceptance Criteria

1. WHEN the object is a JPEG with an APP1 Exif segment that holds `DateTimeOriginal`, THE Evidence_Processor SHALL parse the segment with a hand-written parser and store the value as the Exif_Date.
2. WHEN the object is not a JPEG, or the JPEG has no APP1 Exif segment or no `DateTimeOriginal`, THE Evidence_Processor SHALL store the Exif_Date as `null`.
3. IF the APP1 segment is truncated or malformed, THEN THE Evidence_Processor SHALL store the Exif_Date as `null` and continue processing.
4. THE test suite SHALL cover a JPEG with `DateTimeOriginal`, a JPEG without EXIF, a truncated segment, a PNG and a PDF.

### Requirement 4: Evidence_Index row shape and keys

**User Story:** As the Decision Lambda, I want evidence rows in the same shape as seeded rows, so that the existing lookups work unchanged.

#### Acceptance Criteria

1. WHEN a file is processed, THE Evidence_Processor SHALL write each Evidence_Row with the fields `pk`, `sk`, `gsi1pk`, `gsi1sk`, `type`, `value`, `kind`, `claimId`, `evidenceId`, `customerId`, `exifDate`, `processingStatus`, `contentType`, `createdAt`, `s3Key` and `sizeBytes`, with the key helpers used in `seed/definitions/build.ts`.
2. THE Evidence_Processor SHALL set `claimId` to Unassigned_Claim_Id and `sk` to `UNASSIGNED#<evidenceId>`, because no claim exists at upload time.
3. THE Evidence_Processor SHALL take `tenantId`, `customerId` and `evidenceId` from the S3 object key `<tenantId>/<customerId>/<evidenceId>`.
4. IF the S3 object key does not have the form `<tenantId>/<customerId>/<evidenceId>`, THEN THE Evidence_Processor SHALL log a warning and write no row.
5. WHEN the object carries the S3 metadata `x-amz-meta-kind`, THE Evidence_Processor SHALL use its value as the Kind.
6. IF the S3 metadata `x-amz-meta-kind` is missing or not an allowed Kind, THEN THE Evidence_Processor SHALL derive the Kind from the content type and log a warning.
7. WHEN a file is processed, THE Evidence_Processor SHALL set `processingStatus` to `READY`.
8. THE Evidence_Processor SHALL write rows with unconditional `PutItem`, so a repeated event for the same object overwrites the same rows and creates no duplicates.
9. THE test suite SHALL assert that a processed row has the same field set and key format as the CLM-1042 rows built by `seed/definitions/build.ts`.

### Requirement 5: Error handling

**User Story:** As an operator, I want unreadable files recorded and transient failures retried, so that no evidence silently disappears.

#### Acceptance Criteria

1. IF a PNG cannot be decoded, THEN THE Evidence_Processor SHALL write a SHA256 Evidence_Row with `processingStatus` `FAILED`, SHALL write no PHASH row, and SHALL complete without throwing.
2. IF reading the object from S3 fails, THEN THE Evidence_Processor SHALL throw the error, so Lambda asynchronous invocation retries it and, when the retries are exhausted, sends the event to the dead-letter queue.
3. IF writing to the Evidence_Index fails, THEN THE Evidence_Processor SHALL throw the error, so Lambda asynchronous invocation retries it and, when the retries are exhausted, sends the event to the dead-letter queue.
4. WHEN a retried invocation processes the same object, THE Evidence_Processor SHALL end with the same rows as a first successful invocation.

### Requirement 6: Logging and privacy

**User Story:** As an operator, I want structured logs that never hold personal data, so that I can trace one upload safely.

#### Acceptance Criteria

1. THE Evidence_Processor SHALL write structured JSON logs that include `evidenceId` and the Lambda request ID.
2. THE Evidence_Processor SHALL omit file bytes, the policyholder name and extracted document text from logs.
3. WHEN a file has been processed, THE Evidence_Processor SHALL log the Kind, the content type, the Processing_Status and the processing duration in milliseconds.

### Requirement 7: Performance

**User Story:** As the demo audience, I want evidence processed quickly, so that the claim is decided in seconds.

#### Acceptance Criteria

1. WHEN a file of at most 5 MB is processed, THE Evidence_Processor SHALL complete within 2 seconds, measured by the logged duration.
2. THE Evidence_Processor SHALL read each object from S3 once per invocation.

### Requirement 8: Duplicate detection of the seeded photo

**User Story:** As a judge, I want the seeded photo, uploaded again, to be found as a duplicate of CLM-1042, so that the fraud moment of the demo works.

#### Acceptance Criteria

1. WHEN Seed_Duplicate_Photo is uploaded again, THE Evidence_Processor SHALL write a SHA256 row and a PHASH row whose `value` equals the SHA256 and PHASH of the committed CLM-1042 rows.
2. WHEN a query by the SHA256 partition key returns rows, THE Evidence_Index SHALL return both the CLM-1042 row and the `UNASSIGNED#<evidenceId>` row.

### Requirement 9: Decision_Store ignores unassigned rows in claim matching

**User Story:** As the decision rules, I want `findOtherClaims` to report only real claims, so that an unassigned upload never counts as another claim.

#### Acceptance Criteria

1. WHEN `findOtherClaims` reads rows for a hash or identifier, THE Decision_Store SHALL ignore rows whose `claimId` is Unassigned_Claim_Id.
2. WHEN `findOtherClaims` reads rows that include both a real claim ID and Unassigned_Claim_Id, THE Decision_Store SHALL return only the real claim IDs, excluding the claim under decision.
3. THE test suite SHALL include a Decision_Store test that fails if Unassigned_Claim_Id rows are returned.

### Requirement 10: Evaluate_Module uses unassigned rows as the claim's own evidence

**User Story:** As the decision rules, I want evidence uploaded for a claim to count as that claim's evidence, so that Kind and EXIF checks work before T-15 assigns claim IDs.

#### Acceptance Criteria

1. WHEN the Evaluate_Module collects the evidence rows of the claim under decision for Kind and Exif_Date purposes, THE Evaluate_Module SHALL include rows with `claimId` Unassigned_Claim_Id whose `evidenceId` is listed on the claim.
2. THE Evaluate_Module SHALL exclude Unassigned_Claim_Id rows whose `evidenceId` is not listed on the claim.
3. THE test suite SHALL include an Evaluate_Module test in which a claim whose evidence rows all carry Unassigned_Claim_Id is evaluated with the correct Kind and Exif_Date.

### Requirement 11: Parity and regression tests

**User Story:** As a reviewer, I want tests that tie the processor to the seed, so that drift is caught.

#### Acceptance Criteria

1. WHEN `npm test` runs for the Processing workspace, THE test suite SHALL run the processor tests, the parity test from Requirement 2 and the two decision tests from Requirements 9 and 10.
2. WHEN `npm run lint`, `npm run typecheck` and `npx cdk synth -c stage=ci` run, THE repository SHALL pass all three.

### Requirement 12: Verification in the Demo_Account

**User Story:** As reviewer, I want proof from a real deployment, so that the PR evidence shows the duplicate is found end to end.

#### Acceptance Criteria

1. WHEN the verification runs, THE verification procedure SHALL first check its prerequisites (valid AWS credentials for the Demo_Account, deployed Foundation stack, seeded data including `CLM-1042`, and a `dev-a` Processing stack that can be deployed), and SHALL report any missing prerequisite with its name instead of continuing silently.
2. WHEN the prerequisites hold, THE verification procedure SHALL deploy `ClaimsAgent-dev-a-Processing`.
3. WHEN the stack is deployed, THE verification procedure SHALL upload Seed_Duplicate_Photo to the Evidence_Bucket under `demo-insurer/cust-demo/<evidenceId>` with the metadata `kind=DEVICE_PHOTO`, using a newly generated scratch `evidenceId`.
4. WHEN the upload has been processed, THE verification procedure SHALL show the Evidence_Index rows written for that `evidenceId`.
5. WHEN the rows exist, THE verification procedure SHALL query the Evidence_Index by the SHA256 partition key and SHALL show that the result holds both the `CLM-1042` row and the `UNASSIGNED#<evidenceId>` row.
6. WHEN the rows exist, THE verification procedure SHALL create a scratch claim in status `PROCESSING` whose evidence is the uploaded `evidenceId`, SHALL invoke the Decision_Lambda for that claim, and SHALL show that the routing reasons name `CLM-1042`.
7. WHEN the verification ends, whether it succeeded or failed, THE verification procedure SHALL delete only the objects and rows it created (the scratch S3 object, the Evidence_Rows for the scratch `evidenceId`, the scratch claim and its audit record) without asking for confirmation.
8. THE verification procedure SHALL leave the seeded data and the deployed stack unchanged.
9. IF a step cannot run, THEN THE verification procedure SHALL state the step and the cause in the report, and SHALL NOT report the step as passed.
10. THE verification procedure SHALL record the processor duration from CloudWatch Logs as evidence for Requirement 7.

## Out of scope

The following items of the ticket are not part of the MVP and are not built in this spec:

- The normalized copy of the image (resize to 1568 px, EXIF stripping, JPEG output under `normalized/`, `sharp`).
- Perceptual hash of JPEG files. JPEG and PDF files get a SHA256 row only.
- Near-duplicate search by Hamming distance (threshold scan, BK-tree). Only exact SHA-256 and exact PHASH equality are used.
- Assigning real claim IDs to evidence rows (T-15). Rows keep Unassigned_Claim_Id until then.
- Presigned POST metadata in the evidence upload API (owner B). The Kind fallback by content type covers uploads without the `kind` metadata.
- The ticket status `REJECTED` for unreadable files. This spec uses `FAILED`.
