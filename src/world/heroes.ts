import * as THREE from 'three';
import { P } from '../style/palette';
import type { Kit } from './buildings';
import { seeded } from './kit';

/**
 * Hand-built landmarks. Each takes the real footprint from the map and stands a custom model on it,
 * so the building is in the right place at the right size but has its own character.
 */
export type HeroBuilder = (k: Kit, ring: number[], base: number) => void;

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** The tightest rectangle round a footprint: its centre, half-sizes (long side first) and turn. */
function fitRectangle(ring: number[]): { cx: number; cz: number; halfLong: number; halfShort: number; angle: number } {
  let best = { cx: 0, cz: 0, halfLong: 0, halfShort: 0, angle: 0 };
  let bestArea = Infinity;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const angle = Math.atan2(ring[((i + 1) % n) * 2 + 1] - ring[i * 2 + 1], ring[((i + 1) % n) * 2] - ring[i * 2]);
    const c = Math.cos(angle), s = Math.sin(angle);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const u = ring[k * 2] * c + ring[k * 2 + 1] * s;
      const v = -ring[k * 2] * s + ring[k * 2 + 1] * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area >= bestArea) continue;
    bestArea = area;
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    const long = u1 - u0 >= v1 - v0;
    best = {
      cx: mu * c - mv * s,
      cz: mu * s + mv * c,
      halfLong: (long ? u1 - u0 : v1 - v0) / 2,
      halfShort: (long ? v1 - v0 : u1 - u0) / 2,
      angle: long ? angle : angle + Math.PI / 2,
    };
  }
  return best;
}

/**
 * The Forbes Mill annex: the 1880 stone store-room that is all that is left of the flour mill.
 * Stylized from general knowledge of the building (two-storey rough stone with a pitched roof),
 * not from reference photographs, so details such as window count are approximate.
 */
const millAnnex: HeroBuilder = (k, ring, base) => {
  const p = k.paint;
  const { cx, cz, halfLong: hx, halfShort: hz, angle } = fitRectangle(ring);
  const rand = seeded(1880);
  const STONE = 0xd9c8a8;
  const STONES = [0xcbb792, 0xe3d5b8, 0xc2ab88, 0xd2c09d];
  const SHINGLE = 0x7c6e6c;
  const WOOD = 0x6b4a3a;
  const H = 6.6;
  const RISE = 2.4;

  // Local space: x along the long side, z across, y up.
  const c = Math.cos(angle), s = Math.sin(angle);
  const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(c, 0, s), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-s, 0, c)).setPosition(cx, base, cz);
  for (const b of [k.paint, k.glow]) b.frame.copy(frame);

  // Stone body with a low plinth, and gable ends in the same stone.
  p.box(STONE, 0, H / 2 - 0.25, 0, hx * 2, H + 0.5, hz * 2);
  p.box(0xbfae90, 0, 0.25, 0, hx * 2 + 0.16, 0.5, hz * 2 + 0.16);
  p.wedge(STONE, 0, H, 0, hx * 2, RISE, hz);
  p.wedge(STONE, 0, H, 0, hx * 2, RISE, hz, Math.PI);

  // Rough masonry: individual stones standing slightly proud in three or four tones.
  const stones = (count: number, along: number, place: (u: number, v: number, w: number, h: number) => void) => {
    for (let i = 0; i < count; i++) {
      const w = 0.45 + rand() * 0.5;
      const h = 0.26 + rand() * 0.16;
      place((rand() * 2 - 1) * (along - w / 2 - 0.1), 0.6 + rand() * (H - 1.0), w, h);
    }
  };
  for (const side of [-1, 1]) {
    stones(46, hx, (u, v, w, h) => p.box(STONES[Math.floor(rand() * 4)], u, v, side * (hz + 0.012), w, h, 0.03));
    stones(22, hz, (u, v, w, h) => p.box(STONES[Math.floor(rand() * 4)], side * (hx + 0.012), v, u, 0.03, h, w));
  }

  // Pitched shingle roof: two slabs meeting at the ridge, with a little overhang.
  const slope = Math.atan2(RISE, hz);
  const run = Math.hypot(RISE, hz) + 0.45;
  for (const side of [-1, 1]) {
    p.add(UNIT_BOX, SHINGLE, 0, H + RISE / 2 - 0.05, side * (hz / 2 + 0.12), { sx: hx * 2 + 0.7, sy: 0.16, sz: run, rx: side * slope });
    // Courses of shingles as thin darker lines.
    for (let i = 1; i < 5; i++) {
      const f = i / 5;
      p.add(UNIT_BOX, 0x6c5f5e, 0, H + RISE * (1 - f) + 0.06, side * hz * f * 1.04, { sx: hx * 2 + 0.72, sy: 0.03, sz: 0.07, rx: side * slope });
    }
  }
  p.box(SHINGLE, 0, H + RISE + 0.04, 0, hx * 2 + 0.7, 0.14, 0.3);

  // Small deep-set windows with stone lintels and wooden shutters, on both floors.
  const windowAt = (u: number, v: number, side: number, onEnd: boolean) => {
    const put = (color: number, du: number, dv: number, w: number, h: number, proud: number, batch = p) => {
      if (onEnd) batch.box(color, side * (hx + proud), v + dv, u + du, 0.06, h, w);
      else batch.box(color, u + du, v + dv, side * (hz + proud), w, h, 0.06);
    };
    put(P.glass, 0, 0, 0.8, 1.3, 0.02);
    put(0xeadfc6, 0, 0.75, 1.1, 0.2, 0.04);
    put(0xeadfc6, 0, -0.72, 1.05, 0.12, 0.05);
    put(WOOD, -0.6, 0, 0.36, 1.3, 0.035);
    put(WOOD, 0.6, 0, 0.36, 1.3, 0.035);
  };
  const perSide = Math.max(2, Math.round(hx / 2.4));
  for (const side of [-1, 1]) {
    for (let i = 0; i < perSide; i++) {
      const u = ((i + 0.5) / perSide) * 2 * hx - hx;
      const doorHere = side === 1 && i === Math.floor(perSide / 2);
      if (!doorHere) windowAt(u, 1.9, side, false);
      windowAt(u, 4.9, side, false);
    }
    windowAt(0, 4.9, side, true);
    windowAt(0, 1.9, side, true);
  }

  // A wide plank door on the long side, a stone step, and the landmark plaque beside it.
  const doorU = ((Math.floor(perSide / 2) + 0.5) / perSide) * 2 * hx - hx;
  p.box(WOOD, doorU, 1.35, hz + 0.03, 1.9, 2.7, 0.08);
  p.box(0x5a3d30, doorU, 1.35, hz + 0.075, 0.05, 2.7, 0.02);
  p.box(0xeadfc6, doorU, 2.82, hz + 0.05, 2.3, 0.26, 0.1);
  p.box(P.brass, doorU + 0.25, 1.3, hz + 0.09, 0.05, 0.26, 0.05);
  p.box(P.stone, doorU, 0.08, hz + 0.45, 2.6, 0.16, 0.9);
  p.box(P.brass, doorU + 1.7, 1.6, hz + 0.04, 0.6, 0.45, 0.04);
  k.glow.box(P.lampGlow, doorU - 1.45, 2.5, hz + 0.16, 0.2, 0.3, 0.2);
  p.box(P.ink, doorU - 1.45, 2.72, hz + 0.1, 0.26, 0.06, 0.32);

  for (const b of [k.paint, k.glow]) b.frame.identity();
};

export const HEROES: Record<string, HeroBuilder> = {
  'mill-annex': millAnnex,
};
