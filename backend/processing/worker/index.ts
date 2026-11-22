// Lambda entry point for the Worker. Real AWS clients, Powertools and environment configuration.
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoStore } from "../decision/dynamo-store.js";
import { createLogSink } from "../decision/powertools.js";
import type { DecideEvent, DecideResult } from "../decision/types.js";
import { createWorker, type WorkerMetrics } from "./handler.js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
const num = (name: string) => {
  const n = Number(env(name));
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} is not a number`);
  return n;
};

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});
const lambda = new LambdaClient({});
const bedrock = new BedrockRuntimeClient({ requestHandler: { requestTimeout: 12_000, connectionTimeout: 3_000 } });
const decisionFunction = env("DECISION_FUNCTION_NAME");

const store = new DynamoStore(doc, {
  claims: env("CLAIMS_TABLE"),
  policies: env("POLICIES_TABLE"),
  packs: env("PACKS_TABLE"),
  evidenceIndex: env("EVIDENCE_INDEX_TABLE"),
  audit: process.env.AUDIT_TABLE ?? "", // the Worker never reads or writes the audit table
});

const logger = new Logger({ serviceName: "worker" });
const powertoolsMetrics = new Metrics({ namespace: "ClaimsAgent", serviceName: "worker" });

const metrics: WorkerMetrics = {
  stage(stage, ms) {
    powertoolsMetrics.addDimension("Stage", stage);
    powertoolsMetrics.addMetric("StageLatencyMs", MetricUnit.Milliseconds, ms);
    powertoolsMetrics.publishStoredMetrics(); // also clears the Stage dimension
  },
  total(ms) {
    powertoolsMetrics.addMetric("TotalMs", MetricUnit.Milliseconds, ms);
    powertoolsMetrics.publishStoredMetrics();
  },
  flush: () => powertoolsMetrics.publishStoredMetrics(),
};

async function invokeDecision(event: DecideEvent): Promise<DecideResult> {
  const res = await lambda.send(
    new InvokeCommand({ FunctionName: decisionFunction, InvocationType: "RequestResponse", Payload: Buffer.from(JSON.stringify(event)) }),
  );
  // Never include the payload in the error: it may carry claim data.
  if (res.FunctionError) throw new Error(`Decision Lambda failed: ${res.FunctionError}`);
  if (!res.Payload) throw new Error("Decision Lambda returned no payload");
  const out = JSON.parse(Buffer.from(res.Payload).toString("utf8")) as DecideResult;
  if (!out || typeof out.result !== "string") throw new Error("Decision Lambda returned an unexpected response");
  return out;
}

const worker = createWorker({
  store,
  getObject: async (bucket, key) => {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error("empty object");
    return { bytes: await res.Body.transformToByteArray(), contentLength: res.ContentLength };
  },
  converse: (req) => bedrock.send(new ConverseCommand(req)),
  invokeDecision,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
  now: () => new Date(),
  log: createLogSink(logger),
  metrics,
  config: {
    modelId: env("BEDROCK_MODEL_ID"),
    maxTokens: num("MAX_TOKENS"),
    maxEvidenceImageBytes: num("MAX_EVIDENCE_IMAGE_BYTES"),
    evidenceBucket: env("EVIDENCE_BUCKET"),
    frequencyWindowDays: num("FREQUENCY_WINDOW_DAYS"),
    injectFailure: process.env.INJECT_BEDROCK_FAILURE === "true",
  },
});

export const handler = worker.handler;
