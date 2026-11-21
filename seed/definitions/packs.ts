// Owner: A. Claim type packs. The phone and car packs equal phonePack and carPack of backend/domain/src/fixtures.ts
// (a test checks it). Caps are starting values to tune in shadow mode (architecture.md).
import type { ClaimTypePack } from "@claims-agent/domain";

export const PHONE_PACK: ClaimTypePack = {
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

export const CAR_PACK: ClaimTypePack = {
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

/**
 * The laptop pack exists only so the Decision Lambda reaches the coverage check for the uncovered laptop and reports
 * "not covered by policy" instead of "no claim type pack". Every cap is 0, so nothing in it can approve.
 */
export const LAPTOP_PACK: ClaimTypePack = {
  category: "laptop",
  version: 1,
  causes: {
    ACCIDENTAL_DAMAGE: { autoApproveCap: 0, requiredEvidence: ["DEVICE_PHOTO"] },
    THEFT: { autoApproveCap: 0, requiredEvidence: ["POLICE_REPORT"] },
    LOSS: { autoApproveCap: 0, requiredEvidence: ["STATEMENT"] },
  },
  identifierFields: [],
  typicalValue: 1500,
  minConfidence: 0.8,
};

export const PACKS: ClaimTypePack[] = [PHONE_PACK, CAR_PACK, LAPTOP_PACK];
