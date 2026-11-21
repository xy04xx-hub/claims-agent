import { describe, expect, it } from "vitest";
import { CachedKillSwitch } from "./kill-switch.js";

function setup(values: (string | Error | undefined)[]) {
  let reads = 0;
  let clock = 1_000_000;
  const read = async () => {
    const v = values[Math.min(reads++, values.length - 1)];
    if (v instanceof Error) throw v;
    return v;
  };
  return { ks: new CachedKillSwitch(read, () => clock), reads: () => reads, advance: (ms: number) => { clock += ms; } };
}

describe("CachedKillSwitch", () => {
  it("reads true only for the exact string true", async () => {
    expect(await setup(["true"]).ks.isEnabled()).toBe(true);
    for (const v of ["false", "TRUE", "1", "", undefined]) expect(await setup([v]).ks.isEnabled()).toBe(false);
  });

  it("caches for under 60 s and reads again at 60 s", async () => {
    const s = setup(["true", "false"]);
    expect(await s.ks.isEnabled()).toBe(true);
    s.advance(59_999);
    expect(await s.ks.isEnabled()).toBe(true);
    expect(s.reads()).toBe(1);
    s.advance(1);
    expect(await s.ks.isEnabled()).toBe(false);
    expect(s.reads()).toBe(2);
  });

  it("a failed read means disabled and is not cached", async () => {
    const s = setup([new Error("ssm down"), "true"]);
    expect(await s.ks.isEnabled()).toBe(false);
    expect(await s.ks.isEnabled()).toBe(true);
    expect(s.reads()).toBe(2);
  });
});
