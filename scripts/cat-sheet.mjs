// Makes a contact sheet of the cat in a set of poses, to judge its anatomy and gaits frame by frame.
// Run with the dev server up: node scripts/cat-sheet.mjs <output.png> [poses...]
// A pose is name or name:phase, for example walk:0.25. The default sheet shows everything.
import { chromium } from 'playwright-core';

const [out = 'shots/cat-sheet.png', ...asked] = process.argv.slice(2);
const strides = (name) => [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map((p) => `${name}:${p}`);
const poses = asked.length ? asked : ['stand', 'sit', 'loaf', 'groom', ...strides('walk'), ...strides('trot'), ...strides('gallop')];
const base = process.env.GAME_URL ?? 'http://localhost:5173/';

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 760, height: 620 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shots = [];
for (const pose of poses) {
  const [name, phase = '0'] = pose.split(':');
  // Side-on to the camera, on open paving, with the interface hidden.
  await page.goto(`${base}?corner&pose=${name}&phase=${phase}&span=${process.env.SPAN ?? 2.3}&x=11&z=30&heading=${process.env.HEADING ?? 2.36}${process.env.WEAR ? `&wear=${process.env.WEAR}` : ''}`);
  await page.waitForSelector('canvas');
  await page.addStyleTag({ content: '.hud, button { display: none !important; }' });
  await page.waitForTimeout(name === 'loaf' || name === 'sit' || name === 'groom' ? 2600 : 1300);
  shots.push({ pose, data: (await page.screenshot({ clip: { x: 200, y: 150, width: 360, height: 300 } })).toString('base64') });
}
const cols = Math.min(4, shots.length);
await page.setViewportSize({ width: cols * 364, height: Math.ceil(shots.length / cols) * 322 });
await page.setContent(`<body style="margin:0;background:#f3ecdf;display:grid;grid-template-columns:repeat(${cols},364px);font:13px Georgia">${shots
  .map((s) => `<figure style="margin:2px;position:relative"><img src="data:image/png;base64,${s.data}" width="360"><figcaption style="position:absolute;left:8px;top:6px;color:#3a3542">${s.pose}</figcaption></figure>`)
  .join('')}</body>`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
if (errors.length) console.log(errors.join('\n'));
console.log(`saved ${out} (${shots.length} poses)`);
