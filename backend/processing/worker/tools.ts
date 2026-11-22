// Agent tools for the Worker. In-process, read-only, scoped to one claim by closure.
// The model passes no arguments: tenantId and claimId come from the Worker context, never from the model.
// Results are compact and carry no full identifiers (last 4 characters only). Writes nothing.
import type { Tool, ToolSpecification } from "@aws-sdk/client-bedrock-runtime";
import { selectPolicyVersion, type Cause } from "@claims-agent/domain";
import type { ClaimRecord, EvidenceRecord, Store } from "../decision/types.js";

export const TOOL_NAMES = ["lookup_policy", "check_fraud_signals", "verify_evidence"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Worker context for one job. */
export interface ToolContext {
  tenantId: string;
  claimId: string;
}

export interface ToolDeps {
  /** Read methods only. The Worker role has no write permission either. */
  store: Pick<Store, "getClaim" | "getPolicyVersions" | "getPack" | "getEvidence" | "findOtherClaims" | "countRecentClaims">;
  now: () => Date;
  config: { frequencyWindowDays: number };
}

const DAY_MS = 86_400_000;
const normId = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();
const tail = (s: string | undefined) => (s ? `…${s.slice(-4)}` : undefined);

const EMPTY_INPUT = { json: { type: "object", properties: {}, additionalProperties: false } } as const;

const spec = (name: ToolName, description: string): Tool.ToolSpecMember => ({
  toolSpec: { name, description, inputSchema: EMPTY_INPUT } satisfies ToolSpecification,
});

export const lookupPolicySpec = spec(
  "lookup_policy",
  "Read the policy version in force on the loss date for this claim: item, covered causes, limit, deductible and required evidence for the claimed cause. Takes no arguments.",
);
export const checkFraudSignalsSpec = spec(
  "check_fraud_signals",
  "List other claims that share a photo hash or identifier with this claim, and the customer's recent claim count. Takes no arguments.",
);
export const verifyEvidenceSpec = spec(
  "verify_evidence",
  "For each evidence item of this claim: whether its kind is required for the cause and whether its stored identifier matches the policy item. Takes no arguments.",
);

/** Model-supplied part of contracts/proposal.schema.json. The Worker sets claimId, model, promptVersion and customerText in code. */
export const SUBMIT_PROPOSAL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["extracted", "evidenceAssessment"],
  properties: {
    extracted: {
      type: "object",
      additionalProperties: false,
      required: ["itemCategory", "cause", "amount", "lossDate"],
      properties: {
        itemCategory: { type: "string", maxLength: 40 },
        cause: {
          enum: ["ACCIDENTAL_DAMAGE", "THEFT", "LOSS", "WINDSCREEN", "COSMETIC", "COLLISION", "INJURY", "THIRD_PARTY", "TOTAL_LOSS", "UNCLEAR"],
        },
        amount: { type: "number", minimum: 0 },
        lossDate: { type: "string", format: "date" },
        identifiers: {
          type: "object",
          additionalProperties: false,
          properties: {
            imei: { type: "string", maxLength: 40 },
            vin: { type: "string", maxLength: 40 },
            plate: { type: "string", maxLength: 20 },
            reportNumber: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    evidenceAssessment: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceId", "showsClaimedItem", "confidence"],
        properties: {
          evidenceId: { type: "string" },
          showsClaimedItem: { type: "boolean" },
          damageConsistent: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          notes: { type: "string", maxLength: 300 },
        },
      },
    },
  },
} as const;

/** Never executed: the loop captures its input and stops. It writes nothing. */
export const submitProposalSpec: Tool.ToolSpecMember = {
  toolSpec: {
    name: "submit_proposal",
    description:
      "Submit your final proposal once, after the other tools have returned. Report what you read from the evidence. This does not approve or decide anything.",
    inputSchema: { json: SUBMIT_PROPOSAL_INPUT_SCHEMA as unknown as Record<string, unknown> } as ToolSpecification["inputSchema"],
  },
};

export const TOOL_SPECS: Tool[] = [lookupPolicySpec, checkFraudSignalsSpec, verifyEvidenceSpec, submitProposalSpec];

/** Builds name -> executor. Executors ignore any argument. Errors propagate so the loop can return a tool error. */
export function createTools(ctx: ToolContext, deps: ToolDeps): Record<ToolName, () => Promise<unknown>> {
  const { store } = deps;
  const { tenantId, claimId } = ctx;

  const loadClaim = async (): Promise<ClaimRecord> => {
    const claim = await store.getClaim(tenantId, claimId);
    if (!claim) throw new Error("claim not found");
    return claim;
  };

  /** Policy version in force on the loss date, its item and the category pack. */
  const loadPolicyContext = async (claim: ClaimRecord) => {
    const policy = selectPolicyVersion(await store.getPolicyVersions(tenantId, claim.policyId), claim.lossDate);
    const item = policy?.items.find((i) => i.itemId === claim.itemId);
    const pack = item ? await store.getPack(tenantId, item.category) : undefined;
    return { policy, item, pack };
  };

  const ownEvidence = async (claim: ClaimRecord): Promise<EvidenceRecord[]> =>
    store.getEvidence(tenantId, claim.evidenceIds);

  const lookup_policy = async () => {
    const claim = await loadClaim();
    const { policy, item, pack } = await loadPolicyContext(claim);
    if (!policy) return { found: false, reason: `No policy version in force on ${claim.lossDate}.` };
    if (!item) return { found: false, reason: "Claimed item is not listed on the policy.", policyId: policy.policyId, version: policy.version };
    const coverage = policy.coverage[item.category];
    const cause = claim.cause as Cause;
    const identifiers: Record<string, string> = {};
    for (const field of pack?.identifierFields ?? []) {
      const value = (item as unknown as Record<string, string | undefined>)[field];
      if (value) identifiers[field] = tail(value) as string;
    }
    return {
      found: true,
      policyId: policy.policyId,
      version: policy.version,
      active: true,
      item: { category: item.category, label: item.label, identifierTail: identifiers },
      claimedCause: claim.cause,
      causeCovered: coverage ? coverage.causes.includes(cause) : false,
      coveredCauses: coverage?.causes ?? [],
      limit: coverage?.limit ?? null,
      deductible: policy.deductible,
      requiredEvidence: pack?.causes[cause]?.requiredEvidence ?? null,
    };
  };

  const check_fraud_signals = async () => {
    const claim = await loadClaim();
    const evidence = await ownEvidence(claim);
    const sinceIso = new Date(deps.now().getTime() - deps.config.frequencyWindowDays * DAY_MS).toISOString();

    const lookups: Promise<{ evidenceId: string; type: string; claimIds: string[] }>[] = [];
    for (const e of evidence) {
      if (e.sha256) lookups.push(store.findOtherClaims(tenantId, "SHA256", e.sha256, claimId).then((claimIds) => ({ evidenceId: e.evidenceId, type: "sha256", claimIds })));
      if (e.phash) lookups.push(store.findOtherClaims(tenantId, "PHASH", e.phash, claimId).then((claimIds) => ({ evidenceId: e.evidenceId, type: "phash", claimIds })));
      if (e.identifier) lookups.push(store.findOtherClaims(tenantId, "IDENTIFIER", normId(e.identifier), claimId).then((claimIds) => ({ evidenceId: e.evidenceId, type: "identifier", claimIds })));
    }
    const [found, recentClaims] = await Promise.all([
      Promise.all(lookups),
      store.countRecentClaims(tenantId, claim.customerId, sinceIso, claimId),
    ]);
    return {
      matches: found.filter((f) => f.claimIds.length > 0),
      recentClaims,
      windowDays: deps.config.frequencyWindowDays,
    };
  };

  const verify_evidence = async () => {
    const claim = await loadClaim();
    const { item, pack } = await loadPolicyContext(claim);
    const evidence = await ownEvidence(claim);
    const required = pack?.causes[claim.cause as Cause]?.requiredEvidence ?? [];
    const fields = pack?.identifierFields ?? [];
    const insured = fields
      .map((f) => (item as unknown as Record<string, string | undefined> | undefined)?.[f])
      .filter((v): v is string => typeof v === "string");
    return {
      requiredKinds: required,
      items: evidence.map((e) => ({
        evidenceId: e.evidenceId,
        kind: e.kind ?? null,
        kindRequired: e.kind ? required.includes(e.kind) : false,
        processingStatus: e.processingStatus ?? "PENDING",
        storedIdentifierTail: tail(e.identifier) ?? null,
        identifierMatchesPolicy: e.identifier ? insured.some((v) => normId(v) === normId(e.identifier as string)) : null,
      })),
      missingKinds: required.filter((k) => !evidence.some((e) => e.kind === k)),
    };
  };

  return { lookup_policy, check_fraud_signals, verify_evidence };
}
