// Local check of the four issues against the real incident API. It does not ack anything.
// usage: node scripts/check.mjs [dir=app] [seconds=30]
import { chromium } from 'playwright';
import { serve } from './static.mjs';

const dir = process.argv[2] ?? 'app';
const seconds = Number(process.argv[3] ?? 30);
const site = await serve(dir);
const browser = await chromium.launch();
const out = {};

async function open(name, locale, timezoneId) {
  const context = await browser.newContext({ locale, timezoneId, viewport: { width: 1100, height: 720 } });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] console error:`, m.text()));
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  // Hold the first API answer for 1.5 s so the loader is observable.
  let first = true;
  await page.route('**/api/incidents**', async (route) => {
    if (first) { first = false; await new Promise((r) => setTimeout(r, 1500)); }
    await route.continue();
  });
  await page.goto(site.url);
  const loaderShown = await page.locator('[data-testid="loader"]').isVisible();
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  const loaderGone = (await page.locator('[data-testid="loader"]').count()) === 0;
  return { page, context, loaderShown, loaderGone };
}

const berlin = await open('berlin', 'de-DE', 'Europe/Berlin');
const auckland = await open('auckland', 'en-NZ', 'Pacific/Auckland');
const newyork = await open('newyork', 'en-US', 'America/New_York');

const snapshot = (page) => page.evaluate(() => ({
  ids: [...document.querySelectorAll('[data-testid="incident-row"]')].map((r) => r.dataset.id),
  times: [...document.querySelectorAll('[data-testid="incident-row"] time')].slice(0, 2).map((t) => `${t.textContent} <- ${t.getAttribute('datetime')}`),
  last: [...document.querySelectorAll('[data-testid="incident-row"] time')].slice(-1).map((t) => `${t.textContent} <- ${t.getAttribute('datetime')}`),
  ackButtons: document.querySelectorAll('[data-testid="incident-row"] [data-testid="ack"]').length,
  meta: document.querySelector('meta[name="build"]')?.content,
  footer: document.querySelector('[data-testid="build-sha"]')?.textContent,
  status: document.querySelector('.status')?.textContent,
}));

for (const [name, view] of Object.entries({ berlin, auckland, newyork })) {
  out[name] = { loaderShown: view.loaderShown, loaderGone: view.loaderGone, ...(await snapshot(view.page)) };
}

// Watch one board: log every change of the row order, with the top position of the row that was first.
const watch = [];
let before = (await snapshot(berlin.page)).ids;
const started = Date.now();
while (Date.now() - started < seconds * 1000) {
  await berlin.page.waitForTimeout(250);
  const now = (await snapshot(berlin.page)).ids;
  if (now.join() !== before.join()) {
    watch.push({ atSeconds: ((Date.now() - started) / 1000).toFixed(1), added: now.filter((id) => !before.includes(id)), removed: before.filter((id) => !now.includes(id)), top: now[0], rows: now.length });
    before = now;
  }
}
out.watch = watch;
console.log(JSON.stringify(out, null, 2));
await browser.close();
site.close();
