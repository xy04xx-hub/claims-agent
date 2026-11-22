// Turns raw DynamoDB items into domain shapes. Every field may be missing: nothing here throws on absent data.
import { CAUSES, type Cause, type ClaimTypePack, type EvidenceKind, type Policy } from "@claims-agent/domain";
import type { ClaimRecord, ClaimStatus, EvidenceRecord } from "./types.js";

type Item = Record<string, unknown>;
const KINDS: readonly string[] = ["DEVICE_PHOTO", "POLICE_REPORT", "PLATE_PHOTO", "STATEMENT"];
const STATUSES: readonly string[] = [
  "PROCESSING", "AUTO_APPROVED", "ROUTED_TO_ADJUSTER", "APPROVED_BY_ADJUSTER", "REJECTED_BY_ADJUSTER",
];

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Item => typeof v === "object" && v !== null && !Array.isArray(v);

/** First 10 characters when they look like YYYY-MM-DD, otherwise undefined. */
export function toDate(v: unknown): string | undefined {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}

export function toClaim(tenantId: string, item: Item | undefined): ClaimRecord | undefined {
  if (!item) return undefined;
  const status = str(item.status);
  const claimId = str(item.claimId);
  if (!claimId || !status || !STATUSES.includes(status)) return undefined;
  return {
    tenantId,
    claimId,
    customerId: str(item.customerId) ?? "",
    policyId: str(item.policyId) ?? "",
    policyVersion: num(item.policyVersion),
    itemId: str(item.itemId) ?? "",
    cause: str(item.cause) ?? "UNCLEAR",
    amountClaimed: num(item.amountClaimed) ?? 0,
    lossDate: toDate(item.lossDate) ?? "",
    evidenceIds: arr(item.evidenceIds).filter((e): e is string => typeof e === "string"),
    status: status as ClaimStatus,
    createdAt: str(item.createdAt) ?? "",
    ...(str(item.description) !== undefined ? { description: str(item.description) as string } : {}),
  };
}

export function toPolicy(item: Item): Policy {
  const coverage: Policy["coverage"] = {};
  if (isObj(item.coverage)) {
    for (const [category, c] of Object.entries(item.coverage)) {
      if (!isObj(c)) continue;
      coverage[category] = {
        causes: arr(c.causes).filter((x): x is Cause => typeof x === "string" && (CAUSES as readonly string[]).includes(x)),
        limit: num(c.limit) ?? 0,
      };
    }
  }
  return {
    policyId: str(item.policyId) ?? "",
    version: num(item.version) ?? 0,
    customerId: str(item.customerId) ?? "",
    holderName: str(item.holderName) ?? "",
    startDate: toDate(item.startDate) ?? "9999-12-31",
    effectiveFrom: toDate(item.effectiveFrom) ?? "9999-12-31",
    effectiveTo: toDate(item.effectiveTo),
    deductible: num(item.deductible) ?? 0,
    items: arr(item.items).filter(isObj).map((i) => ({
      itemId: str(i.itemId) ?? "",
      category: str(i.category) ?? "",
      label: str(i.label) ?? "",
      imei: str(i.imei),
      vin: str(i.vin),
      plate: str(i.plate),
    })),
    coverage,
  };
}

const DEFAULT_MIN_CONFIDENCE = 0.8;

export function toPack(category: string, item: Item | undefined): ClaimTypePack | undefined {
  if (!item) return undefined;
  const causes: ClaimTypePack["causes"] = {};
  if (isObj(item.causes)) {
    for (const [cause, c] of Object.entries(item.causes)) {
      if (!isObj(c) || !(CAUSES as readonly string[]).includes(cause)) continue;
      causes[cause as Cause] = {
        autoApproveCap: num(c.autoApproveCap) ?? 0,
        requiredEvidence: arr(c.requiredEvidence).filter((k): k is EvidenceKind => typeof k === "string" && KINDS.includes(k)),
      };
    }
  }
  const thresholds = isObj(item.confidenceThresholds) ? item.confidenceThresholds : {};
  return {
    category,
    version: num(item.version) ?? 1,
    causes,
    identifierFields: arr(item.identifierFields).filter((f): f is string => typeof f === "string"),
    typicalValue: num(item.typicalValue) ?? 0,
    minConfidence: num(thresholds.minConfidence) ?? DEFAULT_MIN_CONFIDENCE,
  };
}

/** Folds the index items of one evidence ID (one per type) into a single record. Missing parts stay undefined. */
export function toEvidenceRecord(evidenceId: string, items: Item[]): EvidenceRecord {
  const rec: EvidenceRecord = { evidenceId };
  let failed = false;
  let sha256Ready = false;
  for (const it of items) {
    const type = str(it.type);
    const value = str(it.value);
    const status = str(it.processingStatus);
    if ((type === "SHA256" || type === "PHASH") && status === "FAILED") failed = true;
    if (type === "SHA256" && status === "READY") sha256Ready = true;
    if (type === "SHA256" && value) rec.sha256 = value;
    if (type === "PHASH" && value) rec.phash = value;
    if (type === "IDENTIFIER" && value) rec.identifier = value;
    const kind = str(it.kind);
    if (kind && KINDS.includes(kind)) rec.kind = kind as EvidenceKind;
    rec.claimId = rec.claimId ?? str(it.claimId);
    rec.exifDate = rec.exifDate ?? toDate(it.exifDate);
    rec.s3Key = rec.s3Key ?? str(it.s3Key);
    rec.contentType = rec.contentType ?? str(it.contentType);
    rec.sizeBytes = rec.sizeBytes ?? num(it.sizeBytes);
  }
  // No rows at all (entry missing) leaves the status undefined, which callers treat as not ready.
  if (items.length > 0) rec.processingStatus = failed ? "FAILED" : sha256Ready ? "READY" : "PENDING";
  return rec;
}
