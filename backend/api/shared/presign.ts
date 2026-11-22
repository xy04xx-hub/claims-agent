// Presigned POST wrapper (T-09). The only file under backend/api that imports the S3 presign package.
// The S3Client is created in the entry point and passed in; handlers receive a PresignPost function.
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { S3Client } from "@aws-sdk/client-s3";

export interface PresignInput {
  bucket: string;
  key: string;
  fields: Record<string, string>;
  /** Raw S3 POST policy conditions. */
  conditions: unknown[];
  expiresSeconds: number;
}
export interface PresignedPost { url: string; fields: Record<string, string> }
export type PresignPost = (input: PresignInput) => Promise<PresignedPost>;

export function createPresigner(s3: S3Client): PresignPost {
  return async (input) =>
    createPresignedPost(s3, {
      Bucket: input.bucket,
      Key: input.key,
      Fields: input.fields,
      Conditions: input.conditions as never,
      Expires: input.expiresSeconds,
    });
}
