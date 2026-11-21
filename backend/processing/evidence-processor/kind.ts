// Owner: A. Picks the evidence kind of an upload. The customer sets the metadata, so it only says which requirement
// the file claims to satisfy. The Decision Lambda still checks the content against the policy.
export const EVIDENCE_KINDS = ["DEVICE_PHOTO", "POLICE_REPORT", "PLATE_PHOTO", "STATEMENT"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

type Warn = (message: string, fields?: Record<string, unknown>) => void;

const BY_CONTENT_TYPE: Record<string, EvidenceKind> = {
  "image/png": "DEVICE_PHOTO",
  "image/jpeg": "DEVICE_PHOTO",
  "application/pdf": "POLICE_REPORT",
};

/** A wrong guess fails the "required evidence present" check and routes to an adjuster, so it is safe. */
export function resolveKind(metadataKind: string | undefined, contentType: string | undefined, warn: Warn): EvidenceKind {
  if (metadataKind !== undefined && (EVIDENCE_KINDS as readonly string[]).includes(metadataKind)) {
    return metadataKind as EvidenceKind;
  }
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  warn("kind metadata missing or invalid", { contentType: type || "none", hadMetadata: metadataKind !== undefined });
  return BY_CONTENT_TYPE[type] ?? "STATEMENT";
}
