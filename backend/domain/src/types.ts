// Pure domain types. No AWS imports. Shapes match contracts/*.schema.json.

export const CAUSES = [
  "ACCIDENTAL_DAMAGE", "THEFT", "LOSS", "WINDSCREEN", "COSMETIC",
  "COLLISION", "INJURY", "THIRD_PARTY", "TOTAL_LOSS", "UNCLEAR",
] as const;
export type Cause = (typeof CAUSES)[number];

export type EvidenceKind = "DEVICE_PHOTO" | "POLICE_REPORT" | "PLATE_PHOTO" | "STATEMENT";
export type InformationalFlag = "DOC_AUTHENTICITY_UNVERIFIED" | "EXIF_MISSING";

/** Dates are ISO calendar dates, YYYY-MM-DD. */
export interface PolicyItem {
  itemId: string;
  category: string;
  label: string;
  imei?: string;
  vin?: string;
  plate?: string;
}

export interface Policy {
  policyId: string;
  version: number;
  customerId: string;
  holderName: string;
  startDate: string;
  effectiveFrom: string;
  effectiveTo?: string;
  deductible: number;
  items: PolicyItem[];
  /** category -> covered causes and the limit on the payout after deductible */
  coverage: Record<string, { causes: Cause[]; limit: number }>;
}

export interface CausePack {
  /** Net payout cap for auto-approval. 0 means always route. */
  autoApproveCap: number;
  requiredEvidence: EvidenceKind[];
}

export interface ClaimTypePack {
  category: string;
  version: number;
  causes: Partial<Record<Cause, CausePack>>;
  identifierFields: string[];
  typicalValue: number;
  /** Minimum model/extraction confidence for evidence to count as consistent. */
  minConfidence: number;
}

export interface Thresholds {
  earlyClaimDays: number;
  outlierMultiplier: number;
  /** More than this many recent claims is a risk signal. */
  maxClaimsInWindow: number;
}

export interface Failure {
  code: string;
  /** Adjuster text. May name other claims. */
  detail: string;
  /** Customer-safe text. Never names other claims or accuses. */
  customer: string;
}

export interface RiskSignal {
  code:
    | "DUPLICATE_PHOTO" | "IDENTIFIER_REUSE" | "EARLY_CLAIM" | "AMOUNT_OUTLIER"
    | "CLAIM_FREQUENCY" | "TIMELINE_INCONSISTENT" | "UNABLE_TO_VERIFY";
  detail: string;
  relatedClaimId?: string;
}

export interface Decision {
  claimId: string;
  outcome: "AUTO_APPROVED" | "ROUTED_TO_ADJUSTER";
  checksPassed: string[];
  checksFailed: { code: string; detail: string }[];
  riskSignals: RiskSignal[];
  informationalFlags: InformationalFlag[];
  reasons: { customer: string; adjuster: string[] };
  payout: number;
  failSafe?: boolean;
}
