// Requirement 13.4: a second resolution returns 409 and leaves the first one.
import { describe, expect, it } from "vitest";
import { createResolutionHandler, type ResolutionDeps } from "./resolution.js";
import type { RouteContext } from "../middleware/types.js";

const TENANT = "T1";
const CLAIM = "CLM-1";

function ctx(decision: "APPROVE" | "REJECT", note: string): RouteContext {
  return {
    caller: { sub: "adj-1", group: "Adjuster", tenantId: TENANT },
    requestId: "req-1",
    pathParameters: { claimId: CLAIM },
    body: { decision, reasonCode: "VERIFIED_OK", note },
  };
}

function fakeRepo(initial: Record<string, unknown>) {
  const claim: Record<string, unknown> = { ...initial };
  const repo: ResolutionDeps["repo"] = {
    getClaimItem: async () => ({ ...claim }),
    resolveClaim: async (input) => {
      if (claim.status !== "ROUTED_TO_ADJUSTER") return "CONFLICT";
      claim.status = input.newStatus;
      claim.resolution = input.resolution;
      return "RESOLVED";
    },
  };
  return { repo, claim };
}

const now = () => new Date("2025-01-01T00:00:00Z");

describe("resolution handler", () => {
  it("rejects a second resolution with 409 and keeps the first", async () => {
    const { repo, claim } = fakeRepo({ status: "ROUTED_TO_ADJUSTER", policyId: "POL-1" });
    const handler = createResolutionHandler({ repo, now });

    const first = await handler(ctx("APPROVE", "first"));
    expect(first.statusCode).toBe(200);
    expect(claim.status).toBe("APPROVED_BY_ADJUSTER");

    const second = await handler(ctx("REJECT", "second"));
    expect(second.statusCode).toBe(409);
    expect(claim.status).toBe("APPROVED_BY_ADJUSTER");
    expect((claim.resolution as { note: string }).note).toBe("first");
  });

  it("returns 409 when the conditional write loses a race", async () => {
    const repo: ResolutionDeps["repo"] = {
      getClaimItem: async () => ({ status: "ROUTED_TO_ADJUSTER" }),
      resolveClaim: async () => "CONFLICT",
    };
    const res = await createResolutionHandler({ repo, now })(ctx("APPROVE", "x"));
    expect(res.statusCode).toBe(409);
  });
});
