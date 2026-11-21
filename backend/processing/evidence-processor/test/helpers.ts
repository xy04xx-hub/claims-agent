// Owner: A. Test helpers: JPEG with EXIF, PNG, PDF and fake dependencies.
import { encodePng } from "../png.js";
import type { ObjectData, ProcessDeps } from "../process.js";
import type { EvidenceRow } from "../process.js";

/** A minimal JPEG: SOI, optional APP1 Exif segment with DateTimeOriginal, EOI. */
export function buildJpeg(opts: { date?: string; endian?: "little" | "big"; exifIfd?: boolean; dateTag?: number } = {}): Uint8Array {
  const little = (opts.endian ?? "little") === "little";
  const w16 = (n: number) => (little ? [n & 0xff, (n >> 8) & 0xff] : [(n >> 8) & 0xff, n & 0xff]);
  const w32 = (n: number) => (little ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff] : [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  if (opts.date === undefined && opts.exifIfd === undefined) return Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const text = [...Buffer.from(`${opts.date ?? "2026:11:15 10:20:30"}\0`, "ascii")];
  // TIFF: header(8) | IFD0 at 8: 1 entry (0x8769 -> ExifIFD) | ExifIFD: 1 entry (tag) | string
  const ifd0 = 8;
  const exifIfd = ifd0 + 2 + 12 + 4;
  const strOff = exifIfd + 2 + 12 + 4;
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...w16(42), ...w32(ifd0),
    ...w16(1), ...w16(0x8769), ...w16(4), ...w32(1), ...w32(exifIfd), ...w32(0),
    ...w16(opts.exifIfd === false ? 0 : 1),
    ...(opts.exifIfd === false ? [] : [...w16(opts.dateTag ?? 0x9003), ...w16(2), ...w32(text.length), ...w32(strOff)]),
    ...w32(0), ...text,
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = payload.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload, 0xff, 0xd9]);
}

export function buildPng(width = 16, height = 16, seed = 1): Buffer {
  const px = new Uint8Array(width * height * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 7 + seed * 31 + ((i / 3) | 0) * seed) & 0xff;
  return encodePng(width, height, px);
}

export const buildPdf = (): Buffer => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

export const BUCKET = "evidence-bucket";
export const KEY = "demo-insurer/cust-demo/EVD-T13-1";

export function s3Event(over: { bucket?: string; key?: string; size?: number; time?: string } = {}) {
  return {
    version: "0", id: "evt-1", "detail-type": "Object Created" as const, source: "aws.s3" as const, account: "000000000000",
    time: over.time ?? "2026-11-21T10:00:00Z", region: "us-east-1", resources: [],
    detail: {
      version: "0", bucket: { name: over.bucket ?? BUCKET },
      object: { key: over.key ?? KEY, size: over.size ?? 1000, etag: "e", sequencer: "s" },
      "request-id": "r", requester: "x", reason: "PutObject",
    },
  };
}

export function fakeDeps(objects: Record<string, ObjectData> = {}) {
  const table = new Map<string, EvidenceRow>();
  const logs: { level: "info" | "warn"; message: string; fields?: Record<string, unknown> }[] = [];
  const calls = { getObject: 0, putRows: 0 };
  const fail = { get: false, put: false, putOnce: false };
  let clock = 0;
  const deps: ProcessDeps = {
    getObject: async (_b, key) => {
      calls.getObject++;
      if (fail.get) throw new Error("s3 boom");
      const o = objects[key];
      if (!o) throw new Error("NoSuchKey");
      return o;
    },
    putRows: async (rows) => {
      calls.putRows++;
      if (fail.put || fail.putOnce) { fail.putOnce = false; throw new Error("ddb boom"); }
      for (const r of rows) table.set(`${r.pk}|${r.sk}`, structuredClone(r));
    },
    log: {
      info: (message, fields) => logs.push({ level: "info", message, fields }),
      warn: (message, fields) => logs.push({ level: "warn", message, fields }),
    },
    now: () => new Date(Date.parse("2026-11-21T10:00:00Z") + (clock += 25)),
  };
  return { deps, table, logs, calls, fail };
}
