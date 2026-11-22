# Implementation Plan: T-13 Evidence Processor

## Overview

Build the Evidence Processor Lambda (TypeScript, Node.js 22, ARM64) in `backend/processing/evidence-processor`, wire it into `ProcessingStack`, make two small Decision Lambda changes, and verify the result on `dev-a`. Work is on branch `a/T-13-evidence-processor`, cut from `origin/main`. Each leaf task is one commit with the message `feat(T-13): <task>`. Leaf tasks that change no file (deploy, verification) make no commit. Unit tests are plain Vitest and are required, not optional. They are written in the same leaf task and commit as the code they test. Nothing is pushed and no PR is opened in this plan.

Order follows dependencies: the Decision Lambda changes come first because they only need `UNASSIGNED` as a constant. The processor modules follow, from the leaves (`key`, `kind`, `exif`) up to `process.ts`, then `index.ts`, then CDK.

## Tasks

- [ ] 1. Branch and spec
  - [x] 1.1 Create the ticket branch and commit the spec
    - `git fetch origin`, then `git switch -c a/T-13-evidence-processor origin/main`
    - Commit `.kiro/specs/a-t13-evidence/` (`requirements.md`, `design.md`, `tasks.md`, `.config.kiro`)
    - Commit message: `feat(T-13): add evidence processor spec`
    - Do not commit to `main`, `kiro`, `kiro-a` or `owner-b`
    - _Requirements: 11.1 (repository.md sections 5 to 7)_

- [ ] 2. Decision Lambda changes (A-owned, `backend/processing/decision`)
  - [x] 2.1 Make `findOtherClaims` ignore unassigned rows, with tests
    - In `keys.ts` add `export const UNASSIGNED_CLAIM_ID = "UNASSIGNED";`
    - In `dynamo-store.ts` filter `UNASSIGNED_CLAIM_ID` out of the claim IDs, for both the `claimId` attribute and the `sk` prefix fallback. Add one sentence to the `Store` doc comment: "Rows not yet assigned to a claim are ignored."
    - Extend `dynamo-store.test.ts`: rows `[CLM-1042, UNASSIGNED, own claim]` return only `["CLM-1042"]`, with the `claimId` attribute present and absent (sk fallback). The test fails if `UNASSIGNED` is returned.
    - Commit message: `feat(T-13): ignore unassigned evidence rows in findOtherClaims`
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 2.2 Count listed unassigned rows as the claim's own evidence, with tests
    - In `evaluate.ts` extend the `own` filter: keep `!e.claimId`, `e.claimId === claim.claimId`, and `e.claimId === UNASSIGNED_CLAIM_ID && claim.evidenceIds.includes(e.evidenceId)`
    - Extend `decision.test.ts`: a claim whose evidence records all carry `claimId: "UNASSIGNED"` gets the right `provided` kinds and `EXIF_MISSING` handling. An unassigned record whose `evidenceId` is not on the claim is excluded. All existing tests stay green.
    - Add or keep a test that the model-proposal approval limits are unchanged (approval above the cap or with a risk signal is still impossible), per the working agreement for approval-logic changes
    - Commit message: `feat(T-13): use listed unassigned evidence as own evidence`
    - _Requirements: 10.1, 10.2, 10.3_

- [ ] 3. Processor copies of the hashing code
  - [x] 3.1 Copy `hashing.ts` and `png.ts` from `seed/lib`, with a parity test
    - Create `backend/processing/evidence-processor/hashing.ts` and `png.ts` as verbatim copies with the one-line header from the design (`// COPY of seed/lib/<file>. ...`, three lines as written there). The seed files stay untouched. No new native dependency.
    - Create `parity.test.ts` with: the copy ends with the exact seed text (CRLF normalized) for both files, the header is present, and for each `seed/evidence/*.png` the copy's `sha256Hex` and `dhash64Hex(decodePng(...))` equal the seed results
    - Add `evidence-processor` to `include` in `backend/processing/tsconfig.json` and `evidence-processor/**/*.test.ts` to `backend/processing/vitest.config.ts` in this commit, so the new tests run and typecheck. Task 6.1 does not repeat this.
    - Commit message: `feat(T-13): copy seed hashing and png decoder with parity test`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 1.6_

- [ ] 4. Pure helper modules
  - [x] 4.1 Implement key decoding and parsing, with tests
    - `key.ts`: `decodeS3Key` (`+` to space, `decodeURIComponent`, malformed escape throws), `parseEvidenceKey` (three non-empty parts, `TENANT_OR_CUSTOMER` and `EVIDENCE_ID` patterns), `evidenceSk` (`claimId#evidenceId`), re-export or import `UNASSIGNED_CLAIM_ID`, `evidenceIndexPk`, `evidenceByIdPk` from `../decision/keys.js`
    - `key.test.ts`: decode (`+`, `%20`, malformed `%`); parse valid keys; too few or too many parts, empty parts, `#`, spaces, over-long parts, bad evidence ID; `evidenceSk` equals `evidenceSk` from `seed/definitions/keys.js` for sample inputs (add to `parity.test.ts`)
    - Commit message: `feat(T-13): add evidence key parsing`
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 4.2 Implement kind resolution, with tests
    - `kind.ts`: `EVIDENCE_KINDS`, `resolveKind(metadataKind, contentType, warn)` with the content-type table (`image/png` and `image/jpeg` to `DEVICE_PHOTO`, `application/pdf` to `POLICE_REPORT`, anything else or missing to `STATEMENT`). Lower-case the type and strip parameters after `;`. The warning does not include the metadata value.
    - `kind.test.ts`: valid metadata wins (all four kinds, case-sensitive); invalid or missing metadata falls back for every table row, an unknown type and a missing type; `warn` is called on fallback only
    - Commit message: `feat(T-13): add evidence kind resolution`
    - _Requirements: 4.5, 4.6_

  - [x] 4.3 Implement the EXIF date parser, with a JPEG builder and tests
    - `exif.ts`: `parseExifDate(bytes): string | null`, hand-written, bounds-checked reads, top-level `try`, algorithm as in the design (segment walk, TIFF header, IFD0, ExifIFD `0x8769`, `DateTimeOriginal` `0x9003`, calendar validation, year at least 1900)
    - `test/helpers.ts`: create it with `buildJpeg({ date, endian })` and a small PNG builder using the copied `encodePng`
    - `exif.test.ts`: little and big endian; no APP1; APP1 without the Exif header (XMP); Exif without ExifIFD; ExifIFD without `0x9003`; `0000:00:00 00:00:00` and `2026:13:40` give `null`; every truncation length of one valid JPEG returns a string or `null` and does not throw; a lying IFD entry count; PNG and PDF bytes give `null`
    - Commit message: `feat(T-13): add exif capture date parser`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 5. Processing core
  - [x] 5.1 Implement `process.ts` with fake dependencies and tests
    - `process.ts`: `S3ObjectCreatedEvent`, `ObjectData`, `ProcessDeps`, `ProcessConfig`, `Outcome`, `EvidenceRow`, `processObject` following the twelve steps in the design (event validation, bucket check, key parse, size guard, single `getObject`, SHA-256, format sniffing, PNG pixel cap and dHash in `try`, JPEG EXIF, kind, `putRows`, one `evidence processed` log line). `createdAt` is `event.time`, with `deps.now()` as fallback only. Rows are unconditional puts.
    - `test/helpers.ts`: add the fakes (in-memory object store, table keyed by `pk` and `sk`, log recorder with a clock)
    - `process.test.ts`: PNG gives SHA256 and PHASH rows; JPEG and PDF give SHA256 only; undecodable PNG (truncated, unsupported color type, over the pixel cap, wrong signature with `image/png`) gives `FAILED`, no PHASH, no throw; invalid key, wrong bucket, oversized object, missing bucket or key: no S3 call, no row; `getObject` rejects and `putRows` rejects: rethrown; first attempt fails at `putRows`, second succeeds, final table equals a clean run; object read once; same bytes twice give the same SHA-256; row field set and key formats; `claimId` and `sk` are unassigned; IDs come from the key; `createdAt` is the event time; log lines carry `evidenceId` and request ID, the completion line carries kind, content type, status and duration, and no log field holds file bytes or the full key of an invalid object
    - Commit message: `feat(T-13): add evidence processing core`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 7.2_

  - [x] 5.2 Extend the parity test with seed row comparisons
    - In `parity.test.ts`, run `processObject` on `seed/evidence/phone-damaged-imei2.png` with the processor copy and compare with the `CLM-1042` SHA256 and PHASH rows from `buildSeedItems` (values computed with the seed implementation): equal `value` and `pk`
    - Assert the processor's SHA256 row has the same key set as the seed's `CLM-1042` SHA256 row, the same `pk`, `gsi1pk` and `gsi1sk` formats, and that the part of `sk` after the claim ID is the evidence ID in both
    - Commit message: `feat(T-13): add seed row parity tests`
    - _Requirements: 2.6, 4.9, 8.1_

- [ ] 6. Lambda entry point and dependencies
  - [x] 6.1 Add `index.ts` and move the S3 client dependency
    - `index.ts`: real `S3Client`, `DynamoDBDocumentClient` with `removeUndefinedValues: true`, Powertools `Logger` passed to `createLogSink` from `../decision/powertools.js`, `env` and `num` helpers that fail at cold start on a missing variable, `deps`, and `handler(event, ctx)` that calls `processObject` with `EVIDENCE_BUCKET` and `MAX_OBJECT_BYTES`. No logic beyond wiring.
    - Move `@aws-sdk/client-s3` from `devDependencies` to `dependencies` with `npm install @aws-sdk/client-s3 -w backend/processing --save-prod`. Do not hand-edit `package-lock.json`.
    - Confirm `tsconfig.json` and `vitest.config.ts` include the processor folder (added in 3.1) and that `npm run typecheck` passes
    - Commit message: `feat(T-13): add evidence processor handler`
    - _Requirements: 1.1, 1.6, 6.1_

- [ ] 7. CDK wiring
  - [x] 7.1 Add the processor, rule, DLQ, IAM and nag acknowledgments to `ProcessingStack`, with stack tests
    - In `infra/lib/stacks/processing-stack.ts`: `ClaimsFunction` `evidence-processor` (entry `backend/processing/evidence-processor/index.ts`, timeout 20 s, 1024 MB, env `EVIDENCE_INDEX_TABLE`, `EVIDENCE_BUCKET`, `MAX_OBJECT_BYTES` = `maxUploadBytes * 2`), expose `evidenceProcessorFunction`; DLQ `EvidenceEventsDlq` (SQS-managed encryption, `enforceSSL`, 14-day retention); EventBridge rule on S3 `Object Created` for the evidence bucket with key `wildcard: '*/*/*'` and one target with `retryAttempts: 2`, `maxEventAge` 5 min and the DLQ; `configureAsyncInvoke` with 2 retries, 5 min and an SQS failure destination; role statements added with `addToRolePolicy` (`s3:GetObject` on `bucketArn/*/*/*`, `dynamodb:PutItem` on the EvidenceIndex table ARN, KMS `Decrypt`, `GenerateDataKey`, `DescribeKey` on `dataKey`, `sqs:SendMessage` on the DLQ). No `grantRead` and no `key.grant`. Add `cdk.Validations.of(...).acknowledge` calls for the rules `cdk synth` reports (expected `AwsSolutions-IAM5`, `AwsSolutions-L1`, `AwsSolutions-SQS3`), each with a reason of at least 10 characters. If the `wildcard` operator is rejected on deploy, use `anything-but` prefix `normalized/` and note it in the PR.
    - Update `infra/test/processing-stack.test.ts`: Lambda count 1 to 2, decision function selected by `Timeout` and `MemorySize`; "no wildcard resource except X-Ray" also allows the single S3 object ARN for `s3:GetObject`; "no write on Policies, ClaimTypePacks or EvidenceIndex" scoped to the decision role; new assertions for the rule pattern (source, detail type, bucket name reference, key wildcard), one target with `RetryPolicy` (2, 300 s) and `DeadLetterConfig`, function env variable names, `EventInvokeConfig` (2 retries, 300 s, failure destination), the processor role statements exactly as in the design and `PutItem` limited to the EvidenceIndex table ARN, no wildcard action, and the DLQ (SQS-managed encryption, SSL-only policy, 14-day retention)
    - Run only `processing-stack.test.ts` for this commit. The B test files are updated in 7.2.
    - Commit message: `feat(T-13): add evidence processor to processing stack`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 5.2, 5.3_

  - [x] 7.2 Update the two B-owned test expectations (one line each)
    - `infra/test/stacks.test.ts`: update the "known acknowledgments" list to the final processor entries
    - `infra/test/claims-function.test.ts`: change the Processing function count from 1 to 2
    - Change nothing else in either file. Mention in the PR that owner B should review these two lines.
    - Commit message: `feat(T-13): update shared infra test expectations`
    - _Requirements: 1.5, 1.7, 11.2_

- [ ] 8. Checkpoint - lint, typecheck, test and synth
  - Run `npm run lint`, `npm run typecheck`, `npm test` and `npx cdk synth -c stage=ci` (from `infra/` if the root script does not forward it). All four must pass, including the Processing workspace tests (processor, parity, decision) and all of `infra/test`.
  - If a fix is needed, make it in the leaf task it belongs to using a `fixup` commit and autosquash before the verification starts, or a separate `fix(T-13): ...` commit. Ask the user if questions arise.
  - _Requirements: 11.1, 11.2_

- [ ] 9. Deploy to dev-a
  - [x] 9.1 Deploy `ClaimsAgent-dev-a-Processing`
    - Check the prerequisites by name and stop with the missing name if one fails: `aws sts get-caller-identity` works, `ClaimsAgent-dev-a-Foundation` is `CREATE_COMPLETE` or `UPDATE_COMPLETE`, the Foundation resource names resolve, `CLM-1042` exists in the Claims table, and `sha256sum seed/evidence/phone-damaged-imei2.png` equals the seeded SHA256
    - From `infra/` with `CDK_DEFAULT_ACCOUNT` set: `npx cdk deploy ClaimsAgent-dev-a-Processing -c stage=dev-a --require-approval never`. Only the Processing stack changes. Ask the user before deploying if the target account or stage differs from `dev-a`.
    - No file changes, so no commit
    - _Requirements: 12.1, 12.2, 12.9_

- [ ] 10. Verification on dev-a
  - [x] 10.1 Run the verification procedure and record the output
    - One throwaway shell block with `trap cleanup EXIT` set before the first write, names read from CloudFormation, nothing hard-coded, nothing committed. Each step prints `PASS`, `FAIL <cause>` or `NOT RUN <cause>`. A step that did not run is never reported as passed.
    - Upload `seed/evidence/phone-damaged-imei2.png` to `demo-insurer/cust-demo/EVD-T13-<random>` with `--metadata kind=DEVICE_PHOTO` and content type `image/png`
    - Show the `EvidenceIndex` rows for that `evidenceId` (`byEvidence` index, polled up to 30 s): a `SHA256` and a `PHASH` row, `READY`, `DEVICE_PHOTO`
    - Query by the SHA256 partition key and show both `CLM-1042#EVD-1042-1` and `UNASSIGNED#<evidenceId>`. Repeat for PHASH.
    - Put a scratch claim `CLM-T13-<random>` in `PROCESSING` with `evidenceIds: [<evidenceId>]`, cause `ACCIDENTAL_DAMAGE`, item `ITEM-PHONE-2`, no `gsi1pk` or `gsi1sk`. Invoke the Decision Lambda with `contracts/proposal.example.json` (claim ID replaced). Show `ROUTED_TO_ADJUSTER` with a reason that names `CLM-1042`.
    - Read `durationMs` from the `evidence processed` log line and the `REPORT` line (duration and memory) in CloudWatch Logs, as evidence for the 2 s target
    - Show the DLQ has 0 visible messages
    - Cleanup (success or failure, no prompt): delete only what the run created, which is the scratch S3 object, the SHA256 and PHASH rows for the scratch `evidenceId`, the scratch claim, and its audit records. Skip deletes for variables that were never set. Leave the seed data and the stack unchanged.
    - If the run fails, report the step and cause and stop. Do not change code in this task.
    - No file changes, so no commit
    - _Requirements: 7.1, 8.1, 8.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10_

- [ ] 11. PR description draft
  - [x] 11.1 Write the PR description draft and commit it with the spec
    - Create `.kiro/specs/a-t13-evidence/pr-description.md`. Title `T-13: Evidence processor`. Sections: summary; what changed by area; the design's "Decisions and deviations" (key-shape filter, Lambda async retry then DLQ, the DLQ and its `sqs:SendMessage`, size and pixel guards, `createdAt` is event time, `STATEMENT` fallback, memory and timeout); known limitations (two new claims with the same photo are not matched until T-15, the Worker must wait for rows before signing a ticket, decompression bomb with a false IHDR, DLQ alarm belongs to T-25, `seed/lib` copies); the two B test lines for owner B to review; the output of the verification (step results, rows, SHA256 query, routing reason naming `CLM-1042`, duration, DLQ depth, cleanup result), with account IDs and ARNs removed
    - Use only real output from task 10.1. Mark any step that did not run as `NOT RUN` with its cause.
    - Do not push the branch and do not run `gh pr create`
    - Commit message: `feat(T-13): add pr description draft`
    - _Requirements: 11.2, 12.9_

## Notes

- All leaf tasks are required. There are no optional tasks and no property-based tests: the design's correctness properties are implemented as plain unit tests over tables of representative inputs.
- Property coverage: 1 and 2 in 5.1, 3 in 3.1 and 5.2, 4 in 4.3, 5 in 5.1 and 5.2, 6 in 5.1, 7 in 4.2, 8 and 9 and 10 in 5.1, 11 in 2.1, 12 in 2.2.
- Stay in A-owned folders. The only B-owned edits are the two one-line test changes in 7.2.
- Do not hand-edit `package-lock.json`. On a lockfile conflict take `main`'s version, run `npm install` and commit the result.
- Keep PRs under about 400 changed lines excluding generated files. If the diff is larger, report it to the user before opening the PR.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2"] },
    { "id": 6, "tasks": ["4.3"] },
    { "id": 7, "tasks": ["5.1"] },
    { "id": 8, "tasks": ["5.2"] },
    { "id": 9, "tasks": ["6.1"] },
    { "id": 10, "tasks": ["7.1"] },
    { "id": 11, "tasks": ["7.2"] },
    { "id": 12, "tasks": ["9.1"] },
    { "id": 13, "tasks": ["10.1"] },
    { "id": 14, "tasks": ["11.1"] }
  ]
}
```
