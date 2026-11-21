// Owner: A. The prior claim CLM-1042 on ITEM-PHONE-2. Its decision is computed by domain.decide, so it always fits the contract.
import { decide, type Decision, type Facts } from "@claims-agent/domain";
import {
  CLM_1042, CLM_1042_LOSS_DATE, EVD_1042_1, ITEM_PHONE_2,
} from "./constants.js";
import { PHONE_PACK } from "./packs.js";
import { POLICY_V1 } from "./policies.js";

export const CLM_1042_AMOUNT = 180;
export const CLM_1042_CAUSE = "ACCIDENTAL_DAMAGE" as const;

export function clm1042Decision(): Decision {
  const item = POLICY_V1.items.find((i) => i.itemId === ITEM_PHONE_2);
  const facts: Facts = {
    claimId: CLM_1042,
    amount: CLM_1042_AMOUNT,
    lossDate: CLM_1042_LOSS_DATE,
    claimedCause: CLM_1042_CAUSE,
    proposalCause: CLM_1042_CAUSE,
    policy: POLICY_V1,
    item,
    evidence: { provided: ["DEVICE_PHOTO"], consistent: true, confidence: 0.93 },
    signalInputs: {
      filingDate: "2026-10-14",
      recentClaimCount: 0,
      duplicateMatches: [],
      identifierReuse: [],
      evidenceDates: [{ source: "EXIF", date: CLM_1042_LOSS_DATE }],
      lookupFailed: false,
    },
  };
  const d = decide(facts, PHONE_PACK, { earlyClaimDays: 14, outlierMultiplier: 2, maxClaimsInWindow: 3 }, true);
  if (d.outcome !== "AUTO_APPROVED") throw new Error(`CLM-1042 must be approved by the domain rules: ${d.reasons.adjuster.join(" ")}`);
  void EVD_1042_1;
  return d;
}
