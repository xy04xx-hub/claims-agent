// Builds domain.Facts from the system of record and calls domain.decide.
// The proposal is read only for extracted fields. Nothing in it can add an approval.
import {
  CAUSES, decide as domainDecide, selectPolicyVersion,
  type Cause, type ClaimTypePack, type Decision, type EvidenceKind, type Facts, type InformationalFlag,
  type Policy, type PolicyItem, type Thresholds,
} from "@claims-agent/domain";
import { UNASSIGNED_CLAIM_ID } from "./keys.js";
import type { ClaimRecord, Deps, EvidenceRecord } from "./types.js";

export interface Proposal {
  claimId: string;
  extracted: {
    itemCategory: string;
    cause: Cause;
    amount: number;
    lossDate: string;
    identifiers?: { imei?: string; vin?: string; plate?: string; reportNumber?: string };
  };
  evidenceAssessment: { evidenceId: string; showsClaimedItem: boolean; confidence: number }[];
  model: string;
  promptVersion?: string;
}

export interface Evaluation {
  decision: Decision;
  policyId: string;
  policyVersion: number;
  packVersion: number;
  thresholds: Record<string, number | boolean | string>;
  model?: string;
  promptVersion?: string;
}

const REVIEW_CUSTOMER = "Your claim needs a quick review by our team.";

/** A routed decision for a failure found before domain.decide can run. */
export function routedDecision(
  claimId: string,
  code: string,
  detail: string,
  customer: string = REVIEW_CUSTOMER,
  failSafe = false,
): Decision {
  return {
    claimId,
    outcome: "ROUTED_TO_ADJUSTER",
    checksPassed: [],
    checksFailed: [{ code, detail }],
    riskSignals: [],
    informationalFlags: [],
    reasons: { customer, adjuster: [detail] },
    payout: 0,
    ...(failSafe ? { failSafe: true } : {}),
  };
}

export function failSafeDecision(claimId: string): Decision {
  return routedDecision(
    claimId,
    "AUTOMATIC_CHECK_UNAVAILABLE",
    "Automatic check unavailable. The claim was routed so a person can review it.",
    "We could not complete the automatic check, so a person will review your claim.",
    true,
  );
}

const normId = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();
const tail = (s: string) => `…${s.slice(-4)}`;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const DAY_MS = 86_400_000;

function fallback(claim: ClaimRecord, policy: Policy | undefined, pack: ClaimTypePack | undefined, thresholds: Evaluation["thresholds"], d: Decision): Evaluation {
  return {
    decision: d,
    policyId: claim.policyId,
    policyVersion: Math.max(1, policy?.version ?? claim.policyVersion ?? 1),
    packVersion: Math.max(1, pack?.version ?? 1),
    thresholds,
  };
}

/** Compares what the evidence shows (the model's reading) with the insured item. Returns a mismatch reason or undefined. */
function evidenceMismatch(item: PolicyItem, pack: ClaimTypePack, proposal: Proposal, claim: ClaimRecord): string | undefined {
  if (proposal.extracted.itemCategory.trim().toLowerCase() !== item.category.toLowerCase()) {
    return `Evidence shows item category '${proposal.extracted.itemCategory}', policy item is '${item.category}'.`;
  }
  for (const field of pack.identifierFields) {
    const insured = (item as unknown as Record<string, string | undefined>)[field];
    const seen = (proposal.extracted.identifiers as Record<string, string | undefined> | undefined)?.[field];
    if (!insured) return `The policy has no '${field}' on record for this item, so the evidence cannot be verified.`;
    if (!seen) return `The evidence does not show a '${field}'.`;
    if (normId(insured) !== normId(seen)) {
      return `Evidence ${field} ${tail(seen)} does not match the insured ${field} ${tail(insured)}.`;
    }
  }
  for (const id of claim.evidenceIds) {
    const a = proposal.evidenceAssessment.find((x) => x.evidenceId === id);
    if (!a) return `No assessment was returned for evidence ${id}.`;
    if (!a.showsClaimedItem) return `Evidence ${id} does not show the claimed item.`;
  }
  return undefined;
}

async function gatherSignals(
  deps: Deps, claim: ClaimRecord, pack: ClaimTypePack, proposal: Proposal, evidence: EvidenceRecord[],
): Promise<Facts["signalInputs"]> {
  const { store } = deps;
  const t = claim.tenantId;
  const duplicateMatches: Facts["signalInputs"]["duplicateMatches"] = [];
  const identifierReuse: Facts["signalInputs"]["identifierReuse"] = [];
  let recentClaimCount = 0;
  let lookupFailed = false;

  const identifiers = new Set<string>();
  for (const e of evidence) if (e.identifier) identifiers.add(normId(e.identifier));
  for (const v of Object.values(proposal.extracted.identifiers ?? {})) if (v) identifiers.add(normId(v));

  const since = new Date(deps.now().getTime() - deps.config.frequencyWindowDays * DAY_MS).toISOString();
  try {
    await Promise.all([
      ...evidence.flatMap((e) => [
        e.sha256
          ? store.findOtherClaims(t, "SHA256", e.sha256, claim.claimId).then((ids) =>
              ids.forEach((claimId) => duplicateMatches.push({ claimId, match: "EXACT" })))
          : undefined,
        // MVP: an equal pHash counts as a near duplicate. Hamming-distance search is a T-13 decision.
        e.phash
          ? store.findOtherClaims(t, "PHASH", e.phash, claim.claimId).then((ids) =>
              ids.forEach((claimId) => duplicateMatches.push({ claimId, match: "NEAR" })))
          : undefined,
      ]),
      ...[...identifiers].map((identifier) =>
        store.findOtherClaims(t, "IDENTIFIER", identifier, claim.claimId).then((ids) =>
          ids.forEach((claimId) => identifierReuse.push({ identifier, claimId })))),
      store.countRecentClaims(t, claim.customerId, since, claim.claimId).then((n) => { recentClaimCount = n; }),
    ]);
  } catch (err) {
    lookupFailed = true;
    deps.log.warn("signal lookup failed", { claimId: claim.claimId, error: err instanceof Error ? err.name : "unknown" });
  }

  const evidenceDates: Facts["signalInputs"]["evidenceDates"] = [];
  for (const e of evidence) if (e.exifDate) evidenceDates.push({ source: "EXIF", date: e.exifDate });
  const needsReport = pack.causes[claim.cause as Cause]?.requiredEvidence.includes("POLICE_REPORT");
  if (needsReport && isDate(proposal.extracted.lossDate)) {
    evidenceDates.push({ source: "INCIDENT", date: proposal.extracted.lossDate });
  }

  return {
    filingDate: isDate(claim.createdAt.slice(0, 10)) ? claim.createdAt.slice(0, 10) : deps.now().toISOString().slice(0, 10),
    recentClaimCount,
    duplicateMatches,
    identifierReuse,
    evidenceDates,
    lookupFailed,
  };
}

/** Throws only on store errors that the caller turns into a fail-safe route. */
export async function evaluate(deps: Deps, claim: ClaimRecord, proposal: Proposal): Promise<Evaluation> {
  const { store, config } = deps;
  const t = claim.tenantId;
  const autoApproveEnabled = await deps.killSwitch.isEnabled();
  const base: Evaluation["thresholds"] = {
    autoApproveEnabled,
    earlyClaimDays: config.earlyClaimDays,
    outlierMultiplier: config.outlierMultiplier,
    maxClaimsInWindow: config.frequencyMaxClaims,
    frequencyWindowDays: config.frequencyWindowDays,
  };

  const policy = selectPolicyVersion(await store.getPolicyVersions(t, claim.policyId), claim.lossDate);
  if (!policy) {
    return fallback(claim, undefined, undefined, base, routedDecision(
      claim.claimId, "POLICY_IN_FORCE", `No policy version in force on ${claim.lossDate || "an unknown date"}.`,
      "We could not find a policy in force on the date of the loss, so a person will review your claim."));
  }
  const item = policy.items.find((i) => i.itemId === claim.itemId);
  if (!item) {
    return fallback(claim, policy, undefined, base, routedDecision(
      claim.claimId, "ITEM_ON_POLICY", `Item is not listed on policy ${policy.policyId} v${policy.version}.`,
      "We could not find this item on your policy, so a person will review your claim."));
  }
  const pack = await store.getPack(t, item.category);
  if (!pack) {
    return fallback(claim, policy, undefined, base, routedDecision(
      claim.claimId, "PACK_FOUND", `No claim type pack for category '${item.category}'.`));
  }

  const claimedCause: Cause = (CAUSES as readonly string[]).includes(claim.cause) ? (claim.cause as Cause) : "UNCLEAR";
  const evidence = await store.getEvidence(t, claim.evidenceIds);
  // Rows the Evidence Processor wrote before the claim existed carry UNASSIGNED. They count only if the claim lists them.
  const own = evidence.filter(
    (e) =>
      !e.claimId ||
      e.claimId === claim.claimId ||
      (e.claimId === UNASSIGNED_CLAIM_ID && claim.evidenceIds.includes(e.evidenceId)),
  );
  const provided = [...new Set(own.map((e) => e.kind).filter((k): k is EvidenceKind => k !== undefined))];

  const mismatch = evidenceMismatch(item, pack, proposal, claim);
  const assessed = claim.evidenceIds.map((id) => proposal.evidenceAssessment.find((a) => a.evidenceId === id)?.confidence ?? 0);
  const confidence = assessed.length > 0 ? Math.min(...assessed) : 0;

  const flags: InformationalFlag[] = [];
  if (own.some((e) => (e.kind === "DEVICE_PHOTO" || e.kind === "PLATE_PHOTO") && !e.exifDate)) flags.push("EXIF_MISSING");

  const facts: Facts = {
    claimId: claim.claimId,
    amount: claim.amountClaimed,
    lossDate: claim.lossDate,
    claimedCause,
    proposalCause: proposal.extracted.cause,
    policy,
    item,
    evidence: { provided, consistent: mismatch === undefined, confidence, mismatchDetail: mismatch },
    signalInputs: await gatherSignals(deps, claim, pack, proposal, own),
    flags,
  };
  const thresholds: Thresholds = {
    earlyClaimDays: config.earlyClaimDays,
    outlierMultiplier: config.outlierMultiplier,
    maxClaimsInWindow: config.frequencyMaxClaims,
  };
  const decision = domainDecide(facts, pack, thresholds, autoApproveEnabled);
  return {
    decision,
    policyId: policy.policyId,
    policyVersion: policy.version,
    packVersion: pack.version,
    thresholds: { ...base, minConfidence: pack.minConfidence, autoApproveCap: pack.causes[claimedCause]?.autoApproveCap ?? 0 },
  };
}
