// Owner: A. `npx tsx scripts/cleanup-demo-data.ts --stage dev-a [--tenant t1]`
// Deletes claims filed through the API (claimId CLM-<16 hex>) and the evidence rows they created
// (uploaded evidence ids EVD-<uuid>), for one tenant. Seed data (CLM-1042, CLM-SCN-*, CLM-K*) is never touched.
// Leaves the stage clean for a demo: seed data only, nothing in PROCESSING. The audit log is append-only and is kept.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { realCfn, resolveFoundation } from "../seed/lib/stage-resources.js";

const REGION = "us-east-1";
const API_CLAIM = /^CLM-[0-9a-f]{16}$/;
const UPLOAD_EVIDENCE = /EVD-[0-9a-f]{8}-[0-9a-f]{4}-/;

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string): string => {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : dflt;
  if (!v) throw new Error(`Missing ${name}`);
  return v;
};
const stage = opt("--stage");
const tenant = opt("--tenant", "t1");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const f = await resolveFoundation(realCfn(REGION), stage);

async function scanKeys(table: string, keep: (pk: string, sk: string) => boolean): Promise<{ pk: string; sk: string }[]> {
  const out: { pk: string; sk: string }[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await doc.send(new ScanCommand({ TableName: table, ProjectionExpression: "pk, sk", ExclusiveStartKey: start }));
    for (const i of r.Items ?? []) if (keep(String(i.pk), String(i.sk))) out.push({ pk: String(i.pk), sk: String(i.sk) });
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}
async function del(table: string, keys: { pk: string; sk: string }[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 25) {
    await doc.send(new BatchWriteCommand({ RequestItems: { [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } }));
  }
}

const claims = await scanKeys(f.claims, (pk) => pk.startsWith(`${tenant}#`) && API_CLAIM.test(pk.slice(tenant.length + 1)));
const evidence = await scanKeys(
  f.evidenceIndex,
  (pk, sk) => pk.startsWith(`${tenant}#`) && (UPLOAD_EVIDENCE.test(sk) || API_CLAIM.test(sk.split("#")[0] ?? "")),
);
await del(f.claims, claims);
await del(f.evidenceIndex, evidence);
console.log(`deleted ${claims.length} claim item(s) and ${evidence.length} evidence row(s) for tenant ${tenant}`);
