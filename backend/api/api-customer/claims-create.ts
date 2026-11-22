// POST /claims (T-09 task 3.4, requirements 4.1-4.10). Ownership checks, deterministic claim ID, idempotent write,
// job message to the queue. The customer ID and tenant come only from ctx.caller.
import { createHash } from "node:crypto";
import { selectPolicyVersion } from "@claims-agent/domain";
import type { RouteHandler } from "../middleware/types.js";
import { fail } from "../middleware/errors.js";
import { validateJobMessage } from "../../processing/decision/schemas.js";
import type { ApiRepo } from "../shared/repo.js";

export const SLA_MS = 24 * 60 * 60 * 1000;

export interface JobMessage {
  tenantId: string;
  claimId: string;
  attempt: number;
  requestId: string;
}

export interface ClaimsCreateDeps {
  repo: Pick<ApiRepo, "getPolicyVersions" | "getUpload" | "getClaimItem" | "putClaim" | "markEnqueued">;
  /** Sends the job message to the queue. Throws on failure. */
  sendJob: (message: JobMessage) => Promise<void>;
  now: () => number;
}

interface CreateBody {
  clientRequestId: string;
  policyId: string;
  itemId: string;
  cause: string;
  description: string;
  amountClaimed: number;
  lossDate: string;
  evidenceIds: string[];
}

export const claimIdFor = (tenantId: string, customerId: string, clientRequestId: string): string =>
  "CLM-" + createHash("sha256").update(`${tenantId}#${customerId}#${clientRequestId}`).digest("hex").slice(0, 16);

export function createClaimsCreateHandler(deps: ClaimsCreateDeps): RouteHandler {
  return async (ctx) => {
    const { tenantId, sub: customerId } = ctx.caller;
    const input = ctx.body as CreateBody;

    // 1. Policy ownership, version in force on the loss date, insured item.
    const versions = (await deps.repo.getPolicyVersions(tenantId, input.policyId)).filter((p) => p.customerId === customerId);
    if (versions.length === 0) return fail(403, "FORBIDDEN", "You cannot file a claim on this policy.");
    const policy = selectPolicyVersion(versions, input.lossDate);
    if (!policy) return fail(403, "FORBIDDEN", "No policy was in force on the loss date.");
    if (!policy.items.some((i) => i.itemId === input.itemId)) {
      return fail(403, "FORBIDDEN", "The item is not on this policy.");
    }

    // 2. Evidence ownership. A missing row and another customer's row look the same.
    const uploads = await Promise.all(input.evidenceIds.map((id) => deps.repo.getUpload(tenantId, id)));
    if (uploads.some((u) => !u || u.customerId !== customerId)) {
      return fail(403, "FORBIDDEN", "One or more evidence files are not yours.");
    }

    // 3. Idempotent write on a deterministic ID.
    const claimId = claimIdFor(tenantId, customerId, input.clientRequestId);
    const nowMs = deps.now();
    const createdAt = new Date(nowMs).toISOString();
    const outcome = await deps.repo.putClaim(tenantId, claimId, {
      claimId,
      customerId,
      policyId: input.policyId,
      policyVersion: policy.version,
      itemId: input.itemId,
      cause: input.cause,
      clientRequestId: input.clientRequestId,
      status: "PROCESSING",
      amountClaimed: input.amountClaimed,
      description: input.description,
      lossDate: input.lossDate,
      evidenceIds: input.evidenceIds,
      createdAt,
      slaDueAt: new Date(nowMs + SLA_MS).toISOString(),
      gsi1pk: `${tenantId}#${customerId}`,
      gsi1sk: createdAt,
      gsi3pk: `${tenantId}#${customerId}#${input.clientRequestId}`,
    });

    // 4. Enqueue unless a previous request already did.
    if (outcome === "EXISTS") {
      const stored = await deps.repo.getClaimItem(tenantId, claimId);
      if (stored?.enqueuedAt !== undefined) return { statusCode: 202, body: { claimId, status: "PROCESSING" } };
    }
    const message: JobMessage = { tenantId, claimId, attempt: 1, requestId: ctx.requestId };
    const valid = validateJobMessage(message);
    if (!valid.ok) throw new Error(`job message invalid: ${valid.error}`);
    await deps.sendJob(message); // a failure propagates as a generic 500 and the claim stays for a retry
    await deps.repo.markEnqueued(tenantId, claimId, new Date(deps.now()).toISOString());

    return { statusCode: 202, body: { claimId, status: "PROCESSING" } };
  };
}
