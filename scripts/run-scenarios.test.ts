// Owner: A. Tests of runScenarios with fake dependencies.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SCENARIOS, buildScenarioClaimRow } from "../seed/definitions/index.js";
import { runScenarios, type RunnerDeps } from "./run-scenarios.js";

const decision = (s: (typeof SCENARIOS)[number], over: Record<string, unknown> = {}) => ({
  claimId: s.claimId, outcome: s.expected.outcome, payout: s.expected.payout, checksPassed: [], checksFailed: [], riskSignals: [],
  informationalFlags: [],
  reasons: { customer: s.expected.outcome === "AUTO_APPROVED" ? "Approved." : "Needs review.", adjuster: [...s.expected.adjusterIncludes] },
  ...over,
});

function fake(over: Partial<RunnerDeps> = {}) {
  const claims = new Map<string, Record<string, unknown>>([["CLM-1042", { claimId: "CLM-1042" }]]);
  const logs: string[] = [];
  const errors: string[] = [];
  const events: Record<string, unknown>[] = [];
  const deps: RunnerDeps = {
    resolve: async () => ({ claims: "claims", decisionFunction: "fn" }),
    getClaim: async (_t, id) => claims.get(id),
    putClaim: async (_t, item) => { claims.set(String(item.claimId), item); },
    invokeDecision: async (_f, event) => {
      events.push(event);
      const s = SCENARIOS.find((x) => x.claimId === event.claimId)!;
      return { payload: { result: "DECIDED", decision: decision(s) } };
    },
    now: () => new Date("2026-11-21T10:00:00Z"),
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    ...over,
  };
  return { deps, claims, logs, errors, events };
}

describe("runScenarios", () => {
  it("prints PASS for every scenario and exits 0", async () => {
    const f = fake();
    expect(await runScenarios(["--stage", "dev-a"], f.deps)).toBe(0);
    expect(f.logs.filter((l) => l.startsWith("PASS"))).toHaveLength(SCENARIOS.length);
    expect(f.logs.at(-1)).toBe(`${SCENARIOS.length} of ${SCENARIOS.length} scenarios passed`);
    expect(f.events[0]).toMatchObject({ tenantId: "demo-insurer", claimId: "CLM-SCN-A", jti: "seed-A" });
  });
  it("runs every scenario after a failure and exits 1", async () => {
    const f = fake({
      invokeDecision: async (_f, e) => {
        const s = SCENARIOS.find((x) => x.claimId === e.claimId)!;
        return { payload: { result: "DECIDED", decision: decision(s, s.id === "A" ? { outcome: "ROUTED_TO_ADJUSTER", payout: 0, reasons: { customer: "x", adjuster: ["Auto-approval is switched off (kill switch)."] }, checksFailed: [{ code: "AUTO_APPROVE_ENABLED", detail: "d" }] } : {}) } };
      },
    });
    expect(await runScenarios(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.logs.filter((l) => l.startsWith("FAIL"))).toHaveLength(1);
    expect(f.logs.filter((l) => l.startsWith("PASS"))).toHaveLength(SCENARIOS.length - 1);
    expect(f.logs.join("\n")).toContain("Kill switch autoApproveEnabled is false");
  });
  it("fails a scenario when the expected reason is missing", async () => {
    const f = fake({
      invokeDecision: async (_f, e) => {
        const s = SCENARIOS.find((x) => x.claimId === e.claimId)!;
        return { payload: { result: "DECIDED", decision: decision(s, s.id === "H" ? { reasons: { customer: "x", adjuster: ["something else"] } } : {}) } };
      },
    });
    expect(await runScenarios(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.logs.join("\n")).toContain("missing in adjuster reasons: CLM-1042 | already claimed");
  });
  it.each([
    ["a Lambda error", { functionError: "Unhandled", payload: {} }],
    ["NOT_FOUND", { payload: { result: "NOT_FOUND" } }],
    ["ALREADY_DECIDED", { payload: { result: "ALREADY_DECIDED" } }],
  ])("reports %s as FAIL", async (_n, res) => {
    const f = fake({ invokeDecision: async () => res });
    expect(await runScenarios(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.logs.filter((l) => l.startsWith("FAIL"))).toHaveLength(SCENARIOS.length);
  });
  it("stops with a message when the seed has not run", async () => {
    const f = fake({ getClaim: async () => undefined });
    expect(await runScenarios(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.errors[0]).toContain("npm run seed -- --stage dev-a");
    expect(f.events).toHaveLength(0);
  });
  it("stops when the clock is before the scenario loss date", async () => {
    const f = fake({ now: () => new Date("2026-11-10T00:00:00Z") });
    expect(await runScenarios(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.errors[0]).toContain("2026-11-15");
    expect(f.events).toHaveLength(0);
  });
  it("rejects a bad stage", async () => {
    const f = fake();
    expect(await runScenarios([], f.deps)).toBe(1);
    expect(f.errors[0]).toContain("Usage");
  });
  it("Property 9: the claim row written is a clean PROCESSING row whatever was stored before", async () => {
    await fc.assert(fc.asyncProperty(fc.record({ status: fc.string(), payout: fc.integer(), decision: fc.anything() }), async (prior) => {
      const f = fake();
      for (const s of SCENARIOS) f.claims.set(s.claimId, { ...prior, claimId: s.claimId });
      await runScenarios(["--stage", "dev-a"], f.deps);
      for (const s of SCENARIOS) {
        const row = f.claims.get(s.claimId)!;
        expect(row).toEqual(buildScenarioClaimRow(s, new Date("2026-11-21T10:00:00Z")));
        for (const k of ["decision", "reasons", "payout", "decidedAt", "gsi1pk", "gsi1sk", "gsi2pk", "gsi2sk"]) expect(row).not.toHaveProperty(k);
        expect(row.status).toBe("PROCESSING");
      }
      expect(f.claims.get("CLM-1042")).toEqual({ claimId: "CLM-1042" });
    }), { numRuns: 20 });
  });
});
