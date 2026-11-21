// Owner: A. POL-001 in two versions. v2 drops phone LOSS, to show that a policy change applies with no redeploy.
// Phone THEFT stays covered in both versions so live theft claims with a current loss date work.
import type { Policy, PolicyItem } from "@claims-agent/domain";
import {
  CUSTOMER_ID, DEDUCTIBLE, HOLDER_NAME, IMEI_PHONE_1, IMEI_PHONE_2, ITEM_CAR_1, ITEM_LAPTOP_1, ITEM_PHONE_1,
  ITEM_PHONE_2, PLATE_CAR_1, POLICY_ID, POLICY_START_DATE, V1_EFFECTIVE_FROM, V1_EFFECTIVE_TO, V2_EFFECTIVE_FROM,
} from "./constants.js";

/** The first three items equal those of backend/domain/src/fixtures.ts. ITEM-PHONE-2 is appended. */
export const POLICY_ITEMS: PolicyItem[] = [
  { itemId: ITEM_PHONE_1, category: "phone", label: "Phone", imei: IMEI_PHONE_1 },
  { itemId: ITEM_CAR_1, category: "car", label: "Car", plate: PLATE_CAR_1 },
  { itemId: ITEM_LAPTOP_1, category: "laptop", label: "Laptop" },
  { itemId: ITEM_PHONE_2, category: "phone", label: "Phone", imei: IMEI_PHONE_2 },
];

const car = { causes: ["WINDSCREEN", "COLLISION", "INJURY"], limit: 5000 } as const;

export const POLICY_V1: Policy = {
  policyId: POLICY_ID,
  version: 1,
  customerId: CUSTOMER_ID,
  holderName: HOLDER_NAME,
  startDate: POLICY_START_DATE,
  effectiveFrom: V1_EFFECTIVE_FROM,
  effectiveTo: V1_EFFECTIVE_TO,
  deductible: DEDUCTIBLE,
  items: POLICY_ITEMS.map((i) => ({ ...i })),
  // No `laptop` entry on purpose: the laptop is the not-covered case.
  coverage: {
    phone: { causes: ["ACCIDENTAL_DAMAGE", "THEFT", "LOSS"], limit: 1000 },
    car: { causes: [...car.causes], limit: car.limit },
  },
};

export const POLICY_V2: Policy = {
  policyId: POLICY_ID,
  version: 2,
  customerId: CUSTOMER_ID,
  holderName: HOLDER_NAME,
  startDate: POLICY_START_DATE,
  effectiveFrom: V2_EFFECTIVE_FROM,
  deductible: DEDUCTIBLE,
  items: POLICY_ITEMS.map((i) => ({ ...i })),
  coverage: {
    phone: { causes: ["ACCIDENTAL_DAMAGE", "THEFT"], limit: 1000 },
    car: { causes: [...car.causes], limit: car.limit },
  },
};

export const POLICIES: Policy[] = [POLICY_V1, POLICY_V2];
