// Build docs/plan/kickoff.pdf: the plan plus every ticket, one ticket per page.
// Usage: node tools/plan/build-kickoff.mjs   (uses the puppeteer install from tools/diagram)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(root, 'tools', 'diagram', 'package.json'));
const puppeteer = require('puppeteer');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

// Small Markdown subset: headings, tables, lists, checkboxes, code fences, paragraphs.
function md(src) {
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
      continue;
    }
    const h = l.match(/^(#{1,3}) (.*)/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (l.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.slice(1, -1).split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push('<table><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>');
      continue;
    }
    if (/^\s*([-*]|\d+\.) /.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) items.push(lines[i++]);
      out.push('<ul>' + items.map((it) => {
        const nested = /^\s{2,}/.test(it);
        let t = it.replace(/^\s*([-*]|\d+\.) /, '');
        let box = '';
        if (t.startsWith('[ ] ')) { box = '<span class="box">&#9744;</span> '; t = t.slice(4); }
        return `<li class="${nested ? 'nested' : ''}">${box}${inline(t)}</li>`;
      }).join('') + '</ul>');
      continue;
    }
    if (l.trim() === '') { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|\||```|\s*[-*] |\s*\d+\. )/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const planDir = path.join(root, 'docs', 'plan');
const plan = fs.readFileSync(path.join(planDir, 'README.md'), 'utf8');
const tickets = fs.readdirSync(path.join(planDir, 'tickets')).filter((f) => f.endsWith('.md')).sort()
  .map((f) => fs.readFileSync(path.join(planDir, 'tickets', f), 'utf8'));
const diagram = path.join(root, 'docs', 'architecture.png');
const img = fs.existsSync(diagram) ? `<img src="data:image/png;base64,${fs.readFileSync(diagram).toString('base64')}">` : '';

const css = `
body{font-family:Helvetica,Arial,sans-serif;font-size:10.5px;color:#232F3E;line-height:1.4}
h1{font-size:20px;margin:0 0 8px}h2{font-size:14px;margin:14px 0 6px;border-bottom:1px solid #ddd}h3{font-size:12px}
table{border-collapse:collapse;width:100%;margin:6px 0;font-size:inherit}th,td{border:1px solid #ccc;padding:3px 5px;vertical-align:top;text-align:left}
th{background:#F2F4F8}code{background:#F2F4F8;padding:0 2px;font-size:9.5px}pre{background:#F7F7F7;padding:6px;font-size:9px;white-space:pre-wrap}
ul{margin:4px 0;padding-left:16px}li{margin:2px 0}li.nested{margin-left:16px}.box{font-size:12px}
.page{page-break-after:always}.cover p{font-size:12px}img{width:100%;margin:6px 0}`;
const cover = `<div class="page cover"><h1>Instant Claims Agent: team kickoff pack</h1>
<p>Plan, board and ${tickets.length} tickets for the MVP. Source of truth: <code>docs/plan/</code> in the repository. Generated ${new Date().toISOString().slice(0, 10)}.</p>
<h2>Start here</h2><ul>
<li>1. Read sections 1 to 5 of the plan (roles, accounts, practice, Definition of Done, milestones).</li>
<li>2. Agree who is A and who is B. Replace the letters in the board.</li>
<li>3. Start together on T-01, T-02 and T-03 (each in your own account).</li>
<li>4. Then B takes T-04 and A takes T-11, and work proceeds by milestone.</li></ul>
<h2>Architecture</h2>${img}</div>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${cover}
<div class="page">${md(plan)}</div>${tickets.map((t) => `<div class="page">${md(t)}</div>`).join('')}</body></html>`;

const libs = path.join(root, 'tools', 'diagram', '.libs', 'usr', 'lib64');
const env = { ...process.env };
if (fs.existsSync(libs)) env.LD_LIBRARY_PATH = `${libs}:${env.LD_LIBRARY_PATH || ''}`;
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-gpu'], env });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const out = path.join(planDir, 'kickoff.pdf');
  await page.pdf({ path: out, format: 'A4', landscape: true, printBackground: true,
    margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  console.log(`wrote ${path.relative(root, out)}`);
  if (process.argv.includes('--preview')) {
    await page.setViewport({ width: 1120, height: 1400 });
    await page.screenshot({ path: '/tmp/kickoff-preview.png', clip: { x: 0, y: 0, width: 1120, height: 2600 } });
    console.log('preview /tmp/kickoff-preview.png');
  }
} finally {
  await browser.close();
}
