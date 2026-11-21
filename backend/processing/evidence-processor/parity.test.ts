// Owner: A. Ties the processor copies of the hashing code to seed/lib, so the two cannot drift.
// Test files are never bundled, so reading seed/ here does not put it in the Lambda.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dhash64Hex as seedDhash, sha256Hex as seedSha } from "../../../seed/lib/hashing.js";
import { decodePng as seedDecode } from "../../../seed/lib/png.js";
import { dhash64Hex, sha256Hex } from "./hashing.js";
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
