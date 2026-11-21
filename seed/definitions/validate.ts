// Owner: A. Shape checks that run before any AWS write. They throw an Error whose message names the problem.
import { CAUSES, type ClaimTypePack, type Policy } from "@claims-agent/domain";

type Item = Record<string, unknown>;
const KINDS = ["DEVICE_PHOTO", "POLICE_REPORT", "PLATE_PHOTO", "STATEMENT"];
const TYPES = ["SHA256", "PHASH", "IDENTIFIER"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (m: string): never => { throw new Error(m); };

export function assertValidPolicy(p: Policy): void {
  const ref = `policy ${p.policyId} v${p.version}`;
  if (!p.policyId || !p.customerId || !p.holderName) fail(`${ref}: policyId, customerId and holderName are required`);
  if (!Number.isInteger(p.version) || p.version < 1) fail(`${ref}: version must be a positive integer`);
  for (const d of [p.startDate, p.effectiveFrom, ...(p.effectiveTo ? [p.effectiveTo] : [])]) {
    if (!DATE.test(d)) fail(`${ref}: bad date ${d}`);
  }
  if (p.effectiveTo && p.effectiveTo < p.effectiveFrom) fail(`${ref}: effectiveTo is before effectiveFrom`);
  if (!(p.deductible >= 0)) fail(`${ref}: deductible must be 0 or more`);
  const ids = new Set<string>();
  for (const i of p.items) {
    if (!i.itemId || !i.category || !i.label) fail(`${ref}: item needs itemId, category and label`);
    if (ids.has(i.itemId)) fail(`${ref}: duplicate item ${i.itemId}`);
    ids.add(i.itemId);
  }
  for (const [cat, c] of Object.entries(p.coverage)) {
    if (!(c.limit > 0)) fail(`${ref}: limit of ${cat} must be positive`);
    for (const cause of c.causes) if (!(CAUSES as readonly string[]).includes(cause)) fail(`${ref}: unknown cause ${cause}`);
  }
}

export function assertValidPack(p: ClaimTypePack): void {
  const ref = `pack ${p.category} v${p.version}`;
  if (!p.category || !Number.isInteger(p.version) || p.version < 1) fail(`${ref}: category and a positive version are required`);
  if (!(p.typicalValue > 0)) fail(`${ref}: typicalValue must be positive`);
  if (!(p.minConfidence > 0 && p.minConfidence <= 1)) fail(`${ref}: minConfidence must be in (0, 1]`);
  for (const [cause, c] of Object.entries(p.causes)) {
    if (!(CAUSES as readonly string[]).includes(cause)) fail(`${ref}: unknown cause ${cause}`);
    if (!c || !(c.autoApproveCap >= 0)) fail(`${ref}: ${cause} cap must be 0 or more`);
    if (c.requiredEvidence.length === 0) fail(`${ref}: ${cause} needs at least one required evidence kind`);
    for (const k of c.requiredEvidence) if (!KINDS.includes(k)) fail(`${ref}: unknown evidence kind ${k}`);
  }
}

export function assertValidEvidenceRow(r: Item): void {
  const ref = `evidence row ${String(r.pk)} / ${String(r.sk)}`;
  for (const f of ["kind", "claimId", "evidenceId", "exifDate", "type", "value"]) {
    if (!(f in r) || r[f] === undefined) fail(`${ref}: missing ${f}`);
  }
  if (!KINDS.includes(String(r.kind))) fail(`${ref}: bad kind ${String(r.kind)}`);
  if (!TYPES.includes(String(r.type))) fail(`${ref}: bad type ${String(r.type)}`);
  if (r.exifDate !== null && !DATE.test(String(r.exifDate))) fail(`${ref}: exifDate must be YYYY-MM-DD or null`);
  if (!r.value || !r.claimId || !r.evidenceId) fail(`${ref}: value, claimId and evidenceId must not be empty`);
}

export function assertNoDuplicateKeys(table: string, items: Item[]): void {
  const seen = new Set<string>();
  for (const i of items) {
    const k = `${String(i.pk)}|${String(i.sk)}`;
    if (seen.has(k)) fail(`${table}: duplicate key ${k}`);
    seen.add(k);
  }
}
