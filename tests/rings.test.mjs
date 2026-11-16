// Every ring in every region can be reached by tapping it from a nearby street.
import { check, done, load, open, region, saved, streetNear, tap } from './helper.mjs';

const page = await open({ phone: true });
for (const id of ['main-street', 'vasona']) {
  const pack = region(id);
  for (const s of pack.spots) {
    const from = streetNear(pack, s.x, s.z, 30, 45);
    await load(page, `region=${id}&reset=1&x=${from.x}&z=${from.z}`, 2200);
    await tap(page, s.x, s.z);
    await page.waitForTimeout(14000);
    check(`${id}: the "${s.id}" ring is reached`, ((await saved(page)).found ?? []).includes(s.id));
  }
}
await done();
