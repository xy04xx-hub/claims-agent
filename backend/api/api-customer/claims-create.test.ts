// T-09 task 7.1 (requirements 13.1, 13.2): ownership checks and idempotency of POST /claims.
import { describe, expect, it, vi } from "vitest";
import type { Policy } from "@claims-agent/domain";
import { createClaimsCreateHandler, claimIdFor, type ClaimsCreateDeps } from "./claims-create.js";
import type { RouteContext } from "../middleware/types.js";

type Item = Record<string, unknown>;

const TENANT = "demo-tenant";
const ME = "cust-me";
const OTHER = "cust-other";

const policy = (customerId: string, policyId: string): Policy => ({
  policyId,
  version: 1,
  customerId,
  holderName: "Test Holder",
  startDate: "2025-01-01",
  effectiveFrom: "2025-01-01",
  deductible: 50,
  items: [{ itemId: "ITEM-1", category: "phone", label: "Phone", imei: "356938035643809" }],
  coverage: { phone: { causes: ["ACCIDENTAL_DAMAGE", "THEFT"], limit: 1000 } },
});

function makeRepo() {
  const policies = new Map<string, Policy[]>([
    ["POL-ME", [policy(ME, "POL-ME")]],
    ["POL-OTHER", [policy(OTHER, "POL-OTHER")]],
  ]);
  const uploads = new Map<string, Item>([
    ["EVD-ME", { customerId: ME }],
    ["EVD-OTHER", { customerId: OTHER }],
  ]);
  const claims = new Map<string, Item>();
  const putClaim = vi.fn(async (_t: string, claimId: string, item: Item) => {
    if (claims.has(claimId)) return "EXISTS" as const;
    claims.set(claimId, { ...item });
    return "CREATED" as const;
  });
  const markEnqueued = vi.fn(async (_t: string, claimId: string, at: string) => {
    const c = claims.get(claimId);
    if (!c || c["enqueuedAt"] !== undefined) return false;
    c["enqueuedAt"] = at;
    return true;
  });
  const repo: ClaimsCreateDeps["repo"] = {
    getPolicyVersions: async (_t, id) => policies.get(id) ?? [],
    getUpload: async (_t, id) => uploads.get(id),
    getClaimItem: async (_t, id) => claims.get(id),
    putClaim,
    markEnqueued,
  };
  return { repo, claims, putClaim, markEnqueued };
}

const body = (over: Record<string, unknown> = {}) => ({
  clientRequestId: "req-0001",
  policyId: "POL-ME",
  itemId: "ITEM-1",
  cause: "ACCIDENTAL_DAMAGE",
  description: "Cracked screen",
  amountClaimed: 200,
  lossDate: "2025-06-01",
  evidenceIds: ["EVD-ME"],
  ...over,
});

const ctx = (b: unknown): RouteContext => ({
  caller: { sub: ME, group: "Customer", tenantId: TENANT },
  requestId: "r-1",
  pathParameters: {},
  body: b,
});

function setup() {
  const fake = makeRepo();
  const sendJob = vi.fn(async () => undefined);
  const handler = createClaimsCreateHandler({ repo: fake.repo, sendJob, now: () => Date.parse("2025-06-02T00:00:00Z") });
  return { ...fake, sendJob, handler };
}

describe("POST /claims ownership", () => {
  it.each([
    ["another customer's policy", { policyId: "POL-OTHER" }],
    ["an item not on the policy", { itemId: "ITEM-X" }],
    ["another customer's evidence", { evidenceIds: ["EVD-ME", "EVD-OTHER"] }],
    ["unknown evidence", { evidenceIds: ["EVD-NONE"] }],
  ])("returns 403 and writes nothing for %s", async (_name, over) => {
    const t = setup();
    const res = await t.handler(ctx(body(over)));
    expect(res.statusCode).toBe(403);
    expect(t.putClaim).not.toHaveBeenCalled();
    expect(t.sendJob).not.toHaveBeenCalled();
    expect(t.claims.size).toBe(0);
  });
});

describe("POST /claims idempotency", () => {
  it("returns the same claim and sends one job message on a repeat", async () => {
    const t = setup();
    const first = await t.handler(ctx(body()));
    const second = await t.handler(ctx(body()));
    const expected = claimIdFor(TENANT, ME, "req-0001");
    expect(first).toEqual({ statusCode: 202, body: { claimId: expected, status: "PROCESSING" } });
    expect(second).toEqual(first);
    expect(t.sendJob).toHaveBeenCalledTimes(1);
    expect(t.sendJob).toHaveBeenCalledWith({ tenantId: TENANT, claimId: expected, attempt: 1, requestId: "r-1" });
    expect(t.claims.size).toBe(1);
  });

  it("sends the job again on a repeat after a failed send", async () => {
    const t = setup();
    t.sendJob.mockRejectedValueOnce(new Error("sqs down"));
    await expect(t.handler(ctx(body()))).rejects.toThrow("sqs down");
    expect(t.claims.size).toBe(1);
    expect(t.markEnqueued).not.toHaveBeenCalled();

    const retry = await t.handler(ctx(body()));
    expect(retry.statusCode).toBe(202);
    expect(t.sendJob).toHaveBeenCalledTimes(2);
    expect(t.markEnqueued).toHaveBeenCalledTimes(1);
    expect(t.claims.size).toBe(1);

    await t.handler(ctx(body()));
    expect(t.sendJob).toHaveBeenCalledTimes(2);
  });
});
