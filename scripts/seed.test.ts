// Owner: A. Tests of runSeed and stage resolution with fake dependencies.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runSeed, type SeedDeps } from "./seed.js";
import { MissingResourceError, resolveFoundation, resolveProcessing, type CfnLike } from "../seed/lib/stage-resources.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../seed/evidence");
const NAMES = { claims: "claims", policies: "policies", packs: "packs", evidenceIndex: "evidence", bucket: "bucket" };

function fake(over: Partial<SeedDeps> = {}) {
  const store = new Map<string, Record<string, unknown>>();
  const objects: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const deps: SeedDeps = {
    resolveFoundation: async () => NAMES,
    readEvidenceFile: (n) => readFileSync(path.join(dir, n)),
    putObject: async (b, k) => { objects.push(`${b}/${k}`); },
    putItem: async (t, i) => { store.set(`${t}|${String(i.pk)}|${String(i.sk)}`, i); },
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    ...over,
  };
  return { deps, store, objects, logs, errors };
}
const counts = (store: Map<string, unknown>) => {
  const c: Record<string, number> = {};
  for (const k of store.keys()) c[k.split("|")[0] as string] = (c[k.split("|")[0] as string] ?? 0) + 1;
  return c;
};

describe("runSeed", () => {
  it("prints usage for a missing or unknown stage and writes nothing", async () => {
    for (const argv of [[], ["--stage"], ["--stage", "prod"]]) {
      const f = fake();
      expect(await runSeed(argv, f.deps)).toBe(1);
      expect(f.errors.join("\n")).toContain("Usage");
      expect(f.store.size + f.objects.length).toBe(0);
    }
  });
  it("names a missing output and writes nothing", async () => {
    const f = fake({ resolveFoundation: async () => { throw new MissingResourceError("output ClaimsTableName"); } });
    expect(await runSeed(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.errors[0]).toContain("output ClaimsTableName");
    expect(f.store.size + f.objects.length).toBe(0);
  });
  it("names a missing evidence file and writes nothing", async () => {
    const f = fake({ readEvidenceFile: (n) => { if (n === "car-plate.png") throw new Error("ENOENT"); return readFileSync(path.join(dir, n)); } });
    expect(await runSeed(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.errors[0]).toContain("car-plate.png");
    expect(f.store.size + f.objects.length).toBe(0);
  });
  it("rejects a file that is not an image", async () => {
    const f = fake({ readEvidenceFile: () => Buffer.from("hello") });
    expect(await runSeed(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.errors[0]).toContain("not PNG, JPEG or PDF");
  });
  it("a failed S3 upload leaves no DynamoDB write", async () => {
    const f = fake({ putObject: async () => { throw new Error("denied"); } });
    expect(await runSeed(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.store.size).toBe(0);
  });
  it("a failed put stops, names the table and exits 1", async () => {
    let n = 0;
    const f = fake({ putItem: async (t) => { if (t === "packs" && ++n === 2) throw new Error("throttled"); } });
    expect(await runSeed(["--stage", "dev-a"], f.deps)).toBe(1);
    expect(f.errors[0]).toContain("ClaimTypePacks (packs)");
  });
  it("Property 1: two runs write the same keys and the same row counts", async () => {
    const f = fake();
    expect(await runSeed(["--stage", "dev-a"], f.deps)).toBe(0);
    const keys1 = [...f.store.keys()].sort();
    const c1 = counts(f.store);
    const snapshot = JSON.stringify([...f.store.entries()].sort());
    expect(await runSeed(["--stage", "dev-a"], f.deps)).toBe(0);
    expect([...f.store.keys()].sort()).toEqual(keys1);
    expect(counts(f.store)).toEqual(c1);
    expect(JSON.stringify([...f.store.entries()].sort())).toBe(snapshot);
    expect(f.objects).toEqual(["bucket/demo-insurer/cust-demo/EVD-1042-1", "bucket/demo-insurer/cust-demo/EVD-1042-1"]);
    expect(f.logs).toContain("Policies: 2");
    expect(f.logs).toContain("ClaimTypePacks: 3");
    expect(f.logs).toContain("Claims: 1");
  });
  it("prints no ARN or account number", async () => {
    const f = fake();
    await runSeed(["--stage", "dev-a"], f.deps);
    expect([...f.logs, ...f.errors].join("\n")).not.toMatch(/arn:aws|\b\d{12}\b/);
  });
});

describe("stage resolution", () => {
  const cfn = (outputs: Record<string, string>, tables: { logicalId: string; physicalId: string }[]): CfnLike => ({
    describeOutputs: async () => outputs,
    listTables: async () => tables,
  });
  const base = { ClaimsTableName: "c", EvidenceBucketName: "b" };
  const tables = [
    { logicalId: "PoliciesTableB128A423", physicalId: "p" },
    { logicalId: "ClaimTypePacksTable2D026E1F", physicalId: "k" },
    { logicalId: "EvidenceIndexTableCC0C8C88", physicalId: "e" },
    { logicalId: "ClaimsTableD23EAB22", physicalId: "other" },
  ];
  it("falls back to the logical ID of the Foundation resources", async () => {
    expect(await resolveFoundation(cfn(base, tables), "dev-a")).toEqual({ claims: "c", bucket: "b", policies: "p", packs: "k", evidenceIndex: "e" });
  });
  it("prefers an output when one exists", async () => {
    const r = await resolveFoundation(cfn({ ...base, PoliciesTableName: "from-output" }, tables), "dev-a");
    expect(r.policies).toBe("from-output");
  });
  it("names a missing output or table", async () => {
    await expect(resolveFoundation(cfn({ EvidenceBucketName: "b" }, tables), "dev-a")).rejects.toThrow("output ClaimsTableName");
    await expect(resolveFoundation(cfn(base, tables.slice(1)), "dev-a")).rejects.toThrow("table Policies");
    await expect(resolveProcessing(cfn({}, []), "dev-a")).rejects.toThrow("output DecisionFunctionName");
  });
});
