// Owner: A. Dependency-free generator of the synthetic evidence PNGs in seed/evidence/.
// Run by hand: npx tsx seed/tools/generate-evidence.ts. seed.ts never runs it.
// Every file is a flat drawing with bitmap text, not a photograph, and says so on the image.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../lib/png.js";
import { glyph, GLYPH_H, GLYPH_W } from "./font5x7.js";
import {
  HOLDER_NAME, IMEI_MISMATCH, IMEI_PHONE_1, IMEI_PHONE_2, PLATE_CAR_1, SCENARIO_LOSS_DATE,
} from "../definitions/constants.js";

type Rgb = [number, number, number];
const WIDTH = 800;
const HEIGHT = 600;
const BANNER = "SYNTHETIC SAMPLE - NOT A REAL DOCUMENT";

class Canvas {
  readonly px = new Uint8Array(WIDTH * HEIGHT * 3);
  constructor(bg: Rgb) { this.fillRect(0, 0, WIDTH, HEIGHT, bg); }
  fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = Math.max(0, y); j < Math.min(HEIGHT, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(WIDTH, x + w); i++) {
        const o = (j * WIDTH + i) * 3;
        this.px[o] = c[0]; this.px[o + 1] = c[1]; this.px[o + 2] = c[2];
      }
    }
  }
  frame(x: number, y: number, w: number, h: number, t: number, c: Rgb): void {
    this.fillRect(x, y, w, t, c); this.fillRect(x, y + h - t, w, t, c);
    this.fillRect(x, y, t, h, c); this.fillRect(x + w - t, y, t, h, c);
  }
  /** Bresenham line, 3 px thick. */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    let x = x0, y = y0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.fillRect(x - 1, y - 1, 3, 3, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  text(x: number, y: number, s: string, scale: number, c: Rgb): void {
    let cx = x;
    for (const ch of s) {
      glyph(ch).forEach((row, r) => {
        for (let k = 0; k < GLYPH_W; k++) if (row[k] === "#") this.fillRect(cx + k * scale, y + r * scale, scale, scale, c);
      });
      cx += (GLYPH_W + 1) * scale;
    }
    void GLYPH_H;
  }
  png(): Buffer { return encodePng(WIDTH, HEIGHT, this.px); }
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [20, 20, 20];
const RED: Rgb = [190, 30, 30];

function banner(c: Canvas): void { c.text(40, HEIGHT - 50, BANNER, 3, RED); }

function damagedPhone(imei: string): Buffer {
  const c = new Canvas([225, 232, 240]);
  c.fillRect(60, 40, 300, 500, BLACK); // phone body
  c.fillRect(75, 70, 270, 440, [245, 245, 250]); // screen
  c.line(90, 90, 300, 300, BLACK); c.line(300, 300, 200, 480, BLACK); // cracks
  c.line(300, 300, 340, 200, BLACK); c.line(150, 200, 320, 130, BLACK);
  c.fillRect(380, 90, 410, 330, WHITE); c.frame(380, 90, 410, 330, 4, BLACK); // about phone panel
  c.text(400, 110, "ABOUT PHONE", 4, BLACK);
  c.text(400, 190, "MODEL: DEMO X", 4, BLACK);
  c.text(400, 260, "IMEI:", 4, BLACK);
  c.text(400, 310, imei, 4, BLACK);
  banner(c);
  return c.png();
}

function policeReport(imei: string): Buffer {
  const c = new Canvas(WHITE);
  c.frame(20, 20, WIDTH - 40, HEIGHT - 40, 4, BLACK);
  c.text(60, 50, "POLICE REPORT", 6, BLACK);
  c.text(60, 130, "REPORT NO: SYN-2026-00417", 4, BLACK);
  c.text(60, 190, `NAME: ${HOLDER_NAME.toUpperCase()}`, 4, BLACK);
  c.text(60, 250, `IMEI: ${imei}`, 4, BLACK);
  c.text(60, 310, `INCIDENT DATE: ${SCENARIO_LOSS_DATE}`, 4, BLACK);
  c.text(60, 370, `REPORT DATE: ${SCENARIO_LOSS_DATE}`, 4, BLACK);
  c.text(60, 430, "ITEM: MOBILE PHONE STOLEN", 4, BLACK);
  banner(c);
  return c.png();
}

function mug(): Buffer {
  const c = new Canvas([236, 228, 214]);
  c.fillRect(250, 160, 240, 280, [60, 110, 190]);
  c.frame(480, 210, 90, 150, 18, [60, 110, 190]); // handle
  c.fillRect(250, 160, 240, 24, [30, 60, 120]);
  c.text(230, 480, "COFFEE MUG", 6, BLACK);
  banner(c);
  return c.png();
}

function carPlate(): Buffer {
  const c = new Canvas([215, 225, 215]);
  c.fillRect(120, 200, 560, 200, [70, 90, 130]); // body
  c.fillRect(220, 120, 360, 100, [70, 90, 130]); // cabin
  c.fillRect(250, 135, 130, 70, [200, 225, 240]); c.fillRect(400, 135, 150, 70, [200, 225, 240]);
  c.fillRect(160, 390, 90, 90, BLACK); c.fillRect(550, 390, 90, 90, BLACK); // wheels
  c.fillRect(280, 300, 240, 70, WHITE); c.frame(280, 300, 240, 70, 4, BLACK);
  c.text(300, 316, PLATE_CAR_1, 6, BLACK);
  banner(c);
  return c.png();
}

/** File name to PNG bytes. Deterministic pixels. Bytes may differ between zlib versions, so tests compare pixels. */
export function generateAll(): Record<string, Buffer> {
  return {
    "phone-damaged-imei1.png": damagedPhone(IMEI_PHONE_1),
    "phone-damaged-imei2.png": damagedPhone(IMEI_PHONE_2),
    "police-report-phone1.png": policeReport(IMEI_PHONE_1),
    "police-report-phone2.png": policeReport(IMEI_PHONE_2),
    "police-report-imei-mismatch.png": policeReport(IMEI_MISMATCH),
    "non-phone-mug.png": mug(),
    "car-plate.png": carPlate(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../evidence");
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(generateAll())) {
    writeFileSync(path.join(dir, name), bytes);
    console.log(`wrote seed/evidence/${name} (${bytes.length} bytes)`);
  }
}
