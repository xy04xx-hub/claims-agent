import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHandlers } from "./handlers.js";
import { validateAudit, validateDecision } from "./schemas.js";
import { claim, IMEI, photo, proposal, TENANT } from "./test/fixtures.js";
import { ctx, FakeStore, makeDeps } from "./test/helpers.js";
import type { DecideEvent, SqsEvent } from "./types.js";

const event = (over: Partial<DecideEvent> = {}): DecideEvent => ({
  tenantId: TENANT, claimId: "CLM-2001", proposal: proposal(), jti: "9d1c2f0e-6a1b-4c1d-8e2a-0f7b5a3c1d44", ...over,
});
const failedCodes = (r: unknown) => (r as { decision: { checksFailed: { code: string }[] } }).decision.checksFailed.map((c) => c.code);

describe("decide", () => {
  it("approves a clean claim, writes a valid decision and audit record, emits metrics", async () => {
    const { deps, store, metrics } = makeDeps();
    const res = await createHandlers(deps).decide(event(), ctx);
    expect(res).toMatchObject({ result: "DECIDED", decision: { outcome: "AUTO_APPROVED", payout: 130 } });
    expect(store.commits).toHaveLength(1);
    const { decision, audit } = store.commits[0];
    expect(validateDecision(decision)).toEqual({ ok: true });
    expect(validateAudit(audit)).toEqual({ ok: true });
    expect(audit).toMatchObject({
      actor: { type: "agent" }, policyId: "POL-001", policyVersion: 1, packVersion: 1,
      ticketJti: "9d1c2f0e-6a1b-4c1d-8e2a-0f7b5a3c1d44", requestId: "req-1", model: expect.stringContaining("haiku-4-5"),
    });
    expect(audit.thresholds).toMatchObject({ autoApproveEnabled: true, autoApproveCap: 500, earlyClaimDays: 14 });
    expect(metrics.counts).toEqual([{ name: "AutoApproved", dims: undefined }]);
    expect(metrics.latencies).toHaveLength(1);
    expect(metrics.latencies[0]).toBeGreaterThanOrEqual(0);
  });

  it("does not put claim text, names or the IMEI in the audit record", async () => {
    const { deps, store } = makeDeps();
    await createHandlers(deps).decide(event(), ctx);
    const text = JSON.stringify(store.commits[0].audit);
    expect(text).not.toContain(IMEI);
    expect(text).not.toContain("Alex Demo");
    expect(text).not.toContain("being checked");
  });

  it("kill switch off routes the claim", async () => {
    const { deps, store, metrics } = makeDeps({ killSwitch: false });
    const res = await createHandlers(deps).decide(event(), ctx);
    expect(res).toMatchObject({ result: "DECIDED", decision: { outcome: "ROUTED_TO_ADJUSTER", payout: 0 } });
    expect(failedCodes(res)).toEqual(["AUTO_APPROVE_ENABLED"]);
    expect(store.commits[0].audit.thresholds.autoApproveEnabled).toBe(false);
    expect(metrics.counts).toEqual([{ name: "Routed", dims: { reason: "AUTO_APPROVE_ENABLED" } }]);
  });

  it("a second decision for the same claim is rejected and the first stays", async () => {
    const { deps, store } = makeDeps();
    const h = createHandlers(deps);
    await h.decide(event(), ctx);
    const second = await h.decide(event({ proposal: proposal({ extracted: { ...(proposal().extracted as object), cause: "THEFT" } }) }), ctx);
    expect(second).toEqual({ result: "ALREADY_DECIDED", claimId: "CLM-2001" });
    expect(store.commits).toHaveLength(1);
    expect(store.claims.get(`${TENANT}#CLM-2001`)?.status).toBe("AUTO_APPROVED");
  });

  it("loses a race at commit time: ALREADY_DECIDED, no metrics", async () => {
    const store = new FakeStore();
    store.loseRace = true;
    const { deps, metrics } = makeDeps({ store });
    expect(await createHandlers(deps).decide(event(), ctx)).toEqual({ result: "ALREADY_DECIDED", claimId: "CLM-2001" });
    expect(metrics.counts).toEqual([]);
  });

  it("returns NOT_FOUND for an unknown claim and writes nothing", async () => {
    const { deps, store } = makeDeps();
    expect(await createHandlers(deps).decide(event({ claimId: "CLM-9999" }), ctx)).toEqual({ result: "NOT_FOUND", claimId: "CLM-9999" });
    expect(store.commits).toHaveLength(0);
  });

  it("rejects an event without a valid tenantId or claimId", async () => {
    const { deps } = makeDeps();
    const h = createHandlers(deps);
    await expect(h.decide({ tenantId: "", claimId: "CLM-1" } as DecideEvent, ctx)).rejects.toThrow(TypeError);
    await expect(h.decide({ tenantId: "t1", claimId: "x" } as DecideEvent, ctx)).rejects.toThrow(TypeError);
  });

  it("routes an invalid proposal", async () => {
    const { deps } = makeDeps();
    const res = await createHandlers(deps).decide(event({ proposal: { nope: true } }), ctx);
    expect(res).toMatchObject({ decision: { outcome: "ROUTED_TO_ADJUSTER" } });
    expect(failedCodes(res)).toEqual(["PROPOSAL_INVALID"]);
  });

  it("routes a proposal that is for another claim", async () => {
    const { deps } = makeDeps();
    const res = await createHandlers(deps).decide(event({ proposal: proposal({ claimId: "CLM-1042" }) }), ctx);
    expect(failedCodes(res)).toEqual(["PROPOSAL_INVALID"]);
  });

  it("routes when the model's cause is UNCLEAR", async () => {
    const { deps } = makeDeps();
    const p = proposal({ extracted: { ...(proposal().extracted as object), cause: "UNCLEAR" } });
    expect(failedCodes(await createHandlers(deps).decide(event({ proposal: p }), ctx))).toEqual(["CAUSE_CLEAR"]);
  });

  it("routes when the evidence IMEI differs from the insured IMEI", async () => {
    const { deps } = makeDeps();
    const p = proposal({ extracted: { ...(proposal().extracted as object), identifiers: { imei: "999999999999999" } } });
    const res = await createHandlers(deps).decide(event({ proposal: p }), ctx);
    expect(failedCodes(res)).toEqual(["EVIDENCE_MATCHES_POLICY"]);
  });

  it("routes a duplicate photo and names the other claim", async () => {
    const store = new FakeStore();
    store.others["SHA256:sha-aaa"] = ["CLM-1042"];
    const { deps } = makeDeps({ store });
    const res = await createHandlers(deps).decide(event(), ctx);
    expect(res).toMatchObject({ decision: { outcome: "ROUTED_TO_ADJUSTER", riskSignals: [{ code: "DUPLICATE_PHOTO", relatedClaimId: "CLM-1042" }] } });
  });

  it("routes an identifier already used on another claim", async () => {
    const store = new FakeStore();
    store.others[`IDENTIFIER:${IMEI}`] = ["CLM-1042"];
    const { deps } = makeDeps({ store });
    const res = await createHandlers(deps).decide(event(), ctx);
    expect(res).toMatchObject({ decision: { outcome: "ROUTED_TO_ADJUSTER", riskSignals: [{ code: "IDENTIFIER_REUSE" }] } });
  });

  it("uses the routing signal as the audit reasonCode and keeps checksFailed", async () => {
    const store = new FakeStore();
    store.others[`IDENTIFIER:${IMEI}`] = ["CLM-1042"];
    const { deps, metrics } = makeDeps({ store });
    const res = await createHandlers(deps).decide(event(), ctx);
    expect(res).toMatchObject({ decision: { outcome: "ROUTED_TO_ADJUSTER" } });
    const { decision, audit } = store.commits[0];
    expect(audit.reasonCode).toBe("IDENTIFIER_REUSE");
    expect(validateAudit(audit)).toEqual({ ok: true });
    expect(decision.checksFailed.map((c) => c.code)).toContain("NO_RISK_SIGNALS");
    expect(metrics.counts[0]).toEqual({ name: "Routed", dims: { reason: "IDENTIFIER_REUSE" } });
  });

  it("routes when no policy version is in force on the loss date", async () => {
    const store = new FakeStore(claim({ lossDate: "2025-01-01" }));
    const { deps } = makeDeps({ store });
    expect(failedCodes(await createHandlers(deps).decide(event(), ctx))).toEqual(["POLICY_IN_FORCE"]);
  });

  it("routes when there is no claim type pack", async () => {
    const store = new FakeStore();
    store.pack = undefined;
    const { deps } = makeDeps({ store });
    expect(failedCodes(await createHandlers(deps).decide(event(), ctx))).toEqual(["PACK_FOUND"]);
  });
});

describe("failures route, never approve", () => {
  for (const method of ["getPolicyVersions", "getPack", "getEvidence"] as const) {
    it(`${method} throws: fail-safe route and FailSafeRouted metric`, async () => {
      const store = new FakeStore();
      store.failing.add(method);
      const { deps, metrics } = makeDeps({ store });
      const res = await createHandlers(deps).decide(event(), ctx);
      expect(res).toMatchObject({ decision: { outcome: "ROUTED_TO_ADJUSTER", failSafe: true, payout: 0 } });
      expect(failedCodes(res)).toEqual(["AUTOMATIC_CHECK_UNAVAILABLE"]);
      expect(metrics.counts.map((c) => c.name)).toEqual(["Routed", "FailSafeRouted"]);
    });
  }

  for (const method of ["findOtherClaims", "countRecentClaims"] as const) {
    it(`${method} throws: UNABLE_TO_VERIFY risk signal routes`, async () => {
      const store = new FakeStore();
      store.failing.add(method);
      const { deps } = makeDeps({ store });
      const res = await createHandlers(deps).decide(event(), ctx);
      expect(res).toMatchObject({ decision: { outcome: "ROUTED_TO_ADJUSTER", riskSignals: [{ code: "UNABLE_TO_VERIFY" }] } });
    });
  }

  it("an unreadable kill switch (reads as off) routes", async () => {
    const { deps } = makeDeps({ killSwitch: false });
    expect(await createHandlers(deps).decide(event(), ctx)).toMatchObject({ decision: { outcome: "ROUTED_TO_ADJUSTER" } });
  });

  it("a failing commit is thrown so SQS can retry", async () => {
    const store = new FakeStore();
    store.failing.add("commitDecision");
    const { deps } = makeDeps({ store });
    await expect(createHandlers(deps).decide(event(), ctx)).rejects.toThrow("boom");
  });
});

describe("evidence processing not built yet (T-13)", () => {
  it("no evidence index entries: no crash, required evidence is missing, no match signals", async () => {
    const store = new FakeStore();
    store.evidence = [];
    const { deps } = makeDeps({ store });
    const res = await createHandlers(deps).decide(event(), ctx);
    expect(res).toMatchObject({ decision: { outcome: "ROUTED_TO_ADJUSTER", riskSignals: [] } });
    expect(failedCodes(res)).toContain("REQUIRED_EVIDENCE_PRESENT");
  });

  it("an entry with no hashes, identifier or EXIF date: no crash, no signal, approved with EXIF_MISSING", async () => {
    const store = new FakeStore();
    store.evidence = [{ evidenceId: "EVD-1", kind: "DEVICE_PHOTO" }];
    const { deps } = makeDeps({ store });
    const res = await createHandlers(deps).decide(event(), ctx);
    expect(res).toMatchObject({
      decision: { outcome: "AUTO_APPROVED", riskSignals: [], informationalFlags: ["EXIF_MISSING"] },
    });
  });

  it("an entry without a kind cannot prove required evidence, so it routes", async () => {
    const store = new FakeStore();
    store.evidence = [{ ...photo, kind: undefined }];
    const { deps } = makeDeps({ store });
    expect(failedCodes(await createHandlers(deps).decide(event(), ctx))).toEqual(["REQUIRED_EVIDENCE_PRESENT"]);
  });

  it("an index entry owned by another claim does not count as this claim's evidence", async () => {
    const store = new FakeStore();
    store.evidence = [{ ...photo, claimId: "CLM-1042" }];
    const { deps } = makeDeps({ store });
    expect(failedCodes(await createHandlers(deps).decide(event(), ctx))).toEqual(["REQUIRED_EVIDENCE_PRESENT"]);
  });
  it("evidence uploaded before the claim (claimId UNASSIGNED) counts when the claim lists it", async () => {
    const store = new FakeStore();
    store.evidence = [{ ...photo, claimId: "UNASSIGNED" }];
    const { deps } = makeDeps({ store });
    const res = await createHandlers(deps).decide(event(), ctx);
    expect(res).toMatchObject({ result: "DECIDED", decision: { outcome: "AUTO_APPROVED" } });
    expect(failedCodes(res)).toEqual([]);
  });
  it("unassigned evidence without an EXIF date still raises EXIF_MISSING", async () => {
    const store = new FakeStore();
    store.evidence = [{ ...photo, claimId: "UNASSIGNED", exifDate: undefined }];
    const { deps } = makeDeps({ store });
    const res = (await createHandlers(deps).decide(event(), ctx)) as { decision: { informationalFlags: string[] } };
    expect(res.decision.informationalFlags).toContain("EXIF_MISSING");
  });
  it("unassigned evidence that the claim does not list is not used", async () => {
    const store = new FakeStore();
    store.getEvidence = async () => [{ ...photo, evidenceId: "EVD-OTHER", claimId: "UNASSIGNED" }];
    const { deps } = makeDeps({ store });
    expect(failedCodes(await createHandlers(deps).decide(event(), ctx))).toEqual(["REQUIRED_EVIDENCE_PRESENT"]);
  });
  it("unassigned evidence cannot make an approval above the cap", async () => {
    const store = new FakeStore();
    store.evidence = [{ ...photo, claimId: "UNASSIGNED" }];
    store.claims.set("t1#CLM-2001", claim({ amountClaimed: 700 }));
    const { deps } = makeDeps({ store });
    const res = (await createHandlers(deps).decide(event(), ctx)) as { decision: { outcome: string } };
    expect(res.decision.outcome).toBe("ROUTED_TO_ADJUSTER");
  });
});
describe("routeOnly", () => {
  const sample = JSON.parse(readFileSync(new URL("./test/sqs-dlq-event.json", import.meta.url), "utf8")) as SqsEvent;
  const withBody = (body: string): SqsEvent => ({ Records: [{ ...sample.Records[0], body }] });

  it("routes the claim from the sample SQS event with AUTOMATIC_CHECK_UNAVAILABLE", async () => {
    const { deps, store, metrics } = makeDeps();
    const res = await createHandlers(deps).routeOnly(sample, ctx);
    expect(res).toEqual({ batchItemFailures: [] });
    expect(store.commits).toHaveLength(1);
    const { decision, audit } = store.commits[0];
    expect(decision).toMatchObject({ outcome: "ROUTED_TO_ADJUSTER", failSafe: true, payout: 0 });
    expect(decision.checksFailed[0].code).toBe("AUTOMATIC_CHECK_UNAVAILABLE");
    expect(validateDecision(decision)).toEqual({ ok: true });
    expect(validateAudit(audit)).toEqual({ ok: true });
    expect(audit.reasonCode).toBe("AUTOMATIC_CHECK_UNAVAILABLE");
    expect(metrics.counts.map((c) => c.name)).toEqual(["Routed", "FailSafeRouted"]);
  });

  it("always routes, even when everything else about the claim is clean and the switch is on", async () => {
    const { deps, store } = makeDeps({ killSwitch: true });
    await createHandlers(deps).routeOnly(sample, ctx);
    expect(store.commits[0].decision.outcome).toBe("ROUTED_TO_ADJUSTER");
  });

  it("works through the Lambda entry point for an SQS event", async () => {
    const { deps, store } = makeDeps();
    const res = await createHandlers(deps).handler(sample, ctx);
    expect(res).toEqual({ batchItemFailures: [] });
    expect(store.commits).toHaveLength(1);
  });

  it("ignores a claim that is already decided", async () => {
    const store = new FakeStore(claim({ status: "AUTO_APPROVED" }));
    const { deps } = makeDeps({ store });
    expect(await createHandlers(deps).routeOnly(sample, ctx)).toEqual({ batchItemFailures: [] });
    expect(store.commits).toHaveLength(0);
  });

  it("ignores a claim that does not exist", async () => {
    const { deps, store } = makeDeps();
    const body = JSON.stringify({ tenantId: "t1", claimId: "CLM-9999", attempt: 3, requestId: "r" });
    expect(await createHandlers(deps).routeOnly(withBody(body), ctx)).toEqual({ batchItemFailures: [] });
    expect(store.commits).toHaveLength(0);
  });

  it("reports malformed and invalid records in batchItemFailures", async () => {
    const { deps, store } = makeDeps();
    const h = createHandlers(deps);
    const id = sample.Records[0].messageId;
    expect(await h.routeOnly(withBody("not json"), ctx)).toEqual({ batchItemFailures: [{ itemIdentifier: id }] });
    expect(await h.routeOnly(withBody(JSON.stringify({ tenantId: "t1" })), ctx)).toEqual({ batchItemFailures: [{ itemIdentifier: id }] });
    expect(store.commits).toHaveLength(0);
  });

  it("reports a record whose commit fails", async () => {
    const store = new FakeStore();
    store.failing.add("commitDecision");
    const { deps } = makeDeps({ store });
    const res = await createHandlers(deps).routeOnly(sample, ctx);
    expect(res.batchItemFailures).toHaveLength(1);
  });
});
