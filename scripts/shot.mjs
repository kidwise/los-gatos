// Takes a screenshot of the running dev server with the system Chrome.
// Usage: node scripts/shot.mjs "<query string>" <output.png> [width] [height]
import { chromium } from 'playwright-core';

const [query = '', out = 'shots/shot.png', width = '1280', height = '800'] = process.argv.slice(2);
const base = process.env.SHOT_URL ?? 'http://localhost:5173/';

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 2 });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(base + (query ? `?${query}` : ''));
await page.waitForSelector('canvas');
await page.waitForTimeout(Number(process.env.SHOT_WAIT ?? 1800));
await page.screenshot({ path: out });
await browser.close();

if (problems.length) console.log(problems.join('\n'));
console.log(`saved ${out}`);
