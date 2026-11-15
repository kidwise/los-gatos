import * as THREE from 'three';
import { P } from '../style/palette';
import { Batch, makeSign, seeded, type SignStyle } from './kit';
import type { Ride } from './world';

export type Display = 'fashion' | 'bakery' | 'books' | 'cafe' | 'flowers';

export interface Shop {
  name: string;
  sign: SignStyle;
  signInk: number;
  /** Colour of the band the sign sits on. */
  band: number;
  door: number;
  backdrop: number;
  display: Display;
  awning?: number;
  awningStripe?: number;
}

export interface Facade {
  side: '+x' | '+z';
  shops: Shop[];
}

/** The colours a facade is painted in. */
export interface FacadeStyle {
  wall: number;
  trim: number;
  shutters?: number;
}

export interface Building extends FacadeStyle {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  floors: number;
  roof: 'parapet' | 'tile' | 'terrace';
  facades: Facade[];
}

/** Everything the builders write into. */
export interface Kit {
  paint: Batch;
  glow: Batch;
  glint: Batch;
  signs: THREE.Group;
  /** Moving parts a landmark brings with it: something to add to the scene and to move each frame. */
  moving?: { object: THREE.Object3D; update(dt: number, time: number): void; x: number; z: number; sound?: 'carousel' }[];
  /** Rides a landmark offers. */
  rides?: Ride[];
}

export const GROUND_FLOOR = 4.2;
export const UPPER_FLOOR = 3.3;
export const RECESS = 0.55;
const SHELF = 0.55;
const OPENING_TOP = 3.0;

const rand = seeded(1887);
const FLOWERS = [P.pink, P.white, P.yellow, P.lilac];

/** Little still life on the window shelf. Coordinates are the facade's own: u along, v up, n outward. */
function display(k: Kit, kind: Display, u: number, w: number): void {
  const p = k.paint;
  const v = SHELF;
  const n = -RECESS * 0.5;
  switch (kind) {
    case 'fashion': {
      const tones = [P.persimmon, P.navy, P.warmWhite];
      [-0.26, 0.24].forEach((f, i) => {
        const x = u + w * f;
        p.cyl(P.brass, x, v + 0.3, n, 0.014, 0.014, 0.6, 6);
        p.cyl(tones[i], x, v + 0.92, n, 0.07, 0.21, 0.72, 10);
        p.ball(tones[i], x, v + 1.36, n, 0.1, 0.11, 0.07);
        p.ball(P.brass, x, v + 1.5, n, 0.03);
      });
      p.box(P.warmWhite, u, v + 0.17, n, 0.34, 0.34, 0.26);
      p.box(tones[2 - (Math.floor(u) & 1)], u, v + 0.45, n, 0.24, 0.2, 0.1);
      p.cyl(P.brass, u, v + 0.58, n, 0.07, 0.07, 0.015, 8, { rx: Math.PI / 2 });
      break;
    }
    case 'bakery': {
      const x = u - w * 0.18;
      p.cyl(P.warmWhite, x, v + 0.2, n, 0.03, 0.09, 0.4, 8);
      p.cyl(P.warmWhite, x, v + 0.41, n, 0.22, 0.22, 0.025, 14);
      p.cyl(P.blush, x, v + 0.5, n, 0.15, 0.15, 0.16, 14);
      p.cyl(P.warmWhite, x, v + 0.6, n, 0.15, 0.15, 0.04, 14);
      p.ball(P.persimmon, x, v + 0.65, n, 0.035);
      for (let i = 0; i < 3; i++) p.ball(P.paleTerracotta, u + w * (0.08 + i * 0.13), v + 0.08, n, 0.1, 0.075, 0.07);
      for (let i = 0; i < 5; i++) p.cyl(FLOWERS[i % 4], u + w * 0.06 + i * 0.085, v + 0.2, n + 0.12, 0.035, 0.035, 0.03, 8);
      break;
    }
    case 'books': {
      const spines = [P.navy, P.oxblood, P.deepGreen, P.butter, P.persimmon, P.slateBlue];
      [-0.3, -0.05, 0.25].forEach((f, s) => {
        const count = 3 + ((s * 2) % 3);
        for (let i = 0; i < count; i++) {
          p.box(spines[(s * 2 + i) % spines.length], u + w * f, v + 0.03 + i * 0.06, n, 0.3 - (i % 2) * 0.04, 0.055, 0.22, (i % 3) * 0.12 - 0.1);
        }
      });
      p.box(P.butter, u + w * 0.1, v + 0.17, n - 0.05, 0.03, 0.34, 0.24, 0.5);
      p.box(P.oxblood, u + w * 0.14, v + 0.17, n - 0.03, 0.03, 0.34, 0.24, 0.2);
      break;
    }
    case 'cafe': {
      const glassTones = [P.deepGreen, P.oxblood, P.brass, P.deepGreen];
      for (let i = 0; i < 4; i++) {
        const x = u - w * 0.3 + i * 0.13;
        p.cyl(glassTones[i], x, v + 0.13, n, 0.04, 0.04, 0.26, 8);
        p.cyl(glassTones[i], x, v + 0.31, n, 0.014, 0.03, 0.1, 8);
      }
      p.cyl(P.terracotta, u + w * 0.25, v + 0.1, n, 0.11, 0.08, 0.2, 10);
      p.ball(P.leafC, u + w * 0.25, v + 0.38, n, 0.17, 0.22, 0.15);
      k.glow.ball(P.lampGlow, u, v + 1.75, n, 0.1);
      p.cyl(P.ink, u, v + 2.1, n, 0.008, 0.008, 0.6, 5);
      break;
    }
    case 'flowers': {
      [-0.28, 0, 0.27].forEach((f, b) => {
        const x = u + w * f;
        p.cyl(P.steel, x, v + 0.14, n, 0.13, 0.1, 0.28, 10);
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4 + b;
          p.ball(i % 3 === 0 ? P.leafA : FLOWERS[(i + b) % 4], x + Math.cos(a) * 0.09, v + 0.36 + (i % 3) * 0.07, n + Math.sin(a) * 0.07, 0.065);
        }
      });
      break;
    }
  }
}

function shopfront(k: Kit, b: FacadeStyle, shop: Shop, index: number, u0: number, W: number, frame: THREE.Matrix4): void {
  const p = k.paint;
  const PIER = 0.4;
  const DOOR = 1.5;

  // Piers at each end, and the band above the openings that carries the sign.
  p.box(b.wall, u0 + PIER / 2, GROUND_FLOOR / 2, -RECESS / 2 + 0.03, PIER, GROUND_FLOOR, RECESS + 0.06);
  p.box(b.wall, u0 + W - PIER / 2, GROUND_FLOOR / 2, -RECESS / 2 + 0.03, PIER, GROUND_FLOOR, RECESS + 0.06);
  p.box(shop.band, u0 + W / 2, (OPENING_TOP + GROUND_FLOOR) / 2, -RECESS / 2 + 0.01, W - PIER * 2, GROUND_FLOOR - OPENING_TOP, RECESS + 0.02);

  const sign = makeSign(shop.name, shop.sign, shop.signInk, W - PIER * 2 - 0.8, 0.62);
  sign.applyMatrix4(new THREE.Matrix4().makeTranslation(u0 + W / 2, 3.68, 0.035).premultiply(frame));
  k.signs.add(sign);

  // Recessed door, alternating sides so neighbours do not line up.
  const doorLeft = index % 2 === 0;
  const dU = doorLeft ? u0 + PIER + DOOR / 2 : u0 + W - PIER - DOOR / 2;
  p.box(shop.door, dU, 1.3, -RECESS + 0.06, 1.1, 2.6, 0.08);
  k.glow.box(shop.backdrop, dU, 1.65, -RECESS + 0.11, 0.72, 1.35, 0.03);
  k.glow.box(shop.backdrop, dU, 2.8, -RECESS + 0.06, 1.1, 0.3, 0.03);
  p.box(P.brass, dU + (doorLeft ? 0.42 : -0.42), 1.15, -RECESS + 0.13, 0.05, 0.3, 0.05);
  p.box(P.stone, dU, 0.03, -RECESS / 2, DOOR, 0.06, RECESS);
  const mullionU = doorLeft ? dU + DOOR / 2 : dU - DOOR / 2;
  p.box(b.trim, mullionU, OPENING_TOP / 2, -RECESS / 2, 0.14, OPENING_TOP, RECESS);

  // Display window: bulkhead, lit backdrop, still life, and a glint across the glass.
  const wU0 = doorLeft ? mullionU + 0.07 : u0 + PIER;
  const wU1 = doorLeft ? u0 + W - PIER : mullionU - 0.07;
  const wMid = (wU0 + wU1) / 2;
  const wW = wU1 - wU0;
  p.box(shop.band, wMid, SHELF / 2, -RECESS / 2 + 0.02, wW, SHELF, RECESS + 0.04);
  p.box(b.trim, wMid, SHELF + 0.02, -0.02, wW, 0.05, 0.08);
  k.glow.box(shop.backdrop, wMid, (SHELF + OPENING_TOP) / 2, -RECESS + 0.03, wW, OPENING_TOP - SHELF, 0.03);
  display(k, shop.display, wMid, wW);
  k.glint.box(0xffffff, wMid - wW * 0.12, 1.75, -0.03, wW * 0.16, 2.9, 0.005);
  k.glint.box(0xffffff, wMid + wW * 0.1, 1.75, -0.03, wW * 0.06, 2.9, 0.005);

  if (shop.awning !== undefined) {
    const aW = wW + 0.3;
    const strips = shop.awningStripe !== undefined ? Math.max(3, Math.round(aW / 0.42) | 1) : 1;
    for (let i = 0; i < strips; i++) {
      const color = i % 2 === 0 ? shop.awning : shop.awningStripe!;
      const sU = wMid - aW / 2 + (i + 0.5) * (aW / strips);
      p.wedge(color, sU, 2.75, 0, aW / strips, 0.45, 0.8);
      p.box(color, sU, 2.66, 0.79, aW / strips, 0.2, 0.03);
    }
  }
}

function upperWindows(k: Kit, b: FacadeStyle, u0: number, W: number, base: number): void {
  const p = k.paint;
  const count = Math.max(1, Math.round(W / 2.7));
  for (let j = 0; j < count; j++) {
    const u = u0 + ((j + 0.5) * W) / count;
    const v = base + 1.72;
    p.box(b.trim, u, v, 0.03, 1.24, 1.94, 0.06);
    p.box(P.glass, u, v, 0.05, 1.0, 1.7, 0.06);
    p.box(b.trim, u, v, 0.085, 0.05, 1.7, 0.02);
    p.box(b.trim, u, v + 0.25, 0.085, 1.0, 0.05, 0.02);
    p.box(b.trim, u, base + 0.72, 0.1, 1.44, 0.09, 0.2);
    if (b.shutters !== undefined) {
      p.box(b.shutters, u - 0.8, v, 0.045, 0.32, 1.72, 0.05);
      p.box(b.shutters, u + 0.8, v, 0.045, 0.32, 1.72, 0.05);
    }
    if (rand() < 0.45) {
      p.box(P.terracotta, u, base + 0.88, 0.2, 1.1, 0.2, 0.2);
      for (let i = 0; i < 6; i++) {
        p.ball(i % 3 === 1 ? P.leafB : FLOWERS[Math.floor(rand() * 4)], u - 0.42 + i * 0.17, base + 1.04 + rand() * 0.06, 0.22, 0.1);
      }
    }
  }
}

function facade(k: Kit, b: Building, f: Facade, height: number): void {
  const length = f.side === '+z' ? b.x1 - b.x0 : b.z1 - b.z0;
  // Facade space: u runs left to right as seen from the street, v is up, n points out of the wall.
  const frame = new THREE.Matrix4();
  if (f.side === '+z') frame.makeTranslation(b.x0, 0, b.z1);
  else frame.makeRotationY(Math.PI / 2).setPosition(b.x1, 0, b.z1);

  storefronts(k, b, f.shops, length, frame, b.floors, height);
}

/**
 * A row of shopfronts with windows above, laid onto any wall.
 * `frame` puts the wall's bottom-left corner (seen from the street) at the origin, with u along the
 * wall, v up and n out toward the street. The wall behind must be set back by RECESS at ground level.
 */
export function storefronts(k: Kit, style: FacadeStyle, shops: Shop[], length: number, frame: THREE.Matrix4, floors: number, height: number): void {
  const p = k.paint;
  for (const batch of [k.paint, k.glow, k.glint]) batch.frame.copy(frame);

  const W = length / shops.length;
  shops.forEach((shop, i) => {
    shopfront(k, style, shop, i, i * W, W, frame);
    for (let fl = 1; fl < floors; fl++) upperWindows(k, style, i * W, W, GROUND_FLOOR + (fl - 1) * UPPER_FLOOR);
  });

  if (floors > 1) p.box(style.trim, length / 2, GROUND_FLOOR + 0.05, 0.05, length + 0.1, 0.14, 0.1);
  p.box(style.trim, length / 2, height - 0.16, 0.11, length + 0.22, 0.3, 0.22);

  for (const batch of [k.paint, k.glow, k.glint]) batch.frame.identity();
}

function roof(k: Kit, b: Building, height: number): void {
  const p = k.paint;
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;

  if (b.roof === 'tile') {
    // Hipped terracotta roof: a four-sided cone stretched over the footprint.
    const over = 0.55;
    stretchedHip(p, cx, height, cz, w + over * 2, d + over * 2);
    return;
  }

  const T = 0.3;
  const PH = 0.55;
  p.box(b.wall, cx, height + PH / 2, b.z0 + T / 2, w, PH, T);
  p.box(b.wall, cx, height + PH / 2, b.z1 - T / 2, w, PH, T);
  p.box(b.wall, b.x0 + T / 2, height + PH / 2, cz, T, PH, d);
  p.box(b.wall, b.x1 - T / 2, height + PH / 2, cz, T, PH, d);
  p.box(b.trim, cx, height + PH + 0.03, b.z1 - T / 2, w + 0.1, 0.06, T + 0.1);
  p.box(b.trim, b.x1 - T / 2, height + PH + 0.03, cz, T + 0.1, 0.06, d + 0.1);
  p.box(b.roof === 'terrace' ? P.plaza : P.roof, cx, height + 0.03, cz, w - T * 2, 0.06, d - T * 2);

  if (b.roof === 'terrace') {
    // Rooftop terrace with parasols and planters.
    [[-0.22, -0.2], [0.2, 0.15]].forEach(([fx, fz], i) => {
      const x = cx + w * fx;
      const z = cz + d * fz;
      p.cyl(P.ink, x, height + 1.2, z, 0.03, 0.03, 2.3, 6);
      p.cone(i === 0 ? P.persimmon : P.warmWhite, x, height + 2.05, z, 1.35, 0.5, 8, { flat: true });
      p.cyl(P.warmWhite, x, height + 0.75, z, 0.42, 0.42, 0.04, 12);
    });
    for (let i = 0; i < 4; i++) {
      const x = b.x0 + 0.9 + i * ((w - 1.8) / 3);
      p.box(P.terracotta, x, height + 0.3, b.z0 + 0.75, 0.6, 0.5, 0.6);
      p.ball(i % 2 ? P.leafA : P.leafC, x, height + 0.85, b.z0 + 0.75, 0.42, 0.5, 0.42);
    }
  } else {
    p.box(P.roofUnit, cx - w * 0.2, height + 0.4, cz - d * 0.15, 1.5, 0.7, 1.1);
    p.box(P.slateBlue, cx + w * 0.18, height + 0.16, cz + d * 0.12, 1.6, 0.2, 1.1);
    p.cyl(P.roofUnit, cx + w * 0.25, height + 0.4, cz - d * 0.28, 0.16, 0.16, 0.7, 8);
  }
}

function stretchedHip(p: Batch, cx: number, y: number, cz: number, w: number, d: number): void {
  // A 4-sided cone turned 45 degrees has a square base of side sqrt(2); scale that to w x d.
  p.cone(P.terracotta, cx, y, cz, Math.SQRT1_2, 2.3, 4, { ry: Math.PI / 4, sx: w, sz: d, flat: true });
  p.box(P.paleTerracotta, cx, y - 0.02, cz, w, 0.12, d);
}

export function addBuilding(k: Kit, b: Building): void {
  const p = k.paint;
  const height = GROUND_FLOOR + (b.floors - 1) * UPPER_FLOOR;
  const faceX = b.facades.some((f) => f.side === '+x');
  const faceZ = b.facades.some((f) => f.side === '+z');

  // Ground floor core sits back from the street so the shopfronts have real depth.
  const gx1 = b.x1 - (faceX ? RECESS : 0);
  const gz1 = b.z1 - (faceZ ? RECESS : 0);
  p.box(b.wall, (b.x0 + gx1) / 2, GROUND_FLOOR / 2, (b.z0 + gz1) / 2, gx1 - b.x0, GROUND_FLOOR, gz1 - b.z0);
  if (b.floors > 1) {
    p.box(b.wall, (b.x0 + b.x1) / 2, (GROUND_FLOOR + height) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, height - GROUND_FLOOR, b.z1 - b.z0);
  } else {
    p.box(b.wall, (b.x0 + b.x1) / 2, GROUND_FLOOR - 0.1, (b.z0 + b.z1) / 2, b.x1 - b.x0, 0.2, b.z1 - b.z0);
  }

  for (const f of b.facades) facade(k, b, f, height);
  roof(k, b, height);
}
