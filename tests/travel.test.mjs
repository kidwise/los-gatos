// Getting about: walking between regions, dashing across the map, and returning to a found place.
import { check, dist, done, load, open, region, shown, tap, text, where, zoom } from './helper.mjs';

const main = region('main-street'), vasona = region('vasona');
const trailEnd = (pack, north) => {
  let best = null;
  for (const r of pack.roads) {
    if (r.kind !== 'cycleway') continue;
    for (let i = 0; i < r.pts.length; i += 3) if (!best || (north ? r.pts[i + 2] < best.z : r.pts[i + 2] > best.z)) best = { x: r.pts[i], z: r.pts[i + 2] };
  }
  return best;
};
const page = await open({ phone: true });

// Between regions, both ways.
let edge = trailEnd(main, true);
await load(page, `region=main-street&reset=1&x=${edge.x}&z=${main.bounds.z0 + 10}`);
check('at the north edge of Main Street the way on is offered', (await shown(page, 'exit-btn')) && /Vasona/.test(await text(page, 'exit-btn')));
await page.click('#exit-btn');
await page.waitForSelector('canvas');
await page.waitForTimeout(5000);
check('it leads to Oak Meadow & Vasona', /Vasona/.test(await text(page, 'title')));
edge = trailEnd(vasona, false);
await load(page, `region=vasona&x=${edge.x}&z=${vasona.bounds.z1 - 8}`, 3500);
check('at the south edge of Vasona the way back is offered', (await shown(page, 'exit-btn')) && /Main Street/.test(await text(page, 'exit-btn')));
await page.click('#exit-btn');
await page.waitForSelector('canvas');
await page.waitForTimeout(3500);
check('it leads back to Main Street', /Main Street/.test(await text(page, 'title')));

// Pace: a trot at street level, a dash on the map.
const speedAt = async (span) => {
  await zoom(page, span);
  await page.waitForTimeout(700);
  await tap(page, -200, 60);
  await page.waitForTimeout(1500);
  let prev = await where(page), total = 0;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    const w = await where(page);
    total += dist(w, prev.x, prev.z);
    prev = w;
  }
  return total / 3;
};
await load(page, 'region=main-street&x=-360&z=-190');
const street = await speedAt(8.5);
check('at street level the cat trots', street > 3 && street < 6, `${street.toFixed(1)} m/s`);
const map = await speedAt(200);
check('on the map view the cat dashes', map > 18, `${map.toFixed(1)} m/s`);

// Map travel to a place already found.
const carousel = vasona.spots.find((s) => s.id === 'carousel');
await load(page, `region=vasona&x=${carousel.x + 8}&z=${carousel.z}`, 3000);
await tap(page, carousel.x, carousel.z);
await page.waitForTimeout(5000);
await load(page, `region=vasona&x=${carousel.x + 300}&z=${carousel.z - 500}`, 3000);
await zoom(page, 700);
await page.waitForTimeout(1500);
await tap(page, carousel.x + 3, carousel.z + 2);
await page.waitForTimeout(1800);
check('tapping a found place on the map takes the cat there', dist(await where(page), carousel.x, carousel.z) < 8);
await done();
