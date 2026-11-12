// Records the board in use and writes the video plus a timeline of what happened.
// usage: node scripts/record.mjs <board url | local dir> <output name>
//
// The recording adds two things that are not part of the build: a red dot that shows where the pointer is
// (Playwright videos have no cursor) and a clock in the corner with the time since the recording began.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { serve } from './static.mjs';

const target = process.argv[2] ?? 'dist';
const name = process.argv[3] ?? 'rehearsal';
const site = target.startsWith('http') ? null : await serve(target);
const url = site ? site.url : target;
const raw = 'recordings/raw';
mkdirSync(raw, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  locale: 'en-IE',
  timezoneId: 'Europe/Dublin',
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: raw, size: { width: 1280, height: 720 } },
});
await context.addInitScript(() => {
  const began = Date.now();
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(220,0,40,.75);border:2px solid #fff;box-shadow:0 0 0 1px #b00020;pointer-events:none;left:-50px;top:-50px';
    const clock = document.createElement('div');
    clock.style.cssText = 'position:fixed;z-index:99999;right:12px;top:12px;padding:4px 10px;border-radius:6px;background:#1d1d1f;color:#fff;font:600 16px ui-monospace,monospace;pointer-events:none';
    document.body.append(dot, clock);
    document.addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    document.addEventListener('mousedown', () => { dot.style.transform = 'scale(1.8)'; setTimeout(() => (dot.style.transform = ''), 400); }, true);
    const offset = Number(new URLSearchParams(location.hash.slice(1)).get('rec') ?? 0);
    setInterval(() => {
      const s = Math.floor((Date.now() - began + offset) / 1000);
      clock.textContent = `rec ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 100);
  });
});

const page = await context.newPage();
const t0 = Date.now(); // the video starts when the page is created
const at = () => {
  const s = (Date.now() - t0) / 1000;
  return { seconds: Number(s.toFixed(1)), mmss: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` };
};
const timeline = [];
const note = (event, data = {}) => { const entry = { ...at(), event, ...data }; timeline.push(entry); console.log(JSON.stringify(entry)); };

page.on('pageerror', (e) => note('page-error', { message: e.message }));
page.on('response', async (res) => {
  if (!res.url().includes('/api/ack')) return;
  const id = new URL(res.url()).searchParams.get('id');
  let body; try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
  note('ack-reply', { requestedId: id, status: res.status(), body });
});

const rowIds = () => page.locator('[data-testid="incident-row"]').evaluateAll((rows) => rows.map((r) => r.dataset.id));
const idUnderPointer = (x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid="incident-row"]')?.dataset.id ?? null, [x, y]);
async function waitForNewTop(previousTop) {
  await page.waitForFunction((top) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== top, previousTop, { timeout: 60000, polling: 50 });
  return (await rowIds())[0];
}

// --- open-board -------------------------------------------------------------------------------------
await page.goto(`${url}#rec=${Date.now() - t0}`);
note('open-board: page opened', { url, loaderVisible: await page.locator('[data-testid="loader"]').isVisible().catch(() => false) });
await page.locator('[data-testid="incident-row"]').first().waitFor();
note('open-board: incidents on screen', {
  loaderGone: (await page.locator('[data-testid="loader"]').count()) === 0,
  rows: await rowIds(),
  build: await page.locator('[data-testid="build-sha"]').textContent(),
  metaBuild: await page.locator('meta[name="build"]').getAttribute('content'),
  firstTime: await page.locator('[data-testid="incident-row"] time').first().evaluate((t) => `${t.textContent} (datetime=${t.getAttribute('datetime')})`),
});
await page.mouse.move(640, 600, { steps: 10 });

// --- watch-board ------------------------------------------------------------------------------------
let top = (await rowIds())[0];
top = await waitForNewTop(top);
note('watch-board: a new incident appeared at the top without a reload', { newTop: top, rows: (await rowIds()).length });
await page.waitForTimeout(1500);

// --- ack-incident, list at rest: pick the top incident and ack it ------------------------------------
const calm = top;
const calmButton = page.locator(`[data-testid="incident-row"][data-id="${calm}"] [data-testid="ack"]`);
let box = await calmButton.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
note('ack-incident (list at rest): pointer on Ack', { picked: calm, underPointer: await idUnderPointer(box.x + box.width / 2, box.y + box.height / 2) });
await page.mouse.down(); await page.mouse.up();
await page.locator(`[data-testid="incident-row"][data-id="${calm}"] [data-testid="acked"]`).waitFor();
note('ack-incident (list at rest): row marked acked', { picked: calm });
await page.mouse.move(640, 650, { steps: 15 });

// --- ack-incident, list moving: pick the second unacked incident, a new one arrives before the click --
top = await waitForNewTop((await rowIds())[0]);
note('watch-board: another new incident at the top', { newTop: top });
await page.waitForTimeout(2500);
const picked = top; // on-call picks the incident that just came in
const pickedButton = page.locator(`[data-testid="incident-row"][data-id="${picked}"] [data-testid="ack"]`);
box = await pickedButton.boundingBox();
const px = box.x + box.width / 2, py = box.y + box.height / 2;
await page.mouse.move(px, py, { steps: 25 });
note('ack-incident (list moving): pointer on Ack of the picked incident', { picked, underPointer: await idUnderPointer(px, py), pointer: [Math.round(px), Math.round(py)] });
const arrived = await waitForNewTop(picked); // the pointer does not move; the list does
note('ack-incident (list moving): a new incident arrived; the rows moved down under the pointer', { arrived, picked, underPointerNow: await idUnderPointer(px, py) });
await page.waitForTimeout(150); // a click that was already on its way
await page.mouse.down(); await page.mouse.up();
note('ack-incident (list moving): click, pointer never moved', { picked, underPointer: await idUnderPointer(px, py) });
await page.locator('[data-testid="acked"]').nth(1).waitFor();
const ackedIds = await page.locator('[data-testid="incident-row"]:has([data-testid="acked"])').evaluateAll((rows) => rows.map((r) => r.dataset.id));
note('ack-incident (list moving): result on the board', { picked, ackedRows: ackedIds, pickedIsAcked: ackedIds.includes(picked) });
await page.waitForTimeout(4000);
note('end');

await context.close();
const video = await page.video().path();
await browser.close();
site?.close();

renameSync(video, `${raw}/${name}.webm`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${raw}/${name}.webm`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', `recordings/${name}.mp4`]);
writeFileSync(`${raw}/${name}.timeline.json`, JSON.stringify(timeline, null, 2));
console.log(`video: recordings/${name}.mp4, timeline: ${raw}/${name}.timeline.json`);
