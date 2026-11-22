// Owner: B. Drives the deployed console with puppeteer: customer files scenario A and H, adjuster approves H.
// Usage: CONSOLE_URL=https://... E2E_CUSTOMER_PASSWORD=... E2E_ADJUSTER_PASSWORD=... node tests/e2e/console-ui.mjs
import puppeteer from 'puppeteer';
import path from 'node:path';

const URL_ = process.env.CONSOLE_URL;
const need = (n) => process.env[n] ?? (() => { throw new Error(`Missing ${n}`); })();
const CUST = ['customer1@example.com', need('E2E_CUSTOMER_PASSWORD')];
const ADJ = ['adjuster1@example.com', need('E2E_ADJUSTER_PASSWORD')];
const ev = (f) => path.resolve('seed/evidence', f);
const shots = process.env.SHOTS_DIR ?? '/tmp/shots';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

async function signIn(page, [email, pass]) {
  await page.goto(URL_, { waitUntil: 'networkidle0' });
  await Promise.all([page.waitForNavigation(), page.click('button')]);
  await page.waitForSelector('input[name="username"]', { visible: true });
  await page.type('input[name="username"]', email);
  await page.type('input[name="password"]', pass);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('header'), { timeout: 30000 });
}
async function file(page, { cause, amount, item, filename, label }) {
  await page.waitForSelector('select[name=item] option');
  await page.select('select[name=item]', item);
  await page.select('select[name=cause]', cause);
  await page.$eval('input[name=amount]', (e) => (e.value = ''));
  await page.type('input[name=amount]', String(amount));
  await page.$eval('input[name=lossDate]', (e) => (e.value = ''));
  await page.type('input[name=lossDate]', '11152026');
  await page.type('textarea[name=description]', `Synthetic scenario ${label}.`);
  await page.waitForSelector('input[name=file]');
  await (await page.$('input[name=file]')).uploadFile(ev(filename));
  const prev = (await page.$eval('[data-testid=claim-status] h3', (e) => e.textContent).catch(() => '')) ?? '';
  const t0 = Date.now();
  await page.click('button[type=submit]');
  await page.waitForFunction((p) => {
    const t = document.querySelector('[data-testid=claim-status]')?.textContent ?? '';
    return t.startsWith('Claim') && (!p || !t.startsWith(p)) && /Approved|Needs review/.test(t);
  }, { timeout: 40000 }, prev);
  const text = await page.$eval('[data-testid=claim-status]', (e) => e.textContent ?? '');
  console.log(`scenario ${label}: ${Date.now() - t0} ms -> ${text}`);
  await page.screenshot({ path: `${shots}/scenario-${label}.png`, fullPage: true });
  return text;
}
try {
  const c = await browser.newPage();
  c.on('pageerror', (e) => console.log('pageerror', e.message));
  c.on('console', (m) => m.type() === 'error' && console.log('console.error', m.text()));
  await signIn(c, CUST);
  const a = await file(c, { cause: 'ACCIDENTAL_DAMAGE', amount: 180, item: 'ITEM-PHONE-1', filename: 'phone-damaged-imei1.png', label: 'A' });
  const h = await file(c, { cause: 'THEFT', amount: 300, item: 'ITEM-PHONE-2', filename: 'police-report-phone2.png', label: 'H' });
  const m = await browser.createBrowserContext();
  const p = await m.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await signIn(p, ADJ);
  p.on('console', (m) => console.log('adjuster console:', m.text()));
  await p.waitForSelector('[data-testid=queue-item]', { timeout: 20000 }).catch(async (e) => { console.log('PAGE:', await p.$eval('body', (b) => b.innerText)); throw e; });
  await p.screenshot({ path: `${shots}/adjuster-queue.png`, fullPage: true });
  const before = await p.$$eval('[data-testid=queue-item]', (n) => n.length);
  const hId = /Claim (CLM-[0-9a-f]{16})/.exec(h)[1];
  const items = await p.$$('[data-testid=queue-item]');
  let target;
  for (const it of items) if ((await it.evaluate((e) => e.textContent)).includes(hId)) target = it;
  if (!target) throw new Error(`claim ${hId} is not in the queue`);
  await (await target.$('button:not(.link):not(.danger)')).click();
  await p.waitForSelector('[role=status]', { timeout: 20000 });
  await p.waitForFunction((n) => document.querySelectorAll('[data-testid=queue-item]').length < n, { timeout: 15000 }, before).catch(() => undefined);
  const after = await p.$$eval('[data-testid=queue-item]', (n) => n.length);
  console.log(`adjuster approve: queue ${before} -> ${after}; ${await p.$eval('[role=status]', (e) => e.textContent)}`);
  console.log(/Approved/.test(a) && /Needs review/.test(h) && after === before - 1 ? 'PASS' : 'FAIL');
} finally {
  await browser.close();
}
