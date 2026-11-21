// Owner: A. Key helpers. The formats come from backend/processing/decision/keys.ts, so the seed cannot drift from the reader.
export {
  claimKey, policyPk, packPk, evidenceIndexPk, evidenceByIdPk, customerPk,
} from "../../backend/processing/decision/keys.js";

/** Sort key of a versioned item: `v#000001`. See contracts/data-model.md. */
export const versionSk = (version: number): string => `v#${String(version).padStart(6, "0")}`;
/** Sort key of an EvidenceIndex row: `claimId#evidenceId`. */
export const evidenceSk = (claimId: string, evidenceId: string): string => `${claimId}#${evidenceId}`;
