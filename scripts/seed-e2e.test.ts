// Owner: A. Runs the REAL Decision Lambda handler and DynamoStore read path over an in-memory DynamoDB that holds the
// seeded items and the scenario claim rows, so a drift between the seed and the reader fails a test.
import { describe, expect, it } from "vitest";
import { createHandlers } from "../backend/processing/decision/handlers.js";
import { DynamoStore } from "../backend/processing/decision/dynamo-store.js";
import { validateDecision, validateProposal } from "../backend/processing/decision/schemas.js";
import {
  SCENARIOS, TENANT_ID, buildProposal, buildScenarioClaimRow, buildSeedItems, type Scenario,
} from "../seed/definitions/index.js";
import { normalizeIdentifier } from "../seed/lib/hashing.js";
import { FakeDynamo, TABLES, normId, realPhoto } from "./seed-e2e.helpers.js";

const NOW = new Date("2026-11-21T10:00:00.000Z");

function setup() {
  const db = new FakeDynamo();
  const items = buildSeedItems(realPhoto());
  db.load(TABLES.policies, items.policies);
  db.load(TABLES.packs, items.packs);
  db.load(TABLES.evidenceIndex, items.evidenceIndex);
  db.load(TABLES.claims, items.claims);
  const store = new DynamoStore(db, TABLES);
  let tick = NOW.getTime();
  const handlers = createHandlers({
    store,
    killSwitch: { isEnabled: async () => true },
    metrics: { count: () => undefined, latency: () => undefined, flush: () => undefined },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    config: { earlyClaimDays: 14, outlierMultiplier: 2, frequencyWindowDays: 30, frequencyMaxClaims: 3 },
    now: () => new Date((tick += 5)),
  });
  const run = async (scn: Scenario) => {
    db.load(TABLES.claims, [buildScenarioClaimRow(scn, NOW)]); // what the runner does: reset to PROCESSING
    const proposal = buildProposal(scn);
    expect(validateProposal(proposal)).toEqual({ ok: true });
    const r = await handlers.decide({ tenantId: TENANT_ID, claimId: scn.claimId, proposal }, { awsRequestId: "req" });
    if (r.result !== "DECIDED") throw new Error(`${scn.id}: ${r.result}`);
    expect(validateDecision(r.decision)).toEqual({ ok: true });
    return r.decision;
  };
  return { db, run };
}

describe("Property 6: scenario outcomes come from the real decision path", () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))("scenario %s", async (_id, scn) => {
    const { run } = setup();
    const d = await run(scn);
    expect(d.outcome).toBe(scn.expected.outcome);
    expect(d.payout).toBe(scn.expected.payout);
    for (const text of scn.expected.adjusterIncludes) expect(d.reasons.adjuster.join(" ")).toContain(text);
    if (scn.expected.outcome === "AUTO_APPROVED") expect(d.riskSignals).toEqual([]);
    // the customer text never names another claim
    expect(d.reasons.customer).not.toContain("CLM-1042");
  });

  it("Property 7: order and repeats do not change any result", async () => {
    const { run } = setup();
    const first = new Map<string, string>();
    for (const scn of [...SCENARIOS, ...[...SCENARIOS].reverse()]) {
      const d = await run(scn);
      const key = `${d.outcome}|${d.payout}|${d.reasons.adjuster.join("|")}`;
      if (first.has(scn.id)) expect(key).toBe(first.get(scn.id));
      else first.set(scn.id, key);
    }
  });

  it("scenario H trips identifier reuse on CLM-1042 and D trips a duplicate photo on CLM-1042", async () => {
    const { run } = setup();
    const h = await run(SCENARIOS.find((s) => s.id === "H") as Scenario);
    expect(h.riskSignals.map((s) => s.code)).toContain("IDENTIFIER_REUSE");
    const d = await run(SCENARIOS.find((s) => s.id === "D") as Scenario);
    expect(d.riskSignals.map((s) => s.code)).toContain("DUPLICATE_PHOTO");
  });

  it("Property 8: spacing, hyphens and case of the IMEI still trip identifier reuse", async () => {
    const { run } = setup();
    const h = SCENARIOS.find((s) => s.id === "H") as Scenario;
    const odd = { ...h, identifiers: { imei: "86-7530 9000 00017".toLowerCase() } };
    expect((await run(odd)).riskSignals.map((s) => s.code)).toContain("IDENTIFIER_REUSE");
  });

  it("the seed's identifier format equals the Decision Lambda's", () => {
    for (const v of ["35 69-38", "abc-def", " x y "]) expect(normalizeIdentifier(v)).toBe(normId(v));
  });
});
