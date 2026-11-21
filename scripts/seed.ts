// Owner: A. `npm run seed -- --stage <stage>` runs this file through scripts/seed-entry.ts (B).
// Writes the synthetic seed data (policies, packs, CLM-1042, evidence rows) with idempotent unconditional puts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CLM_1042_S3_KEY, EVIDENCE_FILES, buildSeedItems, type PhotoInfo } from "../seed/definitions/index.js";
import { dhash64Hex, sha256Hex } from "../seed/lib/hashing.js";
import { decodePng } from "../seed/lib/png.js";
import { realCfn, resolveFoundation, type FoundationNames } from "../seed/lib/stage-resources.js";
import { parseStageArg } from "./lib/stage-arg.js";

const MAX_BYTES = 5 * 1024 * 1024;
export const CLM_1042_PHOTO = "phone-damaged-imei2.png";

export interface SeedDeps {
  resolveFoundation(stage: string): Promise<FoundationNames>;
  /** Throws if the file does not exist. */
  readEvidenceFile(name: string): Buffer;
  putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  putItem(table: string, item: Record<string, unknown>): Promise<void>;
  log(message: string): void;
  error(message: string): void;
}

function checkFile(name: string, bytes: Buffer): string | undefined {
  if (bytes.length > MAX_BYTES) return `Seed evidence file too large (max 5 MB): ${name}`;
  const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const pdf = bytes.subarray(0, 4).toString("ascii") === "%PDF";
  return png || jpeg || pdf ? undefined : `Seed evidence file is not PNG, JPEG or PDF: ${name}`;
}

export async function runSeed(argv: string[], deps: SeedDeps): Promise<number> {
  const parsed = parseStageArg(argv);
  if (!parsed.ok) {
    deps.error(parsed.usage);
    return 1;
  }
  let names: FoundationNames;
  try {
    names = await deps.resolveFoundation(parsed.stage);
  } catch (e) {
    deps.error(`${(e as Error).message}`);
    return 1;
  }

  const files = new Map<string, Buffer>();
  for (const f of EVIDENCE_FILES) {
    let bytes: Buffer;
    try {
      bytes = deps.readEvidenceFile(f.name);
    } catch {
      deps.error(`Seed evidence file missing: ${f.name}`);
      return 1;
    }
    const problem = checkFile(f.name, bytes);
    if (problem) {
      deps.error(problem);
      return 1;
    }
    files.set(f.name, bytes);
  }

  let items;
  const photoBytes = files.get(CLM_1042_PHOTO) as Buffer;
  try {
    const photo: PhotoInfo = {
      sha256: sha256Hex(photoBytes), phash: dhash64Hex(decodePng(photoBytes)), sizeBytes: photoBytes.length, contentType: "image/png",
    };
    items = buildSeedItems(photo);
  } catch (e) {
    deps.error(`Seed validation failed: ${(e as Error).message}`);
    return 1;
  }

  try {
    await deps.putObject(names.bucket, CLM_1042_S3_KEY, photoBytes, "image/png");
  } catch (e) {
    deps.error(`S3 upload failed for ${names.bucket}: ${(e as Error).message}`);
    return 1;
  }

  const plan: [string, string, Record<string, unknown>[]][] = [
    ["Policies", names.policies, items.policies],
    ["ClaimTypePacks", names.packs, items.packs],
    ["EvidenceIndex", names.evidenceIndex, items.evidenceIndex],
    ["Claims", names.claims, items.claims],
  ];
  for (const [label, table, rows] of plan) {
    for (const row of rows) {
      try {
        await deps.putItem(table, row);
      } catch (e) {
        deps.error(`Write to ${label} (${table}) failed: ${(e as Error).message}`);
        return 1;
      }
    }
  }
  for (const [label, , rows] of plan) deps.log(`${label}: ${rows.length}`);
  deps.log("S3 objects: 1");
  return 0;
}

function realDeps(): SeedDeps {
  const region = "us-east-1";
  const s3 = new S3Client({ region, maxAttempts: 5 });
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region, maxAttempts: 5 }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const cfn = realCfn(region);
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../seed/evidence");
  return {
    resolveFoundation: (stage) => resolveFoundation(cfn, stage),
    readEvidenceFile: (name) => readFileSync(path.join(dir, name)),
    putObject: async (Bucket, Key, Body, ContentType) => {
      await s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
    },
    putItem: async (TableName, Item) => {
      await doc.send(new PutCommand({ TableName, Item }));
    },
    log: (m) => console.log(m),
    error: (m) => console.error(m),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSeed(process.argv.slice(2), realDeps()).then((code) => process.exit(code), (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
