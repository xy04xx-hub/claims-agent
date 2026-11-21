# Requirements Document

## Introduction

Ticket T-12 (owner A, branch `a/T-12-seed`) delivers the synthetic seed data and the scripts that load it. `scripts/seed.ts` writes the tenant, customers, policies, claim type packs, prior claim `CLM-1042`, evidence hashes, identifier rows and typical values into the stage's DynamoDB tables and evidence bucket. `scripts/run-scenarios.ts` is a separate A-owned script that submits scenarios A to H to the deployed Decision Lambda. Hand-made synthetic evidence files live in `seed/evidence/`. All data is synthetic. `scripts/seed-entry.ts` (owner B) is not modified. It already spawns `scripts/seed.ts --stage <stage>`.

Scope source: `docs/plan/tickets/T-12-seed.md`. This spec adds no scope beyond it, except `scripts/run-scenarios.ts` and the run-and-show-results requirement, which the user confirmed in the clarify step.

Scenarios A to H and their data follow the demo scenarios in `backend/domain/src/decide.test.ts` and the fixtures in `backend/domain/src/fixtures.ts`. Causes, categories, item, policy and pack shapes follow `backend/domain/src/types.ts`.

## Glossary

- **Seed_Script**: `scripts/seed.ts`, run as `scripts/seed.ts --stage <stage>`.
- **Scenario_Runner**: `scripts/run-scenarios.ts`, an A-owned script separate from the Seed_Script.
- **Stage**: a deployment name (`dev-a`, `dev-b`, `demo`).
- **Stack_Outputs**: the table, bucket and function names of the stage's stacks. Taken from CloudFormation outputs where the output exists (`ClaimsTableName`, `EvidenceBucketName`, `DecisionFunctionName`) and, for the `Policies`, `ClaimTypePacks` and `EvidenceIndex` tables, which have no output, from the physical IDs of the Foundation stack resources.
- **Tenant**: the insurer record `demo-insurer`.
- **Demo_Customer**: the fixed customer ID `cust-demo`, linked to the seeded Cognito customer user from T-06.
- **Policy_Table, Claims_Table, Evidence_Index, Pack_Table, Audit_Table**: the DynamoDB tables `Policies`, `Claims`, `EvidenceIndex`, `ClaimTypePacks`, `AuditLog` as defined in `architecture.md`.
- **Evidence_Bucket**: the private S3 evidence bucket.
- **Seed_Evidence**: files in `seed/evidence/`.
- **Evidence_Row**: an `EvidenceIndex` record for one evidence item.
- **Identifier_Row**: an `EvidenceIndex` record of type `IDENTIFIER` (IMEI, VIN, plate or report number) pointing to a claim.
- **Typical_Value**: the `typicalValue` number of a claim type pack (800 for phone, 6000 for car), used by the amount outlier signal.
- **Decision_Lambda**: the deployed Decision Lambda from T-14.
- **Domain_Fixtures**: `backend/domain/src/fixtures.ts`, the reference definitions of `policyV1`, `policyV2`, `phonePack`, `carPack`, `thresholds` and `cleanFacts`.
- **Cause**: one of the values of `CAUSES` in `backend/domain/src/types.ts`: `ACCIDENTAL_DAMAGE`, `THEFT`, `LOSS`, `WINDSCREEN`, `COSMETIC`, `COLLISION`, `INJURY`, `THIRD_PARTY`, `TOTAL_LOSS`, `UNCLEAR`.
- **Uncovered_Item**: the third `POL-001` item `ITEM-LAPTOP-1` (category `laptop`, label `Laptop`), whose category has no entry in the policy `coverage` map.
- **Second_Phone**: the fourth `POL-001` item `ITEM-PHONE-2` (category `phone`, its own synthetic IMEI). It is the insured item of `CLM-1042` and of scenario H, and no other scenario uses it.
- **Scenario_Evidence_Row**: an Evidence_Row written by the Seed_Script for a fixed scenario claim ID and evidence ID, so that the Scenario_Runner needs no Evidence_Index write.
- **Scenario_Result**: one printed record of scenario ID, input summary, outcome, reasons and latency.
- **Row_Count**: the number of items in a table, obtained from a DynamoDB scan with `Select=COUNT`.

## Requirements

### Requirement 1: Seed script invocation and configuration

**User Story:** As a developer, I want to seed any stage with one command, so that every environment can be rebuilt from the repository.

#### Acceptance Criteria

1. WHEN the Seed_Script is run with `--stage <stage>`, THE Seed_Script SHALL read table names and the Evidence_Bucket name from the Stack_Outputs of the Foundation stack of that Stage.
2. IF the `--stage` argument is missing or empty, THEN THE Seed_Script SHALL print a usage message and exit with a non-zero code before any AWS write.
3. IF a required Stack_Output is missing, THEN THE Seed_Script SHALL print the name of the missing output or table and exit with a non-zero code before any AWS write.
4. THE Seed_Script SHALL accept invocation through `scripts/seed-entry.ts` without any change to `scripts/seed-entry.ts`.
5. WHEN the Seed_Script completes, THE Seed_Script SHALL print the number of items written per table and exit with code 0.
6. IF any write fails after the SDK retries are exhausted, THEN THE Seed_Script SHALL print the table name and the error and exit with a non-zero code.

### Requirement 2: Idempotent upserts

**User Story:** As a developer, I want repeated seeding to produce identical data, so that I can re-run it safely.

#### Acceptance Criteria

1. THE Seed_Script SHALL write every item with a deterministic key derived only from constants in the seed definitions.
2. WHEN the Seed_Script is run twice against the same Stage, THE Seed_Script SHALL leave the Row_Count of each table equal after the second run and after the first run.
3. WHEN the Seed_Script is run twice against the same Stage, THE Seed_Script SHALL leave every seeded item with attribute values equal to those after the first run, except for attributes that record write time.
4. THE Seed_Script SHALL write each item with an unconditional put so that a re-run overwrites an existing seeded item.
5. WHEN the Seed_Script uploads a Seed_Evidence file, THE Seed_Script SHALL use a fixed S3 key so that a re-run overwrites the same object.

### Requirement 3: Tenant and customers

**User Story:** As a developer, I want the tenant and customer identities fixed, so that seeded Cognito users and seeded data line up.

#### Acceptance Criteria

1. THE Seed_Script SHALL use the tenant ID `demo-insurer` as the `tenantId` prefix of every seeded partition key.
2. THE Seed_Script SHALL use the fixed customer ID `cust-demo` for the Demo_Customer in every seeded policy, claim and evidence key.
3. THE Seed_Script SHALL define the `customerId` values as constants in one source file, so that the Cognito seed users from T-06 can reference the same values.
4. THE Seed_Script SHALL NOT call Cognito.

### Requirement 4: Policies and versioning

**User Story:** As a demo presenter, I want `POL-001` in two versions, so that I can show that a policy change applies without a redeploy.

#### Acceptance Criteria

1. THE Seed_Script SHALL write policy `POL-001` version 1 and version 2 for the Demo_Customer, each with the Policy fields `policyId`, `version`, `customerId`, `holderName`, `startDate`, `effectiveFrom`, `deductible`, `items` and `coverage`, and with `effectiveTo` on version 1.
2. THE Seed_Script SHALL set `deductible` to 50 and `startDate` to `2026-01-01` on both versions, `effectiveFrom` of version 1 to `2026-01-01`, `effectiveTo` of version 1 to `2026-10-31` and `effectiveFrom` of version 2 to `2026-11-01`, so that exactly one version is in force on any single date.
3. THE Seed_Script SHALL list in both versions four items, in this order, with the PolicyItem fields of `backend/domain/src/types.ts`: `ITEM-PHONE-1` (category `phone`, synthetic `imei`), `ITEM-CAR-1` (category `car`, synthetic `plate`), the Uncovered_Item `ITEM-LAPTOP-1` (category `laptop`) and the Second_Phone `ITEM-PHONE-2` (category `phone`, a synthetic `imei` different from that of `ITEM-PHONE-1`). Appending the Second_Phone keeps the first three item indexes equal to those of the Domain_Fixtures.
4. THE Seed_Script SHALL write `POL-001` version 1 coverage as category `phone` with causes `ACCIDENTAL_DAMAGE`, `THEFT` and `LOSS` and limit 1000, and category `car` with causes `WINDSCREEN`, `COLLISION` and `INJURY` and limit 5000.
5. THE Seed_Script SHALL write `POL-001` version 2 coverage identical to version 1 except that the phone category covers only `ACCIDENTAL_DAMAGE` and `THEFT`, so that version 2 drops `LOSS` and keeps `THEFT`. `LOSS` is the cause that shows versioning, because `CAUSES` in `backend/domain/src/types.ts` has no liquid-damage cause.
6. THE Seed_Script SHALL omit the `laptop` category from the `coverage` map of every `POL-001` version, so that a not-covered claim can be shown.
7. THE Seed_Script SHALL write `POL-001` values equal to `policyV1` and `policyV2` of the Domain_Fixtures except for the `customerId`, the `effectiveTo` of version 1, the identifier values, the appended Second_Phone item and the phone causes of version 2 (`ACCIDENTAL_DAMAGE` and `THEFT`, where `policyV2` of the Domain_Fixtures lists `ACCIDENTAL_DAMAGE` and `LOSS`), which the seed definitions set to the Demo_Customer, synthetic data and the versioning demo.
8. THE Seed_Script SHALL write every policy item so that it validates against the Policies shape in `contracts/data-model.md`.

### Requirement 5: Claim type packs and typical values

**User Story:** As a developer, I want packs with the agreed caps, so that decisions use configuration rather than code.

#### Acceptance Criteria

1. THE Seed_Script SHALL write a claim type pack for `phone`, a claim type pack for `car` and a claim type pack for `laptop` under the Tenant, each with the ClaimTypePack fields `category`, `version`, `causes`, `identifierFields`, `typicalValue` and `minConfidence`. The `laptop` pack sets `autoApproveCap` to 0 for `ACCIDENTAL_DAMAGE`, `THEFT` and `LOSS`, `identifierFields` to an empty list and `typicalValue` to 1500, so that the Decision_Lambda reaches the coverage check for the Uncovered_Item and reports "not covered by policy" instead of "no claim type pack".
2. THE Seed_Script SHALL set the phone `autoApproveCap` to 500 for `ACCIDENTAL_DAMAGE`, 300 for `THEFT` and 0 for `LOSS`.
3. THE Seed_Script SHALL set the car `autoApproveCap` to 250 for `WINDSCREEN` and 0 for `COLLISION` and `INJURY`.
4. THE Seed_Script SHALL set `requiredEvidence` to `DEVICE_PHOTO` for phone `ACCIDENTAL_DAMAGE`, `POLICE_REPORT` for phone `THEFT`, `STATEMENT` for phone `LOSS`, `PLATE_PHOTO` for car `WINDSCREEN`, and `POLICE_REPORT` for car `COLLISION` and `INJURY`.
5. THE Seed_Script SHALL set `identifierFields` to `imei` for the phone pack and `plate` for the car pack, and `minConfidence` to 0.8 in both packs.
6. THE Seed_Script SHALL set `typicalValue` to 800 for the phone pack and 6000 for the car pack, for use by the amount outlier signal.
7. THE Seed_Script SHALL write each pack with a version number and validate each pack against the `ClaimTypePack` type of `backend/domain` before writing it.
8. IF a pack fails validation, THEN THE Seed_Script SHALL exit with a non-zero code before any AWS write.
9. THE Seed_Script SHALL write the `phone` and `car` packs equal to `phonePack` and `carPack` of the Domain_Fixtures.

### Requirement 6: Prior claim CLM-1042 and its evidence rows

**User Story:** As a demo presenter, I want a prior claim with a photo, so that a duplicate photo can be reported with the matching claim ID.

#### Acceptance Criteria

1. THE Seed_Script SHALL write the claim `CLM-1042` for the Demo_Customer on the Second_Phone with status `AUTO_APPROVED`, a fixed loss date earlier than the seed run date, and one evidence ID.
2. THE Seed_Script SHALL upload the Seed_Evidence damaged-phone photo that shows the Second_Phone IMEI (Requirement 8.10) to the Evidence_Bucket under the key `tenantId/customerId/evidenceId` for `CLM-1042`.
3. THE Seed_Script SHALL write for `CLM-1042` an Evidence_Row with `kind` `DEVICE_PHOTO`, `claimId` `CLM-1042`, the `evidenceId`, the S3 key and `exifDate`.
4. THE Seed_Script SHALL write for `CLM-1042` one `SHA256` row and one `PHASH` row in the Evidence_Index, each pointing to `CLM-1042`.
5. THE Seed_Script SHALL compute the SHA-256 and pHash values from the bytes of the uploaded Seed_Evidence file, using `node:crypto` for SHA-256 and a pHash function defined in the seed module, because `backend/domain` and `backend/processing` contain no hash helper. THE Seed_Script SHALL document in the seed module that the pHash function must match the Evidence Processor's method (T-13), because the Decision Lambda treats an equal pHash as a near duplicate.
6. THE Seed_Script SHALL write an Identifier_Row for the Second_Phone IMEI, pointing to `CLM-1042`, so that a later claim with the same IMEI triggers the identifier reuse signal. THE Seed_Script SHALL write no Identifier_Row for the IMEI of `ITEM-PHONE-1`, the plate of `ITEM-CAR-1` or any other identifier, so that no scenario other than H can trigger identifier reuse.
7. WHEN `aws dynamodb get-item` is run for `CLM-1042` against the Claims_Table, THE Claims_Table SHALL return the claim with its evidence ID, and the Evidence_Index SHALL return the SHA-256 row for the same photo.

### Requirement 7: Evidence rows carry kind, claim, evidence and EXIF date

**User Story:** As a developer of the tools, I want complete evidence rows, so that verification does not need extra lookups.

#### Acceptance Criteria

1. THE Seed_Script SHALL set on every seeded Evidence_Row the attributes `kind`, `claimId`, `evidenceId` and `exifDate`.
2. THE Seed_Script SHALL restrict `kind` to one of `DEVICE_PHOTO`, `POLICE_REPORT`, `PLATE_PHOTO` and `STATEMENT`.
3. WHERE a Seed_Evidence file has no EXIF capture date, THE Seed_Script SHALL record `exifDate` as an explicit null so that the attribute is present.
4. THE Seed_Script SHALL validate the shape of every Evidence_Row against `contracts/data-model.md` before writing.
5. THE Seed_Script SHALL write Scenario_Evidence_Rows for the fixed claim ID and evidence ID of every scenario of Requirement 9, each with `kind`, `claimId`, `evidenceId` and `exifDate`, and with a SHA-256 row and a PHASH row.
6. THE Seed_Script SHALL give each Scenario_Evidence_Row hash values that are unique to its own claim, except for scenario D, whose rows carry the SHA-256 and pHash values of the `CLM-1042` photo.

### Requirement 8: Synthetic evidence files

**User Story:** As a demo presenter, I want ready evidence files, so that I can file the demo claims without preparation.

#### Acceptance Criteria

1. THE Seed_Evidence directory SHALL contain a damaged-phone photo that shows the synthetic IMEI of `ITEM-PHONE-1`.
2. THE Seed_Evidence directory SHALL contain a police report image whose name and IMEI match `ITEM-PHONE-1`.
3. THE Seed_Evidence directory SHALL contain a police report image whose name matches and whose IMEI differs from every `POL-001` item.
4. THE Seed_Evidence directory SHALL contain a photo of a non-phone object.
5. THE Seed_Evidence directory SHALL contain a car photo that shows the synthetic plate from the `POL-001` car item.
6. THE Seed_Evidence directory SHALL contain a README that lists each file, what it shows, and which scenario uses it.
7. THE Seed_Evidence files SHALL be hand-made or generated from synthetic content and SHALL contain no real personal, financial or device data.
8. THE Seed_Evidence files SHALL each be JPEG, PNG or PDF and no larger than 5 MB.
9. THE Seed_Script SHALL print an error naming the file and exit with a non-zero code if a referenced Seed_Evidence file is missing.
10. THE Seed_Evidence directory SHALL contain a damaged-phone photo that shows the synthetic IMEI of the Second_Phone. This is the `CLM-1042` photo.
11. THE Seed_Evidence directory SHALL contain a police report image whose name and IMEI match the Second_Phone.

### Requirement 9: Scenario data coverage

**User Story:** As a demo presenter, I want every scenario to have the data it needs, so that none fails for missing seed data.

The scenarios follow `backend/domain/src/decide.test.ts`. Amounts are claimed amounts. The `POL-001` deductible is 50, so payout is amount minus 50.

#### Acceptance Criteria

1. THE Seed_Script SHALL provide the data needed by scenario A: a clean `ACCIDENTAL_DAMAGE` claim on `ITEM-PHONE-1` for 180 (payout 130), with the damaged-phone photo showing the policy IMEI, expected `AUTO_APPROVED`.
2. THE Seed_Script SHALL provide the data needed by scenario B: a `THEFT` claim on `ITEM-PHONE-1` for 300 (payout 250) with the matching police report, expected `AUTO_APPROVED`, and by scenario B2: the same claim for 400, expected `ROUTED_TO_ADJUSTER` because the payout exceeds the theft cap of 300.
3. THE Seed_Script SHALL provide the data needed by scenario C: a car `COLLISION` claim and a car `INJURY` claim on `ITEM-CAR-1` with a police report, each expected `ROUTED_TO_ADJUSTER` because the cap is 0, and by scenario C2: a car `WINDSCREEN` claim for 200 with the plate photo, expected `AUTO_APPROVED`.
4. THE Seed_Script SHALL provide the data needed by scenario D: a damage claim on `ITEM-PHONE-1` whose Scenario_Evidence_Rows carry the SHA-256 and pHash of the `CLM-1042` photo, expected `ROUTED_TO_ADJUSTER` with an adjuster reason naming `CLM-1042`.
5. THE Seed_Script SHALL provide the data needed by scenario E: a `THEFT` claim on the Uncovered_Item, expected `ROUTED_TO_ADJUSTER` with the reason "Item category 'laptop' is not covered by policy POL-001.", and by scenario E2: a phone `LOSS` claim on `ITEM-PHONE-1` with `STATEMENT` evidence (the evidence the phone `LOSS` pack requires) and the loss date `2026-11-15`, expected `ROUTED_TO_ADJUSTER` with the reason "Cause 'LOSS' is not covered for 'phone' under POL-001 v2."
6. THE Seed_Script SHALL provide the data needed by scenario F: a phone `ACCIDENTAL_DAMAGE` claim for 700 (payout 650), expected `ROUTED_TO_ADJUSTER` because the payout is above the cap of 500.
7. THE Seed_Script SHALL provide the data needed by scenario G: a phone `THEFT` claim with a police report whose IMEI differs from the policy IMEI, expected `ROUTED_TO_ADJUSTER` with the evidence mismatch reason.
8. THE Seed_Script SHALL provide the data needed by scenario H: a phone `THEFT` claim for 300 on the Second_Phone with a police report that shows the Second_Phone IMEI, which is already claimed on `CLM-1042`, expected `ROUTED_TO_ADJUSTER` with an identifier reuse reason naming `CLM-1042`.
9. THE Seed_Script SHALL set the loss date of every scenario (A, B, B2, C, CI, C2, D, E, E2, F, G and H) to the single constant `2026-11-15`, which lies inside `POL-001` version 2 (`effectiveFrom` `2026-11-01`, no `effectiveTo`), so that a live demo claim filed with the current date uses the same version. Version 2 covers the cause of every scenario except E (laptop, uncovered category) and E2 (`LOSS`, dropped from the phone coverage). The loss date of `CLM-1042` stays `2026-10-12`, and its `policyVersion` stays 1.
10. THE Seed_Script SHALL use `ITEM-PHONE-1` or `ITEM-CAR-1` for scenarios A, B, B2, C, C2, D, E2, F and G, SHALL write no Identifier_Row for them (Requirement 6.6), and SHALL give their Scenario_Evidence_Rows hash values that are unique to the scenario (Requirement 7.6), so that scenarios A and B are not routed by a signal and no scenario leaks into another. The loss date `2026-11-15` is more than 14 days after the policy start date `2026-01-01`, every photo `exifDate` of a scenario equals the loss date, and the `CLM-1042` claim lies outside the 30-day frequency window of a run on or after `2026-11-15`, so that no timeline, early-claim or frequency signal fires for A and B.

### Requirement 10: Scenario runner

**User Story:** As a developer, I want a script that runs the scenarios against the deployed stage, so that I can verify the seed data without the full agent.

#### Acceptance Criteria

1. THE Scenario_Runner SHALL be the file `scripts/run-scenarios.ts`, separate from the Seed_Script, with a header comment naming owner A.
2. WHEN the Scenario_Runner is run with `--stage <stage>`, THE Scenario_Runner SHALL read the Decision_Lambda name from the Stack_Outputs of that Stage.
3. WHEN the Scenario_Runner runs scenarios A to H, THE Scenario_Runner SHALL invoke the deployed Decision_Lambda once per scenario with a proposal that conforms to `contracts/proposal.schema.json`, and SHALL validate each returned decision against `contracts/decision.schema.json`.
4. WHEN the Scenario_Runner runs a scenario, THE Scenario_Runner SHALL create the claim record for that scenario in the Claims_Table with status `PROCESSING` before invoking the Decision_Lambda, using the fixed claim ID and the fixed evidence IDs of the scenario, whose Scenario_Evidence_Rows the Seed_Script has already written. THE Scenario_Runner SHALL omit the `byCustomer` index attributes from these claim records, so that scenario claims are not counted by the claim frequency signal.
5. WHEN the Scenario_Runner finishes a scenario, THE Scenario_Runner SHALL print a Scenario_Result with the scenario ID, outcome, reasons and invocation latency in milliseconds.
6. WHEN the Scenario_Runner finishes a scenario, THE Scenario_Runner SHALL compare the outcome with the expected outcome of the scenario and print PASS or FAIL.
7. THE Scenario_Runner SHALL expect `AUTO_APPROVED` for scenarios A and B, and `ROUTED_TO_ADJUSTER` for scenarios C to H. WHERE the Scenario_Runner includes the variants B2, C2 and E2, THE Scenario_Runner SHALL expect `ROUTED_TO_ADJUSTER` for B2 and E2 and `AUTO_APPROVED` for C2.
8. IF any scenario result differs from its expected outcome, THEN THE Scenario_Runner SHALL exit with a non-zero code after all scenarios have run.
9. WHEN the Scenario_Runner is run a second time, THE Scenario_Runner SHALL reset each scenario claim to `PROCESSING` before invoking the Decision_Lambda, so that the result is reproducible.
10. THE Scenario_Runner SHALL NOT write to the Evidence_Index, Policy_Table or Pack_Table.
11. THE Scenario_Runner SHALL NOT modify any file owned by B.

### Requirement 11: Tests

**User Story:** As a reviewer, I want automated checks of the seed definitions, so that the data cannot drift from the rules.

#### Acceptance Criteria

1. THE Seed_Script SHALL keep its seed definitions in a module that a unit test can import without AWS access.
2. WHEN the unit tests run, THE test suite SHALL assert that the seed packs satisfy the pack validator and the caps in Requirement 5.
3. WHEN the unit tests run, THE test suite SHALL assert that the seed policies satisfy the policy validator, that exactly one version of `POL-001` is in force on each tested date, and that version 2 omits `LOSS` and keeps `THEFT` and `ACCIDENTAL_DAMAGE` for phones.
4. WHEN the unit tests run, THE test suite SHALL assert that every seeded Evidence_Row has `kind`, `claimId`, `evidenceId` and `exifDate`.
5. WHEN the unit tests run, THE test suite SHALL run `decide` from `backend/domain` with the Domain_Fixtures `thresholds` and the seeded pack on the data for scenarios A to H and the variants B2, C2 and E2, and assert the expected outcomes of Requirement 9 and Requirement 10.7.
6. WHEN the unit tests run against an in-memory fake of the DynamoDB client, THE test suite SHALL assert that two runs of the Seed_Script write the same keys and the same Row_Count.
7. WHEN the unit tests run, THE test suite SHALL assert that no seed definition contains a value matching an email address pattern other than the reserved domain `example.com`.
8. WHEN the unit tests run against an in-memory fake of the DynamoDB client loaded with the seeded items and with the scenario claim records the Scenario_Runner creates, THE test suite SHALL run the real Decision_Lambda handler and store read path of `backend/processing/decision` on scenarios A to H and the variants, and assert the outcomes and reasons of Requirement 9.

### Requirement 12: Run on the user's account and show results

**User Story:** As the ticket owner, I want evidence from a real stage, so that the PR shows the seed works.

#### Acceptance Criteria

1. WHEN the implementation is complete, THE implementer SHALL run `npm run seed -- --stage <stage>` against the user's AWS account, twice in a row.
2. WHEN the second seed run completes, THE implementer SHALL record the Row_Count of each seeded table before and after the second run and show that the counts are equal.
3. WHEN the seed runs complete, THE implementer SHALL run `aws dynamodb get-item` for `CLM-1042` and show the returned item with its evidence ID and the SHA-256 row of its photo.
4. WHEN the seed runs complete, THE implementer SHALL run `scripts/run-scenarios.ts --stage <stage>` and show the Scenario_Result for scenario A (happy path, `AUTO_APPROVED`) and for scenario H (duplicate IMEI, `ROUTED_TO_ADJUSTER` with the identifier reuse reason naming `CLM-1042`).
5. IF the stage, the AWS credentials or the deployed Decision_Lambda are unavailable, THEN THE implementer SHALL report the missing prerequisite to the user instead of reporting the verification as done.
6. THE implementer SHALL put the commands and their outputs from criteria 1 to 4 in the pull request description, with no account IDs, tokens or personal data.

### Requirement 13: Repository rules

**User Story:** As a team member, I want the change to follow the repository rules, so that the two branches merge cleanly.

#### Acceptance Criteria

1. THE implementer SHALL create the work on branch `a/T-12-seed` cut from `origin/main`.
2. THE implementer SHALL place `scripts/seed.ts`, `scripts/run-scenarios.ts`, `seed/` and tests only in A-owned locations, and name the owner in each script header.
3. THE implementer SHALL add dependencies only to an A-owned workspace and leave `package-lock.json` to be generated by `npm install`.
4. THE implementer SHALL use one commit per spec task, in the form `feat(T-12): <task>`, and the pull request title `T-12: Synthetic seed data and seed script`.
5. IF a change to a contract other than the `contracts/data-model.md` change of Requirement 14, to `backend/shared` or to a B-owned file is needed, THEN THE implementer SHALL stop and open a separate pull request for that change. The user explicitly authorizes the Requirement 14 change in the T-12 branch, which deviates from the `repository.md` rule that contract changes go in a separate pull request, and the pull request description states this.
6. WHEN the work is complete, THE implementer SHALL run `npm run lint`, `npm run typecheck` and `npm test` and report that each passes.
7. THE Seed_Script SHALL NOT write secrets, account IDs, or real personal data to the repository, console output or logs.

### Requirement 14: EvidenceIndex attributes in the data-model contract

**User Story:** As the owner of T-13, I want the EvidenceIndex attributes `type`, `value` and `kind` documented in the contract, so that the Evidence Processor writes the same attribute names the Decision Lambda reads.

#### Acceptance Criteria

1. THE implementer SHALL update `contracts/data-model.md` in branch `a/T-12-seed` so that the EvidenceIndex attribute list names `type` (`SHA256`, `PHASH` or `IDENTIFIER`), `value` (the hash or the normalized identifier) and `kind` (`DEVICE_PHOTO`, `POLICE_REPORT`, `PLATE_PHOTO` or `STATEMENT`), as read by `backend/processing/decision/normalize.ts`.
2. THE implementer SHALL limit the `contracts/data-model.md` change to those three attributes, and SHALL leave every schema, example and other contract file unchanged.
3. THE implementer SHALL check `contracts/VERSION` and the contracts tests, and SHALL run the contracts tests after the change. WHERE no versioning convention for documentation-only changes is documented in the repository, THE implementer SHALL leave `contracts/VERSION` unchanged and state that in the pull request description.
4. THE implementer SHALL commit the `contracts/data-model.md` change as its own commit, before the seed builder task, so that the change is reviewable separately from the seed code.
5. THE implementer SHALL state in the pull request description that the contract change is in the T-12 branch by the explicit authorization of the user and that it deviates from the `repository.md` rule.
