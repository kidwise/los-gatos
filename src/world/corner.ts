import * as THREE from 'three';
import { gouache } from '../style/gouache';
import { P } from '../style/palette';
import { addBuilding, type Building, type Kit, type Shop } from './buildings';
import { Batch, seeded } from './kit';

/** Things the cat cannot walk through. */
export type Collider =
  | { kind: 'box'; x0: number; x1: number; z0: number; z1: number }
  | { kind: 'circle'; x: number; z: number; r: number };

export interface Corner {
  group: THREE.Group;
  colliders: Collider[];
  /** Walkable radius around the centre of the study. */
  radius: number;
  /** Chairs people can sit on, and spots where they stand and look. */
  seats: Spot[];
  standers: Spot[];
}

/** A place for a person, with the direction they face. */
export interface Spot {
  x: number;
  z: number;
  heading: number;
}

const seats: Spot[] = [];

const ROAD = 4.5; // half-width of each street
const LINE = 8; // distance from street centre to the building line
const CURB = 0.15;
const EXTENT = 48;

const rand = seeded(408);

// Invented shop names: nothing here is a real Los Gatos business.
const shop = (name: string, display: Shop['display'], o: Partial<Shop> = {}): Shop => ({
  name,
  display,
  sign: 'italic',
  signInk: P.trim,
  band: P.inkGreen,
  door: P.inkGreen,
  backdrop: P.backdropButter,
  ...o,
});

const BUILDINGS: Building[] = [
  // The hero corner building.
  {
    x0: -20, x1: -LINE, z0: -20, z1: -LINE, floors: 2, wall: P.cream, trim: P.trim, roof: 'tile', shutters: P.inkGreen,
    facades: [
      {
        side: '+z',
        shops: [
          shop('Café Sereno', 'cafe', { awning: P.persimmon, awningStripe: P.warmWhite, band: P.cream, signInk: P.oxblood, door: P.oxblood }),
          shop('Maison Pêche', 'fashion', { band: P.ink, signInk: P.brass, door: P.ink, backdrop: P.backdropBlush }),
        ],
      },
      {
        side: '+x',
        shops: [
          shop('Maison Pêche', 'fashion', { band: P.ink, signInk: P.brass, door: P.ink, backdrop: P.backdropBlush }),
          shop('The Gilded Fig', 'flowers', { awning: P.deepGreen, band: P.cream, signInk: P.deepGreen, backdrop: P.backdropSky }),
        ],
      },
    ],
  },
  {
    x0: -32, x1: -20, z0: -19, z1: -LINE, floors: 3, wall: P.blush, trim: P.trim, roof: 'parapet',
    facades: [
      {
        side: '+z',
        shops: [
          shop('Sombroso Books', 'books', { sign: 'caps', awning: P.navy, band: P.navy, door: P.navy, backdrop: P.backdropSky }),
          shop('Pan y Luna', 'bakery', { awning: P.warmWhite, awningStripe: P.blush, band: P.warmWhite, signInk: P.oxblood, door: P.oxblood, backdrop: P.backdropBlush }),
        ],
      },
    ],
  },
  {
    x0: -19, x1: -LINE, z0: -32, z1: -20, floors: 2, wall: P.sage, trim: P.trim, roof: 'terrace',
    facades: [
      {
        side: '+x',
        shops: [
          shop('Alder & Wren', 'fashion', { sign: 'caps', awning: P.deepGreen, band: P.deepGreen, door: P.deepGreen }),
          shop('Atelier Laurel', 'flowers', { band: P.warmWhite, signInk: P.inkGreen, backdrop: P.backdropBlush }),
        ],
      },
    ],
  },
  // Across the avenue.
  {
    x0: LINE, x1: 20, z0: -20, z1: -LINE, floors: 2, wall: P.butter, trim: P.trim, roof: 'parapet', shutters: P.navy,
    facades: [
      {
        side: '+z',
        shops: [
          shop('Fig & Thistle', 'flowers', { band: P.navy, door: P.navy, backdrop: P.backdropSky }),
          shop('Luz Editions', 'books', { sign: 'caps', awning: P.oxblood, band: P.oxblood, door: P.oxblood }),
        ],
      },
    ],
  },
  {
    x0: 20, x1: 31, z0: -19, z1: -LINE, floors: 1, wall: P.paleTerracotta, trim: P.trim, roof: 'tile',
    facades: [
      {
        side: '+z',
        shops: [shop('Oro Gelato', 'bakery', { awning: P.butter, awningStripe: P.warmWhite, band: P.warmWhite, signInk: P.persimmon, door: P.persimmon })],
      },
    ],
  },
  // Across Main Street.
  {
    x0: -20, x1: -LINE, z0: LINE, z1: 20, floors: 2, wall: P.slateBlue, trim: P.trim, roof: 'parapet',
    facades: [
      {
        side: '+x',
        shops: [
          shop('Wren Paper Co.', 'books', { band: P.warmWhite, signInk: P.navy, door: P.navy, backdrop: P.backdropSky }),
          shop('Ridgeline', 'fashion', { sign: 'caps', awning: P.ink, band: P.ink, signInk: P.brass, door: P.ink }),
        ],
      },
    ],
  },
  {
    x0: -19, x1: -LINE, z0: 20, z1: 31, floors: 1, wall: P.warmWhite, trim: P.trim, roof: 'tile',
    facades: [
      {
        side: '+x',
        shops: [shop('Vasona Tea', 'cafe', { awning: P.deepGreen, awningStripe: P.sage, band: P.sage, signInk: P.inkGreen })],
      },
    ],
  },
];

function streets(p: Batch): void {
  // Two streets crossing, slightly sunk below the sidewalks.
  p.box(P.asphalt, 0, -0.05, 0, EXTENT * 2, 0.1, ROAD * 2);
  p.box(P.asphalt, 0, -0.05, 0, ROAD * 2, 0.1, EXTENT * 2);

  // Four raised blocks. The near-right one is the plaza.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const c = (ROAD + EXTENT) / 2;
      const size = EXTENT - ROAD;
      const isPlaza = sx > 0 && sz > 0;
      p.box(P.sidewalk, sx * c, CURB / 2, sz * c, size, CURB, size);
      p.box(P.curb, sx * c, CURB / 2 - 0.01, sz * (ROAD + 0.09), size, CURB, 0.18);
      p.box(P.curb, sx * (ROAD + 0.09), CURB / 2 - 0.01, sz * c, 0.18, CURB, size);
      if (isPlaza) p.box(P.plaza, (LINE + EXTENT) / 2, CURB + 0.005, (LINE + EXTENT) / 2, EXTENT - LINE, 0.01, EXTENT - LINE);
      // Paver joints across the sidewalk strips.
      for (let t = LINE + 0.4; t < 42; t += 1.75) {
        p.box(P.paverJoint, sx * t, CURB + 0.004, sz * (ROAD + LINE) / 2, 0.035, 0.008, LINE - ROAD - 0.3);
        p.box(P.paverJoint, sx * (ROAD + LINE) / 2, CURB + 0.004, sz * t, LINE - ROAD - 0.3, 0.008, 0.035);
      }
    }
  }

  // Dashed centre lines, stopping short of the crossing.
  for (let t = 11; t < 42; t += 3.2) {
    for (const s of [-1, 1]) {
      p.box(P.roadPaint, s * t, 0.004, 0, 1.6, 0.008, 0.13);
      p.box(P.roadPaint, 0, 0.004, s * t, 0.13, 0.008, 1.6);
    }
  }
  // Ladder crosswalks on all four sides.
  for (const s of [-1, 1]) {
    for (let i = -3.5; i <= 3.5; i += 1) {
      p.box(P.roadPaint, i * 1.05, 0.004, s * 6.3, 0.5, 0.008, 2.3);
      p.box(P.roadPaint, s * 6.3, 0.004, i * 1.05, 2.3, 0.008, 0.5);
    }
  }
}

function tree(k: Kit, colliders: Collider[], x: number, z: number, canopyY: number, r: number): void {
  const p = k.paint;
  p.box(P.ink, x, CURB + 0.01, z, 1.15, 0.02, 1.15);
  p.cyl(P.trunk, x, CURB + canopyY / 2, z, 0.13, 0.2, canopyY, 8);
  const greens = [P.leafA, P.leafB, P.leafC, P.leafSun];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rand();
    const d = i === 0 ? 0 : r * (0.45 + rand() * 0.25);
    const rr = r * (i === 0 ? 0.8 : 0.5 + rand() * 0.22);
    p.ball(greens[Math.floor(rand() * 4)], x + Math.cos(a) * d, CURB + canopyY + (i === 0 ? r * 0.35 : (rand() - 0.4) * r * 0.5), z + Math.sin(a) * d, rr, rr * 0.82, rr);
  }
  colliders.push({ kind: 'circle', x, z, r: 0.3 });
}

function cedar(k: Kit, colliders: Collider[], x: number, z: number): void {
  // The plaza's deodar: stacked drooping tiers.
  const p = k.paint;
  p.cyl(P.trunk, x, 1.6, z, 0.22, 0.38, 3.2, 8);
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    p.cone(i % 2 ? P.cedarA : P.cedarB, x + (rand() - 0.5) * 0.3, 1.9 + i * 1.65, z + (rand() - 0.5) * 0.3, 3.7 - f * 2.7, 2.9, 9, { flat: true, ry: rand() * 3 });
  }
  colliders.push({ kind: 'circle', x, z, r: 0.55 });
}

function lamp(k: Kit, colliders: Collider[], x: number, z: number): void {
  const p = k.paint;
  p.cyl(P.inkGreen, x, CURB + 0.25, z, 0.09, 0.14, 0.5, 8);
  p.cyl(P.inkGreen, x, CURB + 1.9, z, 0.05, 0.06, 3.3, 8);
  p.cyl(P.inkGreen, x, CURB + 3.55, z, 0.16, 0.05, 0.1, 8);
  k.glow.ball(P.lampGlow, x, CURB + 3.82, z, 0.22);
  p.cyl(P.inkGreen, x, CURB + 4.06, z, 0.03, 0.14, 0.1, 8);
  // Hanging flower basket.
  p.box(P.inkGreen, x + 0.3, CURB + 3.0, z, 0.6, 0.04, 0.04);
  p.ball(P.leafC, x + 0.55, CURB + 2.7, z, 0.24, 0.2, 0.24);
  for (let i = 0; i < 5; i++) p.ball([P.pink, P.white, P.lilac][i % 3], x + 0.55 + Math.cos(i * 1.3) * 0.17, CURB + 2.78 + (i % 2) * 0.07, z + Math.sin(i * 1.3) * 0.17, 0.08);
  colliders.push({ kind: 'circle', x, z, r: 0.2 });
}

function planter(k: Kit, colliders: Collider[], x: number, z: number): void {
  const p = k.paint;
  p.cyl(P.terracotta, x, CURB + 0.3, z, 0.48, 0.36, 0.6, 12);
  p.ball(P.leafC, x, CURB + 0.72, z, 0.46, 0.32, 0.46);
  for (let i = 0; i < 8; i++) {
    const a = i * 0.9;
    p.ball([P.pink, P.yellow, P.white, P.lilac][i % 4], x + Math.cos(a) * 0.3, CURB + 0.86 + (i % 3) * 0.06, z + Math.sin(a) * 0.3, 0.1);
  }
  colliders.push({ kind: 'circle', x, z, r: 0.5 });
}

function cafeSet(k: Kit, colliders: Collider[], x: number, z: number, parasol: number | null): void {
  const p = k.paint;
  p.cyl(P.warmWhite, x, CURB + 0.74, z, 0.4, 0.4, 0.04, 14);
  p.cyl(P.ink, x, CURB + 0.37, z, 0.03, 0.03, 0.74, 6);
  p.cyl(P.ink, x, CURB + 0.02, z, 0.24, 0.24, 0.03, 10);
  p.cyl(P.persimmon, x + 0.12, CURB + 0.8, z - 0.08, 0.045, 0.035, 0.08, 8);
  p.cyl(P.trim, x - 0.14, CURB + 0.8, z + 0.1, 0.045, 0.035, 0.08, 8);
  for (const s of [-1, 1]) {
    const cx = x + s * 0.72;
    p.box(P.deepGreen, cx, CURB + 0.45, z, 0.4, 0.04, 0.4);
    p.box(P.deepGreen, cx + s * 0.19, CURB + 0.7, z, 0.04, 0.46, 0.4);
    p.box(P.ink, cx, CURB + 0.22, z, 0.3, 0.44, 0.04);
    seats.push({ x: cx, z, heading: (-s * Math.PI) / 2 });
  }
  if (parasol !== null) {
    p.cyl(P.ink, x, CURB + 1.3, z, 0.025, 0.025, 2.6, 6);
    p.cone(parasol, x, CURB + 2.3, z, 1.35, 0.5, 8, { flat: true });
  }
  colliders.push({ kind: 'circle', x, z, r: 0.95 });
}

function bench(k: Kit, colliders: Collider[], x: number, z: number, ry: number): void {
  const p = k.paint;
  const b = new THREE.Matrix4().makeRotationY(ry).setPosition(x, CURB, z);
  p.frame.copy(b);
  p.box(P.trunk, 0, 0.45, 0, 1.7, 0.06, 0.5);
  p.box(P.trunk, 0, 0.78, -0.24, 1.7, 0.4, 0.05);
  for (const s of [-1, 1]) p.box(P.ink, s * 0.75, 0.22, 0, 0.06, 0.45, 0.46);
  p.frame.identity();
  colliders.push({ kind: 'circle', x, z, r: 0.7 });
}

function car(k: Kit, colliders: Collider[], x: number, z: number, alongX: boolean, body: number): void {
  const p = k.paint;
  p.frame.copy(new THREE.Matrix4().makeRotationY(alongX ? 0 : Math.PI / 2).setPosition(x, 0, z));
  p.box(body, 0, 0.56, 0, 4.0, 0.56, 1.66);
  p.ball(body, 1.85, 0.56, 0, 0.45, 0.28, 0.83);
  p.ball(body, -1.85, 0.56, 0, 0.45, 0.28, 0.83);
  p.box(P.glass, -0.15, 1.05, 0, 2.0, 0.46, 1.46);
  p.box(body, -0.15, 1.31, 0, 2.08, 0.07, 1.52);
  for (const sx of [-1.25, 1.25]) {
    for (const sz of [-0.78, 0.78]) {
      p.cyl(P.ink, sx, 0.32, sz, 0.32, 0.32, 0.2, 12, { rx: Math.PI / 2 });
      p.cyl(P.steel, sx, 0.32, sz + Math.sign(sz) * 0.09, 0.15, 0.15, 0.04, 10, { rx: Math.PI / 2 });
    }
  }
  k.glow.frame.copy(p.frame);
  k.glow.box(P.lampGlow, 2.27, 0.6, 0.55, 0.05, 0.12, 0.3);
  k.glow.box(P.lampGlow, 2.27, 0.6, -0.55, 0.05, 0.12, 0.3);
  k.glow.frame.identity();
  p.frame.identity();
  const hx = alongX ? 2.35 : 0.9;
  const hz = alongX ? 0.9 : 2.35;
  colliders.push({ kind: 'box', x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz });
}

function plaza(k: Kit, colliders: Collider[]): void {
  const p = k.paint;
  // Lawn with the cedar.
  p.box(P.lawn, 26, CURB + 0.06, 24, 20, 0.12, 17);
  p.box(P.lawnDeep, 26, CURB + 0.065, 24, 16, 0.12, 13);
  cedar(k, colliders, 28, 25);

  // Fountain.
  p.cyl(P.stone, 13, CURB + 0.24, 13, 2.3, 2.4, 0.48, 20);
  p.cyl(P.water, 13, CURB + 0.46, 13, 2.0, 2.0, 0.06, 20);
  p.cyl(P.stone, 13, CURB + 0.8, 13, 0.2, 0.3, 1.0, 10);
  p.cyl(P.stone, 13, CURB + 1.32, 13, 0.85, 0.3, 0.16, 14);
  p.cyl(P.water, 13, CURB + 1.4, 13, 0.72, 0.72, 0.04, 14);
  colliders.push({ kind: 'circle', x: 13, z: 13, r: 2.45 });

  // A short length of the old railway kept in the paving.
  for (const dz of [-0.72, 0.72]) p.box(P.steel, 15, CURB + 0.016, 36 + dz, 13, 0.02, 0.08);
  for (let x = 9; x <= 21; x += 0.9) p.box(P.paverJoint, x, CURB + 0.012, 36, 0.24, 0.012, 2.1);

  cafeSet(k, colliders, 10.5, 21, P.persimmon);
  cafeSet(k, colliders, 11, 26, P.warmWhite);
  cafeSet(k, colliders, 20.5, 11, null);
  bench(k, colliders, 18.5, 14.6, Math.PI);
  bench(k, colliders, 15.2, 18.5, -Math.PI / 2);
  for (const [x, z] of [[9.2, 9.2], [16, 33.5], [36, 13]]) planter(k, colliders, x, z);
}

export function buildCorner(): Corner {
  const k: Kit = { paint: new Batch(), glow: new Batch(), glint: new Batch(), signs: new THREE.Group() };
  const colliders: Collider[] = [];

  streets(k.paint);
  for (const b of BUILDINGS) {
    addBuilding(k, b);
    colliders.push({ kind: 'box', x0: b.x0, x1: b.x1 + 0.05, z0: b.z0, z1: b.z1 + 0.05 });
  }
  plaza(k, colliders);

  // Street trees stand at the party walls, so they frame the shop windows instead of hiding them.
  const T = 5.5;
  for (const [x, z] of [[-20, -T], [-32, -T], [20, -T], [31.5, -T], [-T, -20], [-T, -32], [-T, 20], [-T, 31.5], [16, T], [27, T], [T, 17], [T, 30]]) {
    tree(k, colliders, x, z, 5.6 + rand() * 0.8, 1.5 + rand() * 0.3);
  }
  for (const [x, z] of [[-5.6, -5.6], [5.6, -5.6], [-5.6, 5.6], [5.6, 5.6], [-26, -5.6], [-5.6, -26], [26, -5.6], [-5.6, 26]]) lamp(k, colliders, x, z);
  for (const [x, z] of [[-13.9, -5.7], [-5.7, -14], [13.9, -5.7], [-5.7, 14]]) planter(k, colliders, x, z);

  // Sidewalk seating outside Café Sereno, and a few parked cars.
  cafeSet(k, colliders, -17.2, -5.75, P.persimmon);
  car(k, colliders, -25, -3.4, true, P.cream);
  car(k, colliders, 14.5, -3.4, true, P.sage);
  car(k, colliders, -3.4, -25.5, false, P.navy);

  const group = new THREE.Group();
  const paint = k.paint.build(gouache({ vertexColors: true }));
  const glow = k.glow.build(gouache({ vertexColors: true, unlit: true }));
  const glint = k.glint.build(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }));
  if (paint) {
    paint.castShadow = true;
    paint.receiveShadow = true;
    group.add(paint);
  }
  if (glow) group.add(glow);
  if (glint) {
    glint.renderOrder = 1;
    group.add(glint);
  }
  group.add(k.signs);

  // Window-shoppers, a pair chatting on the plaza, and someone by the fountain.
  const standers: Spot[] = [
    { x: -11.4, z: -7.78, heading: Math.PI },
    { x: -27.3, z: -7.78, heading: Math.PI },
    { x: -7.78, z: -16.6, heading: -Math.PI / 2 },
    { x: 12.2, z: -7.78, heading: Math.PI },
    { x: 22.6, z: 13.4, heading: 1.2 },
    { x: 23.5, z: 13.7, heading: -1.9 },
    { x: 16.1, z: 11.4, heading: -2.2 },
  ];

  return { group, colliders, radius: 34, seats: seats.slice(), standers };
}
