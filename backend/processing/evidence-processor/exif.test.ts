import { describe, expect, it } from "vitest";
import { parseExifDate } from "./exif.js";
import { buildJpeg, buildPdf, buildPng } from "./test/helpers.js";

describe("parseExifDate", () => {
  it.each(["little", "big"] as const)("reads DateTimeOriginal (%s endian)", (endian) => {
    expect(parseExifDate(buildJpeg({ date: "2026:11:15 10:20:30", endian }))).toBe("2026-11-15");
  });
  it("returns null for a JPEG without EXIF", () => expect(parseExifDate(buildJpeg())).toBeNull());
  it("returns null when the ExifIFD has no DateTimeOriginal", () => {
    expect(parseExifDate(buildJpeg({ exifIfd: false }))).toBeNull();
    expect(parseExifDate(buildJpeg({ dateTag: 0x9004 }))).toBeNull();
  });
  it.each(["0000:00:00 00:00:00", "2026:13:40 10:00:00", "2026-11-15 10:20:30", "1800:01:01 00:00:00"])("returns null for %s", (d) => {
    expect(parseExifDate(buildJpeg({ date: d }))).toBeNull();
  });
  it("never throws on any truncation of a valid JPEG", () => {
    const full = buildJpeg({ date: "2026:11:15 10:20:30" });
    for (let n = 0; n < full.length; n++) {
      const r = parseExifDate(full.subarray(0, n));
      expect(r === null || /^\d{4}-\d{2}-\d{2}$/.test(r)).toBe(true);
    }
    expect(parseExifDate(full.subarray(0, full.length - 8))).toBeNull();
  });
  it("survives a lying IFD entry count", () => {
    const j = buildJpeg({ date: "2026:11:15 10:20:30" });
    const bad = Uint8Array.from(j);
    bad[20 + 8 + 1] = 0xff; // IFD0 count low byte (little endian) -> 255 entries
    expect(() => parseExifDate(bad)).not.toThrow();
  });
  it("ignores an APP1 segment that is not Exif", () => {
    const xmp = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0xff, 0xd9]);
    expect(parseExifDate(xmp)).toBeNull();
  });
  it("returns null for PNG, PDF and empty input", () => {
    expect(parseExifDate(buildPng())).toBeNull();
    expect(parseExifDate(buildPdf())).toBeNull();
    expect(parseExifDate(new Uint8Array())).toBeNull();
  });
});
