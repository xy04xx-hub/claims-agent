// Owner: A. Demo scenarios A to H and their variants, as defined by backend/domain/src/decide.test.ts.
// The seed writes the evidence rows of these claims. The runner writes only the PROCESSING claim rows.
import type { Cause, EvidenceKind } from "@claims-agent/domain";
import {
  CUSTOMER_ID, IMEI_MISMATCH, IMEI_PHONE_1, IMEI_PHONE_2, ITEM_CAR_1, ITEM_LAPTOP_1, ITEM_PHONE_1, ITEM_PHONE_2,
  PLATE_CAR_1, POLICY_ID, SCENARIO_LOSS_DATE,
} from "./constants.js";

export interface Scenario {
  id: string;
  claimId: string;
  evidenceId: string;
  itemId: string;
  itemCategory: string;
  cause: Cause;
  amount: number;
  evidenceKind: EvidenceKind;
  /** Scenario D reuses the SHA-256 and pHash of the CLM-1042 photo. All others get hashes unique to the scenario. */
  reusesClm1042Photo?: boolean;
  /** What the evidence shows, as the model would read it. Omitted when the evidence shows no identifier. */
  identifiers?: { imei?: string; plate?: string };
  expected: { outcome: "AUTO_APPROVED" | "ROUTED_TO_ADJUSTER"; payout: number; adjusterIncludes: string[] };
}

const s = (
  id: string, itemId: string, itemCategory: string, cause: Cause, amount: number, evidenceKind: EvidenceKind,
  identifiers: Scenario["identifiers"], expected: Scenario["expected"], extra: Partial<Scenario> = {},
): Scenario => ({
  id, claimId: `CLM-SCN-${id}`, evidenceId: `EVD-SCN-${id}-1`, itemId, itemCategory, cause, amount, evidenceKind,
  identifiers, expected, ...extra,
});

const APPROVED = (payout: number) => ({ outcome: "AUTO_APPROVED" as const, payout, adjusterIncludes: [] });
const ROUTED = (...adjusterIncludes: string[]) => ({ outcome: "ROUTED_TO_ADJUSTER" as const, payout: 0, adjusterIncludes });

export const SCENARIOS: Scenario[] = [
  s("A", ITEM_PHONE_1, "phone", "ACCIDENTAL_DAMAGE", 180, "DEVICE_PHOTO", { imei: IMEI_PHONE_1 }, APPROVED(130)),
  s("B", ITEM_PHONE_1, "phone", "THEFT", 300, "POLICE_REPORT", { imei: IMEI_PHONE_1 }, APPROVED(250)),
  s("B2", ITEM_PHONE_1, "phone", "THEFT", 400, "POLICE_REPORT", { imei: IMEI_PHONE_1 }, ROUTED("Payout 350 is above the auto-approve cap 300.")),
  s("C", ITEM_CAR_1, "car", "COLLISION", 150, "POLICE_REPORT", { plate: PLATE_CAR_1 }, ROUTED("always reviewed (cap 0)")),
  s("CI", ITEM_CAR_1, "car", "INJURY", 150, "POLICE_REPORT", { plate: PLATE_CAR_1 }, ROUTED("always reviewed (cap 0)")),
  s("C2", ITEM_CAR_1, "car", "WINDSCREEN", 200, "PLATE_PHOTO", { plate: PLATE_CAR_1 }, APPROVED(150)),
  s("D", ITEM_PHONE_1, "phone", "ACCIDENTAL_DAMAGE", 180, "DEVICE_PHOTO", { imei: IMEI_PHONE_1 }, ROUTED("CLM-1042"), { reusesClm1042Photo: true }),
  s("E", ITEM_LAPTOP_1, "laptop", "THEFT", 300, "POLICE_REPORT", undefined, ROUTED("Item category 'laptop' is not covered by policy POL-001.")),
  s("E2", ITEM_PHONE_1, "phone", "LOSS", 300, "STATEMENT", { imei: IMEI_PHONE_1 }, ROUTED("Cause 'LOSS' is not covered for 'phone' under POL-001 v2.")),
  s("F", ITEM_PHONE_1, "phone", "ACCIDENTAL_DAMAGE", 700, "DEVICE_PHOTO", { imei: IMEI_PHONE_1 }, ROUTED("Payout 650 is above the auto-approve cap 500.")),
  s("G", ITEM_PHONE_1, "phone", "THEFT", 300, "POLICE_REPORT", { imei: IMEI_MISMATCH }, ROUTED("does not match the insured imei")),
  s("H", ITEM_PHONE_2, "phone", "THEFT", 300, "POLICE_REPORT", { imei: IMEI_PHONE_2 }, ROUTED("CLM-1042", "already claimed")),
];

export const SCENARIO_POLICY_ID = POLICY_ID;
export const SCENARIO_CUSTOMER_ID = CUSTOMER_ID;
export const SCENARIO_LOSS = SCENARIO_LOSS_DATE;

/** A proposal for a scenario, conforming to contracts/proposal.schema.json. */
export function buildProposal(scn: Scenario): Record<string, unknown> {
  return {
    claimId: scn.claimId,
    extracted: {
      itemCategory: scn.itemCategory,
      cause: scn.cause,
      amount: scn.amount,
      lossDate: SCENARIO_LOSS_DATE,
      ...(scn.identifiers ? { identifiers: scn.identifiers } : {}),
    },
    evidenceAssessment: [{ evidenceId: scn.evidenceId, showsClaimedItem: true, confidence: 0.93 }],
    customerText: `Synthetic scenario ${scn.id}.`,
    model: "seed-scenario-runner",
    promptVersion: "seed-1",
  };
}
