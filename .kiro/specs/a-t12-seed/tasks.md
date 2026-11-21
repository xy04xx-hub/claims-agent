# Implementation Plan: T-12 Synthetic seed data and seed script

## Overview

TypeScript on Node 22, owner A, branch `a/T-12-seed`. Each leaf task (1.1, 2.1, ...) is one commit with the message `feat(T-12): <task title>`. Pure definitions come first, then the I/O scripts, then tests that prove them, then the verification against the user's AWS account.

Tasks marked with `*` are optional extras (properties and checks that go beyond Requirement 11). The other tests are required because Requirement 11 asks for them.

Verification tasks (9.x and 10.x) produce output, not code, so they have no commit. Their output goes into the PR description (Requirement 12.6) with no account IDs, tokens or personal data.

## Tasks

- [ ] 1. Branch and prerequisite check
  - [x] 1.1 Create branch `a/T-12-seed` from `origin/main` and commit the spec
    - Run `git fetch origin`, then `git switch -c a/T-12-seed origin/main`. Confirm `git branch --show-current` prints `a/T-12-seed`. Do not work on `main`, `kiro`, `kiro-a` or `owner-b`.
    - Add `.kiro/specs/a-t12-seed/` (`.config.kiro`, `requirements.md`, `design.md`, `tasks.md`) and commit as `feat(T-12): add T-12 seed spec`.
    - If the spec files only exist on another branch, copy them over without touching other files, and report that.
    - _Requirements: 13.1, 13.4_

  - [x] 1.2 Verify the Foundation stack resource lookup against the deployed dev-a stack, and add dev dependencies
    - Check credentials: `aws sts get-caller-identity` (do not copy the account ID into any file or output).
    - Run `aws cloudformation describe-stacks --stack-name ClaimsAgent-dev-a-Foundation --region us-east-1` and confirm the outputs `ClaimsTableName` and `EvidenceBucketName` exist.
    - Run `aws cloudformation list-stack-resources --stack-name ClaimsAgent-dev-a-Foundation --region us-east-1` and confirm exactly one `AWS::DynamoDB::Table` each matches `^PoliciesTable[0-9A-F]{8}$`, `^ClaimTypePacksTable[0-9A-F]{8}$` and `^EvidenceIndexTable[0-9A-F]{8}$`. Compare with `infra/lib/stacks/foundation-stack.ts` (`${spec.id}Table`).
    - If a logical ID differs, change the regexes in `design.md` (Stage resource resolution) before task 4.1. If the stack is not deployed or credentials are missing, stop and report which prerequisite is missing. Do not mark this task done on assumption.
    - Add `@aws-sdk/client-s3`, `@aws-sdk/client-lambda`, `@aws-sdk/client-cloudformation` and `fast-check` as `devDependencies` of `backend/processing` only: `npm install -D <pkg> -w backend/processing`. Do not hand-edit `package-lock.json`.
    - Commit message: `feat(T-12): add seed dev dependencies and verify Foundation lookup`.
    - _Requirements: 1.1, 1.3, 13.3_

- [ ] 2. Constants, key helpers and hashing
  - [x] 2.1 Add seed constants and key helpers
    - Create `seed/definitions/constants.ts` with `TENANT_ID`, `CUSTOMER_ID`, `POLICY_ID`, `HOLDER_NAME`, the four item IDs, the IMEIs (three, Luhn-valid, synthetic), the plate `DEMO123`, loss dates, `SEED_CREATED_AT` and the `CLM-1042` timestamps, as listed in the design.
    - Create `seed/definitions/keys.ts` with `versionSk`, `evidenceSk` and re-exports of `claimKey`, `policyPk`, `packPk`, `evidenceIndexPk`, `evidenceByIdPk`, `customerPk` from `backend/processing/decision/keys.ts`.
    - _Requirements: 2.1, 3.1, 3.2, 3.3_

  - [x] 2.2 Implement hashing helpers
    - Create `seed/lib/hashing.ts` with `sha256Hex` (`node:crypto`), `normalizeIdentifier` (remove whitespace and hyphens, uppercase) and `dhash64Hex` (integer-only 9x8 difference hash, 16 lowercase hex characters).
    - Document in the file header that T-13 must use the same algorithm and must hash the original file bytes.
    - _Requirements: 6.5_

  - [x] 2.3 Implement PNG encode and decode
    - Create `seed/lib/png.ts` with `encodePng(width, height, rgb)` (signature, IHDR, one IDAT via `zlib.deflateSync`, IEND, own CRC-32 table) and `decodePng(bytes)` (inflate IDAT, reverse filters 0 to 4, bit depth 8, non-interlaced, color types 0, 2 and 6, else throw `Unsupported PNG: <reason>`). Use only `node:zlib`.
    - _Requirements: 6.5, 8.8_

  - [ ]* 2.4 Write property test for PNG round trip and pHash format
    - **Property 10: PNG encode and decode round trip, and pHash format** (round-trip and hash-format parts)
    - In `scripts/seed-evidence.test.ts`: random RGB images 1 to 64 pixels per side round trip, `dhash64Hex` returns 16 lowercase hex characters and is stable. The committed-files part is added in task 3.4.
    - **Validates: Requirements 6.5, 8.8**

- [ ] 3. Policies, packs and evidence files
  - [x] 3.1 Define the policies
    - Create `seed/definitions/policies.ts` with `POLICY_V1` and `POLICY_V2` as domain `Policy` objects (four items in the specified order, deductible 50, start date `2026-01-01`, v1 `effectiveTo` `2026-10-31`, v2 `effectiveFrom` `2026-11-01`, no `laptop` coverage, v2 phone covers `ACCIDENTAL_DAMAGE` and `THEFT` and drops `LOSS`; v1 phone keeps all three). The first three items equal those of `backend/domain/src/fixtures.ts`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 3.2 Define the claim type packs
    - Create `seed/definitions/packs.ts` with `PHONE_PACK` and `CAR_PACK` (equal to `phonePack` and `carPack` of the fixtures) and `LAPTOP_PACK` (all caps 0, no identifier fields, typical value 1500, `minConfidence` 0.8).
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9_

  - [x] 3.3 Add the evidence generator
    - Create `seed/tools/font5x7.ts` (glyphs for space, `0-9`, `A-Z`, `: - . / ( ) ,`; an unknown character throws) and `seed/tools/generate-evidence.ts` (`Canvas` with `fillRect`, `line`, `text`; draws the seven files of the design, each with the line `SYNTHETIC SAMPLE - NOT A REAL DOCUMENT`; takes IMEIs, plate, name and dates from `constants.ts`).
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.10, 8.11_

  - [x] 3.4 Generate and commit the evidence files, manifest and README
    - Run `npx tsx seed/tools/generate-evidence.ts` to write the seven PNG files into `seed/evidence/` (800 x 600, under 5 MB each).
    - Create `seed/definitions/evidence-files.ts` (name, kind, content type, what it shows, scenarios) and `seed/evidence/README.md` (the table of the design, plus the note to file live claims with loss date `2026-11-15` or the current date, and that a `LOSS` claim is routed as not covered by v2).
    - View at least the two damaged-phone images and one police report to confirm the IMEI text is legible.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10, 8.11_

  - [ ]* 3.5 Extend the evidence test for committed files
    - **Property 10: PNG encode and decode round trip, and pHash format** (committed-files part)
    - In `scripts/seed-evidence.test.ts`: decoded pixels of each committed file equal a fresh generator run, size at most 5 MB, every file is in the manifest and mentioned in the README.
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8**

- [ ] 4. Stage resource resolution
  - [x] 4.1 Implement `stage-resources.ts`
    - Create `seed/lib/stage-resources.ts`: `FoundationNames`, `CfnLike`, `MissingResourceError`, `resolveFoundation` (outputs first, then logical-ID regex fallback for the three tables, using the regexes confirmed in 1.2) and `resolveProcessing` (`DecisionFunctionName`). Stack names `ClaimsAgent-${stage}-Foundation` and `-Processing`.
    - Add the real `CfnLike` backed by `CloudFormationClient` in us-east-1 (`DescribeStacks`, `ListStackResources` with paging).
    - _Requirements: 1.1, 1.3, 10.2_

  - [ ]* 4.2 Write unit tests for stage resolution
    - In `scripts/seed.test.ts`: outputs preferred over resources, fallback regex, missing output and missing table raise `MissingResourceError` naming them.
    - _Requirements: 1.1, 1.3_

  - [x] 4.3 Document the EvidenceIndex `type`, `value` and `kind` attributes in `contracts/data-model.md`
    - The user explicitly authorizes this contract change in the T-12 branch. It deviates from the `repository.md` rule that contract changes go in a separate PR. Say so in the commit body and in the PR description.
    - In the `## EvidenceIndex` section of `contracts/data-model.md`, add to the attribute list: `type` (`SHA256`, `PHASH` or `IDENTIFIER`), `value` (the hash, or the normalized identifier for `IDENTIFIER`) and `kind` (`DEVICE_PHOTO`, `POLICE_REPORT`, `PLATE_PHOTO` or `STATEMENT`). Match what `backend/processing/decision/normalize.ts` reads. Change nothing else.
    - Check conventions: `contracts/VERSION` is `1.0.0` and no document describes bumping it for documentation-only changes, so leave it unchanged and note that in the PR. The contracts tests (`contracts/contracts.test.js`) only validate JSON schemas and examples, so no example or test update is needed. Run `npm test -w contracts` (or the root `npm test`) to confirm it still passes.
    - Commit alone as `feat(T-12): document EvidenceIndex type, value and kind in data-model`. It must come before task 5.2.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 13.5_

- [ ] 5. Seed items builder and validation
  - [x] 5.1 Define `CLM-1042` and the scenarios
    - Create `seed/definitions/claim-1042.ts` (claim fields, `decision` computed by `domain.decide`) and `seed/definitions/scenarios.ts` (`SCENARIOS` A, B, B2, C, CI, C2, D, E, E2, F, G, H with claim IDs `CLM-SCN-*`, evidence IDs `EVD-SCN-<id>-1`, `buildProposal` conforming to `contracts/proposal.schema.json`, expected outcome, payout and adjuster text, as in the design table).
    - _Requirements: 6.1, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 10.7_

  - [x] 5.2 Implement the pure builder and validators
    - Create `seed/definitions/build.ts` (`policyToItem`, `packToItem`, `buildScenarioClaimRow`, `buildSeedItems({ files })` returning `{ policies, packs, evidenceIndex, claims }`: three rows for `EVD-1042-1`, scenario rows with unique hashes, scenario D copying the `CLM-1042` hashes, exactly one IDENTIFIER row for the Second_Phone IMEI, `exifDate` as explicit null where needed).
    - Create `seed/definitions/validate.ts` (`assertValidPolicy`, `assertValidPack`, `assertValidEvidenceRow`, `assertNoDuplicateKeys`) and `seed/definitions/index.ts`.
    - The claim row from `buildScenarioClaimRow` has no `gsi1pk`, `gsi1sk`, `decision`, `reasons`, `payout`, `decidedAt`, `gsi2pk` or `gsi2sk`.
    - _Requirements: 2.1, 3.1, 3.2, 4.8, 5.7, 5.8, 6.3, 6.4, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.4_

  - [x] 5.3 Write definition tests for determinism, policies, packs and evidence rows
    - In `scripts/seed-definitions.test.ts`, with `fast-check` where marked:
    - **Property 1: Seed build is deterministic and idempotent** (**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 3.2**)
    - **Property 2: Exactly one policy version is in force on any date** (**Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8**)
    - **Property 3: Pack round trip** (**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9**)
    - **Property 4: Evidence rows are complete and fold back to one record** (**Validates: Requirements 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5**)
    - **Property 5: Scenario hashes are isolated** (**Validates: Requirements 6.6, 7.6, 9.4, 9.10**)
    - Example tests: cap values, item order, Luhn validity of the three IMEIs, no email-like string except `example.com` (Req 11.7), `CLM-1042` decision validates against `contracts/decision.schema.json`, `domain.decide` with the fixtures `thresholds` gives the expected outcomes for every scenario (Req 11.5).
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_

- [ ] 6. Seed script
  - [x] 6.1 Implement `scripts/seed.ts`
    - Header comment naming owner A. Export `SeedDeps` and `runSeed(argv, deps)`; `main()` runs only when executed directly.
    - Flow: `parseStageArg` (import from `scripts/lib/stage-arg.ts`, read-only) -> `resolveFoundation` -> read and check every evidence file (exists, at most 5 MB, PNG, JPEG or `%PDF` signature) -> `buildSeedItems` -> validate -> S3 `PutObject` for the `CLM-1042` photo at `demo-insurer/cust-demo/EVD-1042-1` -> unconditional `PutItem` in the order policies, packs, evidenceIndex, claims.
    - Error handling per the design table: no AWS write on usage, resolution, file or validation errors; S3 failure before any DynamoDB write; stop at first `PutItem` failure with table name and error; exit codes 1 and 0.
    - Print per-table counts (`Policies`, `ClaimTypePacks`, `EvidenceIndex`, `Claims`, `S3 objects`). Print no ARN, account ID or credentials.
    - Real clients in us-east-1 with `maxAttempts: 5`, document client with `removeUndefinedValues: true`. Do not modify `scripts/seed-entry.ts`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4, 2.5, 3.4, 6.2, 8.9, 13.2, 13.7_

  - [x] 6.2 Write unit tests for `runSeed`
    - In `scripts/seed.test.ts` with fake deps: usage on a bad stage, missing output named with no write, missing evidence file named with no write, `PutItem` failure stops with table name and exit 1, S3 failure leaves no DynamoDB write, two runs give the same keys and the same row counts (Req 11.6), success prints counts and exits 0.
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 2.2, 8.9, 11.6_

- [ ] 7. Scenario runner
  - [x] 7.1 Implement `scripts/run-scenarios.ts`
    - Header comment naming owner A. Export `RunnerDeps` and `runScenarios(argv, deps)`.
    - Preflight: `CLM-1042` exists, else print `Seed data not found. Run: npm run seed -- --stage <stage>` and return 1; `now()` on or after `2026-11-15` (the scenario loss date). Also check that each scenario claim row's `createdAt` (`now()`) is not before its loss date and that each photo `exifDate` equals the loss date, so no `TIMELINE_INCONSISTENT` signal fires.
    - Per scenario, sequentially: refuse any claim ID not starting with `CLM-SCN-`; put the full `PROCESSING` row from `buildScenarioClaimRow`; `validateProposal`; invoke the Decision Lambda with `{ tenantId, claimId, proposal, jti: "seed-<id>" }`; check `result: "DECIDED"` and `validateDecision`; compare outcome and expected adjuster text; print `PASS|FAIL  <id>  <outcome>  payout <n>  <ms> ms  <reason>`; kill-switch hint on `AUTO_APPROVE_ENABLED`.
    - Run all scenarios even after a failure, print a summary, return 1 if any failed. No code path writes EvidenceIndex, Policies or ClaimTypePacks. Real clients: Lambda `InvokeCommand` (`RequestResponse`) and the document client.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 13.2_

  - [x] 7.2 Write unit tests for `runScenarios`
    - In `scripts/run-scenarios.test.ts` with fake deps: PASS and FAIL lines, exit 1 with all scenarios still run, `FunctionError`, `NOT_FOUND`, `ALREADY_DECIDED`, preflight failures, kill-switch hint, claim reset on a second run, refusal to write a non-`CLM-SCN-` claim ID.
    - _Requirements: 10.5, 10.6, 10.8, 10.9, 10.10_

  - [ ]* 7.3 Write property test for scenario claim reset
    - **Property 9: Scenario claim reset is independent of prior state**
    - In `scripts/run-scenarios.test.ts`: for any prior stored item, the row written is the same `PROCESSING` row without decision, reasons, payout, `decidedAt` or index keys.
    - **Validates: Requirements 10.4, 10.9**

- [ ] 8. End-to-end test over the real decision path
  - [x] 8.1 Build the in-memory DynamoDB fake and the scenario test
    - Create `scripts/seed-e2e.test.ts`: fake client (`GetCommand`, `QueryCommand` on table and `gsi1`, `PutCommand`), real `DynamoStore` subclass whose `commitDecision` records the result, real `createHandlers` with kill switch true, thresholds from `infra/config/default.json`, `now` `2026-11-21T10:00:00Z`.
    - **Property 6: Scenario outcomes come from the real decision path** (**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.7**). Assert outcome, payout, schema validity and each expected adjuster string for every scenario.
    - Add a test that the seed's `normalizeIdentifier` agrees with the Decision Lambda's `normId`.
    - _Requirements: 11.8_

  - [ ]* 8.2 Write property tests for scenario independence and identifier format
    - **Property 7: Scenarios do not affect each other** (**Validates: Requirements 9.10, 10.9**): any permutation and repeated runs give the same per-scenario result.
    - **Property 8: Identifier format does not hide a reuse** (**Validates: Requirements 6.6, 9.8**): any spacing, hyphens and case of the PHONE-2 IMEI still gives `IDENTIFIER_REUSE` naming `CLM-1042`; `normalizeIdentifier` is idempotent.
    - _Requirements: 6.6, 9.8, 9.10, 10.9_

  - [x] 8.3 Update `seed/README.md`
    - Document: how to seed (`npm run seed -- --stage <stage>`), how to run scenarios, how to regenerate evidence, the loss-date note (`2026-11-15`, inside policy v2, runner needs the clock at or after it), and the seed order and idempotence. No account IDs.
    - _Requirements: 13.2, 13.7_

- [ ] 9. Checkpoint and local verification
  - [x] 9.1 Run lint, typecheck and tests
    - Run `npm run lint`, `npm run typecheck` and `npm test` from the repo root. Report the result of each. Fix failures in A-owned files only. If a fix needs a B-owned file, a contract other than the task 3.5 edit or `backend/shared`, stop and open a separate PR (Requirement 13.5).
    - Also run `npx cdk synth -c stage=ci` if B's files are untouched, as the repository workflow lists it.
    - No commit unless a fix was needed. A fix goes in its own commit `feat(T-12): fix lint and type errors`.
    - _Requirements: 13.6_

  - [x] 9.2 Checkpoint
    - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Verification on the user's account (dev-a)
  - [x] 10.1 Check prerequisites and report any that are missing
    - Confirm: `aws sts get-caller-identity` works; `ClaimsAgent-dev-a-Foundation` exists; `ClaimsAgent-dev-a-Processing` exists and has output `DecisionFunctionName`; the Decision Lambda is deployed (`aws lambda get-function --function-name <name>`).
    - If the stage, credentials or the Decision Lambda are missing, report exactly which one, say that tasks 10.2 to 10.5 are not done, and do not present them as verified. The seed (10.2 to 10.4) needs only Foundation. The scenarios (10.5) need Processing and the Decision Lambda.
    - _Requirements: 12.5_

  - [x] 10.2 Run the seed twice and compare row counts
    - Get the four table names from Foundation outputs and resources. Count each of `Policies`, `ClaimTypePacks`, `EvidenceIndex` and `Claims` with `aws dynamodb scan --table-name <name> --select COUNT --region us-east-1`.
    - Run `npm run seed -- --stage dev-a` (first run). Count the tables. Run it again (second run). Count the tables again.
    - Show a table with the counts after the first run and after the second run, and the script's printed per-table counts. The counts after the second run must equal those after the first run. Report any difference as a failure.
    - _Requirements: 12.1, 12.2, 2.2_

  - [x] 10.3 Read back CLM-1042 and its SHA-256 row
    - Run `aws dynamodb get-item --table-name <claims> --key '{"pk":{"S":"demo-insurer#CLM-1042"},"sk":{"S":"CLAIM"}}'` and show the item with its evidence ID.
    - Run `aws dynamodb get-item` on the EvidenceIndex with `pk` `demo-insurer#SHA256#<sha256 of seed/evidence/phone-damaged-imei2.png>` and `sk` `CLM-1042#EVD-1042-1` (compute the hash with `sha256sum`). Show the row.
    - _Requirements: 6.7, 12.3_

  - [x] 10.4 Check the S3 object
    - Run `aws s3api head-object` for `demo-insurer/cust-demo/EVD-1042-1` in the evidence bucket and show size and encryption type only.
    - _Requirements: 6.2, 2.5_

  - [x] 10.5 Run the scenarios and show A and H
    - Run `npx tsx scripts/run-scenarios.ts --stage dev-a`. Show the full output, and call out the result lines for scenario A (`AUTO_APPROVED`, payout 130) and scenario H (`ROUTED_TO_ADJUSTER` with the identifier reuse reason naming `CLM-1042`).
    - If any scenario fails, show the failing line and the reason, and do not describe the run as passing. If the Decision Lambda is not deployed, report that instead.
    - _Requirements: 10.3, 10.5, 10.6, 12.4_

  - [x] 10.6 Prepare the PR description
    - Compose the PR title `T-12: Synthetic seed data and seed script` and a description containing the commands and outputs of 9.1 and 10.2 to 10.5, with no account IDs, tokens or personal data. List the review items from `design.md` (laptop pack, two duplicate matches in the D demo, `data-model.md` change in this branch by the user's authorization, missing table outputs, test location, no AuditLog row for `CLM-1042`, runner clock at or after `2026-11-15`).
    - Do not push or open the PR unless the user asks.
    - _Requirements: 12.6, 13.4_

- [ ] 11. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional extras. Required tests cover Requirement 11: Properties 1 to 6 and the unit tests.
- One commit per leaf task, `feat(T-12): <task title>`. Verification tasks (9.x, 10.x) have no commit.
- Edit only A-owned paths: `scripts/seed.ts`, `scripts/run-scenarios.ts`, `seed/`, tests in `scripts/`, and `backend/processing/package.json` for dev dependencies. `scripts/seed-entry.ts` and `infra/` are not touched. `contracts/` is touched only by task 4.3.
- Never hand-edit `package-lock.json`. Regenerate with `npm install`.
- Runner preflight: the Scenario_Runner requires `now >= 2026-11-15` (the single scenario loss date, inside policy v2). With that, `createdAt` (now) is not before the loss date and `exifDate` equals the loss date, so the timeline check passes. The early-claim check passes (318 days after the `2026-01-01` start, limit 14) and the frequency check passes (`CLM-1042`, created `2026-10-14`, is outside the 30-day window).
- The only contract change allowed in this branch is the `contracts/data-model.md` edit of task 4.3, explicitly authorized by the user. It deviates from the `repository.md` rule that contract changes go in a separate PR. The PR description says so.
- All data is synthetic. No account IDs, secrets or tokens in files, output or the PR description.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.1", "3.2"] },
    { "id": 4, "tasks": ["2.4", "3.3", "4.1"] },
    { "id": 5, "tasks": ["3.4", "4.2"] },
    { "id": 6, "tasks": ["3.5", "4.3", "5.1"] },
    { "id": 7, "tasks": ["5.2"] },
    { "id": 8, "tasks": ["5.3", "6.1", "7.1"] },
    { "id": 9, "tasks": ["6.2", "7.2", "8.1"] },
    { "id": 10, "tasks": ["7.3", "8.2", "8.3"] },
    { "id": 11, "tasks": ["9.1"] },
    { "id": 12, "tasks": ["10.1"] },
    { "id": 13, "tasks": ["10.2"] },
    { "id": 14, "tasks": ["10.3", "10.4"] },
    { "id": 15, "tasks": ["10.5"] },
    { "id": 16, "tasks": ["10.6"] }
  ]
}
```
