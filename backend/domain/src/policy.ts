import type { Cause, Failure, Policy, PolicyItem } from "./types.js";

/** The version in force on the loss date: latest version whose range contains it. */
export function selectPolicyVersion(versions: Policy[], lossDate: string): Policy | undefined {
  return versions
    .filter((p) => p.effectiveFrom <= lossDate && (!p.effectiveTo || lossDate <= p.effectiveTo))
    .sort((a, b) => b.version - a.version)[0];
}

export interface CoverageResult {
  covered: boolean;
  passed: string[];
  failed: Failure[];
}

export function checkCoverage(
  policy: Policy,
  item: PolicyItem | undefined,
  cause: Cause,
  lossDate: string,
): CoverageResult {
  const passed: string[] = [];
  const failed: Failure[] = [];
  const ref = `${policy.policyId} v${policy.version}`;

  if (lossDate >= policy.startDate && lossDate >= policy.effectiveFrom && (!policy.effectiveTo || lossDate <= policy.effectiveTo)) {
    passed.push("POLICY_ACTIVE");
  } else {
    failed.push({
      code: "POLICY_ACTIVE",
      detail: `Policy ${ref} was not active on the loss date ${lossDate}.`,
      customer: "Your policy was not active on the date of the loss, so a person will review your claim.",
    });
  }

  const onPolicy = item && policy.items.some((i) => i.itemId === item.itemId);
  if (!item || !onPolicy) {
    failed.push({
      code: "ITEM_ON_POLICY",
      detail: `Item is not listed on policy ${ref}.`,
      customer: "We could not find this item on your policy, so a person will review your claim.",
    });
    return { covered: false, passed, failed };
  }
  passed.push("ITEM_ON_POLICY");

  const cover = policy.coverage[item.category];
  if (!cover) {
    failed.push({
      code: "CATEGORY_COVERED",
      detail: `Item category '${item.category}' is not covered by policy ${policy.policyId}.`,
      customer: `Items of type '${item.category}' are not covered by your policy, so a person will review your claim.`,
    });
    return { covered: false, passed, failed };
  }
  passed.push("CATEGORY_COVERED");

  if (cause !== "UNCLEAR" && cover.causes.includes(cause)) {
    passed.push("CAUSE_COVERED");
  } else {
    failed.push({
      code: "CAUSE_COVERED",
      detail: `Cause '${cause}' is not covered for '${item.category}' under ${ref}.`,
      customer: "The reason for this claim does not appear to be covered by your policy, so a person will review it.",
    });
  }
  return { covered: failed.length === 0, passed, failed };
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Net payout after the deductible, and whether it is within the category limit. */
export function computePayout(amount: number, deductible: number, limit: number) {
  const payout = Math.max(0, cents(amount - deductible));
  return { payout, withinLimit: payout <= limit };
}
