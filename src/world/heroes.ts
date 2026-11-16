import * as THREE from 'three';
import { P } from '../style/palette';
import { gouache } from '../style/gouache';
import type { Kit } from './buildings';
import { Batch, makeSign, seeded } from './kit';

/**
 * Hand-built landmarks. Each takes the real footprint from the map and stands a custom model on it,
 * so the building is in the right place at the right size but has its own character.
 */
export type HeroBuilder = (k: Kit, ring: number[], base: number, face?: number) => void;


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
 * The Forbes Mill annex, after a photograph of the building: two storeys of dark blue-grey
 * rubble stone flecked with tan, tall narrow windows with pale lintels and iron grilles, a
 * nearly flat roof on exposed rafters, a central door under a signboard, and an old wagon outside.
 */
const millAnnex: HeroBuilder = (k, ring, base, face) => {
  const p = k.paint;
  const { w, d, frame } = frontOn(k, ring, base, face);
  const rand = seeded(1880);
  const STONE = 0x6c7484;
  const STONES = [0x5d6676, 0x7b8494, 0x8b919c, 0x565d6b, 0x7f8798, 0xb7a482, 0xa5957a];
  const LINTEL = 0xe6dab6;
  const IRON = 0x34373f;
  const WOOD = 0x6b4a3a;
  const H = 7.4;

  p.box(STONE, 0, H / 2 - 0.25, 0, w * 2, H + 0.5, d * 2);
  // Rubble masonry: many stones of uneven size, a few of them tan, standing a little proud.
  const stones = (count: number, half: number, place: (u: number, v: number, sw: number, sh: number, c: number) => void) => {
    for (let i = 0; i < count; i++) {
      const sw = 0.4 + rand() * 0.6, sh = 0.24 + rand() * 0.2;
      place((rand() * 2 - 1) * (half - sw / 2 - 0.05), 0.25 + rand() * (H - 0.55), sw, sh, STONES[Math.floor(rand() * STONES.length)]);
    }
  };
  for (const side of [-1, 1]) {
    stones(Math.round(w * 22), w, (u, v, sw, sh, c) => p.box(c, u, v, side * (d + 0.012), sw, sh, 0.03));
    stones(Math.round(d * 22), d, (u, v, sw, sh, c) => p.box(c, side * (w + 0.012), v, u, 0.03, sh, sw));
  }

  // A low roof, tipped slightly to the back, on rafters whose ends show under the eaves.
  p.add(new THREE.BoxGeometry(1, 1, 1), 0x8f8a86, 0, H + 0.2, 0, { sx: w * 2 + 0.9, sy: 0.16, sz: d * 2 + 0.9, rx: -0.035 });
  for (let x = -w + 0.3; x <= w - 0.2; x += 0.9) p.box(0xd9cdb0, x, H + 0.02, d + 0.3, 0.12, 0.16, 0.5);

  // Tall, narrow windows with pale stone surrounds and iron grilles.
  const win = (x: number, y: number, h: number) => {
    p.box(LINTEL, x, y, d + 0.03, 1.15, h + 0.3, 0.06);
    p.box(IRON, x, y, d + 0.05, 0.85, h, 0.06);
    for (const dx of [-0.21, 0, 0.21]) p.box(0x55585f, x + dx, y, d + 0.09, 0.03, h, 0.02);
    for (let dy = -h / 2 + 0.3; dy < h / 2; dy += 0.34) p.box(0x55585f, x, y + dy, d + 0.09, 0.85, 0.03, 0.02);
    p.box(LINTEL, x, y + h / 2 + 0.2, d + 0.06, 1.35, 0.22, 0.1);
  };
  win(-w * 0.62, 5.2, 1.5);
  win(-w * 0.08, 5.0, 2.1);
  win(w * 0.55, 5.4, 1.8);

  // The door, under its signboard, with a plaque either side and an iron railing.
  const doorX = -w * 0.08;
  p.box(0x6a3a35, doorX, 1.25, d + 0.04, 1.1, 2.5, 0.08);
  p.box(LINTEL, doorX, 2.62, d + 0.06, 1.4, 0.16, 0.1);
  p.box(WOOD, doorX, 3.05, d + 0.1, 2.3, 0.42, 0.08);
  const sign = makeSign('Forbes Mill', 'caps', LINTEL, 2.1, 0.3);
  sign.applyMatrix4(new THREE.Matrix4().makeTranslation(doorX, 3.05, d + 0.15).premultiply(frame));
  k.signs.add(sign);
  p.box(P.brass, doorX - 2.6, 2.3, d + 0.04, 0.8, 1.0, 0.05);
  p.box(P.brass, doorX + 1.5, 1.7, d + 0.04, 0.6, 0.45, 0.05);
  for (let x = doorX - 3.2; x <= doorX - 0.8; x += 0.3) p.box(IRON, x, 0.5, d + 1.1, 0.03, 0.9, 0.03);
  p.box(IRON, doorX - 2.0, 0.95, d + 1.1, 2.5, 0.04, 0.04);
  p.box(P.stone, doorX, 0.08, d + 0.6, 2.4, 0.16, 1.2);

  // A rusted iron door at the far end, in its own pale surround.
  p.box(LINTEL, -w + 1.3, 1.35, d + 0.03, 1.9, 2.7, 0.06);
  p.box(0x9c5d4a, -w + 1.3, 1.25, d + 0.07, 1.4, 2.4, 0.06);
  p.box(0x7d4739, -w + 1.3, 1.5, d + 0.11, 0.7, 0.9, 0.02);

  // The old freight wagon that stands outside, and a barrel.
  const wx = w * 0.55, wz = d + 2.2;
  p.box(WOOD, wx, 1.05, wz, 3.0, 0.5, 1.2);
  p.box(0x5a3d30, wx, 1.35, wz, 3.1, 0.08, 1.3);
  p.box(0x4a3a36, wx - 1.9, 1.3, wz, 0.9, 0.5, 0.9);
  for (const sx of [-1.1, 1.1]) for (const sz of [-0.68, 0.68]) {
    p.cyl(0x4a3a36, wx + sx, 0.62, wz + sz, 0.62, 0.62, 0.08, 14, { rx: Math.PI / 2 });
    p.cyl(WOOD, wx + sx, 0.62, wz + sz + Math.sign(sz) * 0.02, 0.5, 0.5, 0.09, 14, { rx: Math.PI / 2 });
  }
  p.cyl(0x8a4a3a, wx - 3.0, 0.6, wz - 0.2, 0.45, 0.42, 1.2, 12);
  done(k);
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
 * The Los Gatos Library, after a photograph of the building: a ground floor of pale stone blocks
 * with punched windows, an upper floor of green-tinted glass, crimson metal frames, a glazed
 * entrance under a teal canopy, and its name in thin letters on the stone.
 */
const library: HeroBuilder = (k, ring, base, face) => {
  const p = k.paint;
  const { w, d, frame } = frontOn(k, ring, base, face);
  const STONE = 0xe8dabd;
  const JOINT = 0xd6c6a6;
  const GLASS = 0x9cc6c0;
  const SPANDREL = 0x74a894;
  const RED = 0xb23540;
  const TEAL = 0x4f9c98;
  const FRAME = 0xf3f1ea;
  const LOWER = 4.3, H = 8.6;

  // Stone below, with courses and upright joints lightly drawn.
  p.box(STONE, 0, LOWER / 2, 0, w * 2, LOWER, d * 2);
  for (let y = 0.7; y < LOWER; y += 0.7) p.box(JOINT, 0, y, d + 0.012, w * 2, 0.03, 0.02);
  for (let i = 0; i < Math.round(w * 1.6); i++) p.box(JOINT, -w + 0.6 + i * 1.3 + (i % 2) * 0.4, 0.35 + (i % 6) * 0.7, d + 0.012, 0.03, 0.7, 0.02);

  // Glass above: tall panes over a band of deeper green, between white mullions, on all four sides.
  p.box(GLASS, 0, (LOWER + H) / 2, 0, w * 2 - 0.1, H - LOWER, d * 2 - 0.1);
  for (const [half, along] of [[w, true], [d, false]] as const) {
    for (const side of [-1, 1]) {
      const other = (along ? d : w) * side;
      const put = (c: number, u: number, y: number, su: number, sy: number, proud: number) =>
        along ? p.box(c, u, y, other + side * proud, su, sy, 0.06) : p.box(c, other + side * proud, y, u, 0.06, sy, su);
      put(SPANDREL, 0, LOWER + 0.45, half * 2, 0.9, 0.0);
      for (let u = -half; u <= half + 0.01; u += (half * 2) / Math.round((half * 2) / 1.5)) put(FRAME, u, (LOWER + H) / 2, 0.09, H - LOWER, 0.03);
      put(FRAME, 0, LOWER + 0.92, half * 2, 0.07, 0.03);
      put(FRAME, 0, LOWER + 0.02, half * 2 + 0.2, 0.16, 0.05);
    }
  }
  k.glint.box(0xffffff, w * 0.3, (LOWER + H) / 2, d + 0.1, 0.9, H - LOWER - 0.4, 0.005);
  // A thin white roof sailing just past the glass.
  p.box(FRAME, 0, H + 0.12, 0, w * 2 + 0.9, 0.24, d * 2 + 0.9);
  p.box(P.roof, 0, H + 0.26, 0, w * 2 + 0.5, 0.05, d * 2 + 0.5);

  // The crimson frame boxed round the glass at one corner.
  const rx = -w + w * 0.34;
  for (const [x, y, sx, sy] of [[rx, H - 0.25, w * 0.68, 0.34], [rx, LOWER + 0.25, w * 0.68, 0.34], [-w + 0.17, (LOWER + H) / 2, 0.34, H - LOWER], [-w + w * 0.68, (LOWER + H) / 2, 0.34, H - LOWER]]) {
    p.box(RED, x, y, d + 0.3, sx, sy, 0.7);
  }

  // Punched windows in the stone, each with a crimson panel beneath.
  for (const x of [-w * 0.8, -w * 0.45, w * 0.5, w * 0.82]) {
    p.box(0x4d6a66, x, 2.4, d + 0.03, 1.5, 1.7, 0.06);
    p.box(FRAME, x, 2.4, d + 0.06, 0.06, 1.7, 0.03);
    p.box(RED, x, 1.25, d + 0.04, 1.5, 0.55, 0.07);
  }

  // The entrance: a run of glass doors under a teal canopy, with the name on the wall beside it.
  const ex = w * 0.08, ew = Math.min(6.5, w * 0.5);
  p.box(0x5d7f7c, ex, 1.6, d + 0.04, ew, 3.1, 0.08);
  k.glow.box(P.backdropButter, ex, 1.0, d + 0.09, ew - 0.3, 1.4, 0.03);
  for (let x = ex - ew / 2; x <= ex + ew / 2 + 0.01; x += ew / 5) p.box(FRAME, x, 1.6, d + 0.1, 0.08, 3.1, 0.06);
  p.box(TEAL, ex, 3.45, d + 1.5, ew + 1.2, 0.2, 3.0);
  p.box(0x3f817e, ex, 3.3, d + 2.96, ew + 1.2, 0.12, 0.1);
  for (const s of [-1, 1]) p.cyl(FRAME, ex + s * (ew / 2 + 0.3), 1.7, d + 2.7, 0.07, 0.07, 3.4, 8);
  const name = makeSign('Los Gatos Library', 'caps', 0x8f8168, Math.min(6, w * 0.5), 0.5);
  name.applyMatrix4(new THREE.Matrix4().makeTranslation(ex - ew / 2 - Math.min(6, w * 0.5) / 2 - 0.6, 2.6, d + 0.03).premultiply(frame));
  k.signs.add(name);

  // The forecourt: pale paving, a bench, bicycle hoops and planting along the wall.
  p.box(0xe6ddcd, ex, 0.04, d + 3.2, ew + 6, 0.06, 6.2);
  p.box(0x9a7758, ex - ew / 2 - 2, 0.45, d + 4.4, 1.8, 0.07, 0.5);
  p.box(0x9a7758, ex - ew / 2 - 2, 0.72, d + 4.18, 1.8, 0.4, 0.06);
  for (let i = 0; i < 3; i++) p.add(new THREE.TorusGeometry(0.34, 0.03, 5, 12, Math.PI), P.steel, ex + ew / 2 + 1.5 + i * 0.6, 0.02, d + 4.2, {});
  for (let x = -w + 1; x < ex - ew / 2 - 1; x += 1.1) p.blob([P.leafC, P.leafA, P.cedarA][Math.round(x * 3) % 3 < 0 ? 0 : Math.abs(Math.round(x * 3)) % 3], x, 0.4, d + 0.7, 0.55, 0.5, 0.5);
  done(k);
};

/**
 * Los Gatos High School's main building, after a photograph of its front: two storeys of buff
 * stucco under a flat parapet, a taller entrance bay with four square pilasters, dark windows in
 * groups, clipped hedges along the wall, broad red steps with black rails, and pink paths
 * crossing the lawn under big oaks.
 */
const highSchool: HeroBuilder = (k, ring, base, face) => {
  const p = k.paint;
  const { w, d, frame } = frontOn(k, ring, base, face);
  const BUFF = 0xebe2c4;
  const TRIM = 0xf5efd9;
  const DARK = 0x353b36;
  const BRICK = 0xb4664e;
  const PATH = 0xe3bba9;
  const H = 8.8;

  p.box(BUFF, 0, H / 2, 0, w * 2, H, d * 2);
  p.box(TRIM, 0, H + 0.2, 0, w * 2 + 0.3, 0.4, d * 2 + 0.3);
  p.box(P.roof, 0, H + 0.02, 0, w * 2 - 0.8, 0.5, d * 2 - 0.8);
  p.box(TRIM, 0, 4.55, d + 0.03, w * 2, 0.16, 0.06);

  // The entrance bay stands forward and taller, with pilasters running its full height.
  const EW = 7.2, ED = 1.3, EH = H + 1.3;
  p.box(BUFF, 0, EH / 2, d + ED / 2, EW * 2, EH, ED);
  p.box(TRIM, 0, EH + 0.15, d + ED / 2, EW * 2 + 0.4, 0.3, ED + 0.4);
  p.box(TRIM, 0, EH + 0.5, d + ED / 2, EW * 1.2, 0.4, ED);
  for (const x of [-EW * 0.85, -EW * 0.3, EW * 0.3, EW * 0.85]) {
    p.box(TRIM, x, EH / 2 - 0.1, d + ED + 0.12, 0.95, EH - 0.5, 0.26);
    p.box(TRIM, x, EH - 0.5, d + ED + 0.16, 1.2, 0.3, 0.34);
    p.box(TRIM, x, 0.3, d + ED + 0.16, 1.2, 0.6, 0.34);
    p.ball(TRIM, x, EH + 0.55, d + ED + 0.1, 0.18, 0.22, 0.18);
  }
  // Doors below and tall windows above, between the pilasters.
  for (const x of [-EW * 0.575, 0, EW * 0.575]) {
    p.box(DARK, x, 1.75, d + ED + 0.03, 2.2, 3.3, 0.06);
    k.glow.box(P.backdropButter, x, 3.0, d + ED + 0.07, 2.0, 0.6, 0.03);
    p.box(TRIM, x, 1.75, d + ED + 0.08, 0.07, 3.3, 0.03);
    p.box(DARK, x, 6.7, d + ED + 0.03, 2.2, 2.9, 0.06);
    for (const dx of [-0.37, 0.37]) p.box(TRIM, x + dx, 6.7, d + ED + 0.08, 0.05, 2.9, 0.03);
    p.box(TRIM, x, 7.2, d + ED + 0.08, 2.2, 0.05, 0.03);
  }

  // Wings: dark windows in groups of three, on both floors.
  for (const side of [-1, 1]) {
    const from = EW + 1.6, to = w - 1.2;
    const groups = Math.max(1, Math.round((to - from) / 5.4));
    for (let g = 0; g < groups; g++) {
      const gx = side * (from + ((g + 0.5) * (to - from)) / groups);
      for (const y of [2.6, 6.75]) {
        for (const dx of [-1.25, 0, 1.25]) {
          p.box(DARK, gx + dx, y, d + 0.03, 1.05, 2.5, 0.06);
          p.box(TRIM, gx + dx, y + 0.5, d + 0.07, 1.05, 0.05, 0.03);
          p.box(TRIM, gx + dx, y, d + 0.07, 0.05, 2.5, 0.03);
        }
        p.box(TRIM, gx, y - 1.34, d + 0.07, 3.9, 0.12, 0.14);
      }
    }
    // A clipped hedge along the foot of the wall.
    for (let x = from - 0.6; x < to + 0.6; x += 1.5) p.blob(g2(x), side * x, 0.55, d + 1.0, 0.95, 0.62, 0.75);
    for (let z = -d * 0.7; z <= d * 0.7 + 0.01; z += 3.6) {
      for (const y of [2.6, 6.75]) p.box(DARK, side * (w + 0.03), y, z, 0.06, 2.5, 1.2);
    }
  }

  // Broad red steps with black rails, and urn-topped cheek walls.
  const sz0 = d + ED;
  for (let i = 0; i < 7; i++) p.box(BRICK, 0, 0.1 + i * 0.2, sz0 + (7 - i) * 0.42, EW * 1.5, 0.2, 0.84);
  p.box(BRICK, 0, 0.7, sz0 + 0.3, EW * 1.5, 1.4, 0.6);
  for (const x of [-EW * 0.75 - 0.4, EW * 0.75 + 0.4]) {
    p.box(TRIM, x, 0.55, sz0 + 1.6, 0.7, 1.1, 3.2);
    p.ball(TRIM, x, 1.45, sz0 + 2.9, 0.3, 0.36, 0.3);
  }
  for (const x of [-EW * 0.25, EW * 0.25]) {
    p.add(new THREE.BoxGeometry(1, 1, 1), 0x2b2a30, x, 1.45, sz0 + 1.75, { sx: 0.05, sy: 0.05, sz: 3.4, rx: 0.42 });
    for (const dz of [0.5, 1.75, 3.0]) p.box(0x2b2a30, x, 1.5 - dz * 0.4, sz0 + dz, 0.04, 0.9, 0.04);
  }

  // The lawn, with a broad walk to the steps and two paths angling away across the grass.
  p.box(P.lawn, 0, 0.05, sz0 + 26, w * 2 + 20, 0.06, 46);
  p.box(PATH, 0, 0.075, sz0 + 12, 5.2, 0.06, 18);
  for (const side of [-1, 1]) p.box(PATH, side * 13, 0.075, sz0 + 27, 4.4, 0.06, 30, side * 0.85);
  p.box(PATH, 0, 0.075, sz0 + 36, 4.4, 0.06, 26);

  // Two great oaks on the lawn, set to the sides so the front stays in view.
  for (const [ox, oz, s] of [[EW + 11, 15, 1], [-EW - 15, 20, 0.85]]) {
    p.cyl(0x6f5a48, ox, 3.4 * s, sz0 + oz, 0.5 * s, 0.85 * s, 6.8 * s, 9);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, r = i === 0 ? 0 : 4.6 * s;
      p.blob([0x5f8a55, 0x4f7a4c, 0x6f9a5b][i % 3], ox + Math.cos(a) * r, (8.6 + (i % 3) * 1.1) * s, sz0 + oz + Math.sin(a) * r, 4.6 * s, 3.2 * s, 4.6 * s);
    }
  }
  const name = makeSign('Los Gatos High School', 'caps', 0x6f6650, EW * 1.5, 0.42);
  name.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 4.75, d + ED + 0.04).premultiply(frame));
  k.signs.add(name);
  // A flagpole on the lawn.
  p.cyl(P.steel, EW + 3, 5.5, sz0 + 8, 0.06, 0.09, 11, 8);
  p.box(P.oxblood, EW + 3.8, 10.2, sz0 + 8, 1.5, 0.95, 0.04);
  done(k);
};
const g2 = (x: number) => [0x5f8a55, 0x6f9a5b, 0x557f4f][Math.abs(Math.round(x * 2)) % 3];

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
  // A deck of varnished boards, as in photographs of the carousel.
  t.cyl(0x9a5f3c, 0, 0.42, 0, R - 0.3, R - 0.3, 0.12, 28);
  for (let i = 0; i < 14; i++) t.box(0x7f4a2e, 0, 0.485, 0, (R - 0.3) * 2, 0.012, 0.05, (i / 14) * Math.PI);
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
  // White and cream horses with a brown one here and there, in bright painted saddles.
  const COATS = [0xfbf8f1, 0xf3ecdd, 0xfbf8f1, 0x9a6a4a, 0xf6efe2, 0xfbf8f1];
  const SADDLES = [0x3f7fd0, P.persimmon, 0xf2c14e, 0xd9577a, P.deepGreen, 0x7d5bb5];
  const GOLD = 0xd4a93a;
  const horses: { group: THREE.Group; rest: number; phase: number }[] = [];
  [[R - 1.5, 10, 0], [R - 3.3, 7, 0.4]].forEach(([rad, count, phase], ringIndex) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + phase;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const coat = COATS[(i + ringIndex * 2) % COATS.length];
      t.cyl(GOLD, x, 2.5, z, 0.05, 0.05, 4.2, 6);
      // Built facing +x, then turned to face the way the carousel goes round.
      const h = new Batch();
      h.ball(coat, 0, 0, 0, 0.62, 0.3, 0.24);
      h.ball(coat, 0.62, 0.36, 0, 0.2, 0.26, 0.16);
      h.ball(coat, 0.84, 0.42, 0, 0.17, 0.12, 0.11);
      h.ball(coat, -0.66, 0.1, 0, 0.1, 0.2, 0.08);
      // Saddle, saddle cloth, bridle and a flowing mane and tail.
      h.box(SADDLES[(i + ringIndex * 3) % 6], 0, 0.27, 0, 0.42, 0.12, 0.52);
      h.box(SADDLES[(i + ringIndex * 3 + 2) % 6], 0, 0.2, 0, 0.6, 0.05, 0.5);
      h.box(SADDLES[(i + 1) % 6], 0.74, 0.45, 0, 0.05, 0.14, 0.24);
      h.ball(coat === 0x9a6a4a ? 0x3d2c25 : 0xd9c08a, 0.5, 0.5, 0, 0.1, 0.24, 0.07);
      h.ball(coat === 0x9a6a4a ? 0x3d2c25 : 0xd9c08a, -0.72, 0.05, 0, 0.07, 0.26, 0.07);
      for (const s of [-0.4, 0.4]) h.cyl(coat, s, -0.42, 0, 0.06, 0.05, 0.6, 6);
      // Children ride some of the horses. The first horse of the outer ring is kept for the cat.
      if ((i + ringIndex) % 3 === 1) {
        const shirt = SADDLES[(i * 2 + 1) % 6];
        h.cyl(shirt, -0.05, 0.62, 0, 0.11, 0.14, 0.44, 7);
        h.ball([0xf0cdb0, 0xdca883, 0xb9825e][i % 3], -0.03, 0.96, 0, 0.11, 0.12, 0.11);
        h.ball([P.ink, 0x5b4336, 0xd9b96e][(i + 1) % 3], -0.06, 1.01, 0, 0.115, 0.1, 0.12);
        for (const sz of [-0.2, 0.2]) h.cyl(P.navy, 0.02, 0.36, sz, 0.05, 0.045, 0.34, 5);
      }
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
