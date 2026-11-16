// Walks the cat to every ring in every region from a nearby street and reports any it cannot reach.
// Run with the dev server up: node scripts/check-rings.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
let bad = 0;
for (const region of ['main-street', 'vasona']) {
  const pack = JSON.parse(readFileSync(`public/regions/${region}.json`));
  for (const s of pack.spots) {
    // Start on a street or path 30 to 45 m away and tap the ring, as a player would.
    let from = null;
    for (const r of pack.roads) {
      if (['motorway', 'motorway_link', 'rail'].includes(r.kind) || r.bridge) continue;
      for (let i = 0; i < r.pts.length; i += 3) {
        const d = Math.hypot(r.pts[i] - s.x, r.pts[i + 2] - s.z);
        if (d > 30 && d < 45 && (!from || d < from.d)) from = { x: r.pts[i], z: r.pts[i + 2], d };
      }
    }
    await p.goto(`http://localhost:5173/?region=${region}&reset=1&x=${from.x}&z=${from.z}`);
    await p.waitForSelector('canvas'); await p.waitForTimeout(2200);
    await p.evaluate(([x, z]) => window.__cat.tap(x, z), [s.x, s.z]); await p.waitForTimeout(14000);
    const r = await p.evaluate(() => ({ found: (JSON.parse(localStorage.getItem('los-gatos:journal') || '{}').found || []), w: window.__cat.where() }));
    const ok = r.found.includes(s.id); if (!ok) bad++;
    console.log(region.padEnd(12), s.id.padEnd(10), ok ? 'reached' : `NOT reached; cat stopped ${Math.hypot(r.w.x - s.x, r.w.z - s.z).toFixed(0)} m away`);
    if (s.id === 'library') { await p.evaluate(() => window.__cat.zoom(40)); await p.waitForTimeout(1500);  }
  }
}
console.log(bad ? `${bad} rings could not be reached` : 'every ring reached');
await b.close();
