// Key formats from contracts/data-model.md. The Foundation tables use generic attribute names (pk, sk, gsi1pk, ...).
import type { IndexType } from "./types.js";

/** Claim ID the Evidence Processor writes before a claim exists. T-15 assigns the real ID. */
export const UNASSIGNED_CLAIM_ID = "UNASSIGNED";

export const claimKey = (tenantId: string, claimId: string) => ({ pk: `${tenantId}#${claimId}`, sk: "CLAIM" });
export const policyPk = (tenantId: string, policyId: string) => `${tenantId}#${policyId}`;
export const packPk = (tenantId: string, category: string) => `${tenantId}#${category}`;
export const evidenceIndexPk = (tenantId: string, type: IndexType, value: string) => `${tenantId}#${type}#${value}`;
export const evidenceByIdPk = (tenantId: string, evidenceId: string) => `${tenantId}#${evidenceId}`;
export const customerPk = (tenantId: string, customerId: string) => `${tenantId}#${customerId}`;
export const auditPk = (tenantId: string, claimId: string) => `${tenantId}#${claimId}`;

/** FNV-1a 32-bit hash of the claim ID, mod 8. The adjuster queue reads all 8 shards (T-10 must use the same function). */
export const QUEUE_SHARDS = 8;
export function queueShard(claimId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < claimId.length; i++) {
    h ^= claimId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % QUEUE_SHARDS;
}
export const queuePkForShard = (tenantId: string, status: string, shard: number) => `${tenantId}#${status}#${shard}`;
export const queuePk = (tenantId: string, status: string, claimId: string) =>
  queuePkForShard(tenantId, status, queueShard(claimId));
