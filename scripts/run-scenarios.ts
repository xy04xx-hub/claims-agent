// Owner: A. `npx tsx scripts/run-scenarios.ts --stage <stage>` runs demo scenarios A to H (and variants) through the
// deployed Decision Lambda and prints PASS or FAIL per scenario. The seed script must have run first: it owns every
// EvidenceIndex row. This script writes only PROCESSING rows of CLM-SCN-* claims and never touches other tables.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { validateDecision, validateProposal } from "../backend/processing/decision/schemas.js";
import { claimKey } from "../backend/processing/decision/keys.js";
import {
  CLM_1042, SCENARIOS, SCENARIO_LOSS_DATE, TENANT_ID, buildProposal, buildScenarioClaimRow,
} from "../seed/definitions/index.js";
import { realCfn, resolveFoundation, resolveProcessing } from "../seed/lib/stage-resources.js";
import { parseStageArg } from "./lib/stage-arg.js";

export interface RunnerDeps {
  resolve(stage: string): Promise<{ claims: string; decisionFunction: string }>;
  getClaim(table: string, claimId: string): Promise<Record<string, unknown> | undefined>;
  putClaim(table: string, item: Record<string, unknown>): Promise<void>;
  invokeDecision(fn: string, event: Record<string, unknown>): Promise<{ functionError?: string; payload: unknown }>;
  now(): Date;
  log(message: string): void;
  error(message: string): void;
}

export async function runScenarios(argv: string[], deps: RunnerDeps): Promise<number> {
  const parsed = parseStageArg(argv);
  if (!parsed.ok) {
    deps.error(parsed.usage);
    return 1;
  }
  const stage = parsed.stage;
  let names: { claims: string; decisionFunction: string };
  try {
    names = await deps.resolve(stage);
  } catch (e) {
    deps.error((e as Error).message);
    return 1;
  }
  if (!(await deps.getClaim(names.claims, CLM_1042))) {
    deps.error(`Seed data not found. Run: npm run seed -- --stage ${stage}`);
    return 1;
  }
  if (deps.now().toISOString().slice(0, 10) < SCENARIO_LOSS_DATE) {
    deps.error(`The scenarios use loss date ${SCENARIO_LOSS_DATE}. Today is earlier, so the decision would see a timeline inconsistency.`);
    return 1;
  }

  let failures = 0;
  for (const scn of SCENARIOS) {
    const label = scn.id.padEnd(2);
    const fail = (why: string) => {
      failures++;
      deps.log(`FAIL  ${label}  ${why}`);
    };
    if (!scn.claimId.startsWith("CLM-SCN-")) {
      deps.error(`Refusing to write claim ${scn.claimId}`);
      return 1;
    }
    try {
      await deps.putClaim(names.claims, buildScenarioClaimRow(scn, deps.now()));
      const proposal = buildProposal(scn);
      const v = validateProposal(proposal);
      if (!v.ok) { fail(`bad proposal: ${v.error}`); continue; }
      const t0 = Date.now();
      const res = await deps.invokeDecision(names.decisionFunction, {
        tenantId: TENANT_ID, claimId: scn.claimId, proposal, jti: `seed-${scn.id}`,
      });
      const ms = Date.now() - t0;
      if (res.functionError) { fail(`Lambda error ${res.functionError}`); continue; }
      const p = res.payload as { result?: string; decision?: { outcome: string; payout: number; riskSignals?: unknown[]; checksFailed: { code: string }[]; reasons: { customer: string; adjuster: string[] } } };
      if (p?.result !== "DECIDED" || !p.decision) { fail(`unexpected result ${String(p?.result)}`); continue; }
      const dv = validateDecision(p.decision);
      if (!dv.ok) { fail(`decision failed schema: ${dv.error}`); continue; }
      const d = p.decision;
      const text = d.reasons.adjuster.join(" ");
      const missing = scn.expected.adjusterIncludes.filter((s) => !text.includes(s));
      const ok = d.outcome === scn.expected.outcome && d.payout === scn.expected.payout && missing.length === 0;
      const reason = d.outcome === "AUTO_APPROVED" ? d.reasons.customer : d.reasons.adjuster[0] ?? "";
      deps.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${d.outcome}  payout ${d.payout}  ${ms} ms  ${reason}`);
      if (!ok) {
        failures++;
        if (missing.length > 0) deps.log(`        missing in adjuster reasons: ${missing.join(" | ")}`);
        if (d.checksFailed.some((c) => c.code === "AUTO_APPROVE_ENABLED")) {
          deps.log("        Kill switch autoApproveEnabled is false on this stage");
        }
      }
    } catch (e) {
      fail(`error: ${(e as Error).message}`);
    }
  }
  deps.log(`${SCENARIOS.length - failures} of ${SCENARIOS.length} scenarios passed`);
  return failures === 0 ? 0 : 1;
}

function realDeps(): RunnerDeps {
  const region = "us-east-1";
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region, maxAttempts: 5 }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const lambda = new LambdaClient({ region, maxAttempts: 3 });
  const cfn = realCfn(region);
  return {
    resolve: async (stage) => ({
      claims: (await resolveFoundation(cfn, stage)).claims,
      decisionFunction: (await resolveProcessing(cfn, stage)).decisionFunction,
    }),
    getClaim: async (TableName, claimId) =>
      (await doc.send(new GetCommand({ TableName, Key: claimKey(TENANT_ID, claimId) }))).Item,
    putClaim: async (TableName, Item) => {
      await doc.send(new PutCommand({ TableName, Item }));
    },
    invokeDecision: async (FunctionName, event) => {
      const r = await lambda.send(new InvokeCommand({
        FunctionName, InvocationType: "RequestResponse", Payload: Buffer.from(JSON.stringify(event)),
      }));
      return { functionError: r.FunctionError, payload: r.Payload ? JSON.parse(Buffer.from(r.Payload).toString("utf8")) : undefined };
    },
    now: () => new Date(),
    log: (m) => console.log(m),
    error: (m) => console.error(m),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runScenarios(process.argv.slice(2), realDeps()).then((code) => process.exit(code), (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
