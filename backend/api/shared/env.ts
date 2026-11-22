// Lazy environment access for the API entry points (T-09). Values are read when first used, not at module
// load, so the bundle can be imported (cold-start test, tooling) without the Lambda environment.
import type { Tables } from "../../processing/decision/dynamo-store.js";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Table names resolved on first property read. */
export function lazyTables(): Tables {
  return {
    get claims() { return env("CLAIMS_TABLE"); },
    get policies() { return env("POLICIES_TABLE"); },
    get packs() { return env("PACKS_TABLE"); },
    get evidenceIndex() { return env("EVIDENCE_INDEX_TABLE"); },
    get audit() { return env("AUDIT_TABLE"); },
  };
}

export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function maxUploadBytes(): number {
  const n = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES;
}
