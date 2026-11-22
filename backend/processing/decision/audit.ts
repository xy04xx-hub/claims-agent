import type { Decision } from "@claims-agent/domain";
import type { Evaluation } from "./evaluate.js";
import type { AuditRecord, ClaimRecord } from "./types.js";

/** The single reason used for the Routed metric and the audit reasonCode. Undefined for an approval. */
export function reasonCode(d: Decision): string | undefined {
  if (d.outcome === "AUTO_APPROVED") return undefined;
  const check = d.checksFailed[0]?.code;
  // NO_RISK_SIGNALS is a check name, not a reason: report the signal that caused the routing.
  if (check === "NO_RISK_SIGNALS") return d.riskSignals[0]?.code ?? check;
  return check ?? d.riskSignals[0]?.code ?? "UNKNOWN";
}

export interface AuditInput {
  claim: ClaimRecord;
  evaluation: Evaluation;
  timestamp: string;
  actorId: string;
  requestId?: string;
  jti?: string;
}

/**
 * Codes and numbers only. No claim text, no identifiers, no photo bytes, no names.
 * (Signal details name other claim IDs, so only the codes are stored here. The full decision is on the claim item.)
 */
export function buildAudit({ claim, evaluation: ev, timestamp, actorId, requestId, jti }: AuditInput): AuditRecord {
  const d = ev.decision;
  return {
    tenantId: claim.tenantId,
    claimId: claim.claimId,
    requestId,
    timestamp,
    actor: { type: "agent", id: actorId },
    outcome: d.outcome,
    policyId: ev.policyId,
    policyVersion: ev.policyVersion,
    packVersion: ev.packVersion,
    thresholds: ev.thresholds,
    checksPassed: d.checksPassed,
    checksFailed: d.checksFailed.map((c) => c.code),
    riskSignals: d.riskSignals.map((s) => s.code),
    informationalFlags: d.informationalFlags,
    amountClaimed: claim.amountClaimed,
    payout: d.payout,
    reasonCode: reasonCode(d),
    model: ev.model,
    promptVersion: ev.promptVersion,
    ticketJti: jti,
  };
}
