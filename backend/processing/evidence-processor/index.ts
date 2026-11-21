// Owner: A. Lambda entry point of the Evidence Processor. Real AWS clients and environment configuration only.
// All logic is in process.ts.
import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createLogSink } from "../decision/powertools.js";
import { processObject, type ProcessDeps, type S3ObjectCreatedEvent } from "./process.js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const table = env("EVIDENCE_INDEX_TABLE");
const cfg = { bucket: env("EVIDENCE_BUCKET"), maxObjectBytes: Number(env("MAX_OBJECT_BYTES")) };
if (!Number.isFinite(cfg.maxObjectBytes)) throw new Error("Environment variable MAX_OBJECT_BYTES is not a number");

const s3 = new S3Client({});
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const log = createLogSink(new Logger({ serviceName: "evidence-processor" }));

const deps: ProcessDeps = {
  getObject: async (Bucket, Key) => {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
    if (!r.Body) throw new Error("S3 object has no body");
    return { bytes: await r.Body.transformToByteArray(), contentType: r.ContentType, metadata: r.Metadata ?? {} };
  },
  putRows: async (rows) => {
    await Promise.all(rows.map((Item) => doc.send(new PutCommand({ TableName: table, Item }))));
  },
  log,
  now: () => new Date(),
};

export const handler = async (event: S3ObjectCreatedEvent, ctx: { awsRequestId: string }): Promise<void> => {
  await processObject(event, deps, cfg, ctx.awsRequestId);
};
