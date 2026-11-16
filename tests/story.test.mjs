// The opening, resuming where you left off, the plaza lookout, and the ending at the dam.
import { check, dist, done, load, open, region, shown, tap, text, where } from './helper.mjs';

const main = region('main-street'), vasona = region('vasona');
let page = await open({ phone: true });

// A first visit.
await load(page, 'reset', 4000);
const cedar = main.props.cedar;
check('a first visit opens on the title screen', await shown(page, 'intro'));
check('the cat starts beside the plaza cedar', dist(await where(page), cedar[0], cedar[2]) < 6);
await page.mouse.click(200, 500);
await page.waitForTimeout(2500);
check('a touch wakes the cat and clears the title', !(await shown(page, 'intro')));

// Walk a little, give the game time to save, and come back.
const start = await where(page);
await tap(page, start.x + 14, start.z + 6);
await page.waitForTimeout(6500);
const left = await where(page);
await load(page, '', 3000);
check('a later visit resumes where the cat was, with no title', dist(await where(page), left.x, left.z) < 2 && !(await shown(page, 'intro')));

// The ending.
page = await open();
const dam = vasona.spots.find((s) => s.id === 'dam');
await load(page, `region=vasona&x=${dam.x + 9}&z=${dam.z}`, 3500);
await tap(page, dam.x, dam.z);
await page.waitForTimeout(12000);
check('at the dam the closing card appears', await shown(page, 'ending'));
check('the card reports what was found', /things found/.test(await text(page, 'ending-tally')));
await page.click('#ending-close');
await page.waitForTimeout(600);
check('"Keep wandering" dismisses it', !(await shown(page, 'ending')));
await done();
