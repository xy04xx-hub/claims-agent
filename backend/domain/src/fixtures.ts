// Test fixtures only. Synthetic data.
import type { Facts } from "./decide.js";
import type { ClaimTypePack, Policy, Thresholds } from "./types.js";

export const thresholds: Thresholds = { earlyClaimDays: 14, outlierMultiplier: 2, maxClaimsInWindow: 3 };

export const policyV1: Policy = {
  policyId: "POL-001",
  version: 1,
  customerId: "cust-1",
  holderName: "Alex Demo",
  startDate: "2026-01-01",
  effectiveFrom: "2026-01-01",
  deductible: 50,
  items: [
    { itemId: "ITEM-PHONE-1", category: "phone", label: "Phone", imei: "356938035643809" },
    { itemId: "ITEM-CAR-1", category: "car", label: "Car", plate: "DEMO123" },
    { itemId: "ITEM-LAPTOP-1", category: "laptop", label: "Laptop" },
  ],
  coverage: {
    phone: { causes: ["ACCIDENTAL_DAMAGE", "THEFT", "LOSS"], limit: 1000 },
    car: { causes: ["WINDSCREEN", "COLLISION", "INJURY"], limit: 5000 },
  },
};

/** v2 removes THEFT for phones, to show versioning. */
export const policyV2: Policy = {
  ...policyV1,
  version: 2,
  effectiveFrom: "2026-11-01",
  coverage: { ...policyV1.coverage, phone: { causes: ["ACCIDENTAL_DAMAGE", "LOSS"], limit: 1000 } },
};
// v1 ends the day before v2 starts
export const policyV1Closed: Policy = { ...policyV1, effectiveTo: "2026-10-31" };

export const phonePack: ClaimTypePack = {
  category: "phone",
  version: 1,
  causes: {
    ACCIDENTAL_DAMAGE: { autoApproveCap: 500, requiredEvidence: ["DEVICE_PHOTO"] },
    THEFT: { autoApproveCap: 300, requiredEvidence: ["POLICE_REPORT"] },
    LOSS: { autoApproveCap: 0, requiredEvidence: ["STATEMENT"] },
  },
  identifierFields: ["imei"],
  typicalValue: 800,
  minConfidence: 0.8,
};

export const carPack: ClaimTypePack = {
  category: "car",
  version: 1,
  causes: {
    WINDSCREEN: { autoApproveCap: 250, requiredEvidence: ["PLATE_PHOTO"] },
    COLLISION: { autoApproveCap: 0, requiredEvidence: ["POLICE_REPORT"] },
    INJURY: { autoApproveCap: 0, requiredEvidence: ["POLICE_REPORT"] },
  },
  identifierFields: ["plate"],
  typicalValue: 6000,
  minConfidence: 0.8,
};

/** Scenario A: clean phone accidental damage, 180 claimed, 130 payout. */
export function cleanFacts(over: Partial<Facts> = {}): Facts {
  return {
    claimId: "CLM-2001",
    amount: 180,
    lossDate: "2026-11-18",
    claimedCause: "ACCIDENTAL_DAMAGE",
    proposalCause: "ACCIDENTAL_DAMAGE",
    policy: policyV1,
    item: policyV1.items[0],
    evidence: { provided: ["DEVICE_PHOTO"], consistent: true, confidence: 0.93 },
    signalInputs: {
      filingDate: "2026-11-21",
      recentClaimCount: 0,
      duplicateMatches: [],
      identifierReuse: [],
      evidenceDates: [{ source: "EXIF", date: "2026-11-18" }],
      lookupFailed: false,
    },
    ...over,
  };
}
