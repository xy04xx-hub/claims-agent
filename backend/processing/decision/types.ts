// Types for the Decision Lambda. No AWS imports here: the Store and the kill switch are interfaces.
import type { ClaimTypePack, Decision, EvidenceKind, Policy } from "@claims-agent/domain";

export type ClaimStatus =
  | "PROCESSING"
  | "AUTO_APPROVED"
  | "ROUTED_TO_ADJUSTER"
  | "APPROVED_BY_ADJUSTER"
  | "REJECTED_BY_ADJUSTER";

/** The parts of a Claims item this Lambda reads. */
export interface ClaimRecord {
  tenantId: string;
  claimId: string;
  customerId: string;
  policyId: string;
  policyVersion?: number;
  itemId: string;
  cause: string;
  amountClaimed: number;
  lossDate: string;
  evidenceIds: string[];
  status: ClaimStatus;
  createdAt: string;
  /** Claimant text. Untrusted. Read by the Worker only, never logged. */
  description?: string;
}

/** What the EvidenceIndex holds for one evidence ID. Every field except `evidenceId` may be missing (T-13 is not built yet). */
export interface EvidenceRecord {
  evidenceId: string;
  claimId?: string;
  kind?: EvidenceKind;
  sha256?: string;
  phash?: string;
  identifier?: string;
  /** YYYY-MM-DD */
  exifDate?: string;
  /** Folded from the hash rows: FAILED if any SHA256 or PHASH row failed, READY if the SHA256 row is ready, else PENDING. */
  processingStatus?: "READY" | "PENDING" | "FAILED";
  /** Object key, content type and size as written by the upload and the Evidence Processor. */
  s3Key?: string;
  contentType?: string;
  sizeBytes?: number;
}

export type IndexType = "SHA256" | "PHASH" | "IDENTIFIER";

export interface AuditRecord {
  tenantId: string;
  claimId: string;
  requestId?: string;
  timestamp: string;
  actor: { type: "agent" | "adjuster" | "system"; id: string };
  outcome: Decision["outcome"];
  policyId: string;
  policyVersion: number;
  packVersion: number;
  thresholds: Record<string, number | boolean | string>;
  checksPassed: string[];
  checksFailed: string[];
  riskSignals: string[];
  informationalFlags: string[];
  amountClaimed?: number;
  payout?: number;
  reasonCode?: string;
  model?: string;
  promptVersion?: string;
  ticketJti?: string;
}

export interface CommitInput {
  claim: ClaimRecord;
  decision: Decision;
  audit: AuditRecord;
  decidedAt: string;
}

export type CommitResult = "COMMITTED" | "ALREADY_DECIDED";

/** Everything the handler reads or writes in DynamoDB. */
export interface Store {
  getClaim(tenantId: string, claimId: string): Promise<ClaimRecord | undefined>;
  getPolicyVersions(tenantId: string, policyId: string): Promise<Policy[]>;
  getPack(tenantId: string, category: string): Promise<ClaimTypePack | undefined>;
  /** Missing entries are not an error: return what exists. */
  getEvidence(tenantId: string, evidenceIds: string[]): Promise<EvidenceRecord[]>;
  /** Claim IDs, other than `excludeClaimId`, that own an index entry for this type and value. Rows not yet assigned to a claim are ignored. */
  findOtherClaims(tenantId: string, type: IndexType, value: string, excludeClaimId: string): Promise<string[]>;
  /** Claims by this customer created at or after `sinceIso`, not counting `excludeClaimId`. */
  countRecentClaims(tenantId: string, customerId: string, sinceIso: string, excludeClaimId: string): Promise<number>;
  /** One transaction: claim update (only from PROCESSING) plus audit put. */
  commitDecision(input: CommitInput): Promise<CommitResult>;
}

export interface KillSwitch {
  /** True only when the parameter reads exactly "true". Any failure reads as false. */
  isEnabled(): Promise<boolean>;
}

export interface MetricsSink {
  count(name: "AutoApproved" | "Routed" | "FailSafeRouted", dimensions?: Record<string, string>): void;
  latency(ms: number): void;
  flush(): void;
}

export interface LogSink {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface DecisionConfig {
  earlyClaimDays: number;
  outlierMultiplier: number;
  frequencyWindowDays: number;
  frequencyMaxClaims: number;
}

export interface Deps {
  store: Store;
  killSwitch: KillSwitch;
  metrics: MetricsSink;
  log: LogSink;
  config: DecisionConfig;
  now: () => Date;
}

export interface InvokeContext {
  awsRequestId: string;
}

export interface DecideEvent {
  tenantId: string;
  claimId: string;
  /** Required unless `route` is set. */
  proposal?: unknown;
  /** Route mode: skip evaluation and route with fixed text. Never produces AUTO_APPROVED. */
  route?: "EVIDENCE_NOT_READY" | "AUTOMATIC_CHECK_UNAVAILABLE";
  /** Job ticket ID, recorded in the audit log. */
  jti?: string;
}

export type DecideResult =
  | { result: "DECIDED"; decision: Decision }
  | { result: "ALREADY_DECIDED"; claimId: string }
  | { result: "NOT_FOUND"; claimId: string };

/** The part of an SQS event this Lambda reads. Same shape SQS delivers, so T-09 can wire the DLQ unchanged. */
export interface SqsEvent {
  Records: { messageId: string; body: string }[];
}

export interface SqsBatchResponse {
  batchItemFailures: { itemIdentifier: string }[];
}
