// Owner: A. `npx tsx scripts/e2e-claim-flow.ts --stage dev-a [--scenario A|H] [--identifier-fallback] [--cleanup]`
// Runs demo scenarios A and H through the deployed API as the seeded customer: sign in, GET /me/policies,
// evidence upload, POST /claims (twice, same clientRequestId), poll, verdict. Needs AWS credentials (stack outputs,
// the Claims table read, and with --identifier-fallback or --cleanup the EvidenceIndex and Claims writes).
// Environment: E2E_CUSTOMER_PASSWORD (required), E2E_CUSTOMER_EMAIL (default customer1@example.com).
// Run with the same SEED_TENANT_ID and SEED_CUSTOMER_ID as the seed (for dev-a: SEED_TENANT_ID=t1).
// The access token stays in memory and is never printed. Each run files two claims; --cleanup deletes them.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import {
  UNASSIGNED_CLAIM_ID as UNASSIGNED_CLAIM_ID_FOR_E2E, claimKey, evidenceByIdPk, evidenceIndexPk,
} from "../backend/processing/decision/keys.js";
import {
  CLM_1042, EVIDENCE_FILES, SCENARIOS, SCENARIO_LOSS_DATE, TENANT_ID, type Scenario,
} from "../seed/definitions/index.js";
import { MissingResourceError, realCfn, resolveFoundation } from "../seed/lib/stage-resources.js";

const REGION = "us-east-1";
const SCENARIO_IDS = ["A", "H"] as const;
const POLL_FAST_MS = 500;
const POLL_FAST_UNTIL_MS = 10_000;
const POLL_SLOW_MS = 2_000;
const POLL_UNTIL_MS = 20_000;
const FAST_LIMIT_MS = 10_000;
const EVIDENCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "seed", "evidence");

class Fatal extends Error {}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Args { stage: string; identifierFallback: boolean; cleanup: boolean; scenario?: (typeof SCENARIO_IDS)[number] }
const USAGE = "Usage: --stage dev-a [--scenario A|H] [--identifier-fallback] [--cleanup]";

export function parseArgs(argv: string[]): Args {
  let stage: string | undefined;
  let identifierFallback = false;
  let cleanup = false;
  let scenario: Args["scenario"];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stage") stage = argv[++i];
    else if (a === "--identifier-fallback") identifierFallback = true;
    else if (a === "--cleanup") cleanup = true;
    else if (a === "--scenario") {
      const v = argv[++i];
      if (v !== "A" && v !== "H") throw new Fatal(`Invalid --scenario ${String(v)}. ${USAGE}`);
      scenario = v;
    } else throw new Fatal(`Unknown argument ${a}. ${USAGE}`);
  }
  if (!stage) throw new Fatal(`Missing --stage. ${USAGE}`);
  return { stage, identifierFallback, cleanup, ...(scenario ? { scenario } : {}) };
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const v = env[name];
  if (!v) throw new Fatal(`Missing environment variable ${name}`);
  return v;
};

interface Config {
  apiUrl: string;
  clientId: string;
  email: string;
  password: string;
  claimsTable: string;
  evidenceIndexTable: string;
}

async function loadConfig(stage: string, env: NodeJS.ProcessEnv): Promise<Config> {
  const password = required(env, "E2E_CUSTOMER_PASSWORD");
  const email = env.E2E_CUSTOMER_EMAIL || "customer1@example.com";
  const cfn = realCfn(REGION);
  const out = async (short: string, key: string): Promise<string> => {
    let outputs: Record<string, string>;
    try {
      outputs = await cfn.describeOutputs(`ClaimsAgent-${stage}-${short}`);
    } catch (e) {
      throw new Fatal(`Missing stack ClaimsAgent-${stage}-${short}: ${(e as Error).message}`);
    }
    const v = outputs[key];
    if (!v) {
      const hint = key === "VerificationClientId" ? " (the stage needs enableVerificationClient: true)" : "";
      throw new Fatal(`Missing output ${key} of stack ClaimsAgent-${stage}-${short}${hint}`);
    }
    return v;
  };
  const apiUrl = (await out("Api", "ApiUrl")).replace(/\/+$/, "");
  const clientId = await out("Auth", "VerificationClientId");
  let foundation;
  try {
    foundation = await resolveFoundation(cfn, stage);
  } catch (e) {
    if (e instanceof MissingResourceError) throw new Fatal(`Missing ${e.what} in stack ClaimsAgent-${stage}-Foundation`);
    throw e;
  }
  return { apiUrl, clientId, email, password, claimsTable: foundation.claims, evidenceIndexTable: foundation.evidenceIndex };
}

async function signIn(cfg: Config): Promise<string> {
  const idp = new CognitoIdentityProviderClient({ region: REGION });
  try {
    const res = await idp.send(new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cfg.clientId,
      AuthParameters: { USERNAME: cfg.email, PASSWORD: cfg.password },
    }));
    const token = res.AuthenticationResult?.AccessToken;
    if (!token) throw new Fatal(`Sign-in for ${cfg.email} returned no access token (challenge: ${res.ChallengeName ?? "none"})`);
    return token;
  } catch (e) {
    if (e instanceof Fatal) throw e;
    throw new Fatal(`Sign-in for ${cfg.email} failed: ${(e as Error).name}`);
  }
}

/** The `sub` claim of the access token, used only to build the evidence key. Never printed. */
function subOf(token: string): string {
  const payload = token.split(".")[1] ?? "";
  const sub = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string }).sub;
  if (!sub) throw new Fatal("Access token has no sub claim");
  return sub;
}

async function api<T>(cfg: Config, token: string, method: "GET" | "POST", route: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${cfg.apiUrl}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: unknown = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json: json as T };
}

interface Upload { evidenceId: string; url: string; fields: Record<string, string> }
interface ClaimView {
  status?: string; payout?: number; customerMessage?: string; decidedAt?: string;
}

export interface Verdict { pass: boolean; problems: string[] }

/** Pure verdict rules (Requirements 12.5, 12.6). `adjusterReasons` is only needed for scenario H. */
export function judge(scn: Scenario, view: ClaimView, elapsedMs: number, adjusterReasons: unknown): Verdict {
  const problems: string[] = [];
  if (view.status !== scn.expected.outcome) problems.push(`status ${view.status ?? "unknown"}, expected ${scn.expected.outcome}`);
  if (scn.id === "A") {
    if (view.payout !== scn.expected.payout) problems.push(`payout ${String(view.payout)}, expected ${scn.expected.payout}`);
    if (elapsedMs > FAST_LIMIT_MS) problems.push(`took ${elapsedMs} ms, limit ${FAST_LIMIT_MS} ms`);
  } else if (!JSON.stringify(adjusterReasons ?? "").includes(CLM_1042)) {
    problems.push(`decision.reasons.adjuster does not mention ${CLM_1042}`);
  }
  return { pass: problems.length === 0, problems };
}

async function runScenario(
  id: (typeof SCENARIO_IDS)[number], cfg: Config, token: string, args: Args,
  doc: DynamoDBDocumentClient, created: { claims: string[]; identifierRows: { pk: string; sk: string }[] },
): Promise<boolean> {
  const scn = SCENARIOS.find((s) => s.id === id);
  if (!scn) throw new Fatal(`Scenario ${id} is not defined in seed/definitions`);
  const file = EVIDENCE_FILES.find((f) => f.name === (id === "A" ? "phone-damaged-imei1.png" : "police-report-phone2.png"));
  if (!file) throw new Fatal(`Evidence file for scenario ${id} is not in the seed manifest`);
  const bytes = readFileSync(path.join(EVIDENCE_DIR, file.name));
  console.log(`\n== Scenario ${id}: ${scn.cause} ${scn.itemId}, amount ${scn.amount}, file ${file.name}`);

  const policies = await api<{ policies?: { items?: { itemId: string }[] }[] }>(cfg, token, "GET", "/me/policies");
  if (policies.status !== 200) throw new Fatal(`GET /me/policies returned ${policies.status}`);
  const hasItem = (policies.json.policies ?? []).some((p) => (p.items ?? []).some((i) => i.itemId === scn.itemId));
  if (!hasItem) {
    throw new Fatal(
      `GET /me/policies has no policy with ${scn.itemId} for this user. Run the seed with SEED_CUSTOMER_ID=<sub of ${cfg.email}> (variable SEED_CUSTOMER_ID).`,
    );
  }

  const up = await api<{ uploads?: Upload[] }>(cfg, token, "POST", "/evidence/uploads", {
    files: [{ name: file.name, contentType: file.contentType, sizeBytes: bytes.length, kind: file.kind }],
  });
  const upload = up.json.uploads?.[0];
  if (up.status !== 200 || !upload) throw new Fatal(`POST /evidence/uploads returned ${up.status}`);
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v); // fields first
  form.append("file", new Blob([bytes], { type: file.contentType }), file.name); // file last
  const put = await fetch(upload.url, { method: "POST", body: form });
  if (!put.ok) throw new Fatal(`Evidence upload to S3 returned ${put.status}`);
  console.log(`uploaded evidence ${upload.evidenceId} (${bytes.length} bytes)`);

  if (args.identifierFallback) {
    const imei = scn.identifiers?.imei;
    if (!imei) throw new Fatal(`Scenario ${id} has no identifier for --identifier-fallback`);
    const now = new Date().toISOString();
    const row = {
      pk: evidenceIndexPk(TENANT_ID, "IDENTIFIER", imei),
      sk: `${UNASSIGNED_CLAIM_ID_FOR_E2E}#${upload.evidenceId}`,
      gsi1pk: evidenceByIdPk(TENANT_ID, upload.evidenceId),
      gsi1sk: "IDENTIFIER",
      type: "IDENTIFIER", value: imei, kind: file.kind, claimId: UNASSIGNED_CLAIM_ID_FOR_E2E,
      evidenceId: upload.evidenceId, customerId: subOf(token), processingStatus: "READY",
      contentType: file.contentType, createdAt: now,
      s3Key: `${TENANT_ID}/${subOf(token)}/${upload.evidenceId}`, sizeBytes: bytes.length,
    };
    await doc.send(new PutCommand({ TableName: cfg.evidenceIndexTable, Item: row }));
    created.identifierRows.push({ pk: row.pk, sk: row.sk });
    console.log("identifier-fallback: wrote an IDENTIFIER row for this evidence. It is a stand-in for image reading, not a model result.");
  }

  const body = {
    clientRequestId: randomUUID(), policyId: "POL-001", itemId: scn.itemId, cause: scn.cause,
    description: `Synthetic e2e scenario ${id}.`, amountClaimed: scn.amount, lossDate: SCENARIO_LOSS_DATE,
    evidenceIds: [upload.evidenceId],
  };
  const t0 = Date.now();
  const first = await api<{ claimId?: string }>(cfg, token, "POST", "/claims", body);
  if (first.status !== 202 || !first.json.claimId) throw new Fatal(`POST /claims returned ${first.status}`);
  const claimId = first.json.claimId;
  created.claims.push(claimId);
  const second = await api<{ claimId?: string }>(cfg, token, "POST", "/claims", body);
  const same = second.status === 202 && second.json.claimId === claimId;
  console.log(`claim ${claimId}; duplicate submit ${same ? "returned the same claimId" : `DIFFERED (status ${second.status}, claimId ${String(second.json.claimId)})`}`);

  let view: ClaimView = {};
  for (;;) {
    const elapsed = Date.now() - t0;
    const r = await api<ClaimView>(cfg, token, "GET", `/claims/${claimId}`);
    if (r.status !== 200) throw new Fatal(`GET /claims/${claimId} returned ${r.status}`);
    view = r.json;
    if (view.status !== "PROCESSING" || elapsed >= POLL_UNTIL_MS) break;
    await sleep(elapsed < POLL_FAST_UNTIL_MS ? POLL_FAST_MS : POLL_SLOW_MS);
  }
  const elapsedMs = Date.now() - t0;

  let adjusterReasons: unknown;
  if (id === "H" || view.status === "ROUTED_TO_ADJUSTER") {
    const got = await doc.send(new GetCommand({ TableName: cfg.claimsTable, Key: claimKey(TENANT_ID, claimId) }));
    adjusterReasons = (got.Item?.decision as { reasons?: { adjuster?: unknown } } | undefined)?.reasons?.adjuster;
  }
  const verdict = judge(scn, view, elapsedMs, adjusterReasons);
  const ok = verdict.pass && same;
  console.log(`${ok ? "PASS" : "FAIL"} scenario ${id}: status ${view.status ?? "unknown"} in ${elapsedMs} ms` +
    (view.payout !== undefined ? `, payout ${view.payout}` : ""));
  if (!ok) {
    for (const p of verdict.problems) console.log(`  - ${p}`);
    if (!same) console.log("  - duplicate submit did not return the same claimId");
    console.log(`  customer message: ${view.customerMessage ?? "(none)"}`);
    console.log(`  adjuster reasons: ${adjusterReasons === undefined ? "(none)" : JSON.stringify(adjusterReasons)}`);
  } else if (id === "H") {
    console.log(`  adjuster reasons: ${JSON.stringify(adjusterReasons)}`);
  }
  return ok;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig(args.stage, process.env);
  const token = await signIn(cfg);
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), { marshallOptions: { removeUndefinedValues: true } });
  const created = { claims: [] as string[], identifierRows: [] as { pk: string; sk: string }[] };
  let failed = false;
  try {
    for (const id of args.scenario ? [args.scenario] : SCENARIO_IDS) {
      if (!(await runScenario(id, cfg, token, args, doc, created))) failed = true;
    }
  } finally {
    if (args.cleanup) {
      for (const claimId of created.claims) {
        await doc.send(new DeleteCommand({ TableName: cfg.claimsTable, Key: claimKey(TENANT_ID, claimId) }));
      }
      for (const key of created.identifierRows) {
        await doc.send(new DeleteCommand({ TableName: cfg.evidenceIndexTable, Key: key }));
      }
      console.log(`\ncleanup: deleted ${created.claims.length} claim item(s) and ${created.identifierRows.length} identifier row(s)`);
    }
  }
  console.log(failed ? "\nE2E FAILED" : "\nE2E PASSED");
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Fatal ? e.message : `Unexpected error: ${(e as Error).name}: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
