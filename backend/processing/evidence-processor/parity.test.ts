// Owner: A. Ties the processor copies of the hashing code to seed/lib, so the two cannot drift.
// Test files are never bundled, so reading seed/ here does not put it in the Lambda.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dhash64Hex as seedDhash, sha256Hex as seedSha } from "../../../seed/lib/hashing.js";
import { decodePng as seedDecode } from "../../../seed/lib/png.js";
import { buildSeedItems } from "../../../seed/definitions/build.js";
import { evidenceSk as seedSk } from "../../../seed/definitions/keys.js";
import { dhash64Hex, sha256Hex } from "./hashing.js";
import { processObject } from "./process.js";
import { BUCKET, fakeDeps, s3Event } from "./test/helpers.js";
import { decodePng } from "./png.js";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const seedDir = new URL("../../../seed/evidence/", import.meta.url);
const pngs = readdirSync(seedDir).filter((f) => f.endsWith(".png"));

describe("copies of seed/lib", () => {
  it.each(["hashing.ts", "png.ts"])("%s is the seed file with a two-line header", (name) => {
    const mine = read(`./${name}`);
    const seed = read(`../../../seed/lib/${name}`);
    expect(mine.startsWith(`// COPY of seed/lib/${name}.`)).toBe(true);
    expect(mine.endsWith(seed)).toBe(true);
    expect(mine.slice(0, mine.length - seed.length).split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("there are seed PNGs to compare", () => expect(pngs.length).toBeGreaterThanOrEqual(7));

  it.each(pngs)("%s gives the same SHA-256 and pHash as the seed code", (name) => {
    const bytes = readFileSync(new URL(name, seedDir));
    expect(sha256Hex(bytes)).toBe(seedSha(bytes));
    expect(dhash64Hex(decodePng(bytes))).toBe(seedDhash(seedDecode(bytes)));
    expect(dhash64Hex(decodePng(bytes))).toMatch(/^[0-9a-f]{16}$/);
  });

  it("same bytes give the same SHA-256, different bytes do not", () => {
    expect(sha256Hex(Buffer.from("a"))).toBe(sha256Hex(Buffer.from("a")));
    expect(sha256Hex(Buffer.from("a"))).not.toBe(sha256Hex(Buffer.from("b")));
  });
});

describe("rows match the seed's CLM-1042 rows", () => {
  const name = "phone-damaged-imei2.png";
  const bytes = readFileSync(new URL(name, seedDir));
  const KEY = "demo-insurer/cust-demo/EVD-T13-PARITY";
  // The seed values come from the SEED implementation, the processor rows from the processor copy.
  const seedItems = buildSeedItems({ sha256: seedSha(bytes), phash: seedDhash(seedDecode(bytes)), sizeBytes: bytes.length, contentType: "image/png" });
  const seedRow = (type: string) => seedItems.evidenceIndex.find((r) => r.claimId === "CLM-1042" && r.type === type)!;

  async function processed() {
    const f = fakeDeps({ [KEY]: { bytes, contentType: "image/png", metadata: { kind: "DEVICE_PHOTO" } } });
    await processObject(s3Event({ key: KEY }), f.deps, { bucket: BUCKET, maxObjectBytes: 10_000_000 }, "req");
    return [...f.table.values()];
  }

  it("the SHA256 and PHASH values and partition keys equal the committed CLM-1042 rows", async () => {
    const rows = await processed();
    for (const type of ["SHA256", "PHASH"]) {
      const mine = rows.find((r) => r.type === type)!;
      expect(mine.value).toBe(seedRow(type).value);
      expect(mine.pk).toBe(seedRow(type).pk);
    }
  });

  it("has the same field set and key formats as the seed row", async () => {
    const mine = (await processed()).find((r) => r.type === "SHA256")!;
    const seed = seedRow("SHA256");
    expect(Object.keys(mine).sort()).toEqual(Object.keys(seed).sort());
    expect(mine.gsi1pk).toBe("demo-insurer#EVD-T13-PARITY");
    expect(mine.gsi1sk).toBe(seed.gsi1sk);
    // after the claim ID, the sort key is the evidence ID in both
    expect(mine.sk).toBe("UNASSIGNED#EVD-T13-PARITY");
    expect(String(seed.sk).split("#")[1]).toBe(seed.evidenceId);
    expect(mine.sk).toBe(seedSk("UNASSIGNED", "EVD-T13-PARITY"));
  });
});
