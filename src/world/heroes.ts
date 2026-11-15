import * as THREE from 'three';
import { P } from '../style/palette';
import type { Kit } from './buildings';
import { makeSign, seeded, type SignStyle } from './kit';

/**
 * Hand-built landmarks. Each takes the real footprint from the map and stands a custom model on it,
 * so the building is in the right place at the right size but has its own character.
 */
export type HeroBuilder = (k: Kit, ring: number[], base: number, face?: number) => void;

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** The tightest rectangle round a footprint: its centre, half-sizes (long side first) and turn. */
export function fitRectangle(ring: number[]): { cx: number; cz: number; halfLong: number; halfShort: number; angle: number } {
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

/**
 * Sets up a landmark's own space on its footprint: x runs along the front, y is up and z points
 * out of the front door toward the street. Returns half the width and half the depth.
 */
function frontOn(k: Kit, ring: number[], base: number, face = 0): { w: number; d: number; frame: THREE.Matrix4 } {
  const r = fitRectangle(ring);
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  // The rectangle has four sides; the front is the one looking most nearly toward the street.
  const sides = [
    { fx: c, fz: s, w: r.halfShort, d: r.halfLong },
    { fx: -c, fz: -s, w: r.halfShort, d: r.halfLong },
    { fx: -s, fz: c, w: r.halfLong, d: r.halfShort },
    { fx: s, fz: -c, w: r.halfLong, d: r.halfShort },
  ];
  const tx = Math.sin(face), tz = Math.cos(face);
  const best = sides.reduce((a, b) => (b.fx * tx + b.fz * tz > a.fx * tx + a.fz * tz ? b : a));
  const frame = new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(best.fz, 0, -best.fx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(best.fx, 0, best.fz))
    .setPosition(r.cx, base, r.cz);
  for (const b of [k.paint, k.glow, k.glint]) b.frame.copy(frame);
  return { w: best.w, d: best.d, frame };
}

function done(k: Kit): void {
  for (const b of [k.paint, k.glow, k.glint]) b.frame.identity();
}

function lettering(k: Kit, frame: THREE.Matrix4, text: string, style: SignStyle, ink: number, x: number, y: number, z: number, maxWidth: number, height: number): void {
  const sign = makeSign(text, style, ink, maxWidth, height);
  sign.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z).premultiply(frame));
  k.signs.add(sign);
}

/**
 * The Los Gatos Theatre: an Art Deco picture house with a lit marquee and an upright blade sign.
 * Stylized from general knowledge of the building, not from photographs.
 */
const theatre: HeroBuilder = (k, ring, base, face) => {
  const p = k.paint;
  const { w, d, frame } = frontOn(k, ring, base, face);
  const H = 9.5;
  const WALL = P.cream, DECO = P.oxblood;

  p.box(WALL, 0, H / 2, 0, w * 2, H, d * 2);
  p.box(P.roof, 0, H + 0.03, 0, w * 2 - 0.6, 0.06, d * 2 - 0.6);
  // Stepped Deco parapet and fluted piers on the front.
  p.box(WALL, 0, H + 0.5, d - 0.35, w * 2, 1.0, 0.7);
  p.box(WALL, 0, H + 1.4, d - 0.35, w * 1.3, 0.8, 0.7);
  p.box(WALL, 0, H + 2.1, d - 0.35, w * 0.7, 0.6, 0.7);
  p.box(DECO, 0, H + 1.02, d + 0.02, w * 2, 0.12, 0.06);
  for (let i = 0; i < 6; i++) {
    const x = ((i + 0.5) / 6 - 0.5) * 2 * w;
    if (Math.abs(x) < 0.9) continue;
    p.box(P.trim, x, 6.6, d + 0.04, 0.34, 5.0, 0.1);
    p.box(P.glass, x + 0.75, 6.8, d + 0.02, 0.5, 2.6, 0.05);
  }

  // Marquee: a deep canopy edged in light, with the name across its front.
  const MZ = 2.6;
  p.box(DECO, 0, 3.75, d + MZ / 2, w * 1.7, 0.9, MZ);
  p.box(P.brass, 0, 4.24, d + MZ / 2, w * 1.74, 0.1, MZ + 0.08);
  p.box(P.brass, 0, 3.27, d + MZ / 2, w * 1.74, 0.08, MZ + 0.08);
  k.glow.box(P.lampGlow, 0, 3.2, d + MZ / 2, w * 1.6, 0.05, MZ - 0.3);
  lettering(k, frame, 'Los Gatos', 'caps', P.trim, 0, 3.75, d + MZ + 0.03, w * 1.5, 0.62);
  const bulbs = Math.round(w * 1.7 / 0.6);
  for (let i = 0; i <= bulbs; i++) k.glow.ball(P.lampGlow, (i / bulbs - 0.5) * w * 1.7, 3.24, d + MZ + 0.02, 0.07);

  // Upright blade sign above the marquee, lettered down its length.
  p.box(DECO, 0, 8.3, d + 0.6, 1.2, 7.4, 0.55);
  p.box(P.brass, 0, 12.1, d + 0.6, 1.5, 0.22, 0.7);
  'THEATRE'.split('').forEach((ch, i) => lettering(k, frame, ch, 'caps', P.lampGlow, 0, 11.2 - i * 0.9, d + 0.89, 0.9, 0.82));
  for (let i = 0; i < 9; i++) {
    for (const s of [-1, 1]) k.glow.ball(P.lampGlow, s * 0.52, 5.0 + i * 0.82, d + 0.89, 0.06);
  }

  // Under the canopy: ticket booth, doors and lit poster cases.
  p.box(P.navy, 0, 1.3, d + 0.7, 1.5, 2.6, 1.3);
  k.glow.box(P.backdropButter, 0, 1.65, d + 1.36, 1.0, 0.9, 0.04);
  for (const s of [-1, 1]) {
    p.box(P.inkGreen, s * 2.0, 1.25, d + 0.04, 1.5, 2.5, 0.1);
    k.glow.box(P.backdropButter, s * 2.0, 1.6, d + 0.1, 1.1, 1.2, 0.04);
    p.box(P.brass, s * 2.0, 1.2, d + 0.13, 0.06, 0.5, 0.04);
    if (w > 4.6) {
      p.box(P.brass, s * (w - 1.2), 1.7, d + 0.04, 1.3, 1.9, 0.08);
      k.glow.box([P.backdropBlush, P.backdropSky][s < 0 ? 0 : 1], s * (w - 1.2), 1.7, d + 0.09, 1.1, 1.7, 0.04);
    }
  }
  done(k);
};

/**
 * The Los Gatos Library: a contemporary building of glass, pale stone and warm wood under a
 * broad flat roof. Stylized from a general impression, not from photographs or plans.
 */
const library: HeroBuilder = (k, ring, base, face) => {
  const p = k.paint;
  const { w, d, frame } = frontOn(k, ring, base, face);
  const H = 8.6;
  const WOOD = 0xb98a5e;

  p.box(P.warmWhite, 0, H / 2, 0, w * 2, H, d * 2);
  // A deep roof that sails out past the walls.
  p.box(P.stone, 0, H + 0.25, 0, w * 2 + 3.0, 0.5, d * 2 + 3.0);
  p.box(P.roof, 0, H + 0.52, 0, w * 2 + 2.4, 0.06, d * 2 + 2.4);

  // The front: two storeys of glass between slim mullions, with a wood-clad entrance bay.
  const glassW = w * 1.25;
  const gx = -w + glassW / 2 + 0.8;
  p.box(P.glass, gx, 4.3, d + 0.03, glassW, 7.4, 0.08);
  k.glow.box(P.backdropButter, gx, 2.0, d + 0.08, glassW - 0.4, 2.6, 0.03);
  for (let x = gx - glassW / 2; x <= gx + glassW / 2 + 0.01; x += glassW / Math.round(glassW / 1.7)) p.box(P.trim, x, 4.3, d + 0.1, 0.1, 7.4, 0.1);
  for (const y of [0.6, 4.2, 8.0]) p.box(P.trim, gx, y, d + 0.1, glassW, 0.14, 0.1);
  k.glint.box(0xffffff, gx - glassW * 0.2, 4.3, d + 0.16, glassW * 0.12, 7.2, 0.005);

  const bay = w * 2 - glassW - 1.6;
  const bx = w - bay / 2 - 0.4;
  p.box(WOOD, bx, H / 2, d + 0.2, bay, H, 0.5);
  for (let i = 1; i < Math.round(bay / 0.7); i++) p.box(0xa67a52, bx - bay / 2 + (i * bay) / Math.round(bay / 0.7), H / 2, d + 0.46, 0.04, H, 0.02);
  p.box(P.glass, bx, 1.5, d + 0.47, Math.min(3.2, bay - 1), 3.0, 0.06);
  p.box(P.trim, bx, 1.5, d + 0.5, 0.08, 3.0, 0.04);
  p.box(P.stone, bx, 3.35, d + 1.3, Math.min(4.4, bay), 0.22, 2.4);
  lettering(k, frame, 'Los Gatos Library', 'italic', P.trim, bx, 5.4, d + 0.5, bay - 0.8, 0.7);
  p.box(P.stone, bx, 0.07, d + 1.6, Math.min(5, bay + 0.5), 0.14, 2.8);

  // Bands of window down both sides.
  for (const s of [-1, 1]) {
    for (const y of [2.2, 6.0]) p.box(P.glass, s * (w + 0.03), y, 0, 0.08, 2.0, d * 1.6);
    for (let z = -d * 0.8; z <= d * 0.8 + 0.01; z += (d * 1.6) / Math.round((d * 1.6) / 2.2)) p.box(P.trim, s * (w + 0.08), 4.1, z, 0.08, 5.9, 0.1);
  }
  done(k);
};

/**
 * Los Gatos High School's main building: a white neoclassical front of 1925 with a columned
 * portico. Stylized from the general description; the roof, window count and proportions are guesses.
 */
const highSchool: HeroBuilder = (k, ring, base, face) => {
  const p = k.paint;
  const { w, d, frame } = frontOn(k, ring, base, face);
  const H = 9.4;
  const WHITE = 0xf8f4ea;

  p.box(WHITE, 0, H / 2, 0, w * 2, H, d * 2);
  p.box(0xe9e2d2, 0, 0.5, 0, w * 2 + 0.3, 1.0, d * 2 + 0.3);
  p.box(P.trim, 0, H - 0.25, 0, w * 2 + 0.6, 0.5, d * 2 + 0.6);
  // A low tiled roof.
  p.cone(P.terracotta, 0, H, 0, Math.SQRT1_2, 2.4, 4, { ry: Math.PI / 4, sx: w * 2 + 1.2, sz: d * 2 + 1.2, flat: true });

  // Two rows of tall windows across the front and down the sides.
  const cols = Math.max(4, Math.round(w / 2.2));
  for (let i = 0; i < cols * 2; i++) {
    const x = ((i + 0.5) / (cols * 2) - 0.5) * 2 * w;
    if (Math.abs(x) < 6.2) continue;
    for (const y of [3.0, 6.9]) {
      p.box(P.trim, x, y, d + 0.03, 1.5, 2.7, 0.06);
      p.box(P.glass, x, y, d + 0.05, 1.2, 2.4, 0.06);
      p.box(P.trim, x, y, d + 0.09, 0.06, 2.4, 0.02);
    }
  }
  for (const s of [-1, 1]) {
    for (let z = -d * 0.7; z <= d * 0.7 + 0.01; z += 3.4) {
      for (const y of [3.0, 6.9]) p.box(P.glass, s * (w + 0.03), y, z, 0.06, 2.4, 1.2);
    }
  }

  // The portico: broad steps, six columns, and a pediment.
  const PW = 6.0, PD = 4.2;
  for (let i = 0; i < 4; i++) p.box(0xe9e2d2, 0, 0.13 + i * 0.26, d + PD / 2 + (3 - i) * 0.45, PW * 2 + 2.4 - i * 0.3, 0.26, PD + (3 - i) * 0.9);
  for (let i = 0; i < 6; i++) {
    const x = ((i / 5) - 0.5) * (PW * 2 - 1.2);
    p.cyl(WHITE, x, 1.04 + 3.6, d + PD - 0.7, 0.36, 0.44, 7.2, 12);
    p.box(WHITE, x, 1.2, d + PD - 0.7, 1.05, 0.3, 1.05);
    p.box(WHITE, x, 8.34, d + PD - 0.7, 1.05, 0.26, 1.05);
  }
  p.box(WHITE, 0, 8.95, d + PD / 2, PW * 2, 0.95, PD);
  p.wedge(WHITE, 0, 9.42, d + PD / 2, PD, 2.2, PW + 0.3, Math.PI / 2);
  p.wedge(WHITE, 0, 9.42, d + PD / 2, PD, 2.2, PW + 0.3, -Math.PI / 2);
  p.box(P.trim, 0, 9.46, d + PD / 2, PW * 2 + 0.7, 0.14, PD + 0.4);
  lettering(k, frame, 'Los Gatos High School', 'caps', P.navy, 0, 8.95, d + PD + 0.03, PW * 2 - 1, 0.5);
  // Entrance doors behind the columns.
  for (const x of [-2.4, 0, 2.4]) {
    p.box(P.inkGreen, x, 2.5, d + 0.04, 1.6, 3.2, 0.1);
    k.glow.box(P.backdropButter, x, 4.5, d + 0.06, 1.6, 0.7, 0.04);
  }
  // The rise of lawn in front, with a path up to the steps.
  p.box(P.lawn, 0, 0.05, d + PD + 24, w * 2 + 16, 0.06, 44);
  p.box(P.sidewalk, 0, 0.07, d + PD + 24, 4.2, 0.06, 44);
  // A flagpole on the lawn.
  p.cyl(P.steel, PW + 6, 5.5, d + PD + 9, 0.06, 0.09, 11, 8);
  p.box(P.oxblood, PW + 6.8, 10.2, d + PD + 9, 1.5, 0.95, 0.04);
  done(k);
};

export const HEROES: Record<string, HeroBuilder> = {
  'mill-annex': millAnnex,
  theatre,
  library,
  'high-school': highSchool,
};
