import { computePayout, checkCoverage } from "./policy.js";
import { evaluateSignals, type SignalInputs } from "./signals.js";
import type {
  ClaimTypePack, Cause, Decision, EvidenceKind, Failure, InformationalFlag, Policy, PolicyItem, Thresholds,
} from "./types.js";

export interface Facts {
  claimId: string;
  amount: number;
  lossDate: string;
  /** Cause chosen by the customer from the fixed list. */
  claimedCause: Cause;
  /** Cause the model mapped from the text. Only used to detect UNCLEAR or a mismatch. */
  proposalCause: Cause;
  /** Policy version in force on the loss date, if any. */
  policy?: Policy;
  item?: PolicyItem;
  evidence: {
    provided: EvidenceKind[];
    /** From verify_evidence: identifiers, name and dates match the policy. */
    consistent: boolean;
    confidence: number;
    mismatchDetail?: string;
  };
  signalInputs: Omit<SignalInputs, "amount" | "lossDate" | "policyStartDate" | "typicalValue">;
  flags?: InformationalFlag[];
}

const REVIEW = "Your claim needs a quick review by our team.";

/**
 * The only place an approval is decided. The model's proposal can only add
 * reasons to route (UNCLEAR, cause mismatch). It can never add an approval.
 */
export function decide(facts: Facts, pack: ClaimTypePack, thresholds: Thresholds, killSwitch: boolean): Decision {
  const passed: string[] = [];
  const failed: Failure[] = [];
  const check = (code: string, ok: boolean, f: Omit<Failure, "code">) =>
    ok ? passed.push(code) : failed.push({ code, ...f });

  check("AUTO_APPROVE_ENABLED", killSwitch, {
    detail: "Auto-approval is switched off (kill switch).",
    customer: REVIEW,
  });

  const { policy, item } = facts;
  if (!policy) {
    failed.push({
      code: "POLICY_IN_FORCE",
      detail: `No policy version in force on ${facts.lossDate}.`,
      customer: "We could not find a policy in force on the date of the loss, so a person will review your claim.",
    });
  } else {
    const cov = checkCoverage(policy, item, facts.claimedCause, facts.lossDate);
    passed.push(...cov.passed);
    failed.push(...cov.failed);
  }

  check("CAUSE_CLEAR", facts.proposalCause !== "UNCLEAR" && facts.proposalCause === facts.claimedCause, {
    detail: `Cause could not be confirmed: claimed '${facts.claimedCause}', model read '${facts.proposalCause}'.`,
    customer: "We could not confirm the reason for the claim from your description, so a person will review it.",
  });

  const causePack = pack.causes[facts.claimedCause];
  const required = causePack?.requiredEvidence ?? [];
  const missing = required.filter((k) => !facts.evidence.provided.includes(k));
  check("REQUIRED_EVIDENCE_PRESENT", missing.length === 0, {
    detail: `Missing required evidence: ${missing.join(", ")}.`,
    customer: "Some required evidence is missing, so a person will review your claim.",
  });

  const evidenceOk = facts.evidence.consistent && facts.evidence.confidence >= pack.minConfidence;
  check("EVIDENCE_MATCHES_POLICY", evidenceOk, {
    detail:
      facts.evidence.mismatchDetail ??
      `Evidence does not match the policy or confidence ${facts.evidence.confidence} is below ${pack.minConfidence}.`,
    customer: "We could not match your evidence to your policy details, so a person will review your claim.",
  });

  const deductible = policy?.deductible ?? 0;
  const limit = (policy && item && policy.coverage[item.category]?.limit) || 0;
  const { payout: net, withinLimit } = computePayout(facts.amount, deductible, limit);
  check("PAYABLE_AMOUNT", net > 0, {
    detail: `Claim amount ${facts.amount} does not exceed the deductible ${deductible}.`,
    customer: "The claim amount does not exceed your deductible, so a person will review it.",
  });
  check("WITHIN_LIMIT", withinLimit, {
    detail: `Payout ${net} is above the category limit ${limit}.`,
    customer: "The amount is above the limit that can be paid automatically, so a person will review it.",
  });
  const cap = causePack?.autoApproveCap ?? 0;
  check("UNDER_CAP", cap > 0 && net <= cap, {
    detail: cap > 0 ? `Payout ${net} is above the auto-approve cap ${cap}.` : `Cause '${facts.claimedCause}' is always reviewed (cap 0).`,
    customer: "This type of claim is reviewed by a person.",
  });

  const riskSignals = evaluateSignals(
    {
      ...facts.signalInputs,
      amount: facts.amount,
      lossDate: facts.lossDate,
      policyStartDate: policy?.startDate,
      typicalValue: pack.typicalValue,
    },
    thresholds,
  );
  check("NO_RISK_SIGNALS", riskSignals.length === 0, {
    detail: riskSignals.map((s) => s.detail).join(" "),
    customer: REVIEW,
  });

  const flags = new Set<InformationalFlag>(facts.flags ?? []);
  if (facts.evidence.provided.includes("POLICE_REPORT")) flags.add("DOC_AUTHENTICITY_UNVERIFIED");

  const approved = failed.length === 0 && riskSignals.length === 0;
  const base = {
    claimId: facts.claimId,
    checksPassed: passed,
    checksFailed: failed.map(({ code, detail }) => ({ code, detail })),
    riskSignals,
    informationalFlags: [...flags],
  };
  if (approved) {
    return {
      ...base,
      outcome: "AUTO_APPROVED",
      payout: net,
      reasons: {
        customer: `Your claim was approved. Payout ${net.toFixed(2)} after the ${deductible.toFixed(2)} deductible.`,
        adjuster: [],
      },
    };
  }
  const customer = [...new Set(failed.map((f) => f.customer))];
  if (customer.length === 0) customer.push(REVIEW);
  return {
    ...base,
    outcome: "ROUTED_TO_ADJUSTER",
    payout: 0,
    reasons: {
      customer: customer.join(" ").slice(0, 500),
      adjuster: [
        ...failed.filter((f) => f.code !== "NO_RISK_SIGNALS").map((f) => f.detail),
        ...riskSignals.map((x) => x.detail),
      ],
    },
  };
}
