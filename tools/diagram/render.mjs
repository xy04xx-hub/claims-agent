// Render a .drawio file to PNG (and optionally JPEG) with the draw.io viewer in headless Chrome.
// Usage: node tools/diagram/render.mjs docs/architecture.drawio [--scale 2] [--jpeg]
// Output: <name>.png next to the .drawio file (and <name>.jpg with --jpeg).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('usage: node tools/diagram/render.mjs <file.drawio> [--scale 2] [--jpeg]');
  process.exit(2);
}
const scale = Number(args[args.indexOf('--scale') + 1]) || 2;
const wantJpeg = args.includes('--jpeg');

const viewerPath = path.join(here, '.cache', 'viewer-static.min.js');
if (!fs.existsSync(viewerPath)) {
  fs.mkdirSync(path.dirname(viewerPath), { recursive: true });
  const res = await fetch('https://viewer.diagrams.net/js/viewer-static.min.js');
  if (!res.ok) throw new Error(`could not download draw.io viewer: ${res.status}`);
  fs.writeFileSync(viewerPath, Buffer.from(await res.arrayBuffer()));
}

const xml = fs.readFileSync(input, 'utf8');
const libs = path.join(here, '.libs', 'usr', 'lib64');
const env = { ...process.env };
if (fs.existsSync(libs)) env.LD_LIBRARY_PATH = `${libs}:${env.LD_LIBRARY_PATH || ''}`;

const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-gpu'], env });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 2400, height: 1600, deviceScaleFactor: scale });
  await page.setContent('<html><body style="margin:0;background:#fff"><div id="c"></div></body></html>');
  await page.addScriptTag({ path: viewerPath });
  const size = await page.evaluate(async (xmlText) => {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    const model = doc.querySelector('mxGraphModel');
    const holder = document.getElementById('c');
    const viewer = new GraphViewer(holder, model, { toolbar: null, nav: false, resize: false, 'auto-fit': false, zoom: 1 });
    await new Promise((r) => setTimeout(r, 1500));
    const b = viewer.graph.getGraphBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, xml);
  // Wait for lazily loaded AWS stencils, then re-measure.
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  const pad = 20;
  const clip = { x: Math.max(0, size.x - pad), y: Math.max(0, size.y - pad), width: size.w + pad * 2, height: size.h + pad * 2 };
  await page.setViewport({ width: Math.ceil(clip.x + clip.width + 40), height: Math.ceil(clip.y + clip.height + 40), deviceScaleFactor: scale });
  await new Promise((r) => setTimeout(r, 500));
  const base = input.replace(/\.drawio$/, '');
  await page.screenshot({ path: `${base}.png`, type: 'png', clip });
  console.log(`wrote ${base}.png (${Math.round(clip.width)}x${Math.round(clip.height)} px at ${scale}x)`);
  if (wantJpeg) {
    await page.screenshot({ path: `${base}.jpg`, type: 'jpeg', quality: 92, clip });
    console.log(`wrote ${base}.jpg`);
  }
} finally {
  await browser.close();
}
