// Synthetic test data only.
import type { ClaimTypePack, Policy } from "@claims-agent/domain";
import type { Proposal } from "../evaluate.js";
import type { ClaimRecord, EvidenceRecord } from "../types.js";

export const TENANT = "t1";
export const MODEL = "global.anthropic.claude-haiku-4-5-20251001-v1:0";
export const IMEI = "356938035643809";

export const policy: Policy = {
  policyId: "POL-001",
  version: 1,
  customerId: "cust-1",
  holderName: "Alex Demo",
  startDate: "2026-01-01",
  effectiveFrom: "2026-01-01",
  deductible: 50,
  items: [
    { itemId: "ITEM-PHONE-1", category: "phone", label: "Phone", imei: IMEI },
    { itemId: "ITEM-LAPTOP-1", category: "laptop", label: "Laptop" },
  ],
  coverage: { phone: { causes: ["ACCIDENTAL_DAMAGE", "THEFT"], limit: 1000 } },
};

export const pack: ClaimTypePack = {
  category: "phone",
  version: 1,
  causes: {
    ACCIDENTAL_DAMAGE: { autoApproveCap: 500, requiredEvidence: ["DEVICE_PHOTO"] },
    THEFT: { autoApproveCap: 300, requiredEvidence: ["POLICE_REPORT"] },
  },
  identifierFields: ["imei"],
  typicalValue: 800,
  minConfidence: 0.8,
};

export function claim(over: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    tenantId: TENANT,
    claimId: "CLM-2001",
    customerId: "cust-1",
    policyId: "POL-001",
    itemId: "ITEM-PHONE-1",
    cause: "ACCIDENTAL_DAMAGE",
    amountClaimed: 180,
    lossDate: "2026-11-18",
    evidenceIds: ["EVD-1"],
    status: "PROCESSING",
    createdAt: "2026-11-21T10:00:00.000Z",
    ...over,
  };
}

export const photo: EvidenceRecord = {
  evidenceId: "EVD-1",
  claimId: "CLM-2001",
  kind: "DEVICE_PHOTO",
  sha256: "sha-aaa",
  phash: "phash-bbb",
  identifier: IMEI,
  exifDate: "2026-11-18",
};

/** A valid, clean proposal for the default claim. */
export function proposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Proposal & { customerText: string } = {
    claimId: "CLM-2001",
    extracted: {
      itemCategory: "phone",
      cause: "ACCIDENTAL_DAMAGE",
      amount: 180,
      lossDate: "2026-11-18",
      identifiers: { imei: IMEI },
    },
    evidenceAssessment: [{ evidenceId: "EVD-1", showsClaimedItem: true, confidence: 0.93 }],
    customerText: "Your claim looks complete and is being checked against your policy.",
    model: MODEL,
    promptVersion: "v1",
  };
  return { ...base, ...over };
}
