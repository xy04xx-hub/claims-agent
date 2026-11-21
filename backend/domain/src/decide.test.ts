import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { decide, type Facts } from "./decide.js";
import { CAUSES, type Cause } from "./types.js";
import { carPack, cleanFacts, phonePack, policyV1, policyV2, thresholds } from "./fixtures.js";

const run = (f: Facts, pack = phonePack, kill = true) => decide(f, pack, thresholds, kill);
const failedCodes = (d: ReturnType<typeof run>) => d.checksFailed.map((c) => c.code);

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validateDecision = ajv.compile(
  JSON.parse(readFileSync(new URL("../../../contracts/decision.schema.json", import.meta.url), "utf8")),
);
const expectValid = (d: unknown) => {
  expect(validateDecision(d), ajv.errorsText(validateDecision.errors)).toBe(true);
};

describe("demo scenarios", () => {
  it("A: phone damage under the cap is auto-approved", () => {
    const d = run(cleanFacts());
    expect(d.outcome).toBe("AUTO_APPROVED");
    expect(d.payout).toBe(130);
    expect(d.checksPassed).toEqual(expect.arrayContaining([
      "POLICY_ACTIVE", "CATEGORY_COVERED", "CAUSE_COVERED", "EVIDENCE_MATCHES_POLICY", "UNDER_CAP", "NO_RISK_SIGNALS",
    ]));
    expect(d.reasons.customer).toBe("Your claim was approved. Payout 130.00 after the 50.00 deductible.");
    expectValid(d);
  });

  it("B: phone theft with a matching report is approved under the lower cap", () => {
    const d = run(cleanFacts({
      amount: 300, claimedCause: "THEFT", proposalCause: "THEFT",
      evidence: { provided: ["POLICE_REPORT"], consistent: true, confidence: 0.9 },
      signalInputs: { ...cleanFacts().signalInputs, evidenceDates: [{ source: "INCIDENT", date: "2026-11-18" }] },
    }));
    expect(d.outcome).toBe("AUTO_APPROVED");
    expect(d.payout).toBe(250);
    expect(d.informationalFlags).toContain("DOC_AUTHENTICITY_UNVERIFIED");
    expectValid(d);
  });

  it("B2: theft above the lower cap is routed even though the damage cap would allow it", () => {
    const d = run(cleanFacts({
      amount: 400, claimedCause: "THEFT", proposalCause: "THEFT",
      evidence: { provided: ["POLICE_REPORT"], consistent: true, confidence: 0.9 },
      signalInputs: { ...cleanFacts().signalInputs, evidenceDates: [] },
    }));
    expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
    expect(failedCodes(d)).toEqual(["UNDER_CAP"]);
  });

  it("C: car collision with injury is never auto-approved", () => {
    const car = policyV1.items[1];
    for (const cause of ["COLLISION", "INJURY"] as const) {
      const d = run(
        cleanFacts({
          amount: 150, claimedCause: cause, proposalCause: cause, item: car,
          evidence: { provided: ["POLICE_REPORT"], consistent: true, confidence: 0.95 },
          signalInputs: { ...cleanFacts().signalInputs, evidenceDates: [] },
        }),
        carPack,
      );
      expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
      expect(failedCodes(d)).toEqual(["UNDER_CAP"]);
      expect(d.reasons.adjuster[0]).toContain("always reviewed");
      expectValid(d);
    }
  });

  it("C2: car windscreen under the small cap is approved", () => {
    const d = run(
      cleanFacts({
        amount: 200, claimedCause: "WINDSCREEN", proposalCause: "WINDSCREEN", item: policyV1.items[1],
        evidence: { provided: ["PLATE_PHOTO"], consistent: true, confidence: 0.9 },
      }),
      carPack,
    );
    expect(d.outcome).toBe("AUTO_APPROVED");
    expect(d.payout).toBe(150);
  });

  it("D: duplicate photo routes and names CLM-1042 only in adjuster text", () => {
    const f = cleanFacts();
    f.signalInputs.duplicateMatches = [{ claimId: "CLM-1042", match: "EXACT" }];
    const d = run(f);
    expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
    expect(d.riskSignals[0]).toMatchObject({ code: "DUPLICATE_PHOTO", relatedClaimId: "CLM-1042" });
    expect(d.reasons.adjuster.join(" ")).toContain("CLM-1042");
    expect(d.reasons.customer).not.toContain("CLM-1042");
    expect(d.reasons.customer).not.toMatch(/fraud|duplicate/i);
    expectValid(d);
  });

  it("E: uncovered category routes with a specific reason", () => {
    const d = run(cleanFacts({ item: policyV1.items[2], claimedCause: "THEFT", proposalCause: "THEFT" }));
    expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
    expect(d.reasons.adjuster).toContain("Item category 'laptop' is not covered by policy POL-001.");
    expect(d.reasons.customer).toContain("not covered");
    expectValid(d);
  });

  it("E2: uncovered cause routes with a specific reason (policy v2 dropped theft)", () => {
    const d = run(cleanFacts({
      policy: policyV2, claimedCause: "THEFT", proposalCause: "THEFT",
      evidence: { provided: ["POLICE_REPORT"], consistent: true, confidence: 0.9 },
    }));
    expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
    expect(d.reasons.adjuster).toContain("Cause 'THEFT' is not covered for 'phone' under POL-001 v2.");
  });

  it("F: amount over the cap is routed", () => {
    const d = run(cleanFacts({ amount: 700 }));
    expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
    expect(d.reasons.adjuster).toContain("Payout 650 is above the auto-approve cap 500.");
    expect(d.payout).toBe(0);
    expectValid(d);
  });

  it("G: report IMEI that does not match the policy is routed with the mismatch reason", () => {
    const d = run(cleanFacts({
      claimedCause: "THEFT", proposalCause: "THEFT",
      evidence: { provided: ["POLICE_REPORT"], consistent: false, confidence: 0.95, mismatchDetail: "Report IMEI ...9999 does not match the insured IMEI." },
    }));
    expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
    expect(failedCodes(d)).toEqual(["EVIDENCE_MATCHES_POLICY"]);
    expect(d.reasons.adjuster).toContain("Report IMEI ...9999 does not match the insured IMEI.");
    expectValid(d);
  });

  it("H: theft with an IMEI already claimed on CLM-1042 is routed, CLM-1042 only in adjuster text", () => {
    const f = cleanFacts({
      amount: 300, claimedCause: "THEFT", proposalCause: "THEFT",
      evidence: { provided: ["POLICE_REPORT"], consistent: true, confidence: 0.9 },
    });
    f.signalInputs.evidenceDates = [{ source: "INCIDENT", date: "2026-11-18" }];
    f.signalInputs.identifierReuse = [{ identifier: "356938035643809", claimId: "CLM-1042" }];
    const d = run(f);
    expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
    expect(d.payout).toBe(0);
    expect(d.riskSignals).toHaveLength(1);
    expect(d.riskSignals[0]).toMatchObject({ code: "IDENTIFIER_REUSE", relatedClaimId: "CLM-1042" });
    expect(d.reasons.adjuster.join(" ")).toContain("CLM-1042");
    expect(d.reasons.adjuster.join(" ")).not.toContain("356938035643809");
    expect(d.reasons.customer).not.toContain("CLM-1042");
    expect(d.reasons.customer).not.toContain("356938035643809");
    expect(d.reasons.customer).not.toMatch(/fraud|stolen|already claimed/i);
    expectValid(d);
  });
});

describe("decide rules", () => {
  it("kill switch off routes everything", () => {
    const d = run(cleanFacts(), phonePack, false);
    expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
    expect(failedCodes(d)).toEqual(["AUTO_APPROVE_ENABLED"]);
  });
  it("no policy in force routes", () => {
    const d = run(cleanFacts({ policy: undefined }));
    expect(d.outcome).toBe("ROUTED_TO_ADJUSTER");
    expect(failedCodes(d)).toContain("POLICY_IN_FORCE");
  });
  it("UNCLEAR proposal cause routes", () => {
    const d = run(cleanFacts({ proposalCause: "UNCLEAR" }));
    expect(failedCodes(d)).toEqual(["CAUSE_CLEAR"]);
  });
  it("proposal cause that differs from the claimed cause routes", () => {
    expect(failedCodes(run(cleanFacts({ proposalCause: "THEFT" })))).toEqual(["CAUSE_CLEAR"]);
  });
  it("missing required evidence routes", () => {
    const d = run(cleanFacts({ evidence: { provided: [], consistent: true, confidence: 0.95 } }));
    expect(failedCodes(d)).toEqual(["REQUIRED_EVIDENCE_PRESENT"]);
    expect(d.reasons.adjuster).toContain("Missing required evidence: DEVICE_PHOTO.");
  });
  it("low extraction confidence routes", () => {
    const d = run(cleanFacts({ evidence: { provided: ["DEVICE_PHOTO"], consistent: true, confidence: 0.5 } }));
    expect(failedCodes(d)).toEqual(["EVIDENCE_MATCHES_POLICY"]);
  });
  it("amount not above the deductible routes", () => {
    expect(failedCodes(run(cleanFacts({ amount: 40 })))).toContain("PAYABLE_AMOUNT");
  });
  it("payout above the category limit routes", () => {
    const policy = { ...policyV1, coverage: { ...policyV1.coverage, phone: { causes: policyV1.coverage.phone.causes, limit: 100 } } };
    expect(failedCodes(run(cleanFacts({ policy })))).toEqual(["WITHIN_LIMIT"]);
  });
  it("cause missing from the pack routes (cap 0)", () => {
    const pack = { ...phonePack, causes: {} };
    expect(failedCodes(run(cleanFacts(), pack))).toEqual(["UNDER_CAP"]);
  });
  it("a routed claim pays nothing and has customer text", () => {
    const d = run(cleanFacts({ amount: 700 }));
    expect(d.payout).toBe(0);
    expect(d.reasons.customer.length).toBeGreaterThan(0);
  });
  it("EXIF_MISSING flag passes through without blocking", () => {
    const d = run(cleanFacts({ flags: ["EXIF_MISSING"] }));
    expect(d.outcome).toBe("AUTO_APPROVED");
    expect(d.informationalFlags).toEqual(["EXIF_MISSING"]);
  });
});

describe("decide never auto-approves when it must not", () => {
  const proposals: Cause[] = [...CAUSES];
  const violations: Record<string, (f: Facts) => { facts: Facts; kill?: boolean }> = {
    "payout above the cap": (f) => ({ facts: { ...f, amount: 1000 } }),
    "duplicate photo": (f) => { f.signalInputs.duplicateMatches = [{ claimId: "CLM-1042", match: "NEAR" }]; return { facts: f }; },
    "identifier reuse": (f) => { f.signalInputs.identifierReuse = [{ identifier: "356938035643809", claimId: "CLM-1" }]; return { facts: f }; },
    "claim frequency": (f) => { f.signalInputs.recentClaimCount = 10; return { facts: f }; },
    "lookup failure": (f) => { f.signalInputs.lookupFailed = true; return { facts: f }; },
    "timeline inconsistent": (f) => { f.signalInputs.evidenceDates = [{ source: "EXIF", date: "2020-01-01" }]; return { facts: f }; },
    "uncovered category": (f) => ({ facts: { ...f, item: policyV1.items[2] } }),
    "uncovered cause": (f) => ({ facts: { ...f, policy: policyV2, claimedCause: "THEFT" } }),
    "no policy": (f) => ({ facts: { ...f, policy: undefined } }),
    "missing evidence": (f) => ({ facts: { ...f, evidence: { ...f.evidence, provided: [] } } }),
    "evidence inconsistent": (f) => ({ facts: { ...f, evidence: { ...f.evidence, consistent: false } } }),
    "kill switch off": (f) => ({ facts: f, kill: false }),
  };

  for (const [name, mutate] of Object.entries(violations)) {
    it(`routes on: ${name}, whatever cause the proposal states`, () => {
      for (const proposalCause of proposals) {
        const { facts, kill } = mutate(cleanFacts());
        const d = run({ ...facts, proposalCause }, phonePack, kill ?? true);
        expect(d.outcome, `${name} / ${proposalCause}`).toBe("ROUTED_TO_ADJUSTER");
        expect(d.payout).toBe(0);
      }
    });
  }

  it("routes when the proposal cause is UNCLEAR even if everything else is clean", () => {
    expect(run(cleanFacts({ proposalCause: "UNCLEAR" })).outcome).toBe("ROUTED_TO_ADJUSTER");
  });

  it("approves only when the payout is at or below the cap", () => {
    for (const amount of [51, 100, 549, 550, 551, 600, 5000]) {
      const d = run(cleanFacts({ amount }));
      expect(d.outcome === "AUTO_APPROVED").toBe(amount - 50 <= 500);
      if (d.outcome === "AUTO_APPROVED") expect(d.payout).toBeLessThanOrEqual(500);
    }
  });
});
