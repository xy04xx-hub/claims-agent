// COPY of seed/lib/hashing.ts. It must stay identical to that file from the next line on.
// parity.test.ts fails if the two differ. Change seed/lib first, then copy the change here.
// Owner: A. Hashing helpers for the seed.
//
// IMPORTANT for T-13 (Evidence Processor): `dhash64Hex` must be the same algorithm that T-13 uses for PHASH values,
// and both must hash the ORIGINAL uploaded file bytes. The Decision Lambda treats an equal PHASH as a near duplicate.
// If T-13 picks another method, change this file in the same PR.
import { createHash } from "node:crypto";
import type { RawImage } from "./png.js";

export const sha256Hex = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** Same as `normId` in backend/processing/decision/evaluate.ts: remove whitespace and hyphens, upper case. */
export const normalizeIdentifier = (s: string): string => s.replace(/[\s-]/g, "").toUpperCase();

/**
 * 64-bit difference hash, 16 lowercase hex characters. Integer arithmetic only, so it is identical on every platform.
 * 1. gray = floor((299 R + 587 G + 114 B) / 1000)
 * 2. average the pixels of a 9 x 8 grid of cells (boundaries floor(i * size / cells))
 * 3. bit = left cell > right cell, row by row, most significant bit first
 */
export function dhash64Hex(img: RawImage): string {
  const { width, height, channels, data } = img;
  const gray = new Int32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o] ?? 0;
    const g = channels >= 3 ? (data[o + 1] ?? 0) : r;
    const b = channels >= 3 ? (data[o + 2] ?? 0) : r;
    gray[i] = Math.floor((299 * r + 587 * g + 114 * b) / 1000);
  }
  const COLS = 9;
  const ROWS = 8;
  const cell = (cx: number, cy: number): number => {
    const x0 = Math.floor((cx * width) / COLS);
    const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / COLS));
    const y0 = Math.floor((cy * height) / ROWS);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / ROWS));
    let sum = 0;
    let n = 0;
    for (let y = y0; y < Math.min(y1, height); y++) {
      for (let x = x0; x < Math.min(x1, width); x++) {
        sum += gray[y * width + x] ?? 0;
        n++;
      }
    }
    return n === 0 ? 0 : Math.floor(sum / n);
  };
  let hex = "";
  for (let y = 0; y < ROWS; y++) {
    let nibble = 0;
    for (let x = 0; x < 8; x++) {
      nibble = (nibble << 1) | (cell(x, y) > cell(x + 1, y) ? 1 : 0);
      if (x === 3 || x === 7) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return hex;
}
