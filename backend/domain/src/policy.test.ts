import { describe, expect, it } from "vitest";
import { checkCoverage, computePayout, selectPolicyVersion } from "./policy.js";
import { policyV1, policyV1Closed, policyV2 } from "./fixtures.js";

describe("selectPolicyVersion", () => {
  const versions = [policyV1Closed, policyV2];
  it("picks the version in force on the loss date", () => {
    expect(selectPolicyVersion(versions, "2026-10-15")?.version).toBe(1);
    expect(selectPolicyVersion(versions, "2026-11-18")?.version).toBe(2);
  });
  it("returns undefined when none is in force", () => {
    expect(selectPolicyVersion(versions, "2025-12-31")).toBeUndefined();
  });
});

describe("checkCoverage", () => {
  const phone = policyV1.items[0];
  it("passes when active, item listed, category and cause covered", () => {
    const r = checkCoverage(policyV1, phone, "ACCIDENTAL_DAMAGE", "2026-11-18");
    expect(r.covered).toBe(true);
    expect(r.passed).toEqual(["POLICY_ACTIVE", "ITEM_ON_POLICY", "CATEGORY_COVERED", "CAUSE_COVERED"]);
  });
  it("fails before the policy start", () => {
    const r = checkCoverage(policyV1, phone, "THEFT", "2025-12-31");
    expect(r.failed.map((f) => f.code)).toContain("POLICY_ACTIVE");
  });
  it("fails after the policy version ended", () => {
    const r = checkCoverage(policyV1Closed, phone, "THEFT", "2026-11-18");
    expect(r.failed.map((f) => f.code)).toContain("POLICY_ACTIVE");
  });
  it("fails when the item is not on the policy", () => {
    expect(checkCoverage(policyV1, undefined, "THEFT", "2026-11-18").failed[0].code).toBe("ITEM_ON_POLICY");
    const other = { itemId: "X", category: "phone", label: "x" };
    expect(checkCoverage(policyV1, other, "THEFT", "2026-11-18").covered).toBe(false);
  });
  it("fails with a specific reason for an uncovered category", () => {
    const r = checkCoverage(policyV1, policyV1.items[2], "THEFT", "2026-11-18");
    expect(r.covered).toBe(false);
    expect(r.failed[0].detail).toBe("Item category 'laptop' is not covered by policy POL-001.");
  });
  it("fails with a specific reason for an uncovered cause", () => {
    const r = checkCoverage(policyV2, phone, "THEFT", "2026-11-18");
    expect(r.failed[0].detail).toBe("Cause 'THEFT' is not covered for 'phone' under POL-001 v2.");
  });
  it("fails for an UNCLEAR cause", () => {
    expect(checkCoverage(policyV1, phone, "UNCLEAR", "2026-11-18").covered).toBe(false);
  });
});

describe("computePayout", () => {
  it("subtracts the deductible", () => {
    expect(computePayout(180, 50, 1000)).toEqual({ payout: 130, withinLimit: true });
  });
  it("never goes below zero", () => {
    expect(computePayout(30, 50, 1000).payout).toBe(0);
  });
  it("flags a payout above the limit", () => {
    expect(computePayout(1500, 50, 1000)).toEqual({ payout: 1450, withinLimit: false });
  });
  it("rounds to cents", () => {
    expect(computePayout(100.126, 0, 1000).payout).toBe(100.13);
  });
});
