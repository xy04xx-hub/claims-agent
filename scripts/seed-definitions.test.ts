// Owner: A. Tests of the seed definitions. No AWS access.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { selectPolicyVersion } from "@claims-agent/domain";
import { carPack, phonePack, policyV1 } from "../backend/domain/src/fixtures.js";
import { validateDecision } from "../backend/processing/decision/schemas.js";
import {
  CAR_PACK, CLM_1042, CUSTOMER_ID, EVIDENCE_FILES, IMEI_MISMATCH, IMEI_PHONE_1, IMEI_PHONE_2, LAPTOP_PACK, PHONE_PACK,
  POLICIES, POLICY_V1, POLICY_V2, SCENARIOS, TENANT_ID, assertValidEvidenceRow, assertValidPack, assertValidPolicy,
  buildSeedItems, clm1042Decision, scenarioHashes,
} from "../seed/definitions/index.js";
import { realPhoto } from "./seed-e2e.helpers.js";

const luhn = (s: string) => [...s].reverse().reduce((t, c, i) => {
  let d = Number(c);
  if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
  return t + d;
}, 0) % 10 === 0;

describe("policies", () => {
  it("validate and keep the first three items of the domain fixtures", () => {
    POLICIES.forEach(assertValidPolicy);
    expect(POLICY_V1.items.slice(0, 3)).toEqual(policyV1.items.map((i) => ({ ...i })));
    expect(POLICY_V1.items[3]?.itemId).toBe("ITEM-PHONE-2");
    expect(POLICY_V1.coverage).not.toHaveProperty("laptop");
    expect(POLICY_V2.coverage).not.toHaveProperty("laptop");
  });
  it("v2 keeps phone THEFT and drops LOSS", () => {
    expect(POLICY_V1.coverage.phone?.causes).toEqual(["ACCIDENTAL_DAMAGE", "THEFT", "LOSS"]);
    expect(POLICY_V2.coverage.phone?.causes).toEqual(["ACCIDENTAL_DAMAGE", "THEFT"]);
  });
  it("Property 2: exactly one version is in force on any date from start to a year later", () => {
    const day = fc.integer({ min: 0, max: 730 }).map((n) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10));
    fc.assert(fc.property(day, (d) => {
      const inForce = POLICIES.filter((p) => p.effectiveFrom <= d && (!p.effectiveTo || d <= p.effectiveTo));
      expect(inForce).toHaveLength(1);
      expect(selectPolicyVersion(POLICIES, d)?.version).toBe(d <= "2026-10-31" ? 1 : 2);
    }));
  });
});

describe("packs", () => {
  it("phone and car equal the domain fixtures, with the agreed caps", () => {
    expect(PHONE_PACK).toEqual(phonePack);
    expect(CAR_PACK).toEqual(carPack);
    expect(PHONE_PACK.causes.ACCIDENTAL_DAMAGE?.autoApproveCap).toBe(500);
    expect(PHONE_PACK.causes.THEFT?.autoApproveCap).toBe(300);
    expect(PHONE_PACK.causes.LOSS?.autoApproveCap).toBe(0);
    expect(CAR_PACK.causes.WINDSCREEN?.autoApproveCap).toBe(250);
    expect(CAR_PACK.causes.COLLISION?.autoApproveCap).toBe(0);
    expect(CAR_PACK.causes.INJURY?.autoApproveCap).toBe(0);
    expect(PHONE_PACK.typicalValue).toBe(800);
    expect(CAR_PACK.typicalValue).toBe(6000);
  });
  it("the laptop pack can never approve", () => {
    assertValidPack(LAPTOP_PACK);
    expect(Object.values(LAPTOP_PACK.causes).every((c) => c?.autoApproveCap === 0)).toBe(true);
  });
  it("rejects a bad pack", () => {
    expect(() => assertValidPack({ ...PHONE_PACK, typicalValue: 0 })).toThrow(/typicalValue/);
    expect(() => assertValidPack({ ...PHONE_PACK, causes: { THEFT: { autoApproveCap: -1, requiredEvidence: ["POLICE_REPORT"] } } })).toThrow(/cap/);
  });
});

describe("seed items", () => {
  const photo = realPhoto();
  const items = buildSeedItems(photo);

  it("Property 1: building twice gives identical items", () => {
    expect(buildSeedItems(photo)).toEqual(items);
  });
  it("every partition key starts with the tenant and uses the demo customer", () => {
    for (const row of Object.values(items).flat()) expect(String(row.pk)).toMatch(new RegExp(`^${TENANT_ID}#`));
    expect(items.claims[0]?.customerId).toBe(CUSTOMER_ID);
  });
  it("Property 4: every evidence row has kind, claimId, evidenceId and exifDate", () => {
    for (const r of items.evidenceIndex) {
      assertValidEvidenceRow(r);
      expect(["DEVICE_PHOTO", "POLICE_REPORT", "PLATE_PHOTO", "STATEMENT"]).toContain(r.kind);
      expect(r).toHaveProperty("exifDate");
    }
    expect(() => assertValidEvidenceRow({ pk: "x", sk: "y", type: "SHA256", value: "v", kind: "OTHER", claimId: "c", evidenceId: "e", exifDate: null })).toThrow(/kind/);
    expect(() => assertValidEvidenceRow({ pk: "x", sk: "y", type: "SHA256", value: "v", kind: "DEVICE_PHOTO", claimId: "c", evidenceId: "e" })).toThrow(/exifDate/);
  });
  it("CLM-1042 has its photo hash rows and the only identifier row", () => {
    const rows = items.evidenceIndex.filter((r) => r.claimId === CLM_1042);
    expect(rows.map((r) => r.type).sort()).toEqual(["IDENTIFIER", "PHASH", "SHA256"]);
    expect(rows.find((r) => r.type === "SHA256")?.value).toBe(photo.sha256);
    expect(items.evidenceIndex.filter((r) => r.type === "IDENTIFIER")).toHaveLength(1);
    expect(items.evidenceIndex.find((r) => r.type === "IDENTIFIER")?.value).toBe(IMEI_PHONE_2);
    expect(items.claims[0]).toMatchObject({ claimId: CLM_1042, status: "AUTO_APPROVED", evidenceIds: ["EVD-1042-1"] });
  });
  it("Property 5: scenario hashes are unique except scenario D, which copies CLM-1042", () => {
    const seen = new Map<string, string>();
    for (const s of SCENARIOS) {
      const h = scenarioHashes(s, photo);
      if (s.id === "D") { expect(h).toEqual({ sha256: photo.sha256, phash: photo.phash }); continue; }
      for (const v of [h.sha256, h.phash]) {
        expect(seen.has(v), `${s.id} collides with ${seen.get(v)}`).toBe(false);
        seen.set(v, s.id);
      }
      expect(h.sha256).not.toBe(photo.sha256);
    }
    const ids = items.evidenceIndex.filter((r) => String(r.claimId).startsWith("CLM-SCN-") && r.type === "IDENTIFIER");
    expect(ids).toHaveLength(0);
  });
  it("CLM-1042 decision satisfies the decision contract", () => {
    expect(validateDecision(clm1042Decision())).toEqual({ ok: true });
  });
  it("uses Luhn-valid synthetic IMEIs and no email address outside example.com", () => {
    for (const i of [IMEI_PHONE_1, IMEI_PHONE_2, IMEI_MISMATCH]) expect(luhn(i)).toBe(true);
    const text = JSON.stringify(items);
    const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
    expect(emails.filter((e) => !e.endsWith("@example.com"))).toEqual([]);
  });
  it("manifest lists seven files", () => expect(EVIDENCE_FILES).toHaveLength(7));
});
