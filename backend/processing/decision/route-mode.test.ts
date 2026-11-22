import { describe, expect, it } from "vitest";
import { createHandlers } from "./handlers.js";
import { proposal, TENANT } from "./test/fixtures.js";
import { ctx, makeDeps } from "./test/helpers.js";
import type { DecideEvent } from "./types.js";

const base = (over: Record<string, unknown> = {}) =>
  ({ tenantId: TENANT, claimId: "CLM-2001", proposal: proposal(), ...over }) as unknown as DecideEvent;

const FIXED = {
  EVIDENCE_NOT_READY: "Evidence not ready. The claim was routed so a person can review it.",
  AUTOMATIC_CHECK_UNAVAILABLE: "Automatic check unavailable. The claim was routed so a person can review it.",
} as const;

describe("decide route mode never approves", () => {
  it("control: the same fixture with a valid proposal and no route auto-approves", async () => {
    const { deps } = makeDeps({ killSwitch: true });
    const res = await createHandlers(deps).decide(base(), ctx);
    expect(res).toMatchObject({ result: "DECIDED", decision: { outcome: "AUTO_APPROVED" } });
  });

  for (const route of Object.keys(FIXED) as (keyof typeof FIXED)[]) {
    for (const withProposal of [false, true]) {
      it(`${route}${withProposal ? " with a valid proposal (ignored)" : ""} routes with fixed text`, async () => {
        const { deps, store } = makeDeps({ killSwitch: true });
        const event = withProposal ? base({ route }) : base({ route, proposal: undefined });
        const res = await createHandlers(deps).decide(event, ctx);
        expect(res).toMatchObject({
          result: "DECIDED",
          decision: { outcome: "ROUTED_TO_ADJUSTER", payout: 0, reasons: { adjuster: [FIXED[route]] } },
        });
        expect(store.commits).toHaveLength(1);
        expect(store.commits[0].decision.outcome).toBe("ROUTED_TO_ADJUSTER");
        expect(store.claims.get(`${TENANT}#CLM-2001`)?.status).toBe("ROUTED_TO_ADJUSTER");
      });
    }
  }

  it("rejects an unknown route value and writes nothing", async () => {
    const { deps, store } = makeDeps({ killSwitch: true });
    await expect(createHandlers(deps).decide(base({ route: "APPROVE" }), ctx)).rejects.toThrow(TypeError);
    expect(store.commits).toHaveLength(0);
  });

  it("rejects a missing proposal without route as a routed claim, never an approval", async () => {
    const { deps } = makeDeps({ killSwitch: true });
    const res = await createHandlers(deps).decide(base({ proposal: undefined }), ctx);
    expect(res).toMatchObject({ decision: { outcome: "ROUTED_TO_ADJUSTER" } });
  });
});
