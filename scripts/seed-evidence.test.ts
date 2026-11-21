// Owner: A. Tests of the PNG codec, the hash helpers and the committed evidence files.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EVIDENCE_FILES } from "../seed/definitions/index.js";
import { dhash64Hex, normalizeIdentifier, sha256Hex } from "../seed/lib/hashing.js";
import { decodePng, encodePng } from "../seed/lib/png.js";
import { generateAll } from "../seed/tools/generate-evidence.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../seed/evidence");

describe("png and hashing", () => {
  const image = fc.record({ w: fc.integer({ min: 1, max: 40 }), h: fc.integer({ min: 1, max: 40 }) }).chain(({ w, h }) =>
    fc.uint8Array({ minLength: w * h * 3, maxLength: w * h * 3 }).map((px) => ({ w, h, px })));

  it("Property 10: encode then decode returns the same pixels and the hash is 16 hex characters", () => {
    fc.assert(fc.property(image, ({ w, h, px }) => {
      const dec = decodePng(encodePng(w, h, px));
      expect([dec.width, dec.height, dec.channels]).toEqual([w, h, 3]);
      expect(Buffer.from(dec.data).equals(Buffer.from(px))).toBe(true);
      expect(dhash64Hex(dec)).toMatch(/^[0-9a-f]{16}$/);
      expect(dhash64Hex(dec)).toBe(dhash64Hex(dec));
    }));
  });
  it("decodePng rejects unsupported input", () => {
    expect(() => decodePng(Buffer.from("not a png"))).toThrow(/Unsupported PNG/);
  });
  it("normalizeIdentifier is idempotent and matches the Decision Lambda format", () => {
    fc.assert(fc.property(fc.string(), (s) => { expect(normalizeIdentifier(normalizeIdentifier(s))).toBe(normalizeIdentifier(s)); }));
    expect(normalizeIdentifier("35 6938-0356 43809")).toBe("356938035643809");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("committed evidence files", () => {
  const fresh = generateAll();
  const readme = readFileSync(path.join(dir, "README.md"), "utf8");
  it.each(EVIDENCE_FILES.map((f) => f.name))("%s matches the generator, is small and is documented", (name) => {
    const file = path.join(dir, name);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThanOrEqual(5 * 1024 * 1024);
    const a = decodePng(readFileSync(file));
    const b = decodePng(fresh[name] as Buffer);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(readme).toContain(name);
  });
  it("the generator produces exactly the manifest", () => {
    expect(Object.keys(fresh).sort()).toEqual(EVIDENCE_FILES.map((f) => f.name).sort());
  });
});
