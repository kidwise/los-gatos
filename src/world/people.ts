import * as THREE from 'three';
import { gouache } from '../style/gouache';
import { P } from '../style/palette';
import { seeded } from './kit';
import type { Spot } from './corner';

/**
 * Fashion-illustration people: long legs, small heads, a defined waist, and a curated outfit each.
 * Everyone is drawn from five shared shapes, so the whole crowd costs five draw calls.
 */

const SKIN = [0xf0cdb0, 0xdca883, 0xb9825e, 0x8a5a3e];
const HAIR = [P.ink, 0x5b4336, 0x9a5a3c, 0xb9b3b0, 0xd9b96e, 0x3d2c25];
const DOG = [P.cream, 0xc8a57a, P.ink, 0x8a6f5c];

const CAMEL = 0xc8a57a;
const WHITE = 0xfbf8f1;
const DENIM = 0x6f86a6;
const GREY = 0x6d6a78;
const TAN = 0xa9744a;
const STONE = 0xd9cdb8;

type OuterKind = 'trench' | 'coat' | 'blazer' | 'crop';
type BottomKind = 'slim' | 'wide' | 'midi' | 'dress';
type BagKind = 'handbag' | 'tote' | 'crossbody' | 'shopping' | 'cup';
type HatKind = 'brim' | 'beret' | 'cap';
type HairStyle = 'crop' | 'bob' | 'long' | 'chignon' | 'ponytail';

/** One considered outfit. People are dressed from this list, never from random colour mixes. */
interface Look {
  outer?: { kind: OuterKind; color: number; belt?: number };
  top: number;
  stripes?: number;
  sleeveless?: boolean;
  bottom: { kind: BottomKind; color: number };
  shoes: number;
  boots?: boolean;
  hat?: { kind: HatKind; color: number };
  hair?: HairStyle;
  shades?: boolean;
  scarf?: number;
  bag?: { kind: BagKind; color: number };
}

const LOOKS: Look[] = [
  // Belted camel trench, black trousers, one bright bag.
  { outer: { kind: 'trench', color: CAMEL, belt: TAN }, top: WHITE, bottom: { kind: 'slim', color: P.ink }, shoes: P.ink, bag: { kind: 'handbag', color: P.persimmon }, shades: true },
  // Long black coat over cream wide-legs.
  { outer: { kind: 'coat', color: P.ink }, top: P.warmWhite, bottom: { kind: 'wide', color: P.cream }, shoes: WHITE, bag: { kind: 'tote', color: TAN }, shades: true, hair: 'bob' },
  // Navy blazer, white tee, camel trousers, coffee in hand.
  { outer: { kind: 'blazer', color: P.navy }, top: WHITE, bottom: { kind: 'wide', color: CAMEL }, shoes: TAN, bag: { kind: 'cup', color: WHITE } },
  // Persimmon midi dress, wide-brim hat.
  { top: P.persimmon, sleeveless: true, bottom: { kind: 'dress', color: P.persimmon }, shoes: P.ink, hat: { kind: 'brim', color: P.cream }, shades: true, bag: { kind: 'handbag', color: P.cream }, hair: 'long' },
  // Sage slip dress with a cropped cream cardigan.
  { outer: { kind: 'crop', color: P.cream }, top: P.sage, bottom: { kind: 'dress', color: P.sage }, shoes: TAN, bag: { kind: 'crossbody', color: TAN }, hair: 'chignon' },
  // Breton stripes and a beret, boutique bags in hand.
  { top: WHITE, stripes: P.navy, bottom: { kind: 'slim', color: P.ink }, shoes: WHITE, hat: { kind: 'beret', color: P.persimmon }, bag: { kind: 'shopping', color: WHITE }, hair: 'bob' },
  // Head-to-toe cream.
  { outer: { kind: 'coat', color: P.cream }, top: P.warmWhite, bottom: { kind: 'wide', color: P.warmWhite }, shoes: CAMEL, bag: { kind: 'handbag', color: CAMEL }, scarf: P.blush, hair: 'chignon' },
  // Oxblood jacket, black midi skirt, tall boots.
  { outer: { kind: 'crop', color: P.oxblood }, top: P.ink, bottom: { kind: 'midi', color: P.ink }, shoes: P.ink, boots: true, bag: { kind: 'crossbody', color: P.ink }, shades: true, hair: 'long' },
  // Navy overcoat, grey flannel, a dark red scarf.
  { outer: { kind: 'coat', color: P.navy }, top: GREY, bottom: { kind: 'slim', color: GREY }, shoes: TAN, scarf: P.oxblood, hair: 'crop' },
  // Pale blue shirt, cream chinos, white trainers.
  { top: P.slateBlue, bottom: { kind: 'slim', color: P.cream }, shoes: WHITE, bag: { kind: 'cup', color: WHITE }, shades: true, hair: 'crop' },
  // Deep green coat over a blush dress.
  { outer: { kind: 'coat', color: P.deepGreen }, top: P.blush, bottom: { kind: 'dress', color: P.blush }, shoes: P.ink, boots: true, bag: { kind: 'shopping', color: P.ink }, hair: 'long' },
  // Off-duty: white jacket, black leggings, cap and ponytail.
  { outer: { kind: 'crop', color: WHITE }, top: P.sage, bottom: { kind: 'slim', color: P.ink }, shoes: WHITE, hat: { kind: 'cap', color: P.ink }, hair: 'ponytail' },
  // Butter blazer with white wide-legs.
  { outer: { kind: 'blazer', color: P.butter }, top: WHITE, bottom: { kind: 'wide', color: WHITE }, shoes: TAN, shades: true, bag: { kind: 'tote', color: P.ink }, hair: 'bob' },
  // Black knit, camel midi skirt, boots.
  { top: P.ink, bottom: { kind: 'midi', color: CAMEL }, shoes: P.ink, boots: true, bag: { kind: 'handbag', color: P.oxblood }, hair: 'chignon' },
  // Stone trench, denim, trainers.
  { outer: { kind: 'trench', color: STONE, belt: STONE }, top: P.navy, bottom: { kind: 'slim', color: DENIM }, shoes: WHITE, bag: { kind: 'shopping', color: P.blush }, hair: 'ponytail' },
  // Sharp monochrome: grey blazer over black.
  { outer: { kind: 'blazer', color: GREY }, top: P.ink, bottom: { kind: 'slim', color: P.ink }, shoes: P.ink, shades: true, hair: 'crop' },
];

const STEP_RATE = 12;
const CAPACITY = 2600;
const THIGH = 0.5;
const SHIN = 0.5;
const UPPER_ARM = 0.3;
const FOREARM = 0.27;

type Mode = 'walk' | 'stand' | 'sit';

interface Person {
  mode: Mode;
  look: Look;
  scale: number;
  shoulders: number;
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  earrings: boolean;
  pocket: boolean;
  dog: number | null;
  x: number;
  y: number;
  z: number;
  heading: number;
  // Walkers only.
  /** The line being walked, as x, y, z points in walking order, and the distance along it at each point. */
  line: number[] | null;
  cum: number[];
  seg: number;
  way: number;
  /** Set for someone walking alongside another person: they keep station on their leader. */
  leader: Person | null;
  lag: number;
  dist: number;
  speed: number;
  side: number;
  phase: number;
  shownPhase: number;
  // Stopping to greet the cat.
  greet: number;
  greetTime: number;
  cooldown: number;
  /** Seconds left of having been called over by a meow. */
  called: number;
  seed: number;
}

/** A line people can walk along: x, y, z for each point. Lines whose ends meet are joined into a network. */
export type Walkway = number[];

export interface PeopleOptions {
  seats: Spot[];
  standers: Spot[];
  walkways: Walkway[];
  walkers: number;
  /** Ground height, where it should override the heights stored in the walkways. */
  heightAt?: (x: number, z: number) => number;
  /** People further than this from the cat are not drawn. */
  drawRadius?: number;
}

// The style corner's sidewalk lines, round the blocks and over the crosswalks. Their ends lie out
// in the bare paper, so people arrive, leave and turn round unseen.
const LANE = 6.85;
const CROSS = 6.6;
const FAR = 48;
export const CORNER_WALKWAYS: Walkway[] = [
  [[-FAR, -LANE], [-LANE, -LANE], [-LANE, -FAR]],
  [[-FAR, -LANE], [-9, -LANE], [-7, -CROSS], [7, -CROSS], [9, -LANE], [FAR, -LANE]],
  [[-LANE, -FAR], [-LANE, -9], [-CROSS, -7], [-CROSS, 7], [-LANE, 9], [-LANE, FAR]],
  [[FAR, LANE], [9.5, LANE], [LANE, 9.5], [LANE, FAR]],
  [[-FAR, LANE], [-9, LANE], [-7, CROSS], [7, CROSS], [9.5, LANE], [FAR, LANE]],
].map((line) => line.flatMap(([x, z]) => [x, 0, z]));

/** Distance along a line at each of its points, measured on the ground. */
function measure(pts: number[]): number[] {
  const cum = [0];
  for (let i = 3; i < pts.length; i += 3) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 3], pts[i + 2] - pts[i - 1]));
  return cum;
}

const _base = new THREE.Matrix4();
const _upper = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _color = new THREE.Color();

class Shape {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;

  constructor(geo: THREE.BufferGeometry) {
    this.mesh = new THREE.InstancedMesh(geo, gouache({ local: true }), CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, _color.set(0xffffff));
  }

  begin(): void {
    this.n = 0;
  }

  put(matrix: THREE.Matrix4, color: number): void {
    if (this.n >= CAPACITY) return;
    this.mesh.setMatrixAt(this.n, matrix);
    this.mesh.setColorAt(this.n, _color.set(color));
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Where a two-part limb's joint and end fall, for a limb hanging from (y, z) and swung by two angles. */
function limb(y: number, z: number, first: number, a: number, second: number, b: number, out: { jy: number; jz: number; ey: number; ez: number }): void {
  out.jy = y - first * Math.cos(a);
  out.jz = z - first * Math.sin(a);
  out.ey = out.jy - second * Math.cos(b);
  out.ez = out.jz - second * Math.sin(b);
}
const _limb = { jy: 0, jz: 0, ey: 0, ez: 0 };

export class People {
  readonly group = new THREE.Group();
  // Strokes hang down from their top end and are one unit long.
  private flare = new Shape(new THREE.CylinderGeometry(0.58, 1, 1, 12).translate(0, -0.5, 0));
  private taper = new Shape(new THREE.CylinderGeometry(1, 0.55, 1, 10).translate(0, -0.5, 0));
  private tube = new Shape(new THREE.CylinderGeometry(1, 0.86, 1, 12).translate(0, -0.5, 0));
  private ball = new Shape(new THREE.SphereGeometry(1, 12, 9));
  private box = new Shape(new THREE.BoxGeometry(1, 1, 1));
  private shapes = [this.flare, this.taper, this.tube, this.ball, this.box];
  private folk: Person[] = [];
  private stepClock = 0;
  private time = 0;
  private ways: { pts: number[]; cum: number[] }[];
  private rand = seeded(1923);
  private heightAt?: (x: number, z: number) => number;
  private drawRadius: number;
  private catX = 0;
  private catZ = 0;

  constructor(opts: PeopleOptions) {
    const { seats, standers } = opts;
    for (const s of this.shapes) this.group.add(s.mesh);
    this.ways = opts.walkways.filter((w) => w.length >= 6).map((pts) => ({ pts, cum: measure(pts) }));
    this.heightAt = opts.heightAt;
    this.drawRadius = opts.drawRadius ?? Infinity;
    const rand = this.rand;
    const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

    // Deal outfits from a shuffled deck so neighbours rarely match.
    let deck: Look[] = [];
    const deal = (): Look => {
      if (deck.length === 0) deck = LOOKS.slice().sort(() => rand() - 0.5);
      return deck.pop()!;
    };

    const make = (mode: Mode): Person => {
      const look = deal();
      return {
        mode,
        look,
        scale: 0.96 + rand() * 0.13,
        shoulders: 0.165 + rand() * 0.035,
        skin: pick(SKIN),
        hair: pick(HAIR),
        hairStyle: look.hair ?? pick<HairStyle>(['crop', 'bob', 'long', 'chignon']),
        earrings: rand() < 0.35,
        pocket: rand() < 0.3,
        dog: null,
        x: 0, y: 0.15, z: 0, heading: 0,
        line: null, cum: [], seg: 0, way: -1, leader: null, lag: 0, dist: 0, speed: 0, side: 0,
        phase: rand(), shownPhase: 0,
        greet: 0, greetTime: 0, cooldown: 0, called: 0,
        seed: rand() * 100,
      };
    };

    // Walkers are spread along the walkways in proportion to their length.
    const lengths = this.ways.map((w) => w.cum[w.cum.length - 1]);
    const total = lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.walkers && total > 0; i++) {
      let at = rand() * total;
      let w = 0;
      while (w < lengths.length - 1 && at > lengths[w]) at -= lengths[w++];
      const p = make('walk');
      this.follow(p, w, rand() < 0.5);
      p.dist = Math.min(at, lengths[w] * 0.98);
      p.speed = 1.05 + rand() * 0.4;
      p.side = 0.3 + (rand() - 0.5) * 0.2;
      const hands = p.look.bag?.kind;
      if (rand() < 0.3 && (hands === undefined || hands === 'tote' || hands === 'crossbody')) p.dog = pick(DOG);
      this.folk.push(p);

      // Some people are out together: one or two friends walk abreast of the first.
      const r = rand();
      const friends = r < 0.09 ? 2 : r < 0.36 ? 1 : 0;
      for (let f = 0; f < friends && i + 1 < opts.walkers; f++, i++) {
        const friend = make('walk');
        friend.leader = p;
        friend.side = p.side + (f === 0 ? 0.72 : -0.72);
        friend.lag = 0.1 + rand() * 0.35;
        friend.line = p.line;
        this.folk.push(friend);
      }
    }

    for (const spot of standers) {
      const p = make('stand');
      Object.assign(p, { x: spot.x, y: spot.y ?? 0.15, z: spot.z, heading: spot.heading });
      this.folk.push(p);
    }
    // Leave a few chairs empty.
    seats.forEach((spot, i) => {
      if (i % 3 === 2) return;
      const p = make('sit');
      Object.assign(p, { x: spot.x, y: spot.y ?? 0.15, z: spot.z, heading: spot.heading });
      this.folk.push(p);
    });

    this.draw();
  }

  /** How many people are within a distance of a point. */
  countNear(x: number, z: number, radius: number): number {
    let n = 0;
    for (const p of this.folk) if (Math.abs(p.x - x) < radius && Math.abs(p.z - z) < radius) n++;
    return n;
  }

  /** A meow: walkers within earshot stop and turn to the cat for a few seconds. Returns how many heard. */
  call(x: number, z: number, radius: number): number {
    let heard = 0;
    for (const p of this.folk) {
      if (p.mode !== 'walk' || p.leader || Math.hypot(p.x - x, p.z - z) > radius) continue;
      p.called = 3 + this.rand() * 1.5;
      heard++;
    }
    return heard;
  }

  /** People further than this from the cat are not drawn. */
  setDrawRadius(radius: number): void {
    this.drawRadius = radius;
  }

  update(dt: number, cat: THREE.Vector3, catSpeed: number): void {
    this.catX = cat.x;
    this.catZ = cat.z;
    this.time += dt;
    this.stepClock += dt;
    const tick = this.stepClock >= 1 / STEP_RATE;
    if (tick) this.stepClock = 0;

    for (const p of this.folk) {
      if (p.mode === 'walk' && p.line) this.walk(p, dt, cat, catSpeed);
      if (tick) p.shownPhase = p.phase;
    }
    this.draw();
  }

  /** Sets a walker off along a walkway, from one end or the other, optionally starting from where they stand. */
  private follow(p: Person, way: number, reversed: boolean, from?: number[]): void {
    const src = this.ways[way].pts;
    const line: number[] = from ? from.slice() : [];
    for (let i = 0; i < src.length; i += 3) {
      const k = reversed ? src.length - 3 - i : i;
      line.push(src[k], src[k + 1], src[k + 2]);
    }
    p.line = line;
    p.cum = measure(line);
    p.way = way;
    p.seg = 0;
    p.dist = 0;
  }

  /** At the end of a walkway, carry on along one that starts nearby, or turn back if there is none. */
  private turn(p: Person): void {
    const line = p.line!;
    const end = [line[line.length - 3], line[line.length - 2], line[line.length - 1]];
    const options: { way: number; reversed: boolean; weight: number }[] = [];
    let sum = 0;
    this.ways.forEach((w, i) => {
      if (i === p.way) return;
      for (const reversed of [false, true]) {
        const k = reversed ? w.pts.length - 3 : 0;
        const d = Math.hypot(w.pts[k] - end[0], w.pts[k + 2] - end[2]);
        // Usually round the corner or straight on; now and then, across the street.
        const weight = d < 9 ? 1 : d < 17 ? 0.2 : 0;
        if (weight > 0 && Math.abs(w.pts[k + 1] - end[1]) < 1.5) {
          options.push({ way: i, reversed, weight });
          sum += weight;
        }
      }
    });
    if (options.length === 0) {
      // Dead end: go back the way we came.
      const src = this.ways[p.way].pts;
      const atStart = Math.hypot(src[0] - end[0], src[2] - end[2]) < Math.hypot(src[src.length - 3] - end[0], src[src.length - 1] - end[2]);
      this.follow(p, p.way, !atStart);
      return;
    }
    let r = this.rand() * sum;
    let choice = options[0];
    for (const o of options) {
      choice = o;
      if ((r -= o.weight) <= 0) break;
    }
    this.follow(p, choice.way, choice.reversed, end);
  }

  private walk(p: Person, dt: number, cat: THREE.Vector3, catSpeed: number): void {
    // A cat that has stopped nearby is worth stopping for.
    p.cooldown = Math.max(0, p.cooldown - dt);
    const near = Math.hypot(cat.x - p.x, cat.z - p.z) < 1.5 && Math.abs(cat.y - p.y) < 1.5;
    p.called = Math.max(0, p.called - dt);
    const greeting = p.called > 0 || (near && catSpeed < 0.3 && p.cooldown === 0 && p.greetTime < 5);
    if (greeting) p.greetTime += dt;
    else if (p.greetTime > 0) {
      if (p.greetTime > 0.5) p.cooldown = 8;
      p.greetTime = 0;
    }
    p.greet += ((greeting ? 1 : 0) - p.greet) * (1 - Math.exp(-6 * dt));

    let pace = p.speed * (1 - p.greet);
    const lead = p.leader;
    if (lead) {
      // Keep station beside the leader, and stop when they stop.
      p.line = lead.line;
      p.cum = lead.cum;
      p.seg = 0;
      p.dist = Math.max(0, lead.dist - p.lag);
      p.greet = lead.greet;
      pace = lead.speed * (1 - lead.greet);
    } else {
      p.dist += pace * dt;
      if (p.dist >= p.cum[p.cum.length - 1]) this.turn(p);
    }
    p.phase = (p.phase + (pace * dt) / (1.5 * p.scale)) % 1;

    // Find the stretch of line we are on, and keep to the right of it.
    const line = p.line!;
    while (p.seg < p.cum.length - 2 && p.dist > p.cum[p.seg + 1]) p.seg++;
    const a = p.seg * 3;
    const span = p.cum[p.seg + 1] - p.cum[p.seg] || 1;
    const t = Math.min(1, (p.dist - p.cum[p.seg]) / span);
    const dx = (line[a + 3] - line[a]) / span;
    const dz = (line[a + 5] - line[a + 2]) / span;
    const tx = line[a] + (line[a + 3] - line[a]) * t - dz * p.side;
    const tz = line[a + 2] + (line[a + 5] - line[a + 2]) * t + dx * p.side;
    const ty = this.heightAt ? this.heightAt(tx, tz) : line[a + 1] + (line[a + 4] - line[a + 1]) * t;
    const ease = 1 - Math.exp(-8 * dt);
    const jumped = Math.hypot(tx - p.x, tz - p.z) > 5;
    p.x = jumped ? tx : p.x + (tx - p.x) * ease;
    p.z = jumped ? tz : p.z + (tz - p.z) * ease;
    p.y = jumped ? ty : p.y + (ty - p.y) * 0.3;

    const goal = p.greet > 0.5 ? Math.atan2(cat.x - p.x, cat.z - p.z) : Math.atan2(dx, dz);
    const diff = Math.atan2(Math.sin(goal - p.heading), Math.cos(goal - p.heading));
    p.heading = jumped ? goal : p.heading + diff * (1 - Math.exp(-7 * dt));
  }

  private draw(): void {
    for (const s of this.shapes) s.begin();
    for (const p of this.folk) {
      if (Math.hypot(p.x - this.catX, p.z - this.catZ) <= this.drawRadius) this.figure(p);
    }
    for (const s of this.shapes) s.end();
  }

  /** A stroke hanging from (x, y, z): sx wide, sz deep, swung forward or back by rx. */
  private stroke(shape: Shape, frame: THREE.Matrix4, color: number, x: number, y: number, z: number, sx: number, length: number, sz = sx, rx = 0): void {
    _local.compose(_pos.set(x, y, z), _quat.setFromEuler(_euler.set(rx, 0, 0)), _scl.set(sx, length, sz));
    shape.put(_m.multiplyMatrices(frame, _local), color);
  }

  private blob(shape: Shape, frame: THREE.Matrix4, color: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx): void {
    _local.compose(_pos.set(x, y, z), _quat.identity(), _scl.set(sx, sy, sz));
    shape.put(_m.multiplyMatrices(frame, _local), color);
  }

  /** A thin line from _a to _b, for straps and leads. */
  private line(frame: THREE.Matrix4, color: number, radius: number): void {
    const len = _a.distanceTo(_b);
    _quat.setFromUnitVectors(_down, _dir.subVectors(_b, _a).divideScalar(len));
    _local.compose(_a, _quat, _scl.set(radius, len, radius));
    this.tube.put(_m.multiplyMatrices(frame, _local), color);
  }

  private figure(p: Person): void {
    const TAU = Math.PI * 2;
    const L = p.look;
    const sitting = p.mode === 'sit';
    const moving = p.mode === 'walk' ? 1 - p.greet : 0;
    const skirted = L.bottom.kind === 'midi' || L.bottom.kind === 'dress';
    const stride = skirted ? 0.3 : 0.42;
    const idle = Math.sin(this.time * 0.8 + p.seed);
    const bob = Math.abs(Math.cos(p.shownPhase * TAU)) * 0.03 * moving;

    const hip = sitting ? 0.5 : 1.02;
    const waist = hip + 0.18;
    const shoulder = hip + 0.54;
    const headY = hip + 0.71;
    const sw = p.shoulders;

    _base.compose(_pos.set(p.x, p.y + bob * p.scale, p.z), _quat.setFromEuler(_euler.set(0, p.heading, 0)), _scl.setScalar(p.scale));

    // Everything above the hips leans together: forward to greet the cat, a touch when seated.
    const lean = p.greet * 0.5 + (sitting ? 0.06 : -0.02) + (p.mode === 'stand' ? idle * 0.015 : 0);
    _upper.copy(_base)
      .multiply(_local.makeTranslation(0, hip, 0))
      .multiply(_local.makeRotationX(lean))
      .multiply(_local.makeTranslation(0, -hip, 0));

    // ---- Legs: long, close together, with a knee that bends as the leg comes through. ----
    for (const s of [-1, 1]) {
      const ph = (p.shownPhase + (s > 0 ? 0.5 : 0)) * TAU;
      let thigh = Math.sin(ph) * stride * moving;
      let shin = thigh + Math.max(0, -Math.cos(ph)) * 0.85 * moving;
      if (sitting) {
        thigh = -Math.PI / 2 + 0.08;
        shin = 0.12;
      } else if (p.mode === 'stand') {
        // Weight on one leg, the other relaxed.
        thigh = s < 0 ? -0.06 : 0.04;
        shin = s < 0 ? 0.1 : 0.04;
      }
      const x = s * 0.066;
      limb(hip, 0, THIGH, thigh, SHIN, shin, _limb);
      const legSkin = skirted;
      const thighColor = legSkin ? p.skin : L.bottom.color;
      const shinColor = L.boots ? L.shoes : thighColor;
      if (L.bottom.kind === 'wide') {
        this.stroke(this.tube, _base, thighColor, x, hip, 0, 0.09, THIGH + 0.02, 0.085, thigh);
        this.stroke(this.flare, _base, shinColor, x, _limb.jy, _limb.jz, 0.105, SHIN - 0.03, 0.1, shin);
      } else {
        this.stroke(this.taper, _base, thighColor, x, hip, 0, legSkin ? 0.066 : 0.078, THIGH + 0.02, legSkin ? 0.066 : 0.078, thigh);
        this.stroke(this.taper, _base, shinColor, x, _limb.jy, _limb.jz, L.boots ? 0.056 : 0.05, SHIN - 0.02, L.boots ? 0.056 : 0.05, shin);
      }
      this.blob(this.ball, _base, L.shoes, x, _limb.ey + 0.035, _limb.ez + 0.05, 0.043, 0.036, 0.11);
    }

    // ---- Skirt or hips. ----
    if (skirted) {
      const hem = L.bottom.kind === 'dress' ? 0.66 : 0.6;
      if (sitting) this.stroke(this.flare, _base, L.bottom.color, 0, hip + 0.06, -0.06, 0.2, 0.5, 0.11, -Math.PI / 2 + 0.1);
      else this.stroke(this.flare, _base, L.bottom.color, 0, waist + 0.01, 0, 0.21, hem, 0.175, Math.sin(p.shownPhase * TAU * 2) * 0.03 * moving);
    } else {
      this.stroke(this.flare, _base, L.bottom.color, 0, waist + 0.01, 0, 0.152, 0.27, 0.118);
    }

    // ---- Torso: wide at the shoulder, narrow at the waist. ----
    this.stroke(this.taper, _upper, L.top, 0, shoulder, 0, sw, 0.38, 0.115);
    this.blob(this.ball, _upper, L.top, 0, shoulder - 0.012, 0, sw, 0.04, 0.1);
    if (L.stripes !== undefined) {
      for (let i = 0; i < 4; i++) {
        const f = (i + 0.6) / 4.6;
        const r = 1 - f * 0.45;
        this.blob(this.ball, _upper, L.stripes, 0, shoulder - f * 0.38, 0, sw * r + 0.004, 0.016, 0.115 * r + 0.004);
      }
    }
    if (L.bottom.kind === 'dress' && !L.outer) this.blob(this.ball, _upper, P.ink, 0, waist + 0.01, 0, sw * 0.57, 0.016, 0.068);

    // ---- Outerwear, cut to show what is worn underneath. ----
    const O = L.outer;
    const sway = Math.sin(p.shownPhase * TAU * 2 + 1) * 0.035 * moving;
    if (O) {
      const osw = sw + 0.028;
      const long = O.kind === 'trench' || O.kind === 'coat';
      const under = L.bottom.kind === 'dress' ? L.top : L.bottom.color;
      if (long) {
        // Fitted through the body, then flaring from the waist.
        const skirt = sitting ? 0.2 : O.kind === 'trench' ? 0.56 : 0.72;
        this.stroke(this.taper, _upper, O.color, 0, shoulder + 0.008, 0, osw, 0.39, 0.138);
        this.stroke(this.flare, _upper, O.color, 0, waist + 0.03, 0, 0.235, skirt, 0.18, sway);
        this.stroke(this.taper, _upper, L.top, 0, shoulder + 0.004, 0.014, 0.05, 0.385, 0.138);
        this.stroke(this.flare, _upper, under, 0, waist + 0.03, 0.012, 0.045, skirt - 0.01, 0.18, sway);
        if (O.belt !== undefined) {
          this.blob(this.ball, _upper, O.belt, 0, waist + 0.015, 0, osw * 0.6, 0.022, 0.086);
          this.blob(this.box, _upper, P.brass, 0, waist + 0.015, 0.086, 0.035, 0.035, 0.012);
        }
      } else {
        const len = O.kind === 'blazer' ? 0.58 : 0.36;
        this.stroke(this.tube, _upper, O.color, 0, shoulder + 0.008, 0, osw, len, 0.138);
        this.stroke(this.tube, _upper, L.top, 0, shoulder + 0.004, 0.014, 0.055, len - 0.01, 0.138);
      }
      // Structured shoulders and a collar.
      this.blob(this.ball, _upper, O.color, 0, shoulder, 0, osw + 0.012, 0.045, 0.122);
      if (L.scarf === undefined) this.blob(this.ball, _upper, O.color, 0, shoulder + 0.04, -0.012, 0.1, 0.036, 0.098);
    }

    // ---- Arms. The right arm does whatever the accessory needs; the left swings or rests in a pocket. ----
    const armX = sw + (O ? 0.05 : 0.022);
    const armR = O ? 0.05 : 0.042;
    const sleeve = O ? O.color : L.top;
    const bag = sitting && L.bag && L.bag.kind !== 'cup' ? undefined : L.bag;
    let handY = 0;
    let handZ = 0;
    for (const s of [-1, 1]) {
      const ph = (p.shownPhase + (s > 0 ? 0.5 : 0)) * TAU;
      let a = -Math.sin(ph) * 0.34 * moving;
      let b = a - 0.28 - Math.max(0, -a) * 0.5;
      if (s === -1 && p.pocket && !sitting) {
        a = 0.12;
        b = -0.42;
      }
      if (s === 1) {
        if (p.dog !== null) {
          a = -0.3;
          b = -0.75;
        } else if (bag?.kind === 'handbag') {
          a = 0.12;
          b = -1.45;
        } else if (bag?.kind === 'cup') {
          a = -0.2;
          b = -1.9;
        } else if (bag?.kind === 'shopping') {
          a *= 0.3;
          b = a - 0.12;
        }
      }
      if (sitting) {
        a = -0.55;
        b = -1.4;
      }
      if (s === -1) {
        a -= p.greet * 0.8;
        b -= p.greet * 0.9;
      }
      limb(shoulder - 0.035, 0, UPPER_ARM, a, FOREARM, b, _limb);
      const bare = !O && L.sleeveless;
      this.stroke(this.taper, _upper, bare ? p.skin : sleeve, s * armX, shoulder - 0.035, 0, armR, UPPER_ARM + 0.01, armR, a);
      this.stroke(this.taper, _upper, bare ? p.skin : sleeve, s * armX, _limb.jy, _limb.jz, armR * 0.85, FOREARM, armR * 0.85, b);
      this.blob(this.ball, _upper, p.skin, s * armX, _limb.ey, _limb.ez, 0.03, 0.036, 0.03);
      if (s === 1) {
        handY = _limb.ey;
        handZ = _limb.ez;
        if (bag?.kind === 'handbag' && p.dog === null) {
          // Carried in the crook of the arm.
          const my = (_limb.jy + _limb.ey) / 2;
          const mz = (_limb.jz + _limb.ez) / 2;
          this.blob(this.box, _upper, bag.color, armX, my - 0.19, mz, 0.1, 0.19, 0.26);
          this.blob(this.box, _upper, bag.color, armX, my - 0.06, mz - 0.07, 0.02, 0.1, 0.02);
          this.blob(this.box, _upper, bag.color, armX, my - 0.06, mz + 0.07, 0.02, 0.1, 0.02);
          this.blob(this.box, _upper, P.brass, armX + 0.052, my - 0.15, mz, 0.01, 0.035, 0.05);
        } else if (bag?.kind === 'cup' && p.dog === null) {
          this.blob(this.box, _upper, bag.color, armX, handY + 0.06, handZ + 0.02, 0.055, 0.1, 0.055);
          this.blob(this.box, _upper, P.ink, armX, handY + 0.115, handZ + 0.02, 0.06, 0.015, 0.06);
        } else if (bag?.kind === 'shopping' && p.dog === null) {
          // Two boutique bags, one in front of the other.
          const second = bag.color === P.ink ? P.blush : P.ink;
          this.blob(this.box, _upper, bag.color, armX + 0.04, handY - 0.2, handZ + 0.02, 0.1, 0.3, 0.26);
          this.blob(this.box, _upper, second, armX + 0.042, handY - 0.1, handZ + 0.02, 0.102, 0.04, 0.262);
          this.blob(this.box, _upper, second, armX - 0.05, handY - 0.17, handZ - 0.03, 0.08, 0.24, 0.2);
        }
      }
    }
    if (bag?.kind === 'tote') {
      this.blob(this.box, _upper, bag.color, -(armX + 0.075), waist - 0.07, -0.02, 0.07, 0.3, 0.34);
      _a.set(-(sw + 0.01), shoulder + 0.03, 0);
      _b.set(-(armX + 0.075), waist + 0.08, -0.02);
      this.line(_upper, bag.color, 0.014);
    } else if (bag?.kind === 'crossbody') {
      _a.set(-sw + 0.02, shoulder + 0.045, 0.06);
      _b.set(sw, waist - 0.06, 0.13);
      this.line(_upper, bag.color, 0.013);
      _a.set(-sw + 0.02, shoulder + 0.045, -0.06);
      _b.set(sw, waist - 0.06, -0.1);
      this.line(_upper, bag.color, 0.013);
      this.blob(this.box, _upper, bag.color, sw + 0.075, waist - 0.14, 0.02, 0.07, 0.15, 0.2);
      this.blob(this.box, _upper, P.brass, sw + 0.112, waist - 0.12, 0.02, 0.008, 0.03, 0.04);
    }

    // ---- Neck and head, kept small, chin up. ----
    const nod = p.greet * 0.06;
    this.stroke(this.tube, _upper, p.skin, 0, headY - 0.05, 0, 0.04, 0.15);
    this.blob(this.ball, _upper, p.skin, 0, headY, 0.006 + nod, 0.084, 0.106, 0.093);
    if (L.shades) this.blob(this.box, _upper, P.ink, 0, headY + 0.014, 0.08 + nod, 0.158, 0.036, 0.03);
    if (p.earrings) {
      for (const s of [-1, 1]) this.blob(this.ball, _upper, P.brass, s * 0.086, headY - 0.045, 0.005, 0.014);
    }
    if (L.scarf !== undefined) {
      this.blob(this.ball, _upper, L.scarf, 0, shoulder + 0.055, 0, 0.105, 0.05, 0.1);
      this.stroke(this.flare, _upper, L.scarf, 0.05, shoulder + 0.05, 0.1, 0.05, 0.34, 0.022, sway);
    }

    // ---- Hair. ----
    const hat = L.hat?.kind;
    const hs = p.hairStyle;
    if (hs === 'bob' || hs === 'long') this.blob(this.ball, _upper, p.hair, 0, headY + 0.018, -0.03, 0.103, 0.108, 0.103);
    else this.blob(this.ball, _upper, p.hair, 0, headY + 0.04, -0.022, 0.092, 0.086, 0.1);
    if (hs === 'long') this.stroke(this.flare, _upper, p.hair, 0, headY + 0.02, -0.075, 0.095, 0.4, 0.05, 0.06 + sway * 2);
    if (hs === 'chignon' && hat !== 'brim') this.blob(this.ball, _upper, p.hair, 0, headY + 0.075, -0.1, 0.052);
    if (hs === 'ponytail') this.stroke(this.taper, _upper, p.hair, 0, headY + 0.05, -0.1, 0.036, 0.3, 0.036, 0.55 + sway * 4);

    // ---- Hats. ----
    if (L.hat) {
      const c = L.hat.color;
      if (hat === 'brim') {
        this.blob(this.ball, _upper, c, 0, headY + 0.09, -0.005, 0.24, 0.016, 0.24);
        this.blob(this.ball, _upper, c, 0, headY + 0.12, -0.005, 0.1, 0.07, 0.105);
        this.blob(this.ball, _upper, P.ink, 0, headY + 0.1, -0.005, 0.102, 0.016, 0.107);
      } else if (hat === 'beret') {
        this.blob(this.ball, _upper, c, 0.025, headY + 0.1, -0.015, 0.118, 0.04, 0.118);
        this.blob(this.ball, _upper, c, 0.025, headY + 0.142, -0.015, 0.012);
      } else {
        this.blob(this.ball, _upper, c, 0, headY + 0.06, -0.005, 0.094, 0.07, 0.1);
        this.blob(this.box, _upper, c, 0, headY + 0.055, 0.12, 0.13, 0.012, 0.1);
      }
    }

    if (p.dog !== null) this.dog(p, Math.sin(p.shownPhase * TAU) * moving, armX, handY, handZ);
  }

  private dog(p: Person, swing: number, handX: number, handY: number, handZ: number): void {
    // Trots a little ahead on the right, on a lead.
    const dx = 0.5;
    const dz = 0.8;
    const trot = swing * 0.8;
    const c = p.dog!;
    this.blob(this.ball, _base, c, dx, 0.3, dz, 0.1, 0.1, 0.22);
    this.blob(this.ball, _base, c, dx, 0.42, dz + 0.24, 0.085, 0.08, 0.1);
    this.blob(this.ball, _base, c, dx, 0.39, dz + 0.33, 0.04, 0.035, 0.05);
    for (const sx of [-1, 1]) {
      this.blob(this.ball, _base, c, dx + sx * 0.06, 0.49, dz + 0.2, 0.03, 0.045, 0.025);
      this.stroke(this.taper, _base, c, dx + sx * 0.06, 0.28, dz + 0.14, 0.03, 0.28, 0.03, sx * trot);
      this.stroke(this.taper, _base, c, dx + sx * 0.06, 0.28, dz - 0.14, 0.03, 0.28, 0.03, -sx * trot);
    }
    this.stroke(this.taper, _base, c, dx, 0.36, dz - 0.2, 0.025, 0.2, 0.025, 2.3);
    this.blob(this.ball, _base, P.persimmon, dx, 0.4, dz + 0.17, 0.07, 0.07, 0.02);
    // The lead, from hand to collar. The hand sits in the leaning upper-body frame, but this is close enough.
    _a.set(handX, handY, handZ);
    _b.set(dx, 0.43, dz + 0.16);
    this.line(_base, P.oxblood, 0.008);
  }
}
