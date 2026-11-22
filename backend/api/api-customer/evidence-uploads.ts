// POST /evidence/uploads (T-09). Returns one presigned POST per file. The browser uploads straight to S3.
// Identity comes only from ctx.caller. The UPLOAD row records who owns each evidence ID.
import { randomUUID } from "node:crypto";
import { fail } from "../middleware/errors.js";
import type { RouteHandler } from "../middleware/types.js";
import type { PresignPost } from "../shared/presign.js";
import type { ApiRepo } from "../shared/repo.js";

export const PRESIGN_EXPIRY_SECONDS = 300;
export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;

export interface EvidenceUploadsDeps {
  repo: Pick<ApiRepo, "putUpload">;
  presign: PresignPost;
  bucket: string;
  maxUploadBytes: number;
  now: () => number;
  newId?: () => string;
}

interface UploadFile { name: string; contentType: string; sizeBytes: number; kind: string }

export function createEvidenceUploadsHandler(deps: EvidenceUploadsDeps): RouteHandler {
  const newId = deps.newId ?? randomUUID;
  return async (ctx) => {
    const { tenantId, sub: customerId } = ctx.caller;
    const files = (ctx.body as { files?: UploadFile[] } | undefined)?.files ?? [];
    const uploads = [];
    for (const file of files) {
      // Defence in depth: the route schema already enforces these.
      if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.contentType) || file.sizeBytes > deps.maxUploadBytes) {
        return fail(400, "BAD_REQUEST", "File type or size not allowed.");
      }
      const evidenceId = `EVD-${newId()}`;
      const key = `${tenantId}/${customerId}/${evidenceId}`;
      const createdAt = new Date(deps.now()).toISOString();
      const expiresAt = new Date(deps.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString();

      const created = await deps.repo.putUpload(tenantId, evidenceId, {
        kind: file.kind,
        customerId,
        processingStatus: "PENDING",
        uploadStatus: "UPLOADING",
        s3Key: key,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        createdAt,
      });
      if (created === "EXISTS") throw new Error("evidence id collision");

      const post = await deps.presign({
        bucket: deps.bucket,
        key,
        // The evidence processor reads the kind from the object metadata "kind" (x-amz-meta-kind).
        fields: { "Content-Type": file.contentType, "x-amz-meta-kind": file.kind },
        conditions: [
          ["eq", "$Content-Type", file.contentType],
          ["eq", "$x-amz-meta-kind", file.kind],
          ["content-length-range", 1, deps.maxUploadBytes],
          ["eq", "$key", key],
        ],
        expiresSeconds: PRESIGN_EXPIRY_SECONDS,
      });
      uploads.push({ evidenceId, url: post.url, fields: post.fields, expiresAt });
    }
    return { statusCode: 200, body: { uploads } };
  };
}
