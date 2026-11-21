import { buildAudit } from "./audit.js";
import { evaluate, failSafeDecision, routedDecision, type Evaluation, type Proposal } from "./evaluate.js";
import { validateDecision, validateProposal } from "./schemas.js";
import type {
  ClaimRecord, DecideEvent, DecideResult, Deps, InvokeContext, SqsBatchResponse, SqsEvent,
} from "./types.js";

export interface Handlers {
  decide(event: DecideEvent, ctx: InvokeContext): Promise<DecideResult>;
  routeOnly(event: SqsEvent, ctx: InvokeContext): Promise<SqsBatchResponse>;
  /** Lambda entry point: SQS events go to routeOnly, anything else to decide. */
  handler(event: DecideEvent | SqsEvent, ctx: InvokeContext): Promise<DecideResult | SqsBatchResponse>;
}

const TENANT = /^[A-Za-z0-9._-]{1,40}$/;
const CLAIM_ID = /^CLM-[A-Za-z0-9-]{1,40}$/;

function parseEvent(event: unknown): DecideEvent {
  const e = event as Partial<DecideEvent> | null;
  if (!e || typeof e.tenantId !== "string" || !TENANT.test(e.tenantId) || typeof e.claimId !== "string" || !CLAIM_ID.test(e.claimId)) {
    throw new TypeError("decide: tenantId and claimId are required");
  }
  return { tenantId: e.tenantId, claimId: e.claimId, proposal: e.proposal, jti: typeof e.jti === "string" ? e.jti : undefined };
}

/** Everything that can fail without a decision: any error becomes a fail-safe route. */
async function decideClaim(deps: Deps, claim: ClaimRecord, rawProposal: unknown): Promise<Evaluation> {
  const checked = validateProposal(rawProposal);
  if (!checked.ok) {
    return fallbackEval(claim, routedDecision(claim.claimId, "PROPOSAL_INVALID", `Proposal failed validation: ${checked.error}`));
  }
  const proposal = rawProposal as Proposal;
  const meta = { model: proposal.model, promptVersion: proposal.promptVersion };
  if (proposal.claimId !== claim.claimId) {
    return fallbackEval(claim, routedDecision(claim.claimId, "PROPOSAL_INVALID", "Proposal is for a different claim."));
  }
  try {
    return { ...(await evaluate(deps, claim, proposal)), ...meta };
  } catch (err) {
    deps.log.error("evaluation failed, routing", { claimId: claim.claimId, error: err instanceof Error ? err.name : "unknown" });
    return { ...fallbackEval(claim, failSafeDecision(claim.claimId)), ...meta };
  }
}

function fallbackEval(claim: ClaimRecord, decision: Evaluation["decision"]): Evaluation {
  return {
    decision,
    policyId: claim.policyId,
    policyVersion: Math.max(1, claim.policyVersion ?? 1),
    packVersion: 1,
    thresholds: {},
  };
}

export function createHandlers(deps: Deps): Handlers {
  const decide: Handlers["decide"] = async (rawEvent, ctx) => {
    const event = parseEvent(rawEvent);
    const claim = await deps.store.getClaim(event.tenantId, event.claimId);
    if (!claim) return { result: "NOT_FOUND", claimId: event.claimId };
    if (claim.status !== "PROCESSING") return { result: "ALREADY_DECIDED", claimId: event.claimId };

    const evaluation = await decideClaim(deps, claim, event.proposal);
    const valid = validateDecision(evaluation.decision);
    if (!valid.ok) throw new Error(`decision failed schema validation: ${valid.error}`);
    const decidedAt = deps.now().toISOString();
    const audit = buildAudit({
      claim, evaluation, timestamp: decidedAt, actorId: "decision-lambda", requestId: ctx.awsRequestId, jti: event.jti,
    });
    const outcome = await deps.store.commitDecision({ claim, decision: evaluation.decision, audit, decidedAt });
    if (outcome === "ALREADY_DECIDED") return { result: "ALREADY_DECIDED", claimId: claim.claimId };
    return { result: "DECIDED", decision: evaluation.decision };
  };

  const routeOnly: Handlers["routeOnly"] = async () => {
    throw new Error("routeOnly: not implemented");
  };
  const handler: Handlers["handler"] = (event, ctx) =>
    "Records" in event ? routeOnly(event, ctx) : decide(event, ctx);
  return { decide, routeOnly, handler };
}
