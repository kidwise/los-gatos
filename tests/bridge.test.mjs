// The Main Street bridge: the cat crosses on the deck, is stopped by the railing, and can pass underneath.
import { check, done, load, open, region, tap, where } from './helper.mjs';

const pack = region('main-street');
const bridge = pack.roads.find((r) => r.bridge && r.name === 'East Main Street');
const n = bridge.pts.length / 3;
const a = { x: bridge.pts[0], z: bridge.pts[2] }, b = { x: bridge.pts[(n - 1) * 3], z: bridge.pts[(n - 1) * 3 + 2] };
const len = Math.hypot(b.x - a.x, b.z - a.z);
const along = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
const across = { x: -along.z, z: along.x };
const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
const deck = bridge.pts[1];

const page = await open();

// Over the top.
await load(page, `region=main-street&x=${a.x - along.x * 12}&z=${a.z - along.z * 12}`);
await tap(page, mid.x, mid.z);
await page.waitForTimeout(13000);
let w = await where(page);
check('the cat walks to the middle of the bridge, at deck height', Math.hypot(w.x - mid.x, w.z - mid.z) < 3 && Math.abs(w.y - deck) < 0.3, `y=${w.y.toFixed(2)}`);
// A tap just past the railing. (A tap further off would be routed round by road, which is not what is being tested.)
await tap(page, mid.x + across.x * 14, mid.z + across.z * 14);
await page.waitForTimeout(6000);
w = await where(page);
const off = Math.abs((w.x - mid.x) * across.x + (w.z - mid.z) * across.z);
check('the railing stops the cat walking off the side', off < bridge.width / 2 + 3.5 && Math.abs(w.y - deck) < 0.3, `${off.toFixed(1)} m from the centre line`);
await tap(page, b.x + along.x * 6, b.z + along.z * 6);
await page.waitForTimeout(9000);
w = await where(page);
check('the cat reaches the far side', Math.hypot(w.x - b.x, w.z - b.z) < 12);

// Underneath, on the freeway level.
await load(page, `region=main-street&x=${mid.x + across.x * 26}&z=${mid.z + across.z * 26}&y=-6.5`);
w = await where(page);
check('below the bridge, the cat starts on the low ground', w.y < deck - 3, `y=${w.y.toFixed(2)}`);
await tap(page, mid.x - across.x * 26, mid.z - across.z * 26);
await page.waitForTimeout(12000);
w = await where(page);
const side = (w.x - mid.x) * across.x + (w.z - mid.z) * across.z;
check('the cat passes under the deck to the other side', side < -10 && w.y < deck - 3, `y=${w.y.toFixed(2)}`);
await done();
