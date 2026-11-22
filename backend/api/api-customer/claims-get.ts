// GET /claims/{claimId} (T-09 task 3.4, requirements 5.1-5.3). Shared by Customer (own claim) and Adjuster (tenant).
import type { RouteHandler } from "../middleware/types.js";
import { fail } from "../middleware/errors.js";
import type { ApiRepo, Item } from "../shared/repo.js";

export interface ClaimsGetDeps {
  repo: Pick<ApiRepo, "getClaimItem">;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

/** Fields both roles see. Optional fields appear only when stored. */
export function baseClaimView(item: Item): Record<string, unknown> {
  const decision = (item.decision ?? {}) as Record<string, unknown>;
  const reasons = (decision.reasons ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { claimId: item.claimId, status: item.status, createdAt: item.createdAt };
  for (const k of ["policyId", "itemId", "cause", "lossDate", "decidedAt"] as const) {
    const v = str(item[k]);
    if (v !== undefined) out[k] = v;
  }
  if (typeof item.amountClaimed === "number") out.amountClaimed = item.amountClaimed;
  if (typeof item.payout === "number") out.payout = item.payout;
  const evidence = strings(item.evidenceIds);
  if (evidence) out.evidenceIds = evidence;
  const passed = strings(decision.checksPassed);
  if (passed) out.checksPassed = passed;
  const message = str(reasons.customer);
  if (message !== undefined) out.customerMessage = message.slice(0, 500);
  return out;
}

export function createClaimsGetHandler(deps: ClaimsGetDeps): RouteHandler {
  return async (ctx) => {
    const claimId = ctx.pathParameters.claimId ?? "";
    const item = await deps.repo.getClaimItem(ctx.caller.tenantId, claimId);
    const notFound = fail(404, "NOT_FOUND", "Claim not found.");
    if (!item) return notFound;
    if (ctx.caller.group === "Customer") {
      if (item.customerId !== ctx.caller.sub) return notFound;
      return { statusCode: 200, body: baseClaimView(item) };
    }
    const view = baseClaimView(item);
    const decision = (item.decision ?? {}) as Record<string, unknown>;
    const reasons = (decision.reasons ?? {}) as Record<string, unknown>;
    const adjuster = strings(reasons.adjuster);
    if (adjuster) view.adjusterReasons = adjuster.map((r) => r.slice(0, 300));
    if (Array.isArray(decision.riskSignals)) {
      view.riskSignals = decision.riskSignals
        .map((s) => str((s as { code?: unknown } | null)?.code))
        .filter((c): c is string => c !== undefined);
    }
    const flags = strings(decision.informationalFlags);
    if (flags) view.informationalFlags = flags;
    return { statusCode: 200, body: view };
  };
}
