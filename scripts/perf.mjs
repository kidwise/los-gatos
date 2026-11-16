// Reports frame rate and drawing load for six views, with the frame cap removed.
// Run with the dev server up: node scripts/perf.mjs  (add "probe" to also time it without shadows and at half resolution)
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const vas = JSON.parse(readFileSync(new URL('../public/regions/vasona.json', import.meta.url)));
const dam = vas.spots.find((s) => s.id === 'dam');
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const fps = (p) => p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(Math.round(n / 2)); }; requestAnimationFrame(f); }));
const views = [
  ['vasona street  (phone)', 390, 844, `region=vasona&x=-380&z=130`, null],
  ['vasona map     (phone)', 390, 844, `region=vasona&x=-46&z=-420&span=500`, null],
  ['vasona lake    (desktop)', 1300, 820, `region=vasona&x=-46&z=-420&span=60`, null],
  ['dam lookout    (desktop)', 1300, 820, `region=vasona&x=${dam.x + 9}&z=${dam.z}`, dam],
  ['main st street (phone)', 390, 844, `region=main-street&x=-360&z=-190`, null],
  ['main st map    (desktop)', 1300, 820, `region=main-street&x=0&z=0&span=400`, null],
];
for (const [name, w, h, q, walk] of views) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost:5173/?' + q); await p.waitForSelector('canvas'); await p.waitForTimeout(3500);
  if (walk) { await p.evaluate(([x, z]) => window.__cat.go(x, z), [walk.x, walk.z]); await p.waitForTimeout(9000); }
  const base = await fps(p);
  const info = await p.evaluate(() => window.__cat.info());
  const extra = [];
  if (process.argv[2] === 'probe') {
    await p.evaluate(() => { window.__cat.sun.castShadow = false; }); await p.waitForTimeout(400);
    extra.push('no shadows ' + await fps(p));
    await p.evaluate(() => { window.__cat.sun.castShadow = true; window.__cat.renderer.setPixelRatio(1); window.__cat.composer.setPixelRatio(1); }); await p.waitForTimeout(400);
    extra.push('half resolution ' + await fps(p));
  }
  console.log(name.padEnd(26), String(base).padStart(4), 'fps |', (info.triangles / 1e6).toFixed(2), 'M triangles,', info.calls, 'calls |', extra.join(' | '));
  await p.close();
}
await b.close();
