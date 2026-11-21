import type { ClaimTypePack, Policy } from "@claims-agent/domain";
import { claim as makeClaim, pack as defaultPack, photo, policy as defaultPolicy, TENANT } from "./fixtures.js";
import type {
  ClaimRecord, CommitInput, CommitResult, Deps, EvidenceRecord, IndexType, InvokeContext, LogSink, MetricsSink, Store,
} from "../types.js";

export const ctx: InvokeContext = { awsRequestId: "req-1" };

export class FakeStore implements Store {
  claims = new Map<string, ClaimRecord>();
  policies: Policy[] = [defaultPolicy];
  pack: ClaimTypePack | undefined = defaultPack;
  evidence: EvidenceRecord[] = [photo];
  /** key `${type}:${value}` -> other claim IDs */
  others: Record<string, string[]> = {};
  recent = 0;
  commits: CommitInput[] = [];
  /** Store methods that throw. */
  failing = new Set<keyof Store>();
  /** Force commitDecision to report a lost race. */
  loseRace = false;

  constructor(initial: ClaimRecord = makeClaim()) {
    this.claims.set(`${initial.tenantId}#${initial.claimId}`, initial);
  }

  private maybeFail(m: keyof Store) {
    if (this.failing.has(m)) throw new Error(`boom: ${m}`);
  }
  async getClaim(t: string, id: string) { this.maybeFail("getClaim"); return this.claims.get(`${t}#${id}`); }
  async getPolicyVersions() { this.maybeFail("getPolicyVersions"); return this.policies; }
  async getPack() { this.maybeFail("getPack"); return this.pack; }
  async getEvidence(_t: string, ids: string[]) {
    this.maybeFail("getEvidence");
    return this.evidence.filter((e) => ids.includes(e.evidenceId));
  }
  async findOtherClaims(_t: string, type: IndexType, value: string) {
    this.maybeFail("findOtherClaims");
    return this.others[`${type}:${value}`] ?? [];
  }
  async countRecentClaims() { this.maybeFail("countRecentClaims"); return this.recent; }
  async commitDecision(input: CommitInput): Promise<CommitResult> {
    this.maybeFail("commitDecision");
    const key = `${input.claim.tenantId}#${input.claim.claimId}`;
    const current = this.claims.get(key);
    if (this.loseRace || !current || current.status !== "PROCESSING") return "ALREADY_DECIDED";
    this.commits.push(input);
    this.claims.set(key, { ...current, status: input.decision.outcome });
    return "COMMITTED";
  }
}

export function makeDeps(opts: { store?: FakeStore; killSwitch?: boolean } = {}) {
  const store = opts.store ?? new FakeStore();
  const state = { killSwitch: opts.killSwitch ?? true };
  const metrics = { counts: [] as { name: string; dims?: Record<string, string> }[], latencies: [] as number[], flushes: 0 };
  const logs: { level: string; message: string; fields?: Record<string, unknown> }[] = [];
  const sink: MetricsSink = {
    count: (name, dims) => metrics.counts.push({ name, dims }),
    latency: (ms) => metrics.latencies.push(ms),
    flush: () => { metrics.flushes++; },
  };
  const log: LogSink = {
    info: (message, fields) => logs.push({ level: "info", message, fields }),
    warn: (message, fields) => logs.push({ level: "warn", message, fields }),
    error: (message, fields) => logs.push({ level: "error", message, fields }),
  };
  let t = Date.parse("2026-11-21T10:00:04.000Z");
  const deps: Deps = {
    store,
    killSwitch: { isEnabled: async () => state.killSwitch },
    metrics: sink,
    log,
    config: { earlyClaimDays: 14, outlierMultiplier: 2, frequencyWindowDays: 30, frequencyMaxClaims: 3 },
    now: () => new Date((t += 5)),
  };
  return { deps, store, state, metrics, logs, tenantId: TENANT };
}
