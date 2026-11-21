// Owner: A. S3 key decoding and parsing. Evidence keys are `<tenantId>/<customerId>/<evidenceId>`.
export { UNASSIGNED_CLAIM_ID, evidenceByIdPk, evidenceIndexPk } from "../decision/keys.js";

const TENANT_OR_CUSTOMER = /^[A-Za-z0-9._-]{1,40}$/; // same pattern the Decision Lambda uses for tenantId
const EVIDENCE_ID = /^EVD-[A-Za-z0-9-]{1,40}$/; // contracts/api/evidence-upload.response.schema.json

/** S3 event keys are URL-encoded: `+` is a space, everything else is %XX. A malformed escape throws URIError. */
export function decodeS3Key(raw: string): string {
  return decodeURIComponent(raw.replace(/\+/g, " "));
}

export interface EvidenceKey { tenantId: string; customerId: string; evidenceId: string }

/** Returns undefined for any key that is not exactly three valid parts. `#` is excluded because it separates pk parts. */
export function parseEvidenceKey(key: string): EvidenceKey | undefined {
  const parts = key.split("/");
  if (parts.length !== 3) return undefined;
  const [tenantId, customerId, evidenceId] = parts as [string, string, string];
  if (!TENANT_OR_CUSTOMER.test(tenantId) || !TENANT_OR_CUSTOMER.test(customerId) || !EVIDENCE_ID.test(evidenceId)) return undefined;
  return { tenantId, customerId, evidenceId };
}

/** Sort key of an EvidenceIndex row: `claimId#evidenceId`. Same format as seed/definitions/keys.ts. */
export const evidenceSk = (claimId: string, evidenceId: string): string => `${claimId}#${evidenceId}`;
