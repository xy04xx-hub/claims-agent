// Evidence loader for the Worker: reads evidence objects from S3 and turns them into Converse content blocks.
// Evidence bytes are never logged and never put in error messages.
import type { ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { EvidenceRecord } from "../decision/types.js";

export type NotShownReason = "too large" | "type not allowed" | "unreadable";

/** Text for the prompt, e.g. "not shown to the model: too large". */
export const notShownText = (reason: NotShownReason): string => `not shown to the model: ${reason}`;

export interface EvidenceLoaderDeps {
  getObject(bucket: string, key: string): Promise<{ bytes: Uint8Array; contentLength?: number }>;
  config: { evidenceBucket: string; maxEvidenceImageBytes: number };
}

/** Per evidence item: either the content block to place after its label, or the note saying why it is not shown. */
export type EvidenceBlockResult =
  | { evidenceId: string; block: ContentBlock.ImageMember | ContentBlock.DocumentMember; note?: undefined }
  | { evidenceId: string; block?: undefined; note: string };

export interface LoadedEvidence {
  /** In the order of the input evidence. */
  items: EvidenceBlockResult[];
  /** evidenceId -> block, for items that are shown. */
  blocks: Map<string, ContentBlock.ImageMember | ContentBlock.DocumentMember>;
  /** evidenceId -> "not shown to the model: <reason>", for items that are not shown. */
  notes: Map<string, string>;
}

/** Bedrock document names allow letters, digits, single spaces, hyphens, parentheses and square brackets. */
export const documentName = (evidenceId: string): string =>
  evidenceId.replace(/[^A-Za-z0-9 \-()[\]]/g, "-").replace(/\s{2,}/g, " ").slice(0, 200) || "evidence";

function reasonFor(contentType: string | undefined, sizeBytes: number | undefined, key: string | undefined, max: number): NotShownReason | undefined {
  const type = contentType?.toLowerCase();
  if (type !== "image/jpeg" && type !== "image/png" && type !== "application/pdf") return "type not allowed";
  if (!key) return "unreadable";
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes)) return "unreadable";
  if (sizeBytes > max) return "too large";
  return undefined;
}

export async function loadEvidenceBlocks(deps: EvidenceLoaderDeps, evidence: EvidenceRecord[]): Promise<LoadedEvidence> {
  const { evidenceBucket, maxEvidenceImageBytes: max } = deps.config;
  const items = await Promise.all(
    evidence.map(async (ev): Promise<EvidenceBlockResult> => {
      const id = ev.evidenceId;
      const skip = reasonFor(ev.contentType, ev.sizeBytes, ev.s3Key, max);
      if (skip) return { evidenceId: id, note: notShownText(skip) };
      try {
        const obj = await deps.getObject(evidenceBucket, ev.s3Key as string);
        const size = Math.max(obj.bytes.byteLength, obj.contentLength ?? 0);
        if (size > max) return { evidenceId: id, note: notShownText("too large") };
        const type = (ev.contentType as string).toLowerCase();
        if (type === "application/pdf") {
          return { evidenceId: id, block: { document: { format: "pdf", name: documentName(id), source: { bytes: obj.bytes } } } };
        }
        return { evidenceId: id, block: { image: { format: type === "image/png" ? "png" : "jpeg", source: { bytes: obj.bytes } } } };
      } catch {
        return { evidenceId: id, note: notShownText("unreadable") };
      }
    }),
  );
  const blocks: LoadedEvidence["blocks"] = new Map();
  const notes: LoadedEvidence["notes"] = new Map();
  for (const it of items) {
    if (it.block) blocks.set(it.evidenceId, it.block);
    else notes.set(it.evidenceId, it.note);
  }
  return { items, blocks, notes };
}
