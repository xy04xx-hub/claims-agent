import { describe, expect, it } from "vitest";
import { evaluateSignals, type SignalInputs } from "./signals.js";
import { thresholds } from "./fixtures.js";

const base: SignalInputs = {
  amount: 180, lossDate: "2026-11-18", filingDate: "2026-11-21", policyStartDate: "2026-01-01",
  typicalValue: 800, recentClaimCount: 0, duplicateMatches: [], identifierReuse: [],
  evidenceDates: [{ source: "EXIF", date: "2026-11-18" }], lookupFailed: false,
};
const codes = (o: Partial<SignalInputs>) => evaluateSignals({ ...base, ...o }, thresholds).map((s) => s.code);

describe("evaluateSignals", () => {
  it("returns nothing for a clean claim", () => expect(codes({})).toEqual([]));
  it("exact duplicate photo names the matching claim", () => {
    const [s] = evaluateSignals({ ...base, duplicateMatches: [{ claimId: "CLM-1042", match: "EXACT" }] }, thresholds);
    expect(s).toMatchObject({ code: "DUPLICATE_PHOTO", relatedClaimId: "CLM-1042", detail: "Photo matches claim CLM-1042." });
  });
  it("near duplicate photo", () => {
    const [s] = evaluateSignals({ ...base, duplicateMatches: [{ claimId: "CLM-1042", match: "NEAR" }] }, thresholds);
    expect(s.detail).toBe("Photo is similar to claim CLM-1042.");
  });
  it("identifier reuse masks the identifier", () => {
    const [s] = evaluateSignals({ ...base, identifierReuse: [{ identifier: "356938035643809", claimId: "CLM-1042" }] }, thresholds);
    expect(s.code).toBe("IDENTIFIER_REUSE");
    expect(s.detail).not.toContain("356938035643809");
  });
  it("early claim", () => expect(codes({ policyStartDate: "2026-11-10" })).toEqual(["EARLY_CLAIM"]));
  it("no early claim at exactly the limit", () => expect(codes({ policyStartDate: "2026-11-04" })).toEqual([]));
  it("early check skipped without a policy start", () => expect(codes({ policyStartDate: undefined })).toEqual([]));
  it("amount outlier", () => expect(codes({ amount: 1700 })).toEqual(["AMOUNT_OUTLIER"]));
  it("no outlier at exactly the multiplier", () => expect(codes({ amount: 1600 })).toEqual([]));
  it("no outlier when no typical value", () => expect(codes({ amount: 99999, typicalValue: 0 })).toEqual([]));
  it("claim frequency", () => {
    expect(codes({ recentClaimCount: 4 })).toEqual(["CLAIM_FREQUENCY"]);
    expect(codes({ recentClaimCount: 3 })).toEqual([]);
  });
  it("EXIF date before the loss", () =>
    expect(codes({ evidenceDates: [{ source: "EXIF", date: "2026-11-01" }] })).toEqual(["TIMELINE_INCONSISTENT"]));
  it("report incident date far from the loss date", () =>
    expect(codes({ evidenceDates: [{ source: "INCIDENT", date: "2026-11-10" }] })).toEqual(["TIMELINE_INCONSISTENT"]));
  it("report incident date within one day is fine", () =>
    expect(codes({ evidenceDates: [{ source: "INCIDENT", date: "2026-11-17" }] })).toEqual([]));
  it("loss date after filing date", () => expect(codes({ lossDate: "2026-11-25" })).toContain("TIMELINE_INCONSISTENT"));
  it("lookup failure means unable to verify", () => expect(codes({ lookupFailed: true })).toEqual(["UNABLE_TO_VERIFY"]));
});
