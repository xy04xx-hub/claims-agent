// Owner: A. Pure core of the Evidence Processor: one S3 "Object Created" event in, EvidenceIndex rows out.
// All AWS access goes through ProcessDeps, so tests need no SDK mocks.
import { parseExifDate } from "./exif.js";
import { dhash64Hex, sha256Hex } from "./hashing.js";
import { UNASSIGNED_CLAIM_ID, decodeS3Key, evidenceByIdPk, evidenceIndexPk, evidenceSk, parseEvidenceKey } from "./key.js";
import { resolveKind, type EvidenceKind } from "./kind.js";
import { decodePng } from "./png.js";

export interface S3ObjectCreatedEvent {
  version?: string;
  id?: string;
  "detail-type"?: string;
  source?: string;
  /** ISO 8601. Used as createdAt, so a retry writes identical rows. */
  time?: string;
  detail?: {
    bucket?: { name?: unknown };
    object?: { key?: unknown; size?: unknown };
  };
}

export interface ObjectData {
  bytes: Uint8Array;
  contentType: string | undefined;
  /** S3 user metadata, keys lower case: { kind: "DEVICE_PHOTO" } */
  metadata: Record<string, string>;
}

type Fields = Record<string, unknown>;
export interface ProcessDeps {
  /** Throws on any S3 error. */
  getObject(bucket: string, key: string): Promise<ObjectData>;
  /** Unconditional PutItem per row. Throws on any error. */
  putRows(rows: EvidenceRow[]): Promise<void>;
  log: { info(message: string, fields?: Fields): void; warn(message: string, fields?: Fields): void };
  now(): Date;
}

export interface ProcessConfig { bucket: string; maxObjectBytes: number }

export interface EvidenceRow {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: "SHA256" | "PHASH";
  type: "SHA256" | "PHASH";
  value: string;
  kind: EvidenceKind;
  claimId: typeof UNASSIGNED_CLAIM_ID;
  evidenceId: string;
  customerId: string;
  exifDate: string | null;
  processingStatus: "READY" | "FAILED";
  contentType: string;
  createdAt: string;
  s3Key: string;
  sizeBytes: number;
}

export type Outcome =
  | { result: "WRITTEN"; rows: EvidenceRow[]; processingStatus: "READY" | "FAILED" }
  | { result: "SKIPPED"; reason: "BAD_EVENT" | "WRONG_BUCKET" | "BAD_KEY" | "TOO_LARGE" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PIXELS = 16_000_000;
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** The pHash of a PNG, or undefined when it cannot be decoded. Never throws. */
function tryPhash(bytes: Uint8Array): string | undefined {
  try {
    if (bytes.length < 24) return undefined;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const w = dv.getUint32(16);
    const h = dv.getUint32(20);
    if (w === 0 || h === 0 || w * h > MAX_PIXELS) return undefined;
    return dhash64Hex(decodePng(bytes));
  } catch {
    return undefined;
  }
}

export async function processObject(
  event: S3ObjectCreatedEvent, deps: ProcessDeps, cfg: ProcessConfig, requestId: string,
): Promise<Outcome> {
  const started = deps.now().getTime();
  const skip = (reason: Extract<Outcome, { result: "SKIPPED" }>["reason"], fields: Fields = {}): Outcome => {
    deps.log.warn(`evidence event skipped: ${reason}`, { requestId, ...fields });
    return { result: "SKIPPED", reason };
  };

  const bucket = event.detail?.bucket?.name;
  const rawKey = event.detail?.object?.key;
  if (typeof bucket !== "string" || typeof rawKey !== "string") return skip("BAD_EVENT");
  if (bucket !== cfg.bucket) return skip("WRONG_BUCKET");

  let key: string;
  try {
    key = decodeS3Key(rawKey);
  } catch {
    return skip("BAD_KEY", { keyLength: rawKey.length });
  }
  const parsed = parseEvidenceKey(key);
  // A malformed key may hold anything, so only its shape is logged.
  if (!parsed) return skip("BAD_KEY", { keyParts: key.split("/").length, keyLength: key.length });
  const { tenantId, customerId, evidenceId } = parsed;

  const size = event.detail?.object?.size;
  if (typeof size === "number" && size > cfg.maxObjectBytes) return skip("TOO_LARGE", { evidenceId, size });

  const obj = await deps.getObject(bucket, key); // one read; an error propagates so Lambda retries
  const bytes = obj.bytes;
  const contentType = obj.contentType ?? "application/octet-stream";
  const sha256 = sha256Hex(bytes);

  const isPng = startsWith(bytes, PNG_SIGNATURE) || contentType.toLowerCase().startsWith("image/png");
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  let phash: string | undefined;
  let status: "READY" | "FAILED" = "READY";
  if (isPng) {
    phash = tryPhash(bytes);
    if (phash === undefined) {
      status = "FAILED";
      deps.log.warn("png could not be decoded, hash row skipped", { requestId, evidenceId });
    }
  }
  const exifDate = isJpeg ? parseExifDate(bytes) : null;
  const kind = resolveKind(obj.metadata.kind, obj.contentType, (m, f) => deps.log.warn(m, { requestId, evidenceId, ...f }));

  const createdAt = Number.isNaN(Date.parse(event.time ?? "")) ? deps.now().toISOString() : (event.time as string);
  const row = (type: "SHA256" | "PHASH", value: string): EvidenceRow => ({
    pk: evidenceIndexPk(tenantId, type, value),
    sk: evidenceSk(UNASSIGNED_CLAIM_ID, evidenceId),
    gsi1pk: evidenceByIdPk(tenantId, evidenceId),
    gsi1sk: type,
    type, value, kind, claimId: UNASSIGNED_CLAIM_ID, evidenceId, customerId, exifDate,
    processingStatus: status, contentType, createdAt, s3Key: key, sizeBytes: bytes.length,
  });
  const rows = [row("SHA256", sha256), ...(phash ? [row("PHASH", phash)] : [])];
  await deps.putRows(rows);

  deps.log.info("evidence processed", {
    requestId, evidenceId, kind, contentType, processingStatus: status, hasExifDate: exifDate !== null,
    durationMs: deps.now().getTime() - started,
  });
  return { result: "WRITTEN", rows, processingStatus: status };
}
