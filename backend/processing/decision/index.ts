// Lambda entry point. Real AWS clients, Powertools, and environment configuration.
import { SSMClient } from "@aws-sdk/client-ssm";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoStore } from "./dynamo-store.js";
import { createHandlers } from "./handlers.js";
import { CachedKillSwitch, ssmParameterReader } from "./kill-switch.js";
import { createLogSink, createMetricsSink } from "./powertools.js";

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

const handlers = createHandlers({
  store: new DynamoStore(doc, {
    claims: env("CLAIMS_TABLE"),
    policies: env("POLICIES_TABLE"),
    packs: env("PACKS_TABLE"),
    evidenceIndex: env("EVIDENCE_INDEX_TABLE"),
    audit: env("AUDIT_TABLE"),
  }),
  killSwitch: new CachedKillSwitch(ssmParameterReader(new SSMClient({}), env("AUTO_APPROVE_PARAMETER"))),
  metrics: createMetricsSink(),
  log: createLogSink(),
  config: {
    earlyClaimDays: num("EARLY_CLAIM_DAYS"),
    outlierMultiplier: num("OUTLIER_MULTIPLE"),
    frequencyWindowDays: num("FREQUENCY_WINDOW_DAYS"),
    frequencyMaxClaims: num("FREQUENCY_MAX_CLAIMS"),
  },
  now: () => new Date(),
});

export const handler = handlers.handler;
