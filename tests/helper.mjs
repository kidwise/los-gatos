// Shared set-up for the play tests. Each test drives the real game in Chrome and checks what happens.
// The development server must be running (npm run dev). Set GAME_URL to test another address.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

export const URL = process.env.GAME_URL ?? 'http://localhost:5173/';
export const region = (id) => JSON.parse(readFileSync(new URL_(`../public/regions/${id}.json`, import.meta.url)));
const URL_ = globalThis.URL;

let browser;
const failures = [];
const errors = [];

/** Opens a page. Pass `phone: true` for a phone-sized touch screen. */
export async function open({ phone = false } = {}) {
  browser ??= await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext(
    phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1200, height: 800 } },
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return page;
}

/** Loads the game with the given address ending and waits for it to settle. */
export async function load(page, query, settle = 2500) {
  await page.goto(URL + (query ? `?${query}` : ''));
  await page.waitForSelector('canvas');
  await page.waitForTimeout(settle);
}

export const where = (page) => page.evaluate(() => window.__cat.where());
export const tap = (page, x, z) => page.evaluate(([x, z]) => window.__cat.tap(x, z), [x, z]);
export const zoom = (page, span) => page.evaluate((s) => window.__cat.zoom(s), span);
export const riding = (page) => page.evaluate(() => window.__cat.riding());
export const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('los-gatos:journal') ?? '{}'));
export const shown = (page, id) => page.evaluate((id) => document.getElementById(id).classList.contains('on'), id);
export const text = (page, id) => page.evaluate((id) => document.getElementById(id).textContent, id);
export const dist = (a, x, z) => Math.hypot(a.x - x, a.z - z);

/** Records a pass or a failure, and prints it. */
export function check(what, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(what);
}

/** Call at the end of a test file: closes the browser and sets the exit code. */
export async function done() {
  check('no errors in the browser console', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser?.close();
  process.exitCode = failures.length ? 1 : 0;
}

/** The nearest point on a street or path between `min` and `max` metres from a place. */
export function streetNear(pack, x, z, min, max) {
  let best = null;
  for (const r of pack.roads) {
    if (['motorway', 'motorway_link', 'rail'].includes(r.kind) || r.bridge) continue;
    for (let i = 0; i < r.pts.length; i += 3) {
      const d = Math.hypot(r.pts[i] - x, r.pts[i + 2] - z);
      if (d > min && d < max && (!best || d < best.d)) best = { x: r.pts[i], z: r.pts[i + 2], d };
    }
  }
  return best;
}
