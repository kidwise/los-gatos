// Measures how loud the game is in different places, since a script cannot listen.
// Reports the peak (which must stay below 1 to avoid distortion) and the average level.
// Run with the dev server up: node scripts/sound-check.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.GAME_URL ?? 'http://localhost:5173/';
const vasona = JSON.parse(readFileSync(new URL('../public/regions/vasona.json', import.meta.url)));
const carousel = vasona.buildings.find((b) => b.hero === 'carousel');
const dock = vasona.spots.find((s) => s.id === 'boats');
const places = [
  ['downtown avenue', 'region=main-street&x=-360&z=-190', false],
  ['market by the plaza', 'region=main-street&market&x=-405&z=45', false],
  ['Main Street bridge (freeway)', 'region=main-street&x=-237&z=88', false],
  ['creek trail', 'region=main-street&x=-158&z=-84', false],
  ['carousel', `region=vasona&x=${carousel.cx + 10}&z=${carousel.cz + 6}`, false],
  ['lake shore', `region=vasona&x=${dock.x}&z=${dock.z}`, false],
  ['walking downtown', 'region=main-street&x=-360&z=-190', true],
];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
// SOUND=effects measures without the music, to compare the two.
if (process.env.SOUND) await page.addInitScript((m) => localStorage.setItem('los-gatos:sound', m), process.env.SOUND);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
for (const [name, query, walk] of places) {
  await page.goto(`${base}?${query}`);
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__cat.wakeSound());
  if (walk) await page.evaluate(() => { const w = window.__cat.where(); window.__cat.tap(w.x + 40, w.z + 110); });
  await page.waitForTimeout(4000);
  let peak = 0, sum = 0, n = 0, state;
  for (let i = 0; i < 60; i++) {
    state = await page.evaluate(() => window.__cat.sound());
    peak = Math.max(peak, state.peak);
    sum += state.rms * state.rms;
    n++;
    await page.waitForTimeout(150);
  }
  const rms = Math.sqrt(sum / n);
  const a = state.around;
  const heard = Object.entries(a).filter(([, v]) => v > 0.05).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
  console.log(`${name.padEnd(30)} peak ${peak.toFixed(2)} (${db(peak)} dB)  average ${db(rms)} dB  ${state.running ? '' : 'NOT RUNNING '}| ${heard}`);
}
await browser.close();
if (errors.length) console.log('errors:', errors.join(' | '));
