// The journal: wearing what is found, the Meow trick, sound, and sketching a view.
import { check, done, load, open, region, saved, shown, streetNear, tap, text } from './helper.mjs';

const pack = region('main-street');
const page = await open({ phone: true });
const find = async (id, reset) => {
  const s = pack.spots.find((x) => x.id === id);
  const from = streetNear(pack, s.x, s.z, 12, 30);
  await load(page, `region=main-street${reset ? '&reset=1' : ''}&x=${from.x}&z=${from.z}`, 2200);
  await tap(page, s.x, s.z);
  await page.waitForTimeout(9000);
};

await find('theatre', true);
check('finding the beret shows a note', /beret/i.test(await text(page, 'toast')));
check('and the cat puts it on', ((await saved(page)).wearing ?? []).includes('beret'));

await find('plaza');
check('the plaza ring teaches Meow, and its button appears', await shown(page, 'meow-btn'));

await page.click('#sound-btn');
check('the sound button switches sound off', (await text(page, 'sound-btn')) === 'Sound off');
await page.click('#sound-btn');

await load(page, 'region=main-street&x=-360&z=-190');
await page.click('#cam-btn');
await page.waitForTimeout(1500);
check('Sketch opens the viewfinder', await shown(page, 'finder'));
await page.click('#finder-draw');
await page.waitForTimeout(1800);
const pages = (await saved(page)).pages ?? [];
check('"Draw it" files a page named after the street', pages.length === 1 && /Avenue|Street|Way/.test(pages[0].title), pages[0]?.title);
await page.click('#book-btn');
await page.waitForTimeout(500);
check('the journal opens and lists the beret as worn', (await shown(page, 'book')) && /wearing/.test(await text(page, 'book')));

// Restarting from the journal, which asks twice.
const restart = page.locator('#book button', { hasText: 'Restart the game' });
await restart.click();
check('Restart asks to be tapped again', /Tap again/.test(await text(page, 'book')) && ((await saved(page)).found ?? []).length > 0);
await page.locator('#book button', { hasText: 'Tap again' }).click();
await page.waitForSelector('canvas');
await page.waitForTimeout(4000);
check('a second tap erases progress and returns to the title', (await shown(page, 'intro')) && ((await saved(page)).found ?? []).length === 0);
await done();
