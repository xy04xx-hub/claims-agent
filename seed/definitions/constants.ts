// Owner: A. Fixed identities, identifiers and dates of the synthetic seed. All values are synthetic.
// T-06 (B) may import TENANT_ID and CUSTOMER_ID so the seeded Cognito user matches the seeded data.

export const TENANT_ID = process.env.SEED_TENANT_ID ?? "demo-insurer";
export const CUSTOMER_ID = process.env.SEED_CUSTOMER_ID ?? "cust-demo";
export const POLICY_ID = "POL-001";
export const HOLDER_NAME = "Alex Demo";

export const ITEM_PHONE_1 = "ITEM-PHONE-1";
export const ITEM_CAR_1 = "ITEM-CAR-1";
export const ITEM_LAPTOP_1 = "ITEM-LAPTOP-1";
export const ITEM_PHONE_2 = "ITEM-PHONE-2";

/** Synthetic, Luhn-valid IMEIs. None belongs to a real device. */
export const IMEI_PHONE_1 = "356938035643809";
export const IMEI_PHONE_2 = "867530900000017";
/** Shown by the mismatching police report. Belongs to no policy item. */
export const IMEI_MISMATCH = "356938035649996";
export const PLATE_CAR_1 = "DEMO123";

/** Inside policy v2 (effectiveFrom 2026-11-01, open ended). Every scenario uses it. */
export const SCENARIO_LOSS_DATE = "2026-11-15";
export const V1_EFFECTIVE_FROM = "2026-01-01";
export const V1_EFFECTIVE_TO = "2026-10-31";
export const V2_EFFECTIVE_FROM = "2026-11-01";
export const POLICY_START_DATE = "2026-01-01";
export const DEDUCTIBLE = 50;

export const CLM_1042 = "CLM-1042";
export const EVD_1042_1 = "EVD-1042-1";
export const CLM_1042_LOSS_DATE = "2026-10-12";
export const CLM_1042_CREATED_AT = "2026-10-14T09:30:00.000Z";
export const CLM_1042_DECIDED_AT = "2026-10-14T09:30:04.000Z";
/** Fixed, so a re-run writes identical items. */
export const SEED_CREATED_AT = "2026-10-14T09:30:00.000Z";

/** S3 key of the CLM-1042 photo: tenantId/customerId/evidenceId. */
export const CLM_1042_S3_KEY = `${TENANT_ID}/${CUSTOMER_ID}/${EVD_1042_1}`;
