import { describe, expect, it } from "vitest";
import { toClaim, toDate, toEvidenceRecord, toPack, toPolicy } from "./normalize.js";

describe("normalize tolerates missing data", () => {
  it("toEvidenceRecord with no items", () => {
    expect(toEvidenceRecord("EVD-1", [])).toEqual({ evidenceId: "EVD-1" });
  });
  it("toEvidenceRecord folds items and ignores junk fields", () => {
    const rec = toEvidenceRecord("EVD-1", [
      { type: "SHA256", value: "aa", claimId: "CLM-1", kind: "DEVICE_PHOTO" },
      { type: "PHASH" },
      { type: "IDENTIFIER", value: "356938035643809", exifDate: "2026-11-18T09:00:00Z" },
      { type: 5, value: {} , kind: "WEIRD" },
    ]);
    expect(rec).toEqual({
      evidenceId: "EVD-1", claimId: "CLM-1", kind: "DEVICE_PHOTO", sha256: "aa", identifier: "356938035643809", exifDate: "2026-11-18",
    });
    expect(rec.phash).toBeUndefined();
  });
  it("toDate accepts dates and rejects the rest", () => {
    expect(toDate("2026-11-18T10:00:00Z")).toBe("2026-11-18");
    expect(toDate("yesterday")).toBeUndefined();
    expect(toDate(undefined)).toBeUndefined();
  });
  it("toClaim returns undefined for a missing or malformed item", () => {
    expect(toClaim("t1", undefined)).toBeUndefined();
    expect(toClaim("t1", { claimId: "CLM-1", status: "NOPE" })).toBeUndefined();
    expect(toClaim("t1", { claimId: "CLM-1", status: "PROCESSING" })).toMatchObject({ evidenceIds: [], cause: "UNCLEAR", amountClaimed: 0 });
  });
  it("toPack defaults the confidence threshold and drops unknown causes", () => {
    const pack = toPack("phone", { causes: { THEFT: { autoApproveCap: 300, requiredEvidence: ["POLICE_REPORT", "BAD"] }, NOPE: {} } });
    expect(pack?.minConfidence).toBe(0.8);
    expect(pack?.causes).toEqual({ THEFT: { autoApproveCap: 300, requiredEvidence: ["POLICE_REPORT"] } });
    expect(toPack("phone", undefined)).toBeUndefined();
  });
  it("toPolicy never throws on an empty item and never treats it as in force", () => {
    const p = toPolicy({});
    expect(p.items).toEqual([]);
    expect(p.effectiveFrom).toBe("9999-12-31");
  });
});
