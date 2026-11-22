// GET /me/policies (T-09). Active policies of the caller with the causes they can claim and the evidence each needs.
// Response shape: contracts/api/me-policies.response.schema.json. Drives the intake form.
import type { ClaimTypePack, EvidenceKind, Policy } from "@claims-agent/domain";
import type { RouteHandler } from "../middleware/types.js";
import type { ApiRepo } from "../shared/repo.js";

const EVIDENCE_DESCRIPTIONS: Record<EvidenceKind, string> = {
  DEVICE_PHOTO: "Photo of the damaged device showing its identifier (for a phone, the IMEI on the About phone screen)",
  POLICE_REPORT: "Police report with your name, the item identifier and the incident date",
  PLATE_PHOTO: "Photo of the vehicle showing the number plate",
  STATEMENT: "Written statement describing what happened",
};

export interface MePoliciesDeps {
  repo: Pick<ApiRepo, "getPoliciesByCustomer" | "getPack">;
  now: () => number;
}

/** Highest version per policyId that is in force on `today`. */
function activeLatest(policies: Policy[], today: string): Policy[] {
  const best = new Map<string, Policy>();
  for (const p of policies) {
    if (p.effectiveFrom > today || (p.effectiveTo !== undefined && p.effectiveTo < today)) continue;
    const cur = best.get(p.policyId);
    if (cur === undefined || p.version > cur.version) best.set(p.policyId, p);
  }
  return [...best.values()].sort((a, b) => a.policyId.localeCompare(b.policyId));
}

export function createMePoliciesHandler(deps: MePoliciesDeps): RouteHandler {
  return async (ctx) => {
    const { tenantId, sub: customerId } = ctx.caller;
    const today = new Date(deps.now()).toISOString().slice(0, 10);
    const policies = activeLatest(await deps.repo.getPoliciesByCustomer(tenantId, customerId), today);

    const packs = new Map<string, ClaimTypePack | undefined>();
    const categories = new Set(policies.flatMap((p) => p.items.map((i) => i.category)));
    await Promise.all(
      [...categories].map(async (c) => {
        packs.set(c, await deps.repo.getPack(tenantId, c));
      }),
    );

    const out = policies.map((p) => ({
      policyId: p.policyId,
      version: p.version,
      items: p.items.map((item) => {
        const pack = packs.get(item.category);
        const covered = p.coverage[item.category]?.causes ?? [];
        const causes = covered.flatMap((cause) => {
          const causePack = cause === "UNCLEAR" ? undefined : pack?.causes[cause];
          if (causePack === undefined) return [];
          return [{
            cause,
            requiredEvidence: causePack.requiredEvidence.map((kind) => ({ kind, description: EVIDENCE_DESCRIPTIONS[kind] })),
          }];
        });
        return { itemId: item.itemId, category: item.category, label: item.label, causes };
      }),
    }));
    return { statusCode: 200, body: { policies: out } };
  };
}
