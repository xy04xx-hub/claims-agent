# Design Document

## Overview

T-12 (owner A, branch `a/T-12-seed`) adds synthetic seed data, the script that loads it, and a separate script that runs the demo scenarios against the deployed Decision Lambda. All source is TypeScript on Node 22. Nothing here calls Bedrock, Cognito or the agent.

Decisions that shape the rest of this document:

1. **One definitions module, no AWS imports.** `seed/definitions/` holds every constant, policy, pack, scenario and evidence manifest entry. A pure function `buildSeedItems` turns them, plus the hashes of the evidence files, into the exact DynamoDB items. The seed script, the runner and the tests all use it.
2. **Key helpers are imported, not copied.** `seed/definitions` imports `claimKey`, `policyPk`, `packPk`, `evidenceIndexPk`, `evidenceByIdPk` and `customerPk` from `backend/processing/decision/keys.ts`. The sort-key formats that keys.ts does not contain (`v#000001`, `claimId#evidenceId`) are defined once in `seed/definitions/keys.ts` from `contracts/data-model.md`. The end-to-end test (below) runs the real `DynamoStore` read path over the seeded items, so any drift fails a test.
3. **The seed script owns every EvidenceIndex row, including the rows for scenario claims.** Scenario claim IDs and evidence IDs are fixed constants (`CLM-SCN-A`, `EVD-SCN-A-1`, ...). The runner creates or resets only the `PROCESSING` Claims rows and invokes the Decision Lambda. It never writes the EvidenceIndex, Policies or ClaimTypePacks tables (Req 10.10).
4. **The conflict between Req 6.6 and 9.10 is resolved with a second phone.** `ITEM-PHONE-2` is appended after `ITEM-LAPTOP-1`. `CLM-1042` is a prior claim on `ITEM-PHONE-2`. Its photo shows PHONE-2's IMEI and the only IDENTIFIER row in the seed is PHONE-2's IMEI pointing to `CLM-1042`. Scenario H claims theft on `ITEM-PHONE-2` and trips identifier reuse. Every other scenario uses `ITEM-PHONE-1`, `ITEM-CAR-1` or `ITEM-LAPTOP-1` and no IDENTIFIER row exists for those identifiers, so nothing crosses scenarios.
5. **Scenario rows carry per-scenario hashes.** Every scenario evidence item has its own synthetic SHA-256 and pHash, so scenarios cannot match each other as duplicates. Scenario D is the one exception: its rows copy the real SHA-256 and pHash of the `CLM-1042` photo.
6. **Stack names come from the Foundation stack in two ways.** Only `ClaimsTableName`, `EvidenceBucketName` and `DataKeyArn` are outputs today. The `Policies`, `ClaimTypePacks` and `EvidenceIndex` table names are not. The seed reads the three outputs and finds the other three tables in the Foundation stack resources. It prefers an output with a matching name if B adds one later.
7. **Scenario E needs a `laptop` pack.** The Decision Lambda (`evaluate.ts`) looks up the pack for the item category before it runs `domain.decide`. With no pack it routes with "No claim type pack for category 'laptop'", never reaching the coverage check that produces "Item category 'laptop' is not covered by policy POL-001." The seed therefore writes a `laptop` pack with every cap at 0. The policy still lists no `laptop` coverage, so the claim is not covered.

## Architecture

```
npm run seed -- --stage dev-a
  scripts/seed-entry.ts (B, unchanged) -> npx tsx scripts/seed.ts --stage dev-a
     parseStageArg -> resolveFoundation (CloudFormation) -> read evidence files (sha256, pHash)
     -> buildSeedItems (pure) -> validate -> S3 PutObject (CLM-1042 photo) -> DynamoDB PutItem x N

npx tsx scripts/run-scenarios.ts --stage dev-a
     parseStageArg -> resolveFoundation + resolveProcessing -> preflight (CLM-1042 exists, dates)
     for each scenario: Put PROCESSING claim row -> Lambda Invoke {tenantId, claimId, proposal, jti}
        -> validate decision -> compare -> print
```

### File layout

| Path | Owner | Purpose |
|---|---|---|
| `scripts/seed.ts` | A | Entry. `runSeed(argv, deps)` is exported and testable. `main()` runs only when the file is executed. Header comment names owner A. |
| `scripts/run-scenarios.ts` | A | Entry. `runScenarios(argv, deps)` exported, same pattern as `scripts/outputs.ts`. |
| `seed/definitions/constants.ts` | A | `TENANT_ID`, `CUSTOMER_ID`, `POLICY_ID`, item IDs, IMEIs, plate, holder name, fixed dates and timestamps. T-06 (B) may import `TENANT_ID` and `CUSTOMER_ID`. |
| `seed/definitions/policies.ts` | A | `POLICY_V1`, `POLICY_V2` as domain `Policy` objects. |
| `seed/definitions/packs.ts` | A | `PHONE_PACK`, `CAR_PACK` (reused from the shapes in `backend/domain/src/fixtures.ts`), `LAPTOP_PACK`. |
| `seed/definitions/evidence-files.ts` | A | Manifest of the files in `seed/evidence/`: name, kind, content type, what it shows, which scenarios use it. |
| `seed/definitions/scenarios.ts` | A | `SCENARIOS`: claim and evidence IDs, claim fields, proposal builder, expected outcome and reason text. |
| `seed/definitions/claim-1042.ts` | A | `CLM-1042` claim fields and its `decision`, computed by `domain.decide` so it always matches the contract. |
| `seed/definitions/keys.ts` | A | `versionSk`, `evidenceSk`, and re-exports of the keys.ts helpers. |
| `seed/definitions/build.ts` | A | `buildSeedItems(files)` and `packToItem`, `policyToItem`, `buildScenarioClaimRow`. Pure. |
| `seed/definitions/validate.ts` | A | `assertValidPolicy`, `assertValidPack`, `assertValidEvidenceRow`, `assertNoDuplicateKeys`. Pure. |
| `seed/definitions/index.ts` | A | Re-exports. The only import path for tests and scripts. |
| `seed/lib/hashing.ts` | A | `sha256Hex`, `dhash64Hex`, `normalizeIdentifier`. Only `node:crypto`. |
| `seed/lib/png.ts` | A | `encodePng`, `decodePng`. Only `node:zlib`. |
| `seed/lib/stage-resources.ts` | A | `resolveFoundation`, `resolveProcessing`. CloudFormation behind an interface. |
| `seed/tools/generate-evidence.ts` | A | Dependency-free generator of the PNG files. Run by hand, never by `seed.ts`. |
| `seed/tools/font5x7.ts` | A | 5x7 bitmap glyphs for the characters the evidence files use. |
| `seed/evidence/*.png`, `seed/evidence/README.md` | A | Committed evidence files and their README (Req 8.6). |
| `contracts/data-model.md` | both | One documentation-only edit in this branch (Req 14): adds `type`, `value`, `kind` to the EvidenceIndex attributes. Own commit, authorized by the user. |
| `seed/README.md` | A | Updated: how to seed, run scenarios, regenerate evidence. |
| `scripts/seed-definitions.test.ts`, `scripts/seed-evidence.test.ts`, `scripts/seed.test.ts`, `scripts/seed-e2e.test.ts`, `scripts/run-scenarios.test.ts` | A | Tests. They sit in `scripts/` because the root `vitest.config.ts` includes `scripts/**/*.test.ts` but not `seed/**`. Moving them next to the code needs a one-line include change in that shared file, which is a separate PR (Req 13.5). |

Dependencies are added only to `backend/processing/package.json` (A-owned), as `devDependencies`: `@aws-sdk/client-s3`, `@aws-sdk/client-lambda`, `@aws-sdk/client-cloudformation` and `fast-check`. `scripts/` has no `package.json`, so these resolve through the workspace root `node_modules`. `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` are already dependencies there. The lockfile is regenerated by `npm install`. They are dev-only, so the Lambda bundle is unchanged.

## Components and Interfaces

### Stage resource resolution

`scripts/outputs.ts` (B) reads all seven stacks and fails if any is missing, so it is not reused. The seed must work when only Foundation is deployed, and the runner needs only Foundation and Processing.

```ts
// seed/lib/stage-resources.ts
export interface FoundationNames { claims: string; policies: string; packs: string; evidenceIndex: string; bucket: string }
export interface CfnLike {
  /** Outputs of one stack, key to value. Throws if the stack does not exist. */
  describeOutputs(stackName: string): Promise<Record<string, string>>;
  /** Physical IDs of the AWS::DynamoDB::Table resources of one stack. */
  listTables(stackName: string): Promise<{ logicalId: string; physicalId: string }[]>;
}
export class MissingResourceError extends Error { constructor(readonly what: string) { super(`Missing ${what}`); } }

export async function resolveFoundation(cfn: CfnLike, stage: string): Promise<FoundationNames>;
export async function resolveProcessing(cfn: CfnLike, stage: string): Promise<{ decisionFunction: string }>;
```

- Stack names are `ClaimsAgent-${stage}-Foundation` and `ClaimsAgent-${stage}-Processing`, the same convention as `outputs.ts`. The region is `us-east-1`.
- Outputs used: `ClaimsTableName`, `EvidenceBucketName` (Foundation), `DecisionFunctionName` (Processing). Optional outputs, used if present: `PoliciesTableName`, `ClaimTypePacksTableName`, `EvidenceIndexTableName`.
- Fallback for the three tables: `ListStackResources` on Foundation, keep `ResourceType === "AWS::DynamoDB::Table"`, and match the logical ID against `^PoliciesTable[0-9A-F]{8}$`, `^ClaimTypePacksTable[0-9A-F]{8}$`, `^EvidenceIndexTable[0-9A-F]{8}$`. The prefixes are the construct IDs `${spec.id}Table` in `foundation-stack.ts`. The physical ID of a DynamoDB table is its name. The first implementation task confirms the logical IDs on the deployed dev-a stack.
- A missing output or table throws `MissingResourceError("output ClaimsTableName")` or `MissingResourceError("table Policies")`. `runSeed` prints the message and returns 1 before any write (Req 1.3).
- The permissions needed are `cloudformation:DescribeStacks` and `cloudformation:ListStackResources`, the same class as `npm run outputs`.
- A follow-up PR by B can add the three missing outputs to `foundation-stack.ts`. This spec does not touch that file.

### Seed script

```ts
// scripts/seed.ts   Owner: A
export interface SeedDeps {
  resolveFoundation(stage: string): Promise<FoundationNames>;
  readEvidenceFile(name: string): Buffer;                       // throws ENOENT
  putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  putItem(table: string, item: Record<string, unknown>): Promise<void>;
  log(message: string): void;
  error(message: string): void;
}
export async function runSeed(argv: string[], deps: SeedDeps): Promise<number>;
```

Flow of `runSeed`:

1. `parseStageArg(argv)` from `scripts/lib/stage-arg.ts` (B, imported read-only). Not ok: print the usage and return 1 (Req 1.2).
2. `resolveFoundation`. Any error: print it, return 1.
3. For every entry of the evidence manifest: `readEvidenceFile`. A read error prints `Seed evidence file missing: <name>` and returns 1 (Req 8.9). Check the size is at most 5 MB and the first bytes are a PNG signature, JPEG signature or `%PDF`. Compute `sha256Hex` and, for the `CLM-1042` photo only, `dhash64Hex(decodePng(bytes))`.
4. `buildSeedItems({ files })` returns `{ policies, packs, evidenceIndex, claims }`. `validate.ts` checks every item (Req 4.8, 5.7, 5.8, 7.4) and that no two items of one table share a key. A failure prints the reason and returns 1 before any AWS call.
5. `putObject(bucket, "demo-insurer/cust-demo/EVD-1042-1", bytes, "image/png")`. The S3 call is before the DynamoDB writes, so `CLM-1042` never exists without its photo. The bucket default encryption (SSE-KMS with the data key) applies, so the caller needs `kms:GenerateDataKey` on the data key.
6. `putItem` in this order: `policies`, `packs`, `evidenceIndex`, `claims`. Plain `PutItem`, no condition (Req 2.4). Sequential, about 60 items.
7. Print `Policies: 2`, `ClaimTypePacks: 3`, `EvidenceIndex: <n>`, `Claims: 1`, `S3 objects: 1`, return 0 (Req 1.5).

The real `main()` builds `CloudFormationClient`, `S3Client`, `DynamoDBDocumentClient` (with `removeUndefinedValues: true`) and `LambdaClient` in `us-east-1`, each with `maxAttempts: 5` so the SDK retries throttling before the script gives up. No credentials, account IDs or tokens are printed. The only identifiers in output are table names, the bucket name and the S3 key.

### Scenario runner

```ts
// scripts/run-scenarios.ts   Owner: A
export interface RunnerDeps {
  resolve(stage: string): Promise<{ claims: string; decisionFunction: string }>;
  getClaim(table: string, claimId: string): Promise<Record<string, unknown> | undefined>;
  putClaim(table: string, item: Record<string, unknown>): Promise<void>;
  invokeDecision(fn: string, event: DecideEvent): Promise<{ functionError?: string; payload: unknown }>;
  now(): Date;
  log(message: string): void;
  error(message: string): void;
}
export async function runScenarios(argv: string[], deps: RunnerDeps): Promise<number>;
```

Steps:

1. Parse the stage and resolve names. Failure: print and return 1.
2. Preflight. `getClaim(claims, "CLM-1042")` must exist, else print `Seed data not found. Run: npm run seed -- --stage <stage>` and return 1. `deps.now()` must be on or after the latest scenario loss date (`2026-11-15`), because the Decision Lambda treats a loss date after the filing date as `TIMELINE_INCONSISTENT`. Otherwise print the reason and return 1.
3. For each scenario, in order, sequentially:
   1. `putClaim(claims, buildScenarioClaimRow(scn, deps.now()))`. This is an unconditional `PutItem` that replaces the whole item, so it clears any earlier decision, reasons, payout, `decidedAt` and queue keys (Req 10.9). The runner refuses any claim ID that does not start with `CLM-SCN-`, so it can never overwrite `CLM-1042` or a customer's claim.
   2. `proposal = scn.buildProposal()`. `validateProposal` (reused from `backend/processing/decision/schemas.ts`) must pass, else the scenario is `FAIL (bad proposal: ...)`.
   3. `invokeDecision(decisionFunction, { tenantId: "demo-insurer", claimId, proposal, jti: "seed-<id>" })`. This is the exact `DecideEvent` that `createHandlers(...).handler` reads (`handlers.ts`: `tenantId`, `claimId`, `proposal`, optional `jti`). It has no `Records`, so the handler takes the `decide` path. The SDK call is `InvokeCommand` with `InvocationType: "RequestResponse"` and a JSON payload. Latency is the wall time around that call.
   4. Check the result. `FunctionError` set, a payload that is not `{ result: "DECIDED", decision }`, or `NOT_FOUND` / `ALREADY_DECIDED`: `FAIL` with that text. Otherwise `validateDecision(decision)` (reused from `schemas.ts`) must pass.
   5. Compare `decision.outcome` with `scn.expected.outcome`, and each string in `scn.expected.adjusterIncludes` against the joined `reasons.adjuster`. PASS only if all match. The reason check goes slightly beyond Req 10.6, which compares outcomes only. It is what makes scenario D, E, E2, F, G and H prove the right rule fired, and Req 12.4 needs the reason for H.
   6. Print one line: `PASS|FAIL  <id>  <outcome>  payout <n>  <ms> ms  <first reason or customer text>`.
4. Print a summary. Return 0 if all scenarios passed, else 1, after every scenario has run (Req 10.8).
5. When a scenario that expects `AUTO_APPROVED` fails with check `AUTO_APPROVE_ENABLED`, print the hint `Kill switch autoApproveEnabled is false on this stage`.

The runner imports only `DynamoDBDocumentClient` `GetCommand` and `PutCommand` for the Claims table, and `InvokeCommand`. It has no code path that writes the EvidenceIndex, Policies or ClaimTypePacks tables (Req 10.10).

The Decision Lambda itself writes the decision and the audit record through `commitDecision`. That is why running the runner changes the Claims and AuditLog row counts. The seed row counts in Req 12.2 are taken before the runner runs.

## Data Models

### Constants

```ts
export const TENANT_ID = "demo-insurer";
export const CUSTOMER_ID = "cust-demo";
export const POLICY_ID = "POL-001";
export const HOLDER_NAME = "Alex Demo";
export const ITEM_PHONE_1 = "ITEM-PHONE-1";   // imei 356938035643809  (same as the domain fixtures)
export const ITEM_CAR_1 = "ITEM-CAR-1";       // plate DEMO123
export const ITEM_LAPTOP_1 = "ITEM-LAPTOP-1"; // no identifier
export const ITEM_PHONE_2 = "ITEM-PHONE-2";   // imei 867530900000017
export const IMEI_MISMATCH = "356938035649996"; // shown by the mismatching report, belongs to no item
export const SCENARIO_LOSS_DATE = "2026-11-15"; // inside v2 (effectiveFrom 2026-11-01, open ended). Every scenario and live demo claim uses it
export const CLM_1042_LOSS_DATE = "2026-10-12";
export const CLM_1042_CREATED_AT = "2026-10-14T09:30:00.000Z";
export const SEED_CREATED_AT = "2026-10-14T09:30:00.000Z"; // fixed, so re-runs write identical items
```

All three IMEIs pass the Luhn check, which a test asserts. None is a real device.

### Item shapes

The seed items use the generic Foundation attribute names (`pk`, `sk`, `gsi1pk`, `gsi1sk`, `gsi2pk`, `gsi2sk`, `gsi3pk`) from `infra/lib/constructs/platform/data-model.ts`. Every key helper below is from `backend/processing/decision/keys.ts`, so `t = TENANT_ID`.

**Policies** (read by `DynamoStore.getPolicyVersions` with `pk = policyPk(t, policyId)`, then `toPolicy`):

```ts
{
  pk: policyPk(t, "POL-001"),                    // "demo-insurer#POL-001"
  sk: versionSk(v),                              // "v#000001", "v#000002"
  gsi1pk: customerPk(t, "cust-demo"),            // byCustomer
  gsi1sk: policy.effectiveFrom,
  policyId, version, customerId, holderName, startDate, effectiveFrom,
  effectiveTo,                                   // present on v1 only ("2026-10-31"), key omitted on v2
  deductible: 50,
  items: [
    { itemId: "ITEM-PHONE-1",  category: "phone",  label: "Phone",  imei: "356938035643809" },
    { itemId: "ITEM-CAR-1",    category: "car",    label: "Car",    plate: "DEMO123" },
    { itemId: "ITEM-LAPTOP-1", category: "laptop", label: "Laptop" },
    { itemId: "ITEM-PHONE-2",  category: "phone",  label: "Phone",  imei: "867530900000017" },
  ],
  coverage: {                                    // laptop absent on purpose
    phone: { causes: ["ACCIDENTAL_DAMAGE", "THEFT", "LOSS"], limit: 1000 },   // v2: ["ACCIDENTAL_DAMAGE", "THEFT"], LOSS dropped
    car:   { causes: ["WINDSCREEN", "COLLISION", "INJURY"], limit: 5000 },
  },
}
```

`startDate` is `2026-01-01` on both versions, `effectiveFrom` is `2026-01-01` (v1) and `2026-11-01` (v2). The first three items equal `policyV1.items` of the domain fixtures, so fixture indexes are unchanged.

**ClaimTypePacks** (read with `pk = packPk(t, category)`, newest `sk` first, then `toPack`):

```ts
{
  pk: packPk(t, "phone"),                        // "demo-insurer#phone"
  sk: versionSk(1),
  category: "phone", version: 1,
  causes: { ACCIDENTAL_DAMAGE: { autoApproveCap: 500, requiredEvidence: ["DEVICE_PHOTO"] }, ... },
  identifierFields: ["imei"],
  typicalValue: 800,
  confidenceThresholds: { minConfidence: 0.8 },  // toPack reads minConfidence from here
}
```

`packToItem(pack)` maps the domain `ClaimTypePack` to this shape. Phone and car equal `phonePack` and `carPack` of the fixtures. The laptop pack is `{ category: "laptop", version: 1, causes: { ACCIDENTAL_DAMAGE: {0, ["DEVICE_PHOTO"]}, THEFT: {0, ["POLICE_REPORT"]}, LOSS: {0, ["STATEMENT"]} }, identifierFields: [], typicalValue: 1500, minConfidence: 0.8 }`.

**Claims** (`claimKey(t, claimId)` is `{ pk: "demo-insurer#<claimId>", sk: "CLAIM" }`). `CLM-1042`:

```ts
{
  ...claimKey(t, "CLM-1042"),
  gsi1pk: customerPk(t, "cust-demo"), gsi1sk: "2026-10-14T09:30:00.000Z",   // appears in the customer's list
  claimId: "CLM-1042", customerId: "cust-demo", policyId: "POL-001", policyVersion: 1,
  itemId: "ITEM-PHONE-2", cause: "ACCIDENTAL_DAMAGE", clientRequestId: "seed-clm-1042",
  status: "AUTO_APPROVED", amountClaimed: 180, payout: 130,
  description: "Cracked screen (synthetic seed claim).",
  lossDate: "2026-10-12", evidenceIds: ["EVD-1042-1"],
  decision, reasons: decision.reasons,           // from domain.decide, validated against decision.schema.json
  createdAt: "2026-10-14T09:30:00.000Z", decidedAt: "2026-10-14T09:30:04.000Z",
}
```

A scenario claim row (`buildScenarioClaimRow(scn, now)`) is the same shape with `status: "PROCESSING"`, `createdAt: now.toISOString()`, `policyVersion` set to the version in force on its loss date, `clientRequestId: "seed-scn-<id>"`, and **no** `gsi1pk`, `gsi1sk`, `decision`, `reasons`, `payout`, `decidedAt`, `gsi2pk`, `gsi2sk`. Leaving out the `byCustomer` keys is deliberate. `countRecentClaims` queries that index, and 13 claims of one customer in 30 days would exceed `frequencyMaxClaims` (3) and route scenarios A and B. When a scenario is routed, `commitDecision` adds the `byQueue` keys, so routed scenario claims show in the adjuster queue. They do not show in the customer's list.

**EvidenceIndex.** One row per evidence per type. `DynamoStore.getEvidence` reads them through `byEvidence` and `toEvidenceRecord` folds them. `findOtherClaims` reads them by `pk`.

```ts
{
  pk: evidenceIndexPk(t, type, value),           // "demo-insurer#SHA256#<hex>" | "#PHASH#<16 hex>" | "#IDENTIFIER#<normalized>"
  sk: evidenceSk(claimId, evidenceId),           // "CLM-1042#EVD-1042-1"
  gsi1pk: evidenceByIdPk(t, evidenceId),         // "demo-insurer#EVD-1042-1"
  gsi1sk: type,                                  // "SHA256" | "PHASH" | "IDENTIFIER"
  type, value,                                   // read by toEvidenceRecord
  kind,                                          // "DEVICE_PHOTO" | "POLICE_REPORT" | "PLATE_PHOTO" | "STATEMENT"
  claimId, evidenceId, customerId,
  exifDate,                                      // "YYYY-MM-DD" or an explicit null
  processingStatus: "READY", contentType, createdAt: SEED_CREATED_AT,
  s3Key,                                         // CLM-1042 photo only: "demo-insurer/cust-demo/EVD-1042-1"
  sizeBytes,                                     // CLM-1042 photo only
}
```

- Identifier values are written with `normalizeIdentifier(v)`: remove whitespace and hyphens, then uppercase. This is the same `normId` that `evaluate.ts` applies before every `findOtherClaims("IDENTIFIER", ...)` call. `normId` is not exported there, so the seed has its own copy and the end-to-end test proves they agree.
- `CLM-1042` has three rows for `EVD-1042-1`: SHA256 (real SHA-256 of the file), PHASH (`dhash64Hex`), IDENTIFIER (`867530900000017`). `exifDate` is `null`, because the PNG has no EXIF.
- Every scenario evidence ID has a SHA256 row and a PHASH row and **no** IDENTIFIER row, with these values:
  - `value(SHA256) = sha256Hex("scenario:" + claimId + ":" + evidenceId)`
  - `value(PHASH)` = first 16 hex characters of `sha256Hex("phash:" + claimId + ":" + evidenceId)`
  - Scenario D instead copies the CLM-1042 values for both types. Its rows sit under the same `pk` as the CLM-1042 rows with `sk = "CLM-SCN-D#EVD-SCN-D-1"`. `findOtherClaims` returns `CLM-1042` for them (EXACT for SHA256, NEAR for PHASH) and excludes `CLM-SCN-D` itself.
  - `exifDate` is the scenario loss date for photo kinds and `null` for police reports. An EXIF date earlier than the loss date would raise `TIMELINE_INCONSISTENT`.
  - No `s3Key`: nothing in the decision path reads the object, and the runner scenarios have no file in S3. The `GET /claims/{id}/evidence/{evidenceId}` route would find no object for a scenario claim. Those claims are test claims.
- `type`, `value` and `kind` are read by `normalize.ts`, but `contracts/data-model.md` does not list them as EvidenceIndex attributes. The seed writes them because the Decision Lambda needs them, and T-13 must write the same attributes. Task 4.3 adds the three attributes to the EvidenceIndex attribute list of `data-model.md` in this branch, as a separate commit (Req 14). The user explicitly authorizes this, which deviates from the `repository.md` rule that contract changes go in a separate PR. The change is documentation only: no schema or example file changes. `contracts/contracts.test.js` only validates JSON schemas and examples, so it needs no update, and `contracts/VERSION` (`1.0.0`) has no documented convention for documentation-only changes, so it stays unchanged and the PR says so.

### Scenarios

All scenarios use policy `POL-001`, customer `cust-demo`, tenant `demo-insurer`. `Date` is `SCENARIO_LOSS_DATE`, `2026-11-15`, inside policy v2 for every scenario. Evidence ID is `EVD-SCN-<id>-1`. The proposal for every scenario is built by `buildProposal` with `model: "seed-scenario-runner"`, `promptVersion: "seed-1"`, `customerText: "Synthetic scenario <id>."`, `extracted.amount` and `extracted.lossDate` equal to the claim's, and one `evidenceAssessment` entry `{ evidenceId, showsClaimedItem: true, confidence }`.

| ID | Claim ID | Item | Cause | Amount | Loss date | Evidence kind | Proposal identifier | Expected outcome | Expected adjuster text contains |
|---|---|---|---|---|---|---|---|---|---|
| A | CLM-SCN-A | PHONE-1 | ACCIDENTAL_DAMAGE | 180 | Date | DEVICE_PHOTO | imei PHONE-1 | AUTO_APPROVED, payout 130 | (none) |
| B | CLM-SCN-B | PHONE-1 | THEFT | 300 | Date | POLICE_REPORT | imei PHONE-1 | AUTO_APPROVED, payout 250 | (none) |
| B2 | CLM-SCN-B2 | PHONE-1 | THEFT | 400 | Date | POLICE_REPORT | imei PHONE-1 | ROUTED | `Payout 350 is above the auto-approve cap 300.` |
| C | CLM-SCN-C | CAR-1 | COLLISION | 150 | Date | POLICE_REPORT | plate DEMO123 | ROUTED | `always reviewed (cap 0)` |
| CI | CLM-SCN-CI | CAR-1 | INJURY | 150 | Date | POLICE_REPORT | plate DEMO123 | ROUTED | `always reviewed (cap 0)` |
| C2 | CLM-SCN-C2 | CAR-1 | WINDSCREEN | 200 | Date | PLATE_PHOTO | plate DEMO123 | AUTO_APPROVED, payout 150 | (none) |
| D | CLM-SCN-D | PHONE-1 | ACCIDENTAL_DAMAGE | 180 | Date | DEVICE_PHOTO, CLM-1042 hashes | imei PHONE-1 | ROUTED | `CLM-1042` |
| E | CLM-SCN-E | LAPTOP-1 | THEFT | 300 | Date | POLICE_REPORT | none | ROUTED | `Item category 'laptop' is not covered by policy POL-001.` |
| E2 | CLM-SCN-E2 | PHONE-1 | LOSS | 300 | Date | STATEMENT | imei PHONE-1 | ROUTED | `Cause 'LOSS' is not covered for 'phone' under POL-001 v2.` |
| F | CLM-SCN-F | PHONE-1 | ACCIDENTAL_DAMAGE | 700 | Date | DEVICE_PHOTO | imei PHONE-1 | ROUTED | `Payout 650 is above the auto-approve cap 500.` |
| G | CLM-SCN-G | PHONE-1 | THEFT | 300 | Date | POLICE_REPORT | imei `356938035649996` | ROUTED | `does not match the insured imei` |
| H | CLM-SCN-H | PHONE-2 | THEFT | 300 | Date | POLICE_REPORT | imei PHONE-2 | ROUTED | `CLM-1042` (signal `IDENTIFIER_REUSE`) |

Notes on individual scenarios:

- A, B, C2: no risk signal can fire. Hashes are unique, no IDENTIFIER row exists for PHONE-1 or the plate, `recentClaimCount` is at most 1 (`CLM-1042`, and only inside a 30-day window), the loss date `2026-11-15` is 318 days after the policy start (limit 14), the amount is below twice the typical value, and the evidence dates match the loss date (photo `exifDate` equals the loss date, report dates are `2026-11-15`). `CLM-1042` was created on `2026-10-14`, which is outside the 30-day frequency window of any run on or after `2026-11-15`, and the frequency limit is 3 claims anyway.
- B and B2 share `kind: POLICE_REPORT` but have different evidence IDs and hash values, so B2 cannot match B.
- D uses PHONE-1 and the proposal reports PHONE-1's IMEI, so the duplicate photo is the only signal. A live filing of the `CLM-1042` photo against PHONE-1 would also mismatch on IMEI, because the photo shows PHONE-2's IMEI.
- E uses the laptop pack (Req 5.1) so the coverage check reports the reason. The claim's evidence is a police report because the laptop `THEFT` cause requires one.
- E2 is a `LOSS` claim. The phone `LOSS` pack requires `STATEMENT` evidence, so the required-evidence check passes, and the coverage check fails because policy v2 drops `LOSS` from the phone causes. `checkCoverage` reports `Cause 'LOSS' is not covered for 'phone' under POL-001 v2.` and the claim is routed (the `LOSS` cap is 0 as well). The `STATEMENT` row has `exifDate` null and no file.
- G's mismatching IMEI belongs to no item and has no IDENTIFIER row, so only the evidence check fails.
- H has no IDENTIFIER row of its own. `gatherSignals` adds the proposal's IMEI to the lookup set, `findOtherClaims("IDENTIFIER", "867530900000017")` returns `CLM-1042`, and `IDENTIFIER_REUSE` fires. The reason text masks the IMEI (`…0017`), which keeps the full identifier out of the output.

### Evidence files

Files are PNG, generated by `seed/tools/generate-evidence.ts` and committed. All are 800 x 600, 8-bit RGB, non-interlaced, a few KB each, so they are far below the 5 MB limit (Req 8.8). Each carries the line `SYNTHETIC SAMPLE - NOT A REAL DOCUMENT`. They are drawings (flat shapes and bitmap text), not photographs, and the README says so.

| File | Kind | Shows | Used by |
|---|---|---|---|
| `phone-damaged-imei1.png` | DEVICE_PHOTO | Phone outline with a cracked screen and an "ABOUT PHONE" panel with `IMEI: 356938035643809` | Live demo (scenario A) |
| `phone-damaged-imei2.png` | DEVICE_PHOTO | Same layout with `IMEI: 867530900000017` | `CLM-1042` photo, live duplicate-photo demo (scenario D) |
| `police-report-phone1.png` | POLICE_REPORT | Name `ALEX DEMO`, `IMEI: 356938035643809`, incident and report date `2026-11-15`, report number | Live demo (scenario B) |
| `police-report-imei-mismatch.png` | POLICE_REPORT | Name `ALEX DEMO`, `IMEI: 356938035649996` | Scenario G (live) |
| `police-report-phone2.png` | POLICE_REPORT | Name `ALEX DEMO`, `IMEI: 867530900000017`, date `2026-11-15` | Scenario H (live) |
| `non-phone-mug.png` | DEVICE_PHOTO | A mug with the caption `COFFEE MUG` | Evidence-mismatch demo |
| `car-plate.png` | PLATE_PHOTO | Car outline with plate `DEMO123` | Scenario C2 (live) |

The README in `seed/evidence/` repeats this table and tells the presenter to file live claims with loss date `2026-11-15` or the current date, which lies inside policy v2. Version 2 still covers phone theft and damage and drops phone `LOSS`, so a live `LOSS` claim is routed with the "not covered" reason (scenario E2, on purpose).

**Generator.** `generate-evidence.ts` has no dependencies:

- `Canvas`: a `Uint8Array` of `width * height * 3`, with `fillRect`, `line` (Bresenham, for cracks and outlines) and `text(x, y, str, scale, rgb)`.
- `font5x7.ts`: a table of 5-bit rows for ` 0-9A-Z:-./(),`. Text is drawn at scale 4 to 5, so a glyph is about 25 x 35 px and legible to a vision model. An unknown character throws, so a typo in a file's text fails loudly.
- Texts take IMEIs, the plate, the holder name and dates from `constants.ts`, so the images cannot drift from the policy.
- `encodePng(width, height, rgb)` in `seed/lib/png.ts` writes the signature, `IHDR` (bit depth 8, color type 2, no interlace), one `IDAT` from `zlib.deflateSync` of the scanlines (each prefixed with filter byte 0), and `IEND`. CRC-32 uses a 256-entry table in the file, so it does not depend on `zlib.crc32` being present.
- `npx tsx seed/tools/generate-evidence.ts` rewrites `seed/evidence/*.png`. Generated bytes can differ between zlib versions, so tests compare decoded pixels, never bytes.

**PNG decoding and pHash.** `decodePng(bytes)` in `seed/lib/png.ts` inflates the concatenated `IDAT` data and reverses filters 0 to 4. It accepts bit depth 8, non-interlaced, color types 0 (gray), 2 (RGB) and 6 (RGBA), and throws `Unsupported PNG: <reason>` otherwise. The error is caught by `runSeed` and printed with the file name.

`dhash64Hex(image)` in `seed/lib/hashing.ts`:

1. Convert to gray with integer math: `(299*R + 587*G + 114*B) / 1000`, rounded down.
2. Reduce to 9 columns by 8 rows by averaging the source pixels in each cell. Cell boundaries are `floor(i * size / cells)`, and a cell always holds at least one pixel. All arithmetic is integer, so the result does not depend on the platform.
3. For each of the 8 rows and 8 column pairs, set a bit when the left cell is brighter than the right cell. 64 bits, written as 16 lowercase hex characters.

This is a difference hash. It is chosen over a DCT-based pHash because it needs no floating-point transform, is about 40 lines, and gives the same bits on every machine, which the idempotence requirement needs. Open decision 4 in `architecture.md` (near-duplicate method and distance) is still open. The Decision Lambda compares PHASH for equality only, so for now any 64-bit value works as long as the Evidence Processor (T-13) produces the same value for the same picture. `hashing.ts` documents that T-13 must use the same algorithm, or this function and the seed must change with it (Req 6.5). The SHA-256 of an uploaded file is computed over the original bytes, which T-13 must also do (not the normalized copy), or a live re-upload of `phone-damaged-imei2.png` will not match the seeded SHA-256 row.

Only the `CLM-1042` photo needs a pHash computed from a file. Scenario rows use the synthetic values above.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Prework reflection: the criteria on idempotence (2.1 to 2.5) and the tenant and customer keys (3.1, 3.2) share one builder, so they are one property. The policy, pack and evidence-shape criteria each round-trip through the Decision Lambda's own `normalize.ts`, which also covers the "validates against `data-model.md`" criteria. The per-scenario criteria (9.1 to 9.10, 10.7) are one property over the real handler, plus an order-independence property. Criteria about the Lambda invocation, S3, CloudFormation, real AWS counts, the repository process and the demo run are example or integration checks and are not properties.

### Property 1: Seed build is deterministic and idempotent

For any evidence file content set, building the seed items twice gives equal item lists, every `pk` starts with `demo-insurer#`, every item has a unique (table, `pk`, `sk`), and applying the items twice, in any order, to an in-memory table keyed by (`pk`, `sk`) gives the same final table and the same item count per table as applying them once.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 3.2**

### Property 2: Exactly one policy version is in force on any date

For any date between `2026-01-15` and `2026-12-31`, `selectPolicyVersion(items.map(toPolicy), date)` returns exactly one version of `POL-001`: version 1 when the date is on or before `2026-10-31`, version 2 otherwise. Version 1 covers `ACCIDENTAL_DAMAGE`, `THEFT` and `LOSS` for `phone`, version 2 covers `ACCIDENTAL_DAMAGE` and `THEFT` only (no `LOSS`), and no version covers `laptop`. For any seeded policy item, `toPolicy(policyToItem(p))` deep-equals `p`, and the first three items equal those of the domain fixtures.

**Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8**

### Property 3: Pack round trip

For any seeded pack `p`, `toPack(p.category, packToItem(p))` deep-equals `p`. For the phone and car packs, `p` deep-equals `phonePack` and `carPack` of the domain fixtures. Every `autoApproveCap` is a number at least 0, and every cause lists at least one required evidence kind.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9**

### Property 4: Evidence rows are complete and fold back to one record

For any evidence ID in the built items, every row has `kind` in the allowed set, `claimId`, `evidenceId` and an `exifDate` that is a `YYYY-MM-DD` string or `null`, and `toEvidenceRecord(evidenceId, rows)` returns a record whose `claimId`, `kind`, `sha256`, `phash` and `exifDate` (undefined when null) equal the row values, with `identifier` set only for `EVD-1042-1`.

**Validates: Requirements 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5**

### Property 5: Scenario hashes are isolated

For any two different scenario evidence IDs, other than scenario D's evidence and the `CLM-1042` photo, the SHA256 values differ and the PHASH values differ. Scenario D's SHA256 and PHASH values equal those of `EVD-1042-1`. The set of IDENTIFIER rows is exactly one row: the normalized PHONE-2 IMEI pointing to `CLM-1042`.

**Validates: Requirements 6.6, 7.6, 9.4, 9.10**

### Property 6: Scenario outcomes come from the real decision path

For any scenario in `SCENARIOS`, running the real `createHandlers(...).decide` over a real `DynamoStore` backed by an in-memory table that holds the seeded items and the runner's claim row returns `DECIDED` with the expected outcome, a decision that validates against `contracts/decision.schema.json`, a payout equal to the expected payout, and an adjuster reason containing each expected string.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.7**

### Property 7: Scenarios do not affect each other

For any permutation of the scenarios run against one in-memory table, and for any number of repeated runs, each scenario's outcome and adjuster reasons equal those of a single run in the default order.

**Validates: Requirements 9.10, 10.9**

### Property 8: Identifier format does not hide a reuse

For any formatting of the PHONE-2 IMEI (any mix of inserted spaces and hyphens and any letter case) used as the proposal's IMEI in scenario H, the decision is `ROUTED_TO_ADJUSTER` with an `IDENTIFIER_REUSE` signal naming `CLM-1042`. For any string `s`, `normalizeIdentifier(normalizeIdentifier(s))` equals `normalizeIdentifier(s)`.

**Validates: Requirements 6.6, 9.8**

### Property 9: Scenario claim reset is independent of prior state

For any prior stored item for a scenario claim ID (unset, `PROCESSING`, decided, resolved), the row written by `buildScenarioClaimRow` is the same: status `PROCESSING`, no `gsi1pk`, `gsi1sk`, `decision`, `reasons`, `payout`, `decidedAt`, `gsi2pk` or `gsi2sk`, and the claim ID starts with `CLM-SCN-`. For any claim ID not starting with `CLM-SCN-`, `runScenarios` refuses to write it.

**Validates: Requirements 10.4, 10.9**

### Property 10: PNG encode and decode round trip, and pHash format

For any small RGB image (width and height 1 to 64, random pixels), `decodePng(encodePng(img))` equals `img`. For any decoded image, `dhash64Hex` returns 16 lowercase hex characters and the same value on repeated calls. For every committed file in `seed/evidence/`, the decoded pixels equal those of a fresh run of the generator, the size is at most 5 MB, and the file is listed in the manifest.

**Validates: Requirements 6.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.8**

## Error Handling

| Situation | Behavior |
|---|---|
| Missing, extra or unknown `--stage` | Usage message from `parseStageArg`, exit 1, no AWS call (Req 1.2). |
| Foundation stack missing, output or table not found | `MissingResourceError` text names it (`output ClaimsTableName`, `table Policies`), exit 1, no write (Req 1.3). |
| Seed evidence file missing, unreadable, over 5 MB, or not PNG, JPEG or PDF | `Seed evidence file problem: <name>: <reason>`, exit 1, no write (Req 8.9). |
| Definitions fail validation (pack, policy, evidence row, duplicate key) | The failing item and rule are printed, exit 1, no write (Req 5.8). |
| S3 `PutObject` fails (including `AccessDenied` on the KMS key) | Print `S3 <bucket>/<key>: <error name>: <message>`, exit 1. No DynamoDB write has happened. |
| DynamoDB `PutItem` fails after SDK retries | Print `<table>: <error name>: <message>`, stop at the first failure, exit 1 (Req 1.6). The run is safe to repeat, because every item is an unconditional put with a fixed key. |
| Runner cannot find `CLM-1042` | `Seed data not found. Run: npm run seed -- --stage <stage>`, exit 1. |
| Runner date earlier than the latest scenario loss date | Explains `TIMELINE_INCONSISTENT` risk, exit 1. |
| Lambda `FunctionError`, throttling after SDK retries, bad payload, `NOT_FOUND`, `ALREADY_DECIDED`, schema failure | That scenario is `FAIL` with the reason. The remaining scenarios still run. Exit 1 at the end (Req 10.8). `ALREADY_DECIDED` in a fresh run means the reset did not happen and is a runner bug, not a decision. |
| `AUTO_APPROVE_ENABLED` failed on an `AUTO_APPROVED` scenario | Scenario `FAIL`, with the kill switch hint. |

Idempotency in one place: seed items have keys that derive only from constants and fixed timestamps, so a second run overwrites equal items. No attribute records write time, so the second run changes nothing, not even `createdAt`. The runner replaces each scenario claim in full on every run. Seed and runner never write the same item: the seed writes `CLM-1042` and the evidence rows, the runner writes only `CLM-SCN-*` claims.

Output hygiene (Req 13.7): the scripts print table names, bucket name, S3 key, claim IDs and outcomes. They do not print the ARN, the account ID, credentials or the stage config. The IMEIs are synthetic and appear in the repository.

## Testing Strategy

Vitest, run by the root `npm test`. Property tests use `fast-check` with at least 100 runs and the tag format `Feature: a-t12-seed, Property <n>: <title>`. Example tests cover the I/O seams with fakes, so no AWS access is needed.

**In-memory DynamoDB fake** (`scripts/seed-e2e.test.ts`). A class with `send(command)` that dispatches on `command.constructor.name` and `command.input`: `GetCommand` (key lookup, `ConsistentRead` ignored), `QueryCommand` (`pk = :pk` on the table or `gsi1pk = :pk [AND gsi1sk >= :since]` for `IndexName`, honoring `ScanIndexForward` and `Limit`), `PutCommand`. It is passed to the real `DynamoStore` from `backend/processing/decision/dynamo-store.ts`, wrapped in a subclass whose `commitDecision` records the result and sets the claim status instead of building a `TransactWriteCommand`. The handler is the real `createHandlers` with a kill switch of `true`, thresholds from `infra/config/default.json` (14, 2, 30, 3) and `now` set to `2026-11-21T10:00:00Z`. This is what proves the key shapes, `normalize.ts` mappings, `normId` agreement, hash isolation and reasons for Properties 6, 7 and 8. The transaction itself (condition, audit put) is already covered by T-14's own tests.

| Test file | Content |
|---|---|
| `scripts/seed-definitions.test.ts` | Properties 1 to 5. Example tests for cap values, item order, Luhn validity of the three IMEIs, no email-like strings except `example.com` (Req 11.7), `CLM-1042` decision valid against the schema. |
| `scripts/seed-evidence.test.ts` | Property 10. Manifest lists every file in `seed/evidence/` and the README mentions each. |
| `scripts/seed.test.ts` | `runSeed` with fake deps: usage on bad stage, missing output named, missing file named with no write, `PutItem` failure stops with table name and exit 1, S3 failure leaves no DynamoDB write, two runs give the same final table and counts (Req 11.6). `stage-resources` unit cases: outputs preferred over resources, fallback regex, missing table. |
| `scripts/seed-e2e.test.ts` | Properties 6, 7 and 8, plus the loss-date and filing-date interplay for every scenario. |
| `scripts/run-scenarios.test.ts` | Property 9. `runScenarios` with fake deps: PASS and FAIL lines, exit code 1 when one scenario fails and all still run, `FunctionError` handling, preflight failures, the kill switch hint, no call to any index-writing function (the deps interface has none). |

Not tested by property tests, on purpose: CloudFormation, S3, Lambda and DynamoDB calls against AWS. They are checked once by the user-account run in Requirement 12 (seed twice, count rows, `get-item` for `CLM-1042`, run scenarios and show A and H).

## Review Items

These need a decision from the owner or the other team member before or during implementation.

1. **Req 5 and 9 gain a `laptop` pack** (Req 5.1 amended). Without it scenario E gives a different reason from the one the requirements and the demo script quote. This adds a third pack to the seed.
2. **Duplicate-photo demo shows two matches.** Scenario D's evidence rows share the `CLM-1042` hashes, as requested. A judge who files `phone-damaged-imei2.png` live will get duplicate signals for both `CLM-1042` and `CLM-SCN-D`. The adjuster text still names `CLM-1042`. If that is distracting, the demo stage can skip scenario evidence rows, which needs a `--no-scenarios` flag that is not in the requirements.
3. **Three table names are not stack outputs.** B can add `PoliciesTableName`, `ClaimTypePacksTableName` and `EvidenceIndexTableName` to `foundation-stack.ts`. The seed works without them, using the logical-ID fallback.
4. **Tests live in `scripts/`**, because the root vitest include list has no `seed/**` entry.
5. **No AuditLog row for `CLM-1042`.** The audit table is not seeded. An adjuster who opens the audit trail of `CLM-1042` sees none.
6. **`contracts/data-model.md` changes in this branch** (Req 14), by the user's explicit authorization, against the `repository.md` rule. Mention it in the PR description.
7. **The runner needs the clock at or after `2026-11-15`.** A run before that date fails the preflight with an explanation.
