import { GetParameterCommand, type SSMClient } from "@aws-sdk/client-ssm";
import type { KillSwitch } from "./types.js";

export const KILL_SWITCH_TTL_MS = 60_000;

/** Reads a value; throws on failure. Separate from the cache so tests need no AWS client. */
export type ReadParameter = () => Promise<string | undefined>;

/**
 * Cached reader for `autoApproveEnabled`. The value is cached for at most 60 s.
 * Anything other than the exact string "true", and any read failure, means disabled.
 * A failed read is not cached, so the next call tries again.
 */
export class CachedKillSwitch implements KillSwitch {
  private cached?: { value: boolean; at: number };

  constructor(
    private readonly read: ReadParameter,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = KILL_SWITCH_TTL_MS,
  ) {}

  async isEnabled(): Promise<boolean> {
    const t = this.now();
    if (this.cached && t - this.cached.at < this.ttlMs) return this.cached.value;
    try {
      const value = (await this.read())?.trim() === "true";
      this.cached = { value, at: t };
      return value;
    } catch {
      this.cached = undefined;
      return false;
    }
  }
}

export function ssmParameterReader(ssm: Pick<SSMClient, "send">, name: string): ReadParameter {
  return async () => {
    const res = await ssm.send(new GetParameterCommand({ Name: name }));
    return res.Parameter?.Value;
  };
}
