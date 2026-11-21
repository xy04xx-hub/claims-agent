import { describe, expect, it } from "vitest";
import { DynamoStore } from "./dynamo-store.js";
import { queueShard } from "./keys.js";
import { buildAudit } from "./audit.js";
import { failSafeDecision } from "./evaluate.js";
import { claim } from "./test/fixtures.js";

const tables = { claims: "claims", policies: "policies", packs: "packs", evidenceIndex: "evidence", audit: "audit" };

interface Sent { input: { TransactItems: { Update?: Record<string, unknown>; Put?: Record<string, unknown> }[] } }

function commitInput(over: { routed: boolean }) {
  const c = claim();
  const decision = over.routed
    ? failSafeDecision(c.claimId)
    : { ...failSafeDecision(c.claimId), outcome: "AUTO_APPROVED" as const, checksFailed: [], failSafe: undefined, payout: 130 };
  const evaluation = { decision, policyId: "POL-001", policyVersion: 1, packVersion: 1, thresholds: {} };
  const decidedAt = "2026-11-21T10:00:04.000Z";
  return { claim: c, decision, audit: buildAudit({ claim: c, evaluation, timestamp: decidedAt, actorId: "x" }), decidedAt };
}

describe("DynamoStore.commitDecision", () => {
  it("updates the claim only from PROCESSING and puts the audit item in one transaction", async () => {
    const sent: Sent[] = [];
    const store = new DynamoStore({ send: async (c: unknown) => { sent.push(c as Sent); return {}; } } as never, tables);
    expect(await store.commitDecision(commitInput({ routed: true }))).toBe("COMMITTED");
    const [update, put] = sent[0].input.TransactItems;
    expect(update.Update).toMatchObject({ TableName: "claims", ConditionExpression: expect.stringContaining("#status = :processing") });
    expect((update.Update as { ExpressionAttributeValues: Record<string, unknown> }).ExpressionAttributeValues[":processing"]).toBe("PROCESSING");
    expect(put.Put).toMatchObject({ TableName: "audit" });
    expect((put.Put as { ConditionExpression: string }).ConditionExpression).toContain("attribute_not_exists");
  });

  it("sets the sparse queue index keys only for routed claims", async () => {
    const run = async (routed: boolean) => {
      const sent: Sent[] = [];
      const store = new DynamoStore({ send: async (c: unknown) => { sent.push(c as Sent); return {}; } } as never, tables);
      await store.commitDecision(commitInput({ routed }));
      return sent[0].input.TransactItems[0].Update as { UpdateExpression: string; ExpressionAttributeValues: Record<string, string> };
    };
    const routed = await run(true);
    expect(routed.UpdateExpression).toContain("gsi2pk");
    expect(routed.ExpressionAttributeValues[":q"]).toBe(`t1#ROUTED_TO_ADJUSTER#${queueShard("CLM-2001")}`);
    expect((await run(false)).UpdateExpression).not.toContain("gsi2pk");
  });

  it("returns ALREADY_DECIDED when the claim condition fails", async () => {
    const err = Object.assign(new Error("cancelled"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
    });
    const store = new DynamoStore({ send: async () => { throw err; } } as never, tables);
    expect(await store.commitDecision(commitInput({ routed: true }))).toBe("ALREADY_DECIDED");
  });

  it("rethrows other errors", async () => {
    const store = new DynamoStore({ send: async () => { throw new Error("throttled"); } } as never, tables);
    await expect(store.commitDecision(commitInput({ routed: true }))).rejects.toThrow("throttled");
  });
});

describe("DynamoStore.findOtherClaims", () => {
  const storeWith = (items: Record<string, unknown>[]) =>
    new DynamoStore({ send: async () => ({ Items: items }) } as never, tables);

  it("returns real claim IDs and never UNASSIGNED, whether claimId or the sk prefix carries it", async () => {
    const withAttr = storeWith([
      { claimId: "CLM-1042", sk: "CLM-1042#EVD-1042-1" },
      { claimId: "UNASSIGNED", sk: "UNASSIGNED#EVD-T13-1" },
      { claimId: "CLM-2001", sk: "CLM-2001#EVD-1" },
    ]);
    expect(await withAttr.findOtherClaims("t1", "SHA256", "abc", "CLM-2001")).toEqual(["CLM-1042"]);
    const bySk = storeWith([{ sk: "CLM-1042#EVD-1042-1" }, { sk: "UNASSIGNED#EVD-T13-1" }]);
    expect(await bySk.findOtherClaims("t1", "SHA256", "abc", "CLM-2001")).toEqual(["CLM-1042"]);
  });
  it("returns nothing when only unassigned rows exist", async () => {
    expect(await storeWith([{ claimId: "UNASSIGNED", sk: "UNASSIGNED#EVD-1" }]).findOtherClaims("t1", "PHASH", "h", "CLM-2001")).toEqual([]);
  });
});

describe("queueShard", () => {
  it("is stable and within 0 to 7", () => {
    for (const id of ["CLM-1", "CLM-1042", "CLM-2001", "CLM-zzz"]) {
      const s = queueShard(id);
      expect(s).toBe(queueShard(id));
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(8);
    }
  });
});
