import * as THREE from 'three';
import { P } from '../style/palette';
import { gouache } from '../style/gouache';
import type { Kit } from './buildings';
import { Batch, makeSign, seeded, type SignStyle } from './kit';

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
 * The Los Gatos Theatre, after photographs of the building as it stands today: a white
 * streamlined front with a stepped tower, a tall cream blade sign lettered LOS / GATOS / THEATRE
 * in navy, a white marquee with a reader board, and a black-tiled entrance with a curved ticket
 * booth and a silver cat. Proportions are judged by eye from those photographs, not measured.
 */
const theatre: HeroBuilder = (k, ring, base, face) => {
  const p = k.paint;
  const { w, d, frame } = frontOn(k, ring, base, face);
  const WHITE = 0xf6f3ec;
  const SHADE = 0xe6e2da;
  const TAUPE = 0x8f8780;
  const CREAM = 0xf3ead2;
  const NAVY = 0x25355e;
  const TILE = 0x23242b;
  const SILVER = 0xc9ccd2;
  const BLUE = 0x5b7bea;
  const H = 9.2;
  /** Lettering on a face turned by ry about the vertical. */
  const letter = (text: string, x: number, y: number, z: number, ry: number, maxWidth: number, height: number, ink = NAVY) => {
    const sign = makeSign(text, 'deco', ink, maxWidth, height);
    sign.applyMatrix4(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z).premultiply(frame));
    k.signs.add(sign);
  };

  // The hall behind, and the white front with a band of shadow lines.
  p.box(WHITE, 0, H / 2, 0, w * 2, H, d * 2);
  p.box(P.roof, 0, H + 0.03, 0, w * 2 - 0.6, 0.06, d * 2 - 0.6);
  p.box(WHITE, 0, H + 0.35, d - 0.3, w * 2, 0.7, 0.6);
  for (const y of [4.9, 8.75]) p.box(SHADE, 0, y, d + 0.03, w * 2, 0.12, 0.06);

  // Tall windows across the upper floor, to the right of the tower.
  const winX0 = -w * 0.12, winX1 = w - 0.7;
  p.box(0x3d4a58, (winX0 + winX1) / 2, 6.85, d + 0.03, winX1 - winX0, 2.9, 0.08);
  k.glow.box(P.backdropButter, (winX0 + winX1) / 2, 5.9, d + 0.08, winX1 - winX0 - 0.3, 0.8, 0.03);
  for (let x = winX0; x <= winX1 + 0.01; x += (winX1 - winX0) / Math.round((winX1 - winX0) / 0.95)) p.box(WHITE, x, 6.85, d + 0.1, 0.12, 2.9, 0.1);
  p.box(WHITE, (winX0 + winX1) / 2, 8.35, d + 0.1, winX1 - winX0, 0.1, 0.1);
  k.glint.box(0xffffff, (winX0 + winX1) / 2 - 0.8, 6.85, d + 0.17, 0.5, 2.8, 0.005);

  // The stepped tower, rising in three setbacks with vertical fins.
  const tx = -w * 0.42;
  p.box(WHITE, tx, 6.2, d - 0.5, 3.6, 12.4, 2.6);
  p.box(WHITE, tx, 12.9, d - 0.6, 2.7, 1.0, 2.2);
  p.box(WHITE, tx, 13.7, d - 0.7, 1.8, 0.7, 1.8);
  for (const fx of [-1.3, -0.45, 0.45, 1.3]) p.box(SHADE, tx + fx, 9.6, d + 0.84, 0.16, 5.4, 0.1);
  p.box(SHADE, tx, 12.42, d + 0.82, 3.7, 0.1, 0.12);

  // The blade sign: a tall cream panel in a taupe frame, standing out from the tower, read from both sides.
  const bz = d + 2.05, top = 14.6, foot = 5.5, bw = 0.5, bd = 1.75;
  p.box(TAUPE, tx, (top + foot) / 2, bz, bw, top - foot, bd);
  p.cyl(TAUPE, tx, top, bz, bd / 2, bd / 2, bw, 16, { rz: Math.PI / 2 });
  p.box(TAUPE, tx, foot - 0.12, bz, bw + 0.5, 0.24, bd + 0.5);
  p.cyl(SILVER, tx, top + bd / 2 + 0.5, bz, 0.03, 0.03, 1.0, 5);
  p.ball(SILVER, tx, top + bd / 2 + 1.0, bz, 0.07);
  const rows = ['G', 'A', 'T', 'O', 'S'];
  const step = 1.42;
  const firstY = top - 1.25;
  for (const side of [-1, 1]) {
    const fx = tx + side * (bw / 2 + 0.012);
    const ry = (side * Math.PI) / 2;
    // The panel is lit from within, so it stays cream on its shaded side too.
    k.glow.box(CREAM, tx + side * (bw / 2 + 0.004), (top + foot) / 2 + 0.1, bz, 0.01, top - foot - 0.3, bd - 0.28);
    letter('LOS', fx + side * 0.01, top + 0.05, bz, ry, bd - 0.7, 0.34);
    rows.forEach((ch, i) => letter(ch, fx + side * 0.01, firstY - i * step, bz, ry, bd - 0.42, 1.2));
    letter('THEATRE', fx + side * 0.01, foot + 0.42, bz, ry, bd - 0.36, 0.3);
  }
  // Silver bars run back from between the letters to the tower.
  for (let i = 0; i <= rows.length; i++) {
    const y = firstY + step / 2 - i * step;
    p.box(SILVER, tx, y, bz - 0.2, bw + 0.16, 0.07, bd + 0.5);
    p.box(SILVER, tx + 0.9, y, d + 1.0, 1.9, 0.06, 0.06);
  }

  // The marquee: a white canopy coming to a blunt point, with a reader board on each angled face.
  const mx = w * 0.1, reach = 3.1, half = Math.min(w - 0.4, 4.6);
  const board = Math.hypot(half, reach - 0.7);
  const slant = Math.atan2(reach - 0.7, half);
  p.box(WHITE, mx, 3.55, d + 0.35, half * 2, 1.5, 0.7);
  for (const side of [-1, 1]) {
    const cx = mx + (side * half) / 2, cz = d + 0.7 + (reach - 0.7) / 2;
    p.box(WHITE, cx, 3.55, cz, board, 1.5, 0.3, side * slant);
    p.box(NAVY, cx, 2.76, cz, board + 0.04, 0.12, 0.36, side * slant);
    p.box(SILVER, cx, 4.33, cz, board + 0.04, 0.07, 0.36, side * slant);
    // Lettering sits just proud of the board, turned to face the same way.
    const nx = Math.sin(side * slant) * 0.17, nz = Math.cos(side * slant) * 0.17;
    letter('Now playing', cx + nx, 3.92, cz + nz, side * slant, board - 1.0, 0.36, TILE);
    letter(side < 0 ? 'A wandering' : 'The cats of the corner', cx + nx, 3.35, cz + nz, side * slant, board - 0.8, 0.38, TILE);
  }
  // Blue light washes down from under the canopy.
  k.glow.box(BLUE, mx, 2.78, d + 1.2, half * 1.5, 0.05, 1.9);
  for (let i = 0; i < 5; i++) k.glow.ball(P.lampGlow, mx + (i - 2) * half * 0.32, 2.74, d + 1.5, 0.08);

  // The entrance: black tile below, glass doors either side of a curved white ticket booth.
  p.box(TILE, 0, 0.55, d + 0.04, w * 2 - 0.2, 1.1, 0.1);
  p.cyl(WHITE, mx, 1.55, d + 0.5, 0.95, 0.95, 3.1, 18);
  p.cyl(TILE, mx, 0.55, d + 0.5, 1.0, 1.0, 1.1, 18);
  k.glow.box(P.backdropButter, mx, 1.95, d + 1.44, 0.8, 0.9, 0.03);
  p.box(SILVER, mx, 1.95, d + 1.46, 0.92, 1.02, 0.02);
  for (const side of [-1, 1]) {
    const dx = mx + side * 2.25;
    p.box(SILVER, dx, 1.4, d + 0.07, 1.9, 2.7, 0.08);
    k.glow.box(0xf2dcae, dx, 1.4, d + 0.12, 1.7, 2.5, 0.03);
    p.box(SILVER, dx, 1.4, d + 0.15, 0.06, 2.5, 0.03);
    // A sunburst etched on the glass.
    for (let r = 0; r < 4; r++) p.box(0xfaf3df, dx + side * (0.15 + r * 0.14), 1.0 + r * 0.42, d + 0.16, 0.05, 1.5 - r * 0.2, 0.02);
    // Poster cases further along.
    if (w > 5.4) {
      const px = mx + side * Math.min(w - 1.3, 4.35);
      p.box(WHITE, px, 2.0, d + 0.07, 1.35, 1.95, 0.08);
      k.glow.box([P.backdropBlush, P.backdropSky][side < 0 ? 0 : 1], px, 2.0, d + 0.12, 1.1, 1.7, 0.03);
    }
  }
  // The silver cat that sits by the ticket window.
  p.cyl(SILVER, mx, 0.42, d + 1.62, 0.13, 0.2, 0.62, 10);
  p.ball(SILVER, mx, 0.86, d + 1.62, 0.15, 0.16, 0.14);
  for (const s of [-1, 1]) p.cone(SILVER, mx + s * 0.08, 0.97, d + 1.62, 0.05, 0.12, 4);

  // Terrazzo forecourt in sweeping bands of grey, blue and cream.
  p.box(0xb9bcc6, mx, 0.045, d + 1.7, half * 2, 0.05, 3.3);
  p.box(0x7f8fb0, mx - half * 0.35, 0.05, d + 1.9, half * 0.5, 0.055, 2.9, 0.5);
  p.box(CREAM, mx + half * 0.2, 0.052, d + 2.0, half * 0.36, 0.056, 2.9, -0.4);
  p.box(TILE, mx + half * 0.55, 0.054, d + 1.8, 0.16, 0.058, 3.2, -0.4);

  // A black gooseneck lamp on the tower.
  p.box(TILE, tx + 2.2, 5.3, d + 0.5, 0.06, 0.06, 1.0);
  k.glow.ball(P.lampGlow, tx + 2.2, 5.12, d + 1.0, 0.13);
  p.cone(TILE, tx + 2.2, 5.12, d + 1.0, 0.24, 0.22, 8);
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

/**
 * The W.E. "Bill" Mason Carousel: a round pavilion with a striped tent roof and a ring of horses.
 * An impression of a 1915 carousel, not a model of this one.
 */
const carousel: HeroBuilder = (k, ring, base) => {
  const p = k.paint;
  const r = fitRectangle(ring);
  const R = Math.max(5.5, Math.min(r.halfLong, r.halfShort) * 0.95);
  const frame = new THREE.Matrix4().makeTranslation(r.cx, base, r.cz);
  p.frame.copy(frame);
  // What stands still: the stone base and the posts round the rim.
  p.cyl(P.stone, 0, 0.18, 0, R + 0.5, R + 0.7, 0.36, 28);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    p.cyl(P.trim, Math.cos(a) * (R + 0.35), 2.5, Math.sin(a) * (R + 0.35), 0.09, 0.11, 4.3, 8);
  }
  p.frame.identity();

  // Everything else turns together: platform, drum, tent roof and horses.
  const spin = new THREE.Group();
  spin.position.set(r.cx, base, r.cz);
  const paint = gouache({ vertexColors: true, local: true });
  const lit = gouache({ vertexColors: true, local: true, unlit: true });
  const t = new Batch();
  const glow = new Batch();
  // The tent roof is kept apart so a window can open in it when the cat is riding underneath.
  const roof = new Batch();
  t.cyl(P.oxblood, 0, 0.42, 0, R - 0.3, R - 0.3, 0.12, 28);
  // Centre drum with mirrors and lights.
  t.cyl(P.cream, 0, 2.3, 0, 1.5, 1.5, 3.7, 12);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    t.box(i % 2 ? P.brass : P.slateBlue, Math.cos(a) * 1.52, 2.4, Math.sin(a) * 1.52, 0.5, 1.6, 0.06, -a + Math.PI / 2);
    glow.ball(P.lampGlow, Math.cos(a) * 1.6, 3.9, Math.sin(a) * 1.6, 0.1);
  }
  // Tent roof in alternating stripes, with a scalloped edge and a finial.
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const g = new THREE.BufferGeometry();
    const o = R + 0.9;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 7.6, 0, Math.cos(a1) * o, 4.6, Math.sin(a1) * o, Math.cos(a0) * o, 4.6, Math.sin(a0) * o]), 3));
    g.computeVertexNormals();
    roof.add(g, i % 2 ? P.persimmon : P.warmWhite, 0, 0, 0);
    const am = (a0 + a1) / 2;
    roof.ball(i % 2 ? P.persimmon : P.warmWhite, Math.cos(am) * o, 4.5, Math.sin(am) * o, 0.42, 0.3, 0.42);
    glow.ball(P.lampGlow, Math.cos(a0) * o, 4.42, Math.sin(a0) * o, 0.09);
  }
  t.cyl(P.brass, 0, 7.9, 0, 0.06, 0.1, 0.8, 6);
  t.ball(P.brass, 0, 8.35, 0, 0.2);
  t.box(P.oxblood, 0.3, 8.0, 0, 0.6, 0.35, 0.03);

  // Two rings of horses on brass poles. Each horse is its own piece so it can rise and fall.
  const COATS = [P.warmWhite, 0xc8a57a, P.slateBlue, P.blush, P.butter, 0x8a6f5c];
  const horses: { group: THREE.Group; rest: number; phase: number }[] = [];
  [[R - 1.5, 10, 0], [R - 3.3, 7, 0.4]].forEach(([rad, count, phase], ringIndex) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + phase;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const coat = COATS[(i + ringIndex * 2) % COATS.length];
      t.cyl(P.brass, x, 2.5, z, 0.035, 0.035, 4.2, 6);
      // Built facing +x, then turned to face the way the carousel goes round.
      const h = new Batch();
      h.ball(coat, 0, 0, 0, 0.62, 0.3, 0.24);
      h.ball(coat, 0.62, 0.36, 0, 0.2, 0.26, 0.16);
      h.ball(coat, 0.84, 0.42, 0, 0.17, 0.12, 0.11);
      h.ball(coat, -0.66, 0.1, 0, 0.1, 0.2, 0.08);
      h.box([P.persimmon, P.navy, P.deepGreen][i % 3], 0, 0.26, 0, 0.36, 0.1, 0.5);
      for (const s of [-0.4, 0.4]) h.cyl(coat, s, -0.42, 0, 0.06, 0.05, 0.6, 6);
      const mesh = h.build(paint)!;
      mesh.castShadow = true;
      const group = new THREE.Group();
      group.add(mesh);
      group.position.set(x, 1.3, z);
      group.rotation.y = -a - Math.PI / 2;
      spin.add(group);
      horses.push({ group, rest: 1.3, phase: i * 2.1 + ringIndex });
    }
  });
  const body = t.build(paint)!;
  body.castShadow = true;
  const top = roof.build(gouache({ vertexColors: true, local: true, hole: true }))!;
  top.castShadow = true;
  spin.add(body, top, glow.build(lit)!);

  let turned = 0;
  (k.moving ??= []).push({
    object: spin,
    x: r.cx,
    z: r.cz,
    sound: 'carousel',
    update(dt, time) {
      turned += dt * 0.42;
      spin.rotation.y = -turned;
      for (const h of horses) h.group.position.y = h.rest + Math.sin(time * 1.9 + h.phase) * 0.3;
      spin.updateMatrixWorld();
    },
  });

  // The cat can ride the first horse of the outer ring.
  const mount = horses[0].group;
  const centre = new THREE.Vector3(r.cx, base, r.cz);
  (k.rides ??= []).push({
    label: 'Ride the carousel',
    roofed: true,
    near: (pos) => Math.hypot(pos.x - r.cx, pos.z - r.cz) < R + 4 && Math.abs(pos.y - base) < 3,
    seat(out) {
      mount.getWorldPosition(out);
      out.y += 0.3;
      // Facing the way the carousel turns: square to the line from the centre.
      return Math.atan2(-(out.z - r.cz), out.x - r.cx);
    },
    exit(out) {
      mount.getWorldPosition(out);
      out.sub(centre).setY(0).setLength(R + 2).add(centre);
    },
  });
};

export const HEROES: Record<string, HeroBuilder> = {
  carousel,
  'mill-annex': millAnnex,
  theatre,
  library,
  'high-school': highSchool,
};
