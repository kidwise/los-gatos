// The carousel, the train and the rowing boat can each be boarded, carry the cat, and be left.
import { check, dist, done, load, open, region, riding, shown, tap, text, where } from './helper.mjs';

const pack = region('vasona');
const page = await open();

// Carousel.
const carousel = pack.buildings.find((b) => b.hero === 'carousel');
await load(page, `region=vasona&reset=1&x=${carousel.cx + 9}&z=${carousel.cz + 6}`, 4000);
check('the carousel offers a ride', (await text(page, 'ride-btn')) === 'Ride the carousel' && (await shown(page, 'ride-btn')));
await page.click('#ride-btn');
await page.waitForTimeout(1200);
let a = await where(page);
await page.waitForTimeout(3000);
let b = await where(page);
check('the carousel carries the cat round', (await riding(page)) && dist(b, a.x, a.z) > 2, `${dist(b, a.x, a.z).toFixed(1)} m in 3 s`);
await page.click('#ride-btn');
await page.waitForTimeout(800);
check('the cat can hop off the carousel', !(await riding(page)));

// Train, which waits at the station beside the carousel when the region loads.
let station = 0, best = Infinity;
for (let i = 0; i < pack.train.length; i += 3) {
  const d = Math.hypot(pack.train[i] - carousel.cx, pack.train[i + 2] - carousel.cz);
  if (d < best) [station, best] = [i, d];
}
await load(page, `region=vasona&x=${pack.train[station] + 3}&z=${pack.train[station + 2] + 3}`, 3500);
check('the train offers a ride at the station', (await text(page, 'ride-btn')) === 'Hop on the train' && (await shown(page, 'ride-btn')));
await page.click('#ride-btn');
await page.waitForTimeout(1000);
a = await where(page);
await page.waitForTimeout(16000);
b = await where(page);
check('the train carries the cat along the line', (await riding(page)) && dist(b, a.x, a.z) > 15, `${dist(b, a.x, a.z).toFixed(0)} m in 16 s`);
await page.click('#ride-btn');
await page.waitForTimeout(800);
check('the cat can hop off the train', !(await riding(page)));

// Rowing boat, moored at the pier by the Vasona Lake ring.
const dock = pack.spots.find((s) => s.id === 'boats');
await load(page, `region=vasona&x=${dock.x}&z=${dock.z}`, 4500);
check('the boat is offered at the pier', (await text(page, 'ride-btn')) === 'Take the boat out' && (await shown(page, 'ride-btn')));
await page.click('#ride-btn');
await page.waitForTimeout(1200);
a = await where(page);
await tap(page, pack.props.boats[8], pack.props.boats[9]);
await page.waitForTimeout(9000);
b = await where(page);
check('the boat can be rowed across the water', dist(b, a.x, a.z) > 15, `${dist(b, a.x, a.z).toFixed(0)} m in 9 s`);
check('out on the water there is no way to step off', !(await shown(page, 'ride-btn')));
await tap(page, dock.x - 200, dock.z + 150);
await page.waitForTimeout(16000);
check('near the shore, "Step ashore" is offered', (await text(page, 'ride-btn')) === 'Step ashore' && (await shown(page, 'ride-btn')));
await page.click('#ride-btn');
await page.waitForTimeout(900);
a = await where(page);
await tap(page, a.x - 12, a.z + 10);
await page.waitForTimeout(4000);
b = await where(page);
check('ashore, the cat walks on land again', !(await riding(page)) && dist(b, a.x, a.z) > 5);
await done();
