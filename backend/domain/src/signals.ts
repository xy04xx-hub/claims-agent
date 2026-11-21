import { daysBetween } from "./dates.js";
import type { RiskSignal, Thresholds } from "./types.js";

export interface SignalInputs {
  amount: number;
  lossDate: string;
  filingDate: string;
  policyStartDate?: string;
  typicalValue: number;
  recentClaimCount: number;
  duplicateMatches: { claimId: string; match: "EXACT" | "NEAR" }[];
  identifierReuse: { identifier: string; claimId: string }[];
  /** EXIF capture dates and incident dates read from reports. */
  evidenceDates: { source: "EXIF" | "INCIDENT"; date: string }[];
  /** A hash or identifier lookup failed. */
  lookupFailed: boolean;
}

const mask = (id: string) => `…${id.slice(-4)}`;

export function evaluateSignals(i: SignalInputs, t: Thresholds): RiskSignal[] {
  const out: RiskSignal[] = [];

  for (const m of i.duplicateMatches) {
    out.push({
      code: "DUPLICATE_PHOTO",
      detail: `Photo ${m.match === "EXACT" ? "matches" : "is similar to"} claim ${m.claimId}.`,
      relatedClaimId: m.claimId,
    });
  }
  for (const r of i.identifierReuse) {
    out.push({
      code: "IDENTIFIER_REUSE",
      detail: `Identifier ${mask(r.identifier)} was already claimed on ${r.claimId}.`,
      relatedClaimId: r.claimId,
    });
  }
  if (i.policyStartDate !== undefined) {
    const days = daysBetween(i.policyStartDate, i.lossDate);
    if (days < t.earlyClaimDays) {
      out.push({ code: "EARLY_CLAIM", detail: `Loss occurred ${days} days after policy start (limit ${t.earlyClaimDays}).` });
    }
  }
  if (i.typicalValue > 0 && i.amount > i.typicalValue * t.outlierMultiplier) {
    out.push({
      code: "AMOUNT_OUTLIER",
      detail: `Amount ${i.amount} is above ${t.outlierMultiplier}x the typical value ${i.typicalValue}.`,
    });
  }
  if (i.recentClaimCount > t.maxClaimsInWindow) {
    out.push({ code: "CLAIM_FREQUENCY", detail: `${i.recentClaimCount} recent claims (limit ${t.maxClaimsInWindow}).` });
  }
  const badDate = i.evidenceDates.find((e) =>
    e.source === "EXIF" ? e.date < i.lossDate : Math.abs(daysBetween(e.date, i.lossDate)) > 1,
  );
  if (badDate || i.lossDate > i.filingDate) {
    out.push({
      code: "TIMELINE_INCONSISTENT",
      detail: badDate
        ? `${badDate.source} date ${badDate.date} is inconsistent with loss date ${i.lossDate}.`
        : `Loss date ${i.lossDate} is after the filing date ${i.filingDate}.`,
    });
  }
  if (i.lookupFailed) {
    out.push({ code: "UNABLE_TO_VERIFY", detail: "A hash or identifier lookup failed." });
  }
  return out;
}
