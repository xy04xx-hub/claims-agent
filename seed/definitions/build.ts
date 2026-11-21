// Owner: A. Pure builder: seed definitions in, the exact DynamoDB items out. No AWS imports, no clock, no randomness.
import type { ClaimTypePack, Policy } from "@claims-agent/domain";
import { sha256Hex, normalizeIdentifier } from "../lib/hashing.js";
import { CLM_1042_AMOUNT, CLM_1042_CAUSE, clm1042Decision } from "./claim-1042.js";
import {
  CLM_1042, CLM_1042_CREATED_AT, CLM_1042_DECIDED_AT, CLM_1042_LOSS_DATE, CLM_1042_S3_KEY, CUSTOMER_ID, EVD_1042_1,
  IMEI_PHONE_2, ITEM_PHONE_2, POLICY_ID, SCENARIO_LOSS_DATE, SEED_CREATED_AT, TENANT_ID,
} from "./constants.js";
import { claimKey, customerPk, evidenceByIdPk, evidenceIndexPk, evidenceSk, packPk, policyPk, versionSk } from "./keys.js";
import { PACKS } from "./packs.js";
import { POLICIES } from "./policies.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";
import { assertNoDuplicateKeys, assertValidEvidenceRow, assertValidPack, assertValidPolicy } from "./validate.js";

export type Item = Record<string, unknown>;

/** What is read from the committed CLM-1042 photo file at run time. */
export interface PhotoInfo { sha256: string; phash: string; sizeBytes: number; contentType: string }
export interface SeedItems { policies: Item[]; packs: Item[]; evidenceIndex: Item[]; claims: Item[] }

const t = TENANT_ID;

export function policyToItem(p: Policy): Item {
  return {
    pk: policyPk(t, p.policyId), sk: versionSk(p.version),
    gsi1pk: customerPk(t, p.customerId), gsi1sk: p.effectiveFrom,
    policyId: p.policyId, version: p.version, customerId: p.customerId, holderName: p.holderName,
    startDate: p.startDate, effectiveFrom: p.effectiveFrom,
    ...(p.effectiveTo ? { effectiveTo: p.effectiveTo } : {}),
    deductible: p.deductible, items: p.items.map((i) => ({ ...i })), coverage: p.coverage,
  };
}

export function packToItem(p: ClaimTypePack): Item {
  return {
    pk: packPk(t, p.category), sk: versionSk(p.version),
    category: p.category, version: p.version, causes: p.causes, identifierFields: p.identifierFields,
    typicalValue: p.typicalValue, confidenceThresholds: { minConfidence: p.minConfidence },
  };
}

function evidenceRow(
  type: "SHA256" | "PHASH" | "IDENTIFIER", value: string, o: {
    claimId: string; evidenceId: string; kind: string; exifDate: string | null; contentType: string; s3Key?: string; sizeBytes?: number;
  },
): Item {
  return {
    pk: evidenceIndexPk(t, type, value), sk: evidenceSk(o.claimId, o.evidenceId),
    gsi1pk: evidenceByIdPk(t, o.evidenceId), gsi1sk: type,
    type, value, kind: o.kind, claimId: o.claimId, evidenceId: o.evidenceId, customerId: CUSTOMER_ID,
    exifDate: o.exifDate, processingStatus: "READY", contentType: o.contentType, createdAt: SEED_CREATED_AT,
    ...(o.s3Key ? { s3Key: o.s3Key } : {}), ...(o.sizeBytes !== undefined ? { sizeBytes: o.sizeBytes } : {}),
  };
}

const PHOTO_KINDS = ["DEVICE_PHOTO", "PLATE_PHOTO"];

/** Scenario hashes are unique to the scenario, so scenarios never match each other. Scenario D copies the CLM-1042 photo. */
export function scenarioHashes(scn: Scenario, photo: PhotoInfo): { sha256: string; phash: string } {
  if (scn.reusesClm1042Photo) return { sha256: photo.sha256, phash: photo.phash };
  return {
    sha256: sha256Hex(`scenario:${scn.claimId}:${scn.evidenceId}`),
    phash: sha256Hex(`phash:${scn.claimId}:${scn.evidenceId}`).slice(0, 16),
  };
}

export function scenarioEvidenceRows(scn: Scenario, photo: PhotoInfo): Item[] {
  const h = scenarioHashes(scn, photo);
  const o = {
    claimId: scn.claimId, evidenceId: scn.evidenceId, kind: scn.evidenceKind, contentType: "image/png",
    exifDate: PHOTO_KINDS.includes(scn.evidenceKind) ? SCENARIO_LOSS_DATE : null,
  };
  return [evidenceRow("SHA256", h.sha256, o), evidenceRow("PHASH", h.phash, o)];
}

/**
 * The PROCESSING claim row of a scenario. It has no byCustomer keys on purpose: countRecentClaims reads that index,
 * and 12 scenario claims would trip the claim frequency signal for every other scenario.
 */
export function buildScenarioClaimRow(scn: Scenario, now: Date): Item {
  return {
    ...claimKey(t, scn.claimId),
    claimId: scn.claimId, customerId: CUSTOMER_ID, policyId: POLICY_ID, policyVersion: 2,
    itemId: scn.itemId, cause: scn.cause, clientRequestId: `seed-scn-${scn.id}`, status: "PROCESSING",
    amountClaimed: scn.amount, description: `Synthetic scenario ${scn.id}.`, lossDate: SCENARIO_LOSS_DATE,
    evidenceIds: [scn.evidenceId], createdAt: now.toISOString(),
  };
}

export function buildSeedItems(photo: PhotoInfo): SeedItems {
  for (const p of POLICIES) assertValidPolicy(p);
  for (const p of PACKS) assertValidPack(p);

  const d = clm1042Decision();
  const base = { claimId: CLM_1042, evidenceId: EVD_1042_1, kind: "DEVICE_PHOTO", exifDate: null, contentType: photo.contentType };
  const evidenceIndex: Item[] = [
    evidenceRow("SHA256", photo.sha256, { ...base, s3Key: CLM_1042_S3_KEY, sizeBytes: photo.sizeBytes }),
    evidenceRow("PHASH", photo.phash, { ...base, s3Key: CLM_1042_S3_KEY, sizeBytes: photo.sizeBytes }),
    evidenceRow("IDENTIFIER", normalizeIdentifier(IMEI_PHONE_2), base),
    ...SCENARIOS.flatMap((s) => scenarioEvidenceRows(s, photo)),
  ];
  for (const r of evidenceIndex) assertValidEvidenceRow(r);

  const claims: Item[] = [{
    ...claimKey(t, CLM_1042),
    gsi1pk: customerPk(t, CUSTOMER_ID), gsi1sk: CLM_1042_CREATED_AT,
    claimId: CLM_1042, customerId: CUSTOMER_ID, policyId: POLICY_ID, policyVersion: 1, itemId: ITEM_PHONE_2,
    cause: CLM_1042_CAUSE, clientRequestId: "seed-clm-1042", status: "AUTO_APPROVED",
    amountClaimed: CLM_1042_AMOUNT, payout: d.payout, description: "Cracked screen (synthetic seed claim).",
    lossDate: CLM_1042_LOSS_DATE, evidenceIds: [EVD_1042_1], decision: d, reasons: d.reasons,
    createdAt: CLM_1042_CREATED_AT, decidedAt: CLM_1042_DECIDED_AT,
  }];

  const items: SeedItems = { policies: POLICIES.map(policyToItem), packs: PACKS.map(packToItem), evidenceIndex, claims };
  assertNoDuplicateKeys("Policies", items.policies);
  assertNoDuplicateKeys("ClaimTypePacks", items.packs);
  assertNoDuplicateKeys("EvidenceIndex", items.evidenceIndex);
  assertNoDuplicateKeys("Claims", items.claims);
  return items;
}
