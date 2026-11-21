// COPY of seed/lib/png.ts. It must stay identical to that file from the next line on.
// parity.test.ts fails if the two differ. Change seed/lib first, then copy the change here.
// Owner: A. Minimal PNG encoder and decoder. Uses only node:zlib. Enough for the synthetic evidence images.
import { deflateSync, inflateSync } from "node:zlib";

export interface RawImage {
  width: number;
  height: number;
  /** 1 (gray), 3 (RGB) or 4 (RGBA). */
  channels: 1 | 3 | 4;
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encodes 8-bit RGB pixels (width * height * 3 bytes). */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  if (rgb.length !== width * height * 3) throw new RangeError("encodePng: pixel buffer has the wrong size");
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CHANNELS: Record<number, 1 | 3 | 4> = { 0: 1, 2: 3, 6: 4 };

/** Decodes 8-bit, non-interlaced PNGs of color type 0, 2 or 6. Anything else throws `Unsupported PNG: <reason>`. */
export function decodePng(bytes: Uint8Array): RawImage {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("Unsupported PNG: bad signature");
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels: 1 | 3 | 4 = 3;
  const idat: Buffer[] = [];
  let sawHeader = false;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colorType = data[9] ?? -1;
      if (depth !== 8) throw new Error(`Unsupported PNG: bit depth ${depth}`);
      if (data[12] !== 0) throw new Error("Unsupported PNG: interlaced");
      const ch = CHANNELS[colorType];
      if (!ch) throw new Error(`Unsupported PNG: color type ${colorType}`);
      channels = ch;
      sawHeader = true;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!sawHeader || width === 0 || height === 0) throw new Error("Unsupported PNG: missing IHDR");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("Unsupported PNG: truncated data");
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x] ?? 0;
      const a = x >= channels ? (out[y * stride + x - channels] ?? 0) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] ?? 0) : 0;
      let v: number;
      switch (ft) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Unsupported PNG: filter ${ft}`);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}
