# Design: T-13 Evidence Processor

## Overview

An S3 upload to the evidence bucket raises an EventBridge `Object Created` event. A rule invokes the Evidence Processor Lambda, which reads the object once, computes SHA-256, a dHash for PNG files and the EXIF capture date for JPEG files, and writes `EvidenceIndex` rows in the same shape as the seed script. The rows carry the placeholder claim ID `UNASSIGNED` until T-15 assigns real ones.

Scope comes from `requirements.md` (MVP: SHA-256 for all files, PNG dHash, JPEG EXIF date; no normalized copy, no near-duplicate search). Owner A. Placement follows `repository.md` section 2.

Things this design decides that the requirements leave open, or corrects, are listed in "Decisions and deviations" at the end. Read that section before reviewing.

## Architecture

Flow: browser upload to S3, then S3 `Object Created` to EventBridge, then the rule invokes the Evidence Processor asynchronously, which reads the object and writes `EvidenceIndex` rows. Failed events go to a DLQ.

### Placement and file layout

```
backend/processing/evidence-processor/      (A, new)
  index.ts            Lambda entry. Real S3, DynamoDB and Powertools clients, env config. No logic.
  process.ts          Pure core: processObject(event, deps, cfg). All AWS access goes through injected deps.
  key.ts              decodeS3Key, parseEvidenceKey, row key helpers (evidenceSk), UNASSIGNED import
  kind.ts             resolveKind(metadataKind, contentType) and the content-type table
  exif.ts             parseExifDate(bytes): string | null. Hand-written, never throws.
  hashing.ts          COPY of seed/lib/hashing.ts (sha256Hex, normalizeIdentifier, dhash64Hex)
  png.ts              COPY of seed/lib/png.ts (decodePng, encodePng, RawImage)
  process.test.ts  key.test.ts  kind.test.ts  exif.test.ts  parity.test.ts
  test/helpers.ts     fake deps, JPEG/TIFF builder, PNG builder
backend/processing/decision/                (A, two small edits)
  keys.ts             + export const UNASSIGNED_CLAIM_ID = "UNASSIGNED"
  dynamo-store.ts     findOtherClaims ignores UNASSIGNED rows
  evaluate.ts         own-evidence filter includes listed UNASSIGNED rows
infra/lib/stacks/processing-stack.ts        (A) function, role, rule, DLQ, nag acknowledgments
infra/test/processing-stack.test.ts         (A) updated and extended
infra/test/stacks.test.ts                   (B file, one list updated: see "Shared files touched")
infra/test/claims-function.test.ts          (B file, one count updated: see "Shared files touched")
backend/processing/package.json             move @aws-sdk/client-s3 from devDependencies to dependencies (npm, not by hand)
backend/processing/tsconfig.json            include "evidence-processor"
backend/processing/vitest.config.ts         include "evidence-processor/**/*.test.ts"
```

`decision/` is not renamed or restructured. The processor imports key helpers (`evidenceIndexPk`, `evidenceByIdPk`, `UNASSIGNED_CLAIM_ID`) from `../decision/keys.js`, the same way `seed/definitions/keys.ts` already does, so the reader and the writer cannot drift. `evidenceSk` (`claimId#evidenceId`) exists only in `seed/definitions/keys.ts`, which must not be imported into the Lambda, so `key.ts` defines it again and the parity test compares it with the seed's.

Nothing from `seed/` is imported by Lambda code. esbuild follows imports from `index.ts` only, so `seed/` never enters the bundle.

### Copies of `hashing.ts` and `png.ts`

Both files are copied verbatim from `seed/lib` with one added header, and nothing else changes:

```ts
// COPY of seed/lib/hashing.ts. It must stay identical to that file from the next line on.
// parity.test.ts fails if the two differ. Change seed/lib first, then copy the change here.
<verbatim content of seed/lib/hashing.ts, starting at its own first line>
```

Same header (with `png.ts`) for `png.ts`. The seed files stay untouched, so seed behavior cannot change. Both copies compile in the processing workspace: `hashing.ts` imports `./png.js`, which resolves to the copy next to it.

## Data Models

The input is the S3 event below. The output is the `EvidenceRow` shape under "Row shape".

### Event shape

EventBridge delivers the S3 `Object Created` event. Fields the processor reads are marked.

```ts
export interface S3ObjectCreatedEvent {
  version: string;
  id: string;
  "detail-type": "Object Created";
  source: "aws.s3";
  account: string;
  time: string;                       // ISO 8601, used as createdAt (see "Idempotency")
  region: string;
  resources: string[];
  detail: {
    version: string;
    bucket: { name: string };         // read
    object: {
      key: string;                    // read. URL-encoded.
      size: number;                   // read. Bytes, used for the size guard.
      etag: string;
      "version-id"?: string;
      sequencer: string;
    };
    "request-id": string;
    requester: string;
    "source-ip-address"?: string;
    reason: string;                   // PutObject, POST Object, CopyObject, CompleteMultipartUpload. Not used.
  };
}
```

The key is URL-encoded in the event (spaces as `+`, other characters as `%XX`). `decodeS3Key(raw)` replaces `+` with a space and applies `decodeURIComponent`. A malformed escape sequence throws inside the decoder, and `process.ts` treats that as an invalid key (warn, no row). The strict key pattern below rejects any decoded key that still contains a space or other unexpected character.

The handler reads the event defensively: if `detail.bucket.name` or `detail.object.key` is not a string, it logs a warning and returns. It does not trust the rule filter alone.

## Key parsing

```ts
const TENANT_OR_CUSTOMER = /^[A-Za-z0-9._-]{1,40}$/;   // same pattern the Decision Lambda uses for tenantId
const EVIDENCE_ID = /^EVD-[A-Za-z0-9-]{1,40}$/;        // contracts/api/evidence-upload.response.schema.json

export function parseEvidenceKey(key: string): { tenantId: string; customerId: string; evidenceId: string } | undefined;
```

The key must split on `/` into exactly three non-empty parts, each matching its pattern. `#` is excluded by the patterns, which matters because `#` is the separator inside `pk` values. Anything else returns `undefined`, and the caller logs `invalid evidence key` (the key itself is not logged in full: only its part count and the length, since a malformed key may hold anything) and writes no row.

## Rule prefix filter

Requirement 1.3 asks for a key prefix filter. Foundation's key layout is `<tenantId>/<customerId>/<evidenceId>` from the root of the bucket, with no fixed leading folder, and the stage config holds no tenant ID. A static prefix would have to be `""` or a hard-coded tenant.

Choice: filter on the key shape with the EventBridge `wildcard` operator, `*/*/*`. It matches keys with at least two slashes, which are exactly the evidence keys, and it excludes any object stored at the bucket root or one level down. A hard-coded `demo-insurer/` prefix would break a second tenant and mix seed constants into infra.

```ts
const rule = new events.Rule(this, 'EvidenceUploaded', {
  description: 'Evidence uploaded to the evidence bucket (T-13)',
  eventPattern: {
    source: ['aws.s3'],
    detailType: ['Object Created'],
    detail: {
      bucket: { name: [f.evidenceBucket.bucketName] },
      object: { key: [{ wildcard: '*/*/*' }] },
    },
  },
});
```

The code check in `parseEvidenceKey` stays as the second line of defense (requirement 4.4). If a future change writes other objects under a three-level key (the normalized copy is out of scope here), give them a root folder and add an `anything-but` prefix clause then. If CloudFormation rejects `wildcard` in a rule on deploy, fall back to `anything-but: { prefix: 'normalized/' }` and say so in the PR. Requirement 1.3 should then read "filter on the key shape". See "Decisions and deviations".

The bucket already sends events to EventBridge (`eventBridgeEnabled` in `foundation-stack.ts`), so Foundation does not change.

## Lambda construct

Built inside `ProcessingStack` with the shared `ClaimsFunction`, next to the decision function. No change to `claims-function.ts`.

```ts
const processor = new ClaimsFunction(this, 'evidence-processor', {
  entry: path.join(REPO_ROOT, 'backend/processing/evidence-processor/index.ts'),
  timeout: cdk.Duration.seconds(20),
  memorySize: 1024,
  environment: {
    EVIDENCE_INDEX_TABLE: f.evidenceIndexTable.tableName,
    EVIDENCE_BUCKET: f.evidenceBucket.bucketName,
    MAX_OBJECT_BYTES: String(props.config.maxUploadBytes * 2),
  },
});
this.evidenceProcessorFunction = processor.function;
```

| Setting | Value | Reason |
|---|---|---|
| Runtime and architecture | Node.js 22, ARM64 (fixed by `ClaimsFunction`) | repository standard |
| Memory | 1024 MB | PNG decode is CPU bound, and CPU scales with memory. A 5 MB PNG can hold about 16 million pixels: raw 48 MB plus the gray `Int32Array` of 64 MB. 512 MB is too tight. |
| Timeout | 20 s | Target is under 2 s. Leaves room for an S3 retry and a cold start, and stays far below the async event age. |
| `AWS_NODEJS_CONNECTION_REUSE_ENABLED`, `POWERTOOLS_SERVICE_NAME` | added by `ClaimsFunction` | |
| `MAX_OBJECT_BYTES` | `maxUploadBytes * 2` (10 MiB with the default) | Guard against objects that bypassed the presigned size limit. |

`ClaimsFunction` runs esbuild with `@aws-sdk/*` external, so the runtime's SDK v3 is used and `client-s3` adds nothing to the bundle. It is moved to `dependencies` because the handler imports it at runtime (`npm install @aws-sdk/client-s3 -w backend/processing --save-prod`, which also updates the lockfile).

## Async invocation, retries and dead-letter queue

EventBridge invokes the Lambda asynchronously. Two layers retry, and requirement 5.2 and 5.3 ("EventBridge retries") are really satisfied by the second one:

1. **EventBridge to Lambda delivery** (the service could not hand the event over, for example throttling): the rule target retries.
2. **Lambda async invocation** (the function ran and threw): Lambda retries on its own.

```ts
const dlq = new sqs.Queue(this, 'EvidenceEventsDlq', {
  encryption: sqs.QueueEncryption.SQS_MANAGED,
  enforceSSL: true,
  retentionPeriod: cdk.Duration.days(14),
});
rule.addTarget(new targets.LambdaFunction(processor.function, {
  retryAttempts: 2,
  maxEventAge: cdk.Duration.minutes(5),
  deadLetterQueue: dlq,
}));
processor.function.configureAsyncInvoke({
  retryAttempts: 2,
  maxEventAge: cdk.Duration.minutes(5),
  onFailure: new destinations.SqsDestination(dlq),
});
```

| Setting | Value | Reason |
|---|---|---|
| Target `retryAttempts` | 2 | Default is 185 attempts over 24 h, far too long for a demo path. |
| Target `maxEventAge` | 5 min | A claim submitted later cannot use a hash that arrives an hour late. |
| Target `deadLetterQueue` | the DLQ | Keeps events EventBridge could not deliver. |
| Function async `retryAttempts` | 2 | Three runs in total. The writes are idempotent, so repeats are safe. |
| Function async `maxEventAge` | 5 min | Same as above. |
| Function async `onFailure` | the same DLQ | Without it an event that exhausted its retries is dropped and the upload has no rows. |
| DLQ encryption | SQS-managed | A KMS key would need a key policy entry from Foundation's key for `events.amazonaws.com` and the function role, which creates a cross-stack cycle. Messages hold the event only (bucket, key, size), no personal data. |

The DLQ depth alarm belongs to T-25 (observability). Until then, the verification step checks the queue is empty.

A claim that arrives at the Decision Lambda before its evidence rows exist finds no evidence for the listed IDs and routes ("required evidence missing"), which is safe. Flagged for T-15: the Worker should wait for rows (or check `processingStatus`) before it signs a ticket.

## IAM (least privilege)

One role, created by `ClaimsFunction`. Statements are added explicitly with `fn.addToRolePolicy`, as in the decision function. Do not use `bucket.grantRead` or `key.grant`: with imported-style handles they edit Foundation's resource policies and create a cross-stack dependency cycle.

| Statement | Actions | Resource |
|---|---|---|
| Read evidence | `s3:GetObject` | `${f.evidenceBucket.bucketArn}/*/*/*` (same key shape as the rule) |
| Write rows | `dynamodb:PutItem` | `f.evidenceIndexTable.tableArn` (not the indexes: PutItem does not address them) |
| Data key | `kms:Decrypt`, `kms:GenerateDataKey`, `kms:DescribeKey` | `f.dataKey.keyArn` |
| Failure destination | `sqs:SendMessage` | `dlq.queueArn` (added by `SqsDestination`) |
| Logs, X-Ray | from `ClaimsFunction` | log group ARN, and `*` for X-Ray only |

KMS: `s3:GetObject` on an SSE-KMS object needs `kms:Decrypt` on the bucket key, and the table write needs `GenerateDataKey` and `Decrypt` on the table key. Both use the one `dataKey`. Foundation's key keeps CDK's default key policy, which delegates to IAM in the account, so these identity-policy statements are enough, as for the decision role. There is no `s3:ListBucket`, so a missing object returns `AccessDenied`, not `NoSuchKey`. That is fine: any S3 read error throws.

Requirement 1.4 says "nothing else". The `sqs:SendMessage` on the one DLQ is the only addition. Recommend rewording 1.4 accordingly (see "Decisions and deviations").

## cdk-nag

cdk-nag runs through `applyNag` (`AwsSolutionsChecks` plus the reason-length check). Acknowledgments use the same call as the decision function: `cdk.Validations.of(<construct>).acknowledge({ id, reason })`, reasons of at least 10 characters.

| Scope | Rule | Reason text (summary) |
|---|---|---|
| `evidence-processor` function construct | `AwsSolutions-IAM5` | The role has two wildcards: X-Ray (AWS has no resource-level support), and the S3 object ARN `bucket/*/*/*`. The object key is `<tenant>/<customer>/<evidence>` and tenants and customers are not known at deploy time. The statement allows only `s3:GetObject`. |
| `evidence-processor` function construct | `AwsSolutions-L1` | Same text as the decision function: Node.js 22 is the project standard, changing it is a platform decision. |
| `EvidenceEventsDlq` | `AwsSolutions-SQS3` | The queue is itself the dead-letter queue for failed events. |

These three are the expected set. The authoritative list is what `cdk synth` reports: acknowledge only rules that fire, never add a blanket one. The "known acknowledgments" test in `stacks.test.ts` is updated to the final list.

## Components and Interfaces

The sections "Key parsing" to "Lambda construct", "Kind resolution", "EXIF parser" and "Entry point" describe the other components. The core is below.

### Pure core: `process.ts`

```ts
export interface ObjectData {
  bytes: Uint8Array;
  contentType: string | undefined;     // S3 ContentType
  metadata: Record<string, string>;    // S3 user metadata, keys lower case: { kind: "DEVICE_PHOTO" }
}

export interface ProcessDeps {
  getObject(bucket: string, key: string): Promise<ObjectData>;   // throws on any S3 error
  putRows(rows: EvidenceRow[]): Promise<void>;                   // unconditional PutItem per row, throws on any error
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void };
  now(): Date;
}

export interface ProcessConfig { bucket: string; maxObjectBytes: number }

export type Outcome =
  | { result: "WRITTEN"; rows: EvidenceRow[]; processingStatus: "READY" | "FAILED" }
  | { result: "SKIPPED"; reason: "BAD_EVENT" | "WRONG_BUCKET" | "BAD_KEY" | "TOO_LARGE" };

export async function processObject(event: S3ObjectCreatedEvent, deps: ProcessDeps, cfg: ProcessConfig, requestId: string): Promise<Outcome>;
```

The Lambda never calls S3 or DynamoDB in this module, so tests run with plain fakes and no AWS SDK mocking library.

### Steps

1. Validate the event fields. Missing bucket or key: warn, `SKIPPED BAD_EVENT`.
2. `detail.bucket.name !== cfg.bucket`: warn, `SKIPPED WRONG_BUCKET`.
3. Decode the key and parse it. Failure: warn, `SKIPPED BAD_KEY`. No S3 or DynamoDB call is made.
4. `detail.object.size > cfg.maxObjectBytes`: warn, `SKIPPED TOO_LARGE`. No S3 read. The upload API limits files to 5 MB (`content-length-range`), so this only triggers for an object that bypassed it.
5. `getObject` once (requirement 7.2). A throw propagates.
6. `sha256 = sha256Hex(bytes)`.
7. Sniff the format from the bytes: PNG signature `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, PDF `%PDF-`. The processor trusts bytes, not the claimed content type, for what to compute. A PNG is `sniffed PNG or contentType === "image/png"`, so a corrupt file that claims PNG ends as `FAILED`.
8. PNG: `tryPhash(bytes)`:
   - read width and height from the IHDR bytes (offsets 16 to 23) and reject more than `MAX_PIXELS = 16_000_000` or zero, before decoding. This bounds memory to roughly 112 MB for the decoded pixels and the gray array.
   - `dhash64Hex(decodePng(bytes))`, wrapped in `try`. Any throw (`Unsupported PNG: ...`, zlib error, `RangeError`) gives `FAILED` and no PHASH row. Nothing is rethrown.
9. JPEG: `exifDate = parseExifDate(bytes)`. Everything else: `null`.
10. `kind = resolveKind(metadata.kind, contentType, warn)`.
11. Build the rows, `putRows(rows)`. A throw propagates.
12. Log one `evidence processed` line with `evidenceId`, `requestId`, `kind`, `contentType`, `processingStatus`, `durationMs`.

A decompression bomb whose IHDR lies about its size can still make `inflateSync` allocate beyond the pixel cap. The 5 MB (10 MB hard) input limit and the 1024 MB memory bound this: Lambda fails the invocation and the retry path ends in the DLQ. Accepted for the MVP, listed in the PR notes.

### Row shape

```ts
export interface EvidenceRow {
  pk: string;                    // evidenceIndexPk(tenantId, type, value)   `${tenantId}#${type}#${value}`
  sk: string;                    // evidenceSk("UNASSIGNED", evidenceId)     `UNASSIGNED#${evidenceId}`
  gsi1pk: string;                // evidenceByIdPk(tenantId, evidenceId)     `${tenantId}#${evidenceId}`
  gsi1sk: "SHA256" | "PHASH";
  type: "SHA256" | "PHASH";
  value: string;
  kind: EvidenceKind;
  claimId: "UNASSIGNED";
  evidenceId: string;
  customerId: string;
  exifDate: string | null;       // YYYY-MM-DD or null
  processingStatus: "READY" | "FAILED";
  contentType: string;           // S3 content type, "application/octet-stream" if absent
  createdAt: string;             // event.time
  s3Key: string;                 // decoded key
  sizeBytes: number;             // bytes.length actually read
}
```

This is the field set of `evidenceRow` in `seed/definitions/build.ts` with `s3Key` and `sizeBytes` always present (the seed builds them for CLM-1042). `exifDate` is written as `null`, not omitted, as the seed does. The SHA256 row always exists. The PHASH row exists only when the PNG decoded. Both rows carry the same `exifDate`, `kind`, `processingStatus`.

`PutItem` is unconditional (requirement 4.8). The DynamoDB document client is created with `removeUndefinedValues: true`, as in the decision `index.ts`. `putRows` in `index.ts` sends the rows with `Promise.all` of `PutCommand`. If one fails the invocation throws, and the retry rewrites both.

### Idempotency

A retry processes the same S3 object and produces the same rows because the row content depends only on the object and the event: `createdAt` is `event.time` (the EventBridge envelope time, stable across retries), not `now()`. `deps.now()` is used only for `durationMs` and as the `createdAt` fallback when `time` is missing or not a valid date. Row keys are deterministic, so an overwrite replaces, never adds.

Re-uploading a different file under the same `evidenceId` overwrites the `UNASSIGNED#<evidenceId>` rows only for the same hash value. A different file has a different `pk`, so its rows are added next to the old ones, and `byEvidence` then returns both. The API creates a new `evidenceId` for every upload, so this does not occur in practice.

## Kind resolution: `kind.ts`

```ts
export const EVIDENCE_KINDS = ["DEVICE_PHOTO", "POLICE_REPORT", "PLATE_PHOTO", "STATEMENT"] as const;

export function resolveKind(metadataKind: string | undefined, contentType: string | undefined, warn: (m: string, f?: Record<string, unknown>) => void): EvidenceKind;
```

1. `metadataKind` is in `EVIDENCE_KINDS` (exact, case-sensitive): use it.
2. Otherwise warn (`kind metadata missing or invalid`, with the content type and whether metadata was present, not the value) and use the table:

| Content type (lower-cased, parameters after `;` removed) | Kind | Why |
|---|---|---|
| `image/png` | `DEVICE_PHOTO` | An image is most likely a device photo |
| `image/jpeg` | `DEVICE_PHOTO` | same |
| `application/pdf` | `POLICE_REPORT` | A PDF is most likely a document |
| anything else or missing | `STATEMENT` | Never satisfies a photo or report requirement |

The table can pick a wrong kind (a police report uploaded as a PNG, `plate` photos). Both wrong guesses fail the "required evidence present" check and route to an adjuster, so the failure is safe. Real uploads should carry `x-amz-meta-kind` (the evidence upload API, owner B). The `kind` metadata is chosen by the customer. It only selects which requirement a file claims to satisfy. The checks that compare its content with the policy still run in the Decision Lambda.

## EXIF parser: `exif.ts`

`parseExifDate(bytes: Uint8Array): string | null`. Pure, no dependencies, wrapped in a top-level `try` so any unexpected error returns `null`. Every read goes through bounds-checked helpers (`u16(off)`, `u32(off)`) that return `undefined` out of range, and a missing value ends the parse with `null`.

Algorithm:

1. **JPEG check.** `bytes[0] === 0xFF && bytes[1] === 0xD8`, else `null`.
2. **Walk segments** from offset 2:
   - Expect `0xFF`. Skip any run of `0xFF` fill bytes. Read the marker byte `m`.
   - `m` is `0xD9` (EOI) or `0xDA` (start of scan): stop, return `null`. Exif always precedes the image data.
   - `m` is `0x01` or `0xD0` to `0xD7` (no length field): advance 2 and continue.
   - Otherwise read the big-endian length `len` at `off + 2`. If `len < 2` or `off + 2 + len > bytes.length`: malformed, return `null`.
   - If `m === 0xE1` and the payload starts with `45 78 69 66 00 00` (`Exif\0\0`): the TIFF block starts at `payloadStart + 6`, ends at the segment end. Parse it (below). Return its result.
   - Otherwise (including XMP, which is also APP1): advance to `off + 2 + len`.
3. **TIFF header** at `t`:
   - bytes `49 49` = little endian, `4D 4D` = big endian, else `null`.
   - `u16(t + 2) === 42`, else `null`.
   - `ifd0 = u32(t + 4)`.
4. **IFD reader** `findEntry(ifdOffset, tag)`: `count = u16(t + ifdOffset)`. Cap `count` at `floor((tiffEnd - (t + ifdOffset + 2)) / 12)` so a lying count cannot run past the block. Entry `i` is at `t + ifdOffset + 2 + 12 * i`: `tag u16`, `type u16`, `count u32`, `value-or-offset u32` at `+8`. Return the entry whose tag matches, else `undefined`.
5. **IFD0 to ExifIFD.** `findEntry(ifd0, 0x8769)`. Its value (type LONG, 4) is the ExifIFD offset, relative to `t`. Missing: `null`.
6. **ExifIFD to DateTimeOriginal.** `findEntry(exifIfd, 0x9003)`. Require type 2 (ASCII) and `count >= 19` (the string `YYYY:MM:DD HH:MM:SS` plus the NUL gives 20; accept 19 to 20 bytes). The 4-byte slot holds an offset because the string is longer than 4 bytes: read the ASCII bytes at `t + value`, length `count`, bounds-checked, trailing NUL removed.
7. **Convert.** Match `/^(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}$/`. Build `YYYY-MM-DD`. Validate it is a real calendar date: `new Date(Date.UTC(y, m - 1, d))` must give back the same year, month and day, and the year must be at least 1900 (`0000:00:00 00:00:00`, which cameras write when the clock is unset, becomes `null`). No match or invalid date: `null`.

`DateTime` (0x0132) and `DateTimeDigitized` (0x9004) are not used as fallbacks: requirement 3.1 names `DateTimeOriginal`. The time of day is dropped, because the decision rules compare dates only.

## Decision Lambda changes (same PR)

### 1. `findOtherClaims` ignores unassigned rows (requirement 9)

`keys.ts` gets `export const UNASSIGNED_CLAIM_ID = "UNASSIGNED";`. In `dynamo-store.ts`:

```ts
const ids = items
  .map((i) => (typeof i.claimId === "string" ? i.claimId : typeof i.sk === "string" ? i.sk.split("#")[0] : ""))
  .filter((id) => id && id !== excludeClaimId && id !== UNASSIGNED_CLAIM_ID);
```

Both branches (the `claimId` attribute and the `sk` prefix fallback) yield `UNASSIGNED` for processor rows, and the filter removes it either way. The `Store` interface and its docs comment are unchanged, except for one added sentence: "Rows not yet assigned to a claim are ignored."

### 2. Listed unassigned rows count as the claim's own evidence (requirement 10)

In `evaluate.ts`, where `own` is built:

```ts
const own = evidence.filter(
  (e) =>
    !e.claimId ||
    e.claimId === claim.claimId ||
    (e.claimId === UNASSIGNED_CLAIM_ID && claim.evidenceIds.includes(e.evidenceId)),
);
```

`getEvidence` already fetches only `claim.evidenceIds`, so the `includes` check is a second guard that keeps requirement 10.2 true even if `getEvidence` is later changed to read more. `toEvidenceRecord` merges all rows of one `evidenceId` and keeps the first row's `claimId`, `kind` and `exifDate`. For a processor upload that is the `UNASSIGNED` value, so the new branch is what makes `provided` kinds and `EXIF_MISSING` work before T-15.

Effect on seeded data: if the seed runs after the processor is deployed, the seed's `putObject` of the CLM-1042 photo triggers one extra pair of `UNASSIGNED#EVD-1042-1` rows (same hashes, kind `DEVICE_PHOTO`). Changes 1 and 2 make them harmless: they are ignored as "other claims", and `CLM-1042` is already decided. No seed change.

## Parity test: reading the seed without bundling it

`parity.test.ts` (Vitest, runs from `npm test -w backend/processing` and the root run) imports seed code and reads seed files, because test files are never bundled by esbuild.

```ts
const seedLib = (f: string) => readFileSync(new URL(`../../../seed/lib/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mine    = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
```

| Test | Assertion |
|---|---|
| copies are textual copies | `mine("hashing.ts")` ends with `seedLib("hashing.ts")`, same for `png.ts`. The two lines before it are the header. This catches any drift, not only behavior drift. |
| header present | both copies start with `// COPY of seed/lib/` |
| behavior on every seed PNG | for each file in `seed/evidence/*.png`: `dhash64Hex(decodePng(buf))` from the processor copy equals the seed's result (imported from `../../../seed/lib/hashing.js`), and `sha256Hex` equal |
| committed CLM-1042 row | read `seed/evidence/phone-damaged-imei2.png`. Build seed items with `buildSeedItems({ sha256, phash, sizeBytes, contentType })` from `../../../seed/definitions/build.js`, where `sha256` and `phash` come from the **seed** implementation. Take its `CLM-1042` SHA256 and PHASH rows. Run `processObject` on the same bytes with the **processor** copy. The written `value`s must equal the seed rows' `value`s, and the `pk`s must be equal. |
| row shape | the processor's SHA256 row has the same key set as the seed's `CLM-1042` SHA256 row, and its `pk`, `gsi1pk`, `gsi1sk` formats match. `sk` is `UNASSIGNED#<evidenceId>` while the seed's is `CLM-1042#EVD-1042-1`; the test asserts the remainder after the claim ID is the evidence ID in both. |
| key helpers | `evidenceSk` in `key.ts` equals `evidenceSk` from `seed/definitions/keys.js` for sample inputs |

`seed/definitions/build.ts` imports `@claims-agent/domain`, which resolves through the workspace symlink in the root `node_modules`, as it already does in `scripts/seed-definitions.test.ts`. If `seed/` ever moves, this test is the one that fails, by design.

## Error handling

| Situation | Behavior | Result for the caller |
|---|---|---|
| Event missing bucket or key | warn, skip | return normally |
| Bucket is not the evidence bucket | warn, skip | return normally |
| Key not `<tenant>/<customer>/EVD-...` or not decodable | warn, skip, no row | return normally |
| Object larger than `MAX_OBJECT_BYTES` | warn, skip, no S3 read | return normally |
| S3 `GetObject` fails (throttling, KMS, permission, not found) | log error, rethrow | Lambda async retry (2), then DLQ |
| PNG cannot be decoded, or has more than 16 million pixels | SHA256 row, `processingStatus: FAILED`, no PHASH row, warn | return normally |
| JPEG EXIF truncated or malformed | `exifDate: null`, continue | return normally |
| `kind` metadata missing or invalid | derive from content type, warn | return normally |
| DynamoDB `PutItem` fails | log error, rethrow | Lambda async retry (2), then DLQ. A retry rewrites both rows. |
| Out of memory or timeout | Lambda failure | same as above |
| Event delivery to Lambda fails | target retries (2, within 5 min) | DLQ |

Logs: Powertools `Logger` with service name `evidence-processor`, created in `index.ts` and passed to `createLogSink` from `../decision/powertools.js` (reused as is). `process.ts` receives the request ID as an argument and adds `requestId` and `evidenceId` to every call. Logged fields are IDs, kind, content type, status and duration only. Never logged: bytes, EXIF values other than presence, the full key of an invalid object, any text from a document. No metrics are added: the ticket and requirements do not ask for them.

## Entry point: `index.ts`

```ts
const s3 = new S3Client({});
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const log = createLogSink(new Logger({ serviceName: "evidence-processor" }));
const table = env("EVIDENCE_INDEX_TABLE");

const deps: ProcessDeps = {
  getObject: async (Bucket, Key) => {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
    return { bytes: await r.Body!.transformToByteArray(), contentType: r.ContentType, metadata: r.Metadata ?? {} };
  },
  putRows: async (rows) => { await Promise.all(rows.map((Item) => doc.send(new PutCommand({ TableName: table, Item })))); },
  log,
  now: () => new Date(),
};

export const handler = async (event: S3ObjectCreatedEvent, ctx: { awsRequestId: string }): Promise<void> => {
  await processObject(event, deps, { bucket: env("EVIDENCE_BUCKET"), maxObjectBytes: num("MAX_OBJECT_BYTES") }, ctx.awsRequestId);
};
```

`env` and `num` follow the helpers in `decision/index.ts` (a missing variable fails at cold start). The handler returns nothing, because async invocation ignores it.

## Testing Strategy

Vitest only, no new dependencies, no property-based library. Each correctness property below is a unit test over a small table of representative inputs (several byte arrays, every table entry, every truncation length of one JPEG), not a randomized generator. Deployed behavior is checked once by the verification procedure.

| File | Cases |
|---|---|
| `process.test.ts` | PNG gives SHA256 and PHASH rows. JPEG and PDF give SHA256 only. Undecodable PNG (truncated, unsupported color type, over the pixel cap, wrong signature with `image/png`) gives `FAILED`, no PHASH, no throw. Invalid key, wrong bucket, oversized object: no S3 call, no row. `getObject` rejects: rethrown. `putRows` rejects: rethrown. First attempt fails at `putRows`, second succeeds: final table content equals a clean run (fake table keyed by `pk` and `sk`). Object read once. Logs: fields present, no marker bytes or key. |
| `key.test.ts` | decode: `%2F`-free keys, `+`, `%20`, malformed `%`. parse: valid, too few or many parts, empty parts, `#`, spaces, over-long parts, bad evidence ID. |
| `kind.test.ts` | metadata wins when valid. Invalid or missing metadata falls back for every table row, unknown type and missing type. Warn is called on fallback only. |
| `exif.test.ts` | JPEG with `DateTimeOriginal` in little and big endian. No APP1. APP1 without Exif header (XMP). Exif without ExifIFD. ExifIFD without `0x9003`. Date `0000:00:00`, `2026:13:40`. Every truncation of a valid JPEG returns a string or `null` and does not throw. Lying IFD entry count. PNG and PDF bytes. |
| `parity.test.ts` | As in the parity section. |
| `decision/dynamo-store.test.ts` (extended) | `findOtherClaims` over rows `[CLM-1042, UNASSIGNED, own claim]` returns only `["CLM-1042"]`, with and without the `claimId` attribute. Fails if `UNASSIGNED` is returned. |
| `decision/decision.test.ts` (extended) | A claim whose evidence record has `claimId: "UNASSIGNED"` evaluates with the right `provided` kinds and `EXIF_MISSING` handling. An unassigned record whose `evidenceId` is not on the claim is excluded. Existing tests stay green. |
| `infra/test/processing-stack.test.ts` | See below. |

`test/helpers.ts` holds the fakes (in-memory object store, table keyed by `pk` and `sk`, log recorder with a clock) and two small builders: a PNG from raw pixels (using the copied `encodePng`) and a JPEG with an APP1 Exif segment (`buildJpeg({ date, endian })`).

### Stack assertions (`processing-stack.test.ts`)

Existing assertions assume one function and no S3 or EvidenceIndex writes, so four of them change:

- Lambda count 1 becomes 2. The existing "one function" test selects the decision function by its `Timeout` and `MemorySize`, not by taking the first one.
- "only the decision role has `UpdateItem` on Claims" stays as is.
- "no wildcard resource except X-Ray" now allows the single S3 object ARN `…/*/*/*` for `s3:GetObject`, and nothing else.
- "no write on Policies, ClaimTypePacks or EvidenceIndex" is scoped to the decision role's statements. The processor role is checked by its own tests.

New assertions: the rule pattern (source, detail type, bucket name reference, key wildcard), one target with `RetryPolicy` (2, 300 s) and a `DeadLetterConfig`, the function's env variable names, the `EventInvokeConfig` (retries 2, max age 300 s, failure destination), the processor role's statements exactly as in the IAM table (and `PutItem` limited to the EvidenceIndex table ARN), no wildcard action, and the DLQ (SQS-managed encryption, SSL-only policy, 14-day retention).

### Shared files touched (small edits to B's tests)

- `infra/test/stacks.test.ts`: the "known acknowledgments" list gets the final processor entries. The `DENY_LIST` check already skips the Processing stack.
- `infra/test/claims-function.test.ts`: the Processing function count 1 becomes 2.

Both are one-line expectation changes needed by the new resources. Request B's review on the PR.

## Verification in the Demo_Account (inline commands)

No new committed script. The procedure runs as one throwaway shell block, pasted from the PR notes, with a `trap` for cleanup. It reads names from CloudFormation, so nothing is hard-coded. The inline form keeps account details out of the repo (repository rule 8). If the block turns out too long to maintain by hand, the fallback is a script under `scripts/` owned by A, which this design does not need.

Steps (`STAGE=dev-a`, region `us-east-1`):

1. **Prerequisites.** Each check prints its name and stops on failure:
   - `aws sts get-caller-identity` succeeds.
   - `aws cloudformation describe-stacks --stack-name ClaimsAgent-dev-a-Foundation` exists and is `CREATE_COMPLETE` or `UPDATE_COMPLETE`.
   - `aws cloudformation list-stack-resources` for Foundation gives the physical names of the `EvidenceBucket`, `EvidenceIndexTable`, `ClaimsTable` and `AuditLogTable`.
   - Seed present: `aws dynamodb get-item` on the Claims table for `demo-insurer#CLM-1042` / `CLAIM` returns an item. The seeded SHA256 is read from the EvidenceIndex rows of `CLM-1042` (`byEvidence` index, `demo-insurer#EVD-1042-1`).
   - `sha256sum seed/evidence/phone-damaged-imei2.png` equals the seeded SHA256 value.
2. **Deploy.** `npx cdk deploy ClaimsAgent-dev-a-Processing -c stage=dev-a --require-approval never` from `infra/`, with `CDK_DEFAULT_ACCOUNT` set. Only the Processing stack changes.
3. **Upload.** `EVD=EVD-T13-$RANDOM$RANDOM`. `aws s3api put-object --bucket $BUCKET --key demo-insurer/cust-demo/$EVD --body seed/evidence/phone-damaged-imei2.png --content-type image/png --metadata kind=DEVICE_PHOTO`. Set `trap cleanup EXIT` before this line.
4. **Rows written.** Poll up to 30 s: `aws dynamodb query` on `EvidenceIndex`, index `byEvidence`, `gsi1pk = demo-insurer#$EVD`. Print the items. Expect a `SHA256` and a `PHASH` row, `processingStatus` `READY`, `kind` `DEVICE_PHOTO`.
5. **Duplicate visible.** `aws dynamodb query` with `pk = demo-insurer#SHA256#<sha>`. Expect both `CLM-1042#EVD-1042-1` and `UNASSIGNED#$EVD` in `sk`. Repeat for `PHASH`.
6. **Decision.** `put-item` a scratch claim `CLM-T13-$RANDOM` in Claims: same attributes as `buildScenarioClaimRow` (status `PROCESSING`, `evidenceIds: [$EVD]`, cause `ACCIDENTAL_DAMAGE`, item `ITEM-PHONE-2`, no `gsi1pk`/`gsi1sk`, so the frequency signal is unaffected). Invoke the decision function (name from `list-stack-resources`) with `{tenantId, claimId, proposal}`, where `proposal` is `contracts/proposal.example.json` with its `claimId` replaced. Print the routing reasons. Expect `ROUTED_TO_ADJUSTER` and a reason naming `CLM-1042`.
7. **Duration.** `aws logs start-query` (or `filter-log-events`) on the processor log group for the `evidence processed` line. Print `durationMs`. Also read the `REPORT` line for the Lambda's own duration and memory. This is the evidence for requirement 7.1.
8. **DLQ empty.** `aws sqs get-queue-attributes` shows 0 visible messages.
9. **Cleanup** (`cleanup`, runs on success and failure, no prompt, only objects this run created): delete the S3 object `demo-insurer/cust-demo/$EVD`; `delete-item` the SHA256 and PHASH rows by `pk` and `sk` (`UNASSIGNED#$EVD`); delete the scratch claim; query the AuditLog by `pk = demo-insurer#<scratch claim>` and delete the returned items by `pk` and `sk`. Variables that were never set (a step that did not run) skip their delete. Seeded data and the stack are left alone.

Every step prints `PASS <step>` or `FAIL <step>: <cause>` or `NOT RUN <step>: <cause>`. A step that did not run is never reported as passed (requirement 12.9). The output goes into the PR description.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Per the testing strategy, each property is implemented as a plain unit test over a representative table of inputs, not a randomized generator.

### Property 1: SHA-256 is the digest of the object bytes

For any object bytes, the SHA256 row value equals the lowercase hex SHA-256 of those bytes, and processing the same bytes twice gives the same value.

**Validates: Requirements 2.1, 2.2**

### Property 2: Rows follow the file format

For any object, a SHA256 row is always written. A PHASH row is written if and only if the object is a PNG that decodes, and its value equals `dhash64Hex(decodePng(bytes))`. JPEG and PDF objects never get a PHASH row. For any PNG that cannot be decoded, the rows are a SHA256 row with `processingStatus` `FAILED` and no PHASH row, and the invocation does not throw.

**Validates: Requirements 2.3, 2.4, 5.1**

### Property 3: Processor copies behave like the seed

For any file in `seed/evidence`, the processor copies of `sha256Hex`, `decodePng` and `dhash64Hex` give the same results as the seed versions, and the copy files end with the exact text of the seed files. For the seeded duplicate photo, the processor's SHA256 and PHASH values equal those of the committed CLM-1042 rows.

**Validates: Requirements 2.5, 2.6, 8.1**

### Property 4: The EXIF parser is total and correct

For any byte array, `parseExifDate` does not throw and returns either `null` or a valid calendar date in `YYYY-MM-DD`. For any JPEG built with a `DateTimeOriginal` value and either byte order, it returns that date. For any truncation of a valid JPEG, it returns the date or `null`. For non-JPEG input or a JPEG without `DateTimeOriginal`, it returns `null`.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: Written rows have the seed's shape and unassigned keys

For any valid key `<tenantId>/<customerId>/<evidenceId>`, every written row has exactly the field set of the seed's `CLM-1042` rows, `claimId` `UNASSIGNED`, `sk` equal to `UNASSIGNED#<evidenceId>`, `pk`, `gsi1pk` and `gsi1sk` built with the same formats as the seed, and the tenant, customer and evidence IDs taken from the key.

**Validates: Requirements 4.1, 4.2, 4.3, 4.7, 4.9**

### Property 6: Invalid keys write nothing

For any S3 key that is not three non-empty parts matching the tenant, customer and evidence ID patterns, the processor makes no S3 read and no table write, and does not throw.

**Validates: Requirements 4.4**

### Property 7: Kind resolution

For any metadata value and content type, an allowed `kind` metadata value is used as is. Otherwise the kind comes from the content-type table, and a warning is logged.

**Validates: Requirements 4.5, 4.6**

### Property 8: Processing is idempotent and retry-safe

For any object, processing it twice, or processing it after a failed attempt, leaves the table with the same rows as one successful run, and the S3 object is read once per invocation.

**Validates: Requirements 4.8, 5.4, 7.2**

### Property 9: Failures that should be retried are thrown

For any S3 read failure or table write failure, the invocation throws the error and does not report success.

**Validates: Requirements 5.2, 5.3**

### Property 10: Logs carry identifiers and no content

For any processed object, the log lines include `evidenceId` and the request ID, the completion line includes kind, content type, status and duration, and no log field contains file bytes or extracted text.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 11: Unassigned rows are never other claims

For any set of EvidenceIndex rows for one hash or identifier, `findOtherClaims` returns only real claim IDs, never `UNASSIGNED`, and never the excluded claim.

**Validates: Requirements 9.1, 9.2**

### Property 12: Listed unassigned evidence counts as the claim's own

For any claim and any evidence records, the claim's own evidence is exactly the records with no claim ID, the claim's own ID, or `UNASSIGNED` with an `evidenceId` listed on the claim. Its kinds and EXIF dates drive the required-evidence and `EXIF_MISSING` checks.

**Validates: Requirements 10.1, 10.2**

Properties not listed above are checked elsewhere. Requirements 1.1 to 1.7 and 11 are stack assertions, nag and CI runs. Requirement 7.1 and Requirements 8.2 and 12 are checked in the Demo_Account by the verification procedure.

## Decisions and deviations

1. **Prefix filter is a key-shape filter, not a prefix.** No fixed prefix exists in the Foundation layout and the config has no tenant. Requirement 1.3 should read "filter on the evidence key shape". Needs a decision if you prefer a hard-coded tenant prefix instead.
2. **Retries come from Lambda async invocation, not EventBridge.** EventBridge only retries delivery. Requirements 5.2 and 5.3 should say "so the invocation is retried".
3. **DLQ added** (SQS-managed encryption), with `sqs:SendMessage` on it in the role. Requirement 1.4 says "nothing else". The queue is the only place a failed upload event is kept. Alarm on it is T-25.
4. **Two guards beyond the requirements:** object size above `MAX_OBJECT_BYTES` is skipped without reading, and PNGs above 16 million pixels are marked `FAILED` before decoding. Both protect the 1024 MB limit.
5. **`createdAt` is the event time** so retries rewrite identical rows.
6. **Unknown content types map to `STATEMENT`**, which cannot satisfy a photo or report requirement.
7. **Memory 1024 MB, timeout 20 s.** Chosen for PNG decode, to be confirmed by the logged duration.
8. **Known limitation (also in the requirements):** until T-15, two new claims using the same photo are not matched with each other. The Worker (T-15) must also wait for rows before signing a ticket.
