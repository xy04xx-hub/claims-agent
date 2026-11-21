// Owner: A. Hand-written reader of the EXIF DateTimeOriginal tag of a JPEG. No dependencies. Never throws.
// JPEG -> APP1 "Exif\0\0" -> TIFF header -> IFD0 -> ExifIFD (tag 0x8769) -> DateTimeOriginal (tag 0x9003, ASCII).

interface Tiff { u16(o: number): number | undefined; u32(o: number): number | undefined; start: number; end: number }

function entry(t: Tiff, ifd: number, tag: number): { type: number; count: number; valueOffset: number } | undefined {
  const base = t.start + ifd;
  const declared = t.u16(base);
  if (declared === undefined) return undefined;
  // A lying entry count cannot run past the TIFF block.
  const count = Math.min(declared, Math.max(0, Math.floor((t.end - (base + 2)) / 12)));
  for (let i = 0; i < count; i++) {
    const o = base + 2 + 12 * i;
    if (t.u16(o) !== tag) continue;
    const type = t.u16(o + 2);
    const n = t.u32(o + 4);
    const v = t.u32(o + 8);
    if (type === undefined || n === undefined || v === undefined) return undefined;
    return { type, count: n, valueOffset: v };
  }
  return undefined;
}

function parseTiff(bytes: Uint8Array, start: number, end: number): string | null {
  const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
  const big = bytes[start] === 0x4d && bytes[start + 1] === 0x4d;
  if (!little && !big) return null;
  const inRange = (o: number, n: number) => o >= start && o + n <= end;
  const t: Tiff = {
    start, end,
    u16: (o) => (inRange(o, 2) ? (little ? (bytes[o] as number) | ((bytes[o + 1] as number) << 8) : ((bytes[o] as number) << 8) | (bytes[o + 1] as number)) : undefined),
    u32: (o) =>
      inRange(o, 4)
        ? little
          ? ((bytes[o] as number) | ((bytes[o + 1] as number) << 8) | ((bytes[o + 2] as number) << 16) | ((bytes[o + 3] as number) << 24)) >>> 0
          : (((bytes[o] as number) << 24) | ((bytes[o + 1] as number) << 16) | ((bytes[o + 2] as number) << 8) | (bytes[o + 3] as number)) >>> 0
        : undefined,
  };
  if (t.u16(start + 2) !== 42) return null;
  const ifd0 = t.u32(start + 4);
  if (ifd0 === undefined) return null;
  const exifPtr = entry(t, ifd0, 0x8769);
  if (!exifPtr) return null;
  const dto = entry(t, exifPtr.valueOffset, 0x9003);
  if (!dto || dto.type !== 2 || dto.count < 19 || dto.count > 20) return null;
  const from = start + dto.valueOffset;
  if (!inRange(from, dto.count)) return null;
  const text = String.fromCharCode(...bytes.subarray(from, from + dto.count)).replace(/\0+$/, "");
  const m = /^(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Cameras with an unset clock write 0000:00:00. Reject it and any impossible calendar date.
  if (y < 1900 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** The capture date as YYYY-MM-DD, or null when the file is not a JPEG, has no EXIF, or the data is malformed. */
export function parseExifDate(bytes: Uint8Array): string | null {
  try {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let off = 2;
    while (off + 4 <= bytes.length) {
      if (bytes[off] !== 0xff) return null;
      while (bytes[off + 1] === 0xff) off++; // fill bytes
      const marker = bytes[off + 1] as number;
      if (marker === 0xd9 || marker === 0xda) return null; // end of image, start of scan: Exif always comes first
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
      const len = ((bytes[off + 2] as number) << 8) | (bytes[off + 3] as number);
      if (len < 2 || off + 2 + len > bytes.length) return null;
      const payload = off + 4;
      const isExif = marker === 0xe1 && [0x45, 0x78, 0x69, 0x66, 0x00, 0x00].every((b, i) => bytes[payload + i] === b);
      if (isExif) return parseTiff(bytes, payload + 6, off + 2 + len);
      off += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}
