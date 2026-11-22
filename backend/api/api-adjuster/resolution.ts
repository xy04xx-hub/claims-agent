// POST /claims/{claimId}/resolution (T-09 task 3.5, requirements 10.4-10.8).
import type { RouteHandler } from "../middleware/types.js";
import { fail } from "../middleware/errors.js";
import type { ApiRepo, Item } from "../shared/repo.js";

type Decision = "APPROVE" | "REJECT";
interface ResolutionBody { decision: Decision; reasonCode: string; note: string }

export interface ResolutionDeps {
  repo: Pick<ApiRepo, "getClaimItem" | "resolveClaim">;
  now: () => Date;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const CONFLICT_MESSAGE = "The claim is no longer waiting for an adjuster.";

export function createResolutionHandler(deps: ResolutionDeps): RouteHandler {
  return async (ctx) => {
    const { tenantId, sub } = ctx.caller;
    const claimId = ctx.pathParameters.claimId;
    if (claimId === undefined) return fail(404, "NOT_FOUND", "Claim not found.");
    const body = ctx.body as ResolutionBody;

    const claim = await deps.repo.getClaimItem(tenantId, claimId);
    if (claim === undefined) return fail(404, "NOT_FOUND", "Claim not found.");
    if (claim.status !== "ROUTED_TO_ADJUSTER") return fail(409, "CONFLICT", CONFLICT_MESSAGE);

    const newStatus = body.decision === "APPROVE" ? "APPROVED_BY_ADJUSTER" : "REJECTED_BY_ADJUSTER";
    const timestamp = deps.now().toISOString();
    const resolution: Item = {
      decision: body.decision,
      reasonCode: body.reasonCode,
      note: body.note,
      resolvedBy: sub,
      resolvedAt: timestamp,
    };
    // The audit record never carries the note: it can hold personal data.
    const audit: Item & { timestamp: string } = {
      tenantId,
      claimId,
      requestId: ctx.requestId,
      timestamp,
      actor: { type: "adjuster", id: sub },
      outcome: newStatus,
      policyId: str(claim.policyId) ?? "UNKNOWN",
      policyVersion: typeof claim.policyVersion === "number" && claim.policyVersion >= 1 ? claim.policyVersion : 1,
      packVersion: 1,
      thresholds: { previousStatus: "ROUTED_TO_ADJUSTER" },
      checksPassed: [],
      checksFailed: [],
      riskSignals: [],
      informationalFlags: [],
      ...(typeof claim.amountClaimed === "number" ? { amountClaimed: claim.amountClaimed } : {}),
      reasonCode: body.reasonCode,
    };

    const result = await deps.repo.resolveClaim({ tenantId, claimId, newStatus, resolution, audit });
    if (result === "CONFLICT") return fail(409, "CONFLICT", CONFLICT_MESSAGE);
    return { statusCode: 200, body: { claimId, status: newStatus } };
  };
}
