import * as THREE from 'three';
import { gouache, gouacheUniforms } from '../style/gouache';
import { P } from '../style/palette';
import { GROUND_FLOOR, RECESS, UPPER_FLOOR, storefronts, type Kit } from './buildings';
import { bench, cafeSet, car, cedar, lamp, planter, type Collider, type Spot } from './corner';
import { bridgeGhost, millGhost, type Ghost } from './ghosts';
import { HEROES, fitRectangle } from './heroes';
import { dressLake } from './lake';
import { People } from './people';
import { Batch, signOptions } from './kit';
import { makeRouter, type Router } from './router';
import { shopAt } from './shops';
import type { Find, Ride, World } from './world';

/** A region pack, as written by pipeline/build.mjs. Coordinates are game metres: x east, z south, y up. */
interface Pack {
  id: string;
  title: string;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  terrain: { x0: number; z0: number; cell: number; cols: number; rows: number; heights: number[] };
  roads: Road[];
  water: { width: number; pts: number[] }[];
  buildings: { id: number; name?: string; kind: string; levels: number; base: number; cx: number; cz: number; ring: number[]; fronts: number[]; hero?: string; face?: number }[];
  areas: { kind: string; y: number; ring: number[] }[];
  trees: number[];
  props?: { lamps: number[]; planters: number[]; benches: number[]; cars: number[]; boats?: number[]; picnics?: number[]; cedar: number[] | null; fountain: number[] | null };
  /** One long run of railway for the train: x, y, z points. */
  train?: number[] | null;
  creekDepth?: number;
  exits?: { to: string; side: 'north' | 'south' }[];
  spots?: Find[];
}

interface Road {
  kind: string;
  name?: string;
  width: number;
  bridge?: boolean;
  sidewalks?: boolean;
  /** x, y, z for each point along the road. */
  pts: number[];
}

const STREETS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
const SIDEWALK = 2.6;
const WALLS = [P.cream, P.warmWhite, P.blush, P.sage, P.butter, P.paleTerracotta, P.slateBlue, P.cream, P.warmWhite];
const HOUSES = new Set(['house', 'detached', 'residential', 'garage', 'shed', 'apartments']);
/** The world is cut into square tiles this many metres across, so what is out of view is not drawn. */
const CHUNK = 72;
const PITCHED_ROOFS = [P.terracotta, 0xb8664a, 0xa8785a, 0x9a8f96];
const FLAT_ROOFS = [P.roof, 0xd3c8bb, 0xcfc6c0, 0xe0d6c8];
const WALKABLE = new Set(['cycleway', 'footway', 'path', 'pedestrian']);
const AREA_COLOR: Record<string, number> = { lake: P.water, park: P.lawn, grass: P.lawn, wood: P.lawnDeep, parking: P.lot, plaza: P.plaza, pool: P.water };

function hash(n: number): number {
  let t = (n ^ 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

const CAP = new THREE.BoxGeometry(1, 1, 1);

function insideRing(x: number, z: number, ring: number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    if (ring[i + 1] > z !== ring[j + 1] > z && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) inside = !inside;
  }
  return inside;
}

/** Collects triangles, turning each to face upward, and hands back a geometry with normals. */
class Tris {
  private v: number[] = [];

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (up >= 0) this.v.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    else this.v.push(ax, ay, az, cx, cy, cz, bx, by, bz);
  }

  get empty(): boolean {
    return this.v.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.v), 3));
    g.computeVertexNormals();
    return g;
  }
}

/** The left and right edges of a strip of the given width laid along a line. */
function edges(pts: number[], width: number): { L: number[]; R: number[] } {
  const n = pts.length / 3;
  const L: number[] = [];
  const R: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 1, 0) * 3;
    const b = Math.min(i + 1, n - 1) * 3;
    let tx = pts[b] - pts[a];
    let tz = pts[b + 2] - pts[a + 2];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    L.push(x - tz * (width / 2), y, z + tx * (width / 2));
    R.push(x + tz * (width / 2), y, z - tx * (width / 2));
  }
  return { L, R };
}

/** A flat strip along a line, lifted a little so layers stack cleanly. `keep` can leave gaps for dashes. */
function ribbon(out: Tris, pts: number[], width: number, lift: number, keep?: (segment: number) => boolean): void {
  const { L, R } = edges(pts, width);
  for (let i = 0; i < pts.length / 3 - 1; i++) {
    if (keep && !keep(i)) continue;
    const a = i * 3;
    const b = a + 3;
    out.tri(L[a], L[a + 1] + lift, L[a + 2], R[a], R[a + 1] + lift, R[a + 2], L[b], L[b + 1] + lift, L[b + 2]);
    out.tri(R[a], R[a + 1] + lift, R[a + 2], R[b], R[b + 1] + lift, R[b + 2], L[b], L[b + 1] + lift, L[b + 2]);
  }
}

/** A round patch, to close the ends of streets and smooth their junctions. */
function disc(out: Tris, x: number, y: number, z: number, r: number): void {
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const b = ((i + 1) / N) * Math.PI * 2;
    out.tri(x, y, z, x + Math.cos(a) * r, y, z + Math.sin(a) * r, x + Math.cos(b) * r, y, z + Math.sin(b) * r);
  }
}

/** Re-cuts a line into even steps, keeping heights, so short dashes and stair treads can be drawn. */
function recut(pts: number[], step: number): number[] {
  const out = [pts[0], pts[1], pts[2]];
  for (let i = 3; i < pts.length; i += 3) {
    const ax = pts[i - 3], ay = pts[i - 2], az = pts[i - 1];
    const n = Math.max(1, Math.round(Math.hypot(pts[i] - ax, pts[i + 2] - az) / step));
    for (let k = 1; k <= n; k++) out.push(ax + ((pts[i] - ax) * k) / n, ay + ((pts[i + 1] - ay) * k) / n, az + ((pts[i + 2] - az) * k) / n);
  }
  return out;
}

interface Wall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Only solid for walkers near this height (bridge railings); NaN means always solid. */
  y: number;
  /** For a bridge railing, which bridge it belongs to: it only stops someone on that deck. */
  bridge?: number;
}

export async function loadRegion(id: string, from: string | null = null): Promise<World> {
  const pack: Pack = await (await fetch(`${import.meta.env.BASE_URL}regions/${id}.json`)).json();
  const T = pack.terrain;

  const terrainY = (x: number, z: number): number => {
    const gx = Math.max(0, Math.min(T.cols - 1.001, (x - T.x0) / T.cell));
    const gz = Math.max(0, Math.min(T.rows - 1.001, (z - T.z0) / T.cell));
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const h = T.heights;
    const a = h[iz * T.cols + ix], b = h[iz * T.cols + ix + 1], c = h[(iz + 1) * T.cols + ix], d = h[(iz + 1) * T.cols + ix + 1];
    return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) / 10;
  };

  const B = pack.bounds;
  const group = new THREE.Group();
  const paint = new Batch();
  // Bridges are kept apart from everything else so they can be cut away when the cat walks under them.
  const over = new Batch();
  const kit: Kit = { paint, glow: new Batch(), glint: new Batch(), signs: new THREE.Group() };
  signOptions.px = 56;
  const walls: Wall[] = [];
  // Lines people walk along, and spots where they stand looking into shop windows.
  const walkways: number[][] = [];
  const standers: Spot[] = [];
  const seats: Spot[] = [];
  // Round things the cat walks around: trunks, lamp posts, planters, tables.
  const posts: { x: number; y: number; z: number; r: number }[] = [];
  const unused: Collider[] = [];
  /** Draws one of the street props at a place and angle, standing on ground at height y. */
  const stand = (x: number, y: number, z: number, ry: number, draw: () => void) => {
    // The props were designed standing on a 0.15 m curb, so lower them by that much.
    const frame = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y - 0.15, z);
    kit.paint.frame.copy(frame);
    kit.glow.frame.copy(frame);
    draw();
    kit.paint.frame.identity();
    kit.glow.frame.identity();
  };
  /** Distance from a point to the nearest street's roadway edge; negative means on the road. */
  const offRoad = (x: number, z: number) => {
    let best = Infinity;
    for (const r of pack.roads) {
      if (!STREETS.has(r.kind) && r.kind !== 'service') continue;
      for (let i = 0; i < r.pts.length - 3; i += 3) {
        const ax = r.pts[i], az = r.pts[i + 2], dx = r.pts[i + 3] - ax, dz = r.pts[i + 5] - az;
        const len2 = dx * dx + dz * dz;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
        best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - r.width / 2);
      }
    }
    return best;
  };
  const PARASOLS = [P.persimmon, P.warmWhite, P.deepGreen, null];
  let tables = 0;
  const lifted = (pts: number[]) => pts.map((v, i) => (i % 3 === 1 ? v + 0.05 : v));

  // ---- Ground: one sheet, tinted by what covers it. ----
  {
    const inRing = (x: number, z: number, ring: number[]) => {
      let inside = false;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        if (ring[i + 1] > z !== ring[j + 1] > z && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) inside = !inside;
      }
      return inside;
    };
    const boxed = pack.areas.map((a) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < a.ring.length; i += 2) {
        x0 = Math.min(x0, a.ring[i]); x1 = Math.max(x1, a.ring[i]);
        z0 = Math.min(z0, a.ring[i + 1]); z1 = Math.max(z1, a.ring[i + 1]);
      }
      return { a, x0, x1, z0, z1 };
    });
    const pos = new Float32Array(T.cols * T.rows * 3);
    const col = new Float32Array(T.cols * T.rows * 3);
    const depth = pack.creekDepth ?? 8;
    const town = new THREE.Color(P.ground), bank = new THREE.Color(P.bank), bed = new THREE.Color(P.creekBed), c = new THREE.Color();
    for (let j = 0; j < T.rows; j++) {
      for (let i = 0; i < T.cols; i++) {
        const k = j * T.cols + i;
        const x = T.x0 + i * T.cell, z = T.z0 + j * T.cell, y = T.heights[k] / 10;
        pos.set([x, y, z], k * 3);
        // Town level is pale; the cut banks are green; the creek bed is gravel.
        c.copy(town).lerp(bank, THREE.MathUtils.smoothstep(-y, 0.4, Math.min(1.6, depth * 0.6))).lerp(bed, THREE.MathUtils.smoothstep(-y, depth * 0.9, depth * 0.99));
        if (y > -0.6) {
          const hit = boxed.find((b) => b.a.kind !== 'lake' && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && inRing(x, z, b.a.ring));
          if (hit) c.set(AREA_COLOR[hit.a.kind]);
        }
        col.set([c.r, c.g, c.b], k * 3);
      }
    }
    // Normals are worked out once over the whole sheet, so tiles meet without a visible seam.
    const whole = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(pos, 3);
    const color = new THREE.BufferAttribute(col, 3);
    whole.setAttribute('position', position);
    const all: number[] = [];
    for (let j = 0; j < T.rows - 1; j++) {
      for (let i = 0; i < T.cols - 1; i++) {
        const k = j * T.cols + i;
        all.push(k, k + T.cols, k + 1, k + 1, k + T.cols, k + T.cols + 1);
      }
    }
    whole.setIndex(all);
    whole.computeVertexNormals();
    const normal = whole.attributes.normal;

    // The sheet is drawn as tiles, so those out of the picture are skipped. A tile that is dead
    // flat and all one colour is drawn with far fewer, larger triangles.
    const TILE = 32, COARSE = 8;
    const ground = gouache({ vertexColors: true, meadow: true });
    for (let tj = 0; tj < T.rows - 1; tj += TILE) {
      for (let ti = 0; ti < T.cols - 1; ti += TILE) {
        const i1 = Math.min(ti + TILE, T.cols - 1), j1 = Math.min(tj + TILE, T.rows - 1);
        let lo = Infinity, hi = -Infinity, plain = true;
        const first = (tj * T.cols + ti) * 3;
        for (let j = tj; j <= j1; j++) {
          for (let i = ti; i <= i1; i++) {
            const k = j * T.cols + i;
            lo = Math.min(lo, T.heights[k]);
            hi = Math.max(hi, T.heights[k]);
            if (plain && (Math.abs(col[k * 3] - col[first]) > 0.004 || Math.abs(col[k * 3 + 1] - col[first + 1]) > 0.004 || Math.abs(col[k * 3 + 2] - col[first + 2]) > 0.004)) plain = false;
          }
        }
        const step = plain && hi === lo && (i1 - ti) % COARSE === 0 && (j1 - tj) % COARSE === 0 ? COARSE : 1;
        const index: number[] = [];
        for (let j = tj; j < j1; j += step) {
          for (let i = ti; i < i1; i += step) {
            const a = j * T.cols + i, b = a + step, c = a + step * T.cols, d = c + step;
            index.push(a, c, b, b, c, d);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', position);
        g.setAttribute('color', color);
        g.setAttribute('normal', normal);
        g.setIndex(index);
        const x0 = T.x0 + ti * T.cell, x1 = T.x0 + i1 * T.cell, z0 = T.z0 + tj * T.cell, z1 = T.z0 + j1 * T.cell;
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (lo + hi) / 20, (z0 + z1) / 2), Math.hypot(x1 - x0, z1 - z0, (hi - lo) / 10) / 2 + 0.5);
        const mesh = new THREE.Mesh(g, ground);
        mesh.receiveShadow = true;
        mesh.castShadow = hi - lo > 4;
        group.add(mesh);
      }
    }
  }

  // ---- Flat ground cover with crisp edges, where the ground really is flat. ----
  const meadow = new Batch();
  for (const a of pack.areas) {
    const contour: THREE.Vector2[] = [];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < a.ring.length; i += 2) {
      contour.push(new THREE.Vector2(a.ring[i], a.ring[i + 1]));
      const y = terrainY(a.ring[i], a.ring[i + 1]);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    const lake = a.kind === 'lake';
    if (!lake && hi - lo > 0.35) continue;
    const out = new Tris();
    const y = lake ? a.y : hi + (a.kind === 'pool' ? 0.05 : 0.025);
    if (lake) {
      const dock = pack.spots?.find((s) => s.id === 'boats') ?? null;
      dressLake({ ring: a.ring, level: a.y, kit, group, terrainY, boats: pack.props?.boats ?? [], dockNear: dock });
      // The shore is as far as a cat goes.
      for (let i = 0; i < contour.length; i++) {
        const p = contour[i], q = contour[(i + 1) % contour.length];
        walls.push({ ax: p.x, az: p.y, bx: q.x, bz: q.y, y: NaN });
      }
    }
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      out.tri(contour[i].x, y, contour[i].y, contour[j].x, y, contour[j].y, contour[k].x, y, contour[k].y);
    }
    // The lake paints its own water; grass goes to the meadow painter; the rest is plain.
    if (lake || out.empty) continue;
    (a.kind === 'park' || a.kind === 'grass' || a.kind === 'wood' ? meadow : paint).add(out.geometry(), AREA_COLOR[a.kind], 0, 0, 0);
  }
  const lawnMeshes = meadow.buildChunks(gouache({ vertexColors: true, meadow: true }), CHUNK * 2);
  for (const m of lawnMeshes) m.receiveShadow = true;

  // ---- Roads, paths and the creek, as layered strips. ----
  const layers: Record<string, Tris> = {};
  const overLayers: Record<string, Tris> = {};
  let onBridge = false;
  const layer = (name: string) => ((onBridge ? overLayers : layers)[name] ??= new Tris());
  const bridges: { pts: number[]; half: number }[] = [];

  for (const r of pack.roads) {
    onBridge = !!r.bridge && r.kind !== 'sidewalk';
    const n = r.pts.length / 3;
    const end = (n - 1) * 3;
    if (STREETS.has(r.kind)) {
      const full = r.width + (r.sidewalks ? SIDEWALK * 2 : 0);
      if (r.sidewalks) {
        ribbon(layer('sidewalk'), r.pts, full, 0.04);
        disc(layer('sidewalk'), r.pts[0], r.pts[1] + 0.04, r.pts[2], full / 2);
        disc(layer('sidewalk'), r.pts[end], r.pts[end + 1] + 0.04, r.pts[end + 2], full / 2);
      }
      ribbon(layer('asphalt'), r.pts, r.width, 0.07);
      disc(layer('asphalt'), r.pts[0], r.pts[1] + 0.07, r.pts[2], r.width / 2);
      disc(layer('asphalt'), r.pts[end], r.pts[end + 1] + 0.07, r.pts[end + 2], r.width / 2);
      if (r.kind !== 'residential') ribbon(layer('paint'), r.pts, 0.16, 0.1, (i) => i % 2 === 0);
      if (r.bridge) bridge(r, full);
      if (r.sidewalks) {
        const walk = edges(r.pts, r.width + SIDEWALK);
        walkways.push(lifted(walk.L), lifted(walk.R));
      }
    } else if (r.kind === 'motorway' || r.kind === 'motorway_link') {
      ribbon(layer('freeway'), r.pts, r.width, 0.06);
      if (r.kind === 'motorway') ribbon(layer('paint'), r.pts, 0.18, 0.09, (i) => i % 3 === 0);
    } else if (r.kind === 'service') {
      ribbon(layer('lot'), r.pts, r.width, 0.055);
    } else if (r.kind === 'crossing') {
      ribbon(layer('paint'), recut(r.pts, 0.55), 2.6, 0.1, (i) => i % 2 === 0);
    } else if (r.kind === 'steps') {
      ribbon(layer('stone'), r.pts, r.width, 0.08);
      ribbon(layer('curb'), recut(r.pts, 0.35), r.width, 0.09, (i) => i % 2 === 0);
    } else if (r.kind === 'rail') {
      // Ballast, sleepers and two rails.
      ribbon(layer('earth'), r.pts, 1.9, 0.06);
      ribbon(layer('sleeper'), recut(r.pts, 0.45), 1.5, 0.09, (i) => i % 2 === 0);
      const track = edges(r.pts, 0.8);
      ribbon(layer('rail'), track.L, 0.1, 0.13);
      ribbon(layer('rail'), track.R, 0.1, 0.13);
      if (r.bridge) bridge(r, 2.2, true);
    } else if (r.kind === 'sidewalk') {
      // Already drawn as part of its street.
    } else {
      const name = r.kind === 'cycleway' ? 'trail' : r.kind === 'track' ? 'earth' : r.kind === 'pedestrian' ? 'plaza' : 'sidewalk';
      ribbon(layer(name), r.pts, r.width, r.kind === 'cycleway' ? 0.085 : 0.08);
      if (r.bridge) bridge(r, r.width);
      if (WALKABLE.has(r.kind)) walkways.push(lifted(r.pts));
    }
  }
  onBridge = false;
  for (const w of pack.water) ribbon(layer('water'), w.pts, w.width, 0);

  /** A bridge needs a deck you can stand on, sides you cannot walk through, and something holding it up. */
  function bridge(r: Road, width: number, low = false): void {
    bridges.push({ pts: r.pts, half: width / 2 });
    const { L, R } = edges(r.pts, width);
    const street = STREETS.has(r.kind);
    // A railway trestle has only low timber edges, so the train shows above them.
    const rail = low ? 0.1 : street ? 1.0 : 1.1;
    const depth = street ? 1.3 : 0.4;
    for (const side of [L, R]) {
      for (let i = 0; i < side.length - 3; i += 3) {
        const dx = side[i + 3] - side[i], dz = side[i + 5] - side[i + 2];
        const len = Math.hypot(dx, dz);
        const y = (side[i + 1] + side[i + 4]) / 2;
        over.box(street ? P.stone : P.trunk, (side[i] + side[i + 3]) / 2, y + (rail - depth) / 2, (side[i + 2] + side[i + 5]) / 2, len + 0.05, rail + depth, street ? 0.4 : 0.16, Math.atan2(-dz, dx));
        walls.push({ ax: side[i], az: side[i + 2], bx: side[i + 3], bz: side[i + 5], y, bridge: bridges.length - 1 });
      }
    }
    if (street) {
      // Piers down to whatever is below, a third and two thirds of the way across.
      const n = r.pts.length / 3;
      for (const f of [1 / 3, 2 / 3]) {
        const i = Math.round((n - 1) * f) * 3;
        const top = r.pts[i + 1] - depth;
        const foot = terrainY(r.pts[i], r.pts[i + 2]);
        if (top - foot > 1) over.box(P.stone, r.pts[i], (top + foot) / 2, r.pts[i + 2], 1.4, top - foot, width * 0.8, Math.atan2(-(r.pts[i + 5] - r.pts[i + 2]), r.pts[i + 3] - r.pts[i]));
      }
    }
  }

  const LAYER_COLOR: Record<string, number> = { sidewalk: P.sidewalk, asphalt: P.asphalt, freeway: P.freeway, lot: P.lot, paint: P.roadPaint, stone: P.stone, curb: P.curb, trail: P.trail, earth: P.earth, plaza: P.plaza, water: P.water, sleeper: P.trunk, rail: P.steel };
  for (const [name, tris] of Object.entries(layers)) {
    if (!tris.empty) paint.add(tris.geometry(), LAYER_COLOR[name], 0, 0, 0);
  }
  for (const [name, tris] of Object.entries(overLayers)) {
    if (!tris.empty) over.add(tris.geometry(), LAYER_COLOR[name], 0, 0, 0);
  }

  // ---- Buildings: real footprints raised into painted blocks with rows of windows. ----
  let shopCount = 0;
  for (const b of pack.buildings) {
    const n = b.ring.length / 2;
    if (b.hero && HEROES[b.hero]) {
      // A hand-built landmark stands on this footprint instead of a generic block.
      HEROES[b.hero](kit, b.ring, b.base, b.face);
      for (let i = 0; i < n; i++) {
        walls.push({ ax: b.ring[i * 2], az: b.ring[i * 2 + 1], bx: b.ring[((i + 1) % n) * 2], bz: b.ring[((i + 1) % n) * 2 + 1], y: NaN });
      }
      continue;
    }
    const house = HOUSES.has(b.kind);
    const fronts = new Set(b.fronts);
    // Buildings with shops use the shopfront kit's taller ground floor.
    const height = fronts.size ? GROUND_FLOOR + (b.levels - 1) * UPPER_FLOOR + 0.5 : b.levels * 3.4 + (house ? 0.4 : 0.9);
    const top = b.base + height;
    const wall = WALLS[Math.floor(hash(b.id) * WALLS.length)];
    const tone = hash(b.id + 3);
    const style = { wall, trim: P.trim, shutters: tone < 0.2 ? P.inkGreen : tone < 0.35 ? P.navy : undefined };
    const g = new THREE.BufferGeometry();
    const v: number[] = [];
    for (let i = 0; i < n; i++) {
      const ax = b.ring[i * 2], az = b.ring[i * 2 + 1];
      const bx = b.ring[((i + 1) % n) * 2], bz = b.ring[((i + 1) % n) * 2 + 1];
      // Footprints are wound so that outside is on the right of each edge.
      walls.push({ ax, az, bx, bz, y: NaN });
      const len = Math.hypot(bx - ax, bz - az);
      if (fronts.has(i)) {
        // Shopfront wall: solid above the ground floor, set back behind the shop windows below it.
        const ox = (-(bz - az) / len) * RECESS, oz = ((bx - ax) / len) * RECESS;
        const mid = b.base + GROUND_FLOOR;
        v.push(ax, mid, az, ax, top, az, bx, top, bz, ax, mid, az, bx, top, bz, bx, mid, bz);
        v.push(ax + ox, b.base - 0.5, az + oz, ax + ox, mid, az + oz, bx + ox, mid, bz + oz, ax + ox, b.base - 0.5, az + oz, bx + ox, mid, bz + oz, bx + ox, b.base - 0.5, bz + oz);
        const frame = new THREE.Matrix4()
          .makeBasis(new THREE.Vector3(-(bx - ax) / len, 0, -(bz - az) / len), new THREE.Vector3(0, 1, 0), new THREE.Vector3((bz - az) / len, 0, -(bx - ax) / len))
          .setPosition(bx, b.base, bz);
        const count = Math.max(1, Math.round(len / 6.5));
        const shops = Array.from({ length: count }, (_, s) => shopAt(shopCount++, hash(b.id * 31 + i * 7 + s)));
        storefronts(kit, style, shops, len, frame, b.levels, height);
        // A table and two chairs on the sidewalk outside cafés and bakeries, where there is room.
        shops.forEach((shop, si) => {
          if ((shop.display !== 'cafe' && shop.display !== 'bakery') || hash(b.id * 13 + i * 3 + si) > 0.75) return;
          const u = (si + 0.5) / count;
          const wx = (ax - bx) / len, wz = (az - bz) / len;
          const tx = bx + (ax - bx) * u - (ox / RECESS) * 1.75, tz = bz + (az - bz) * u - (oz / RECESS) * 1.75;
          if (offRoad(tx, tz) < 1.1) return;
          const turn = Math.atan2(-wz, wx);
          const y = b.base + 0.05;
          stand(tx, y, tz, turn, () => cafeSet(kit, unused, 0, 0, PARASOLS[tables++ % PARASOLS.length]));
          posts.push({ x: tx, y, z: tz, r: 0.95 });
          for (const s of [-1, 1]) seats.push({ x: tx + s * 0.72 * wx, y, z: tz + s * 0.72 * wz, heading: turn - (s * Math.PI) / 2 });
        });
        if (hash(b.id * 17 + i) < 0.3) {
          // Someone looking in at the window.
          const f = 0.3 + hash(b.id * 5 + i) * 0.4;
          standers.push({ x: ax + (bx - ax) * f - ox * 1.9, y: b.base + 0.05, z: az + (bz - az) * f - oz * 1.9, heading: Math.atan2(ox, oz) });
        }
        continue;
      }
      v.push(ax, b.base - 0.5, az, ax, top, az, bx, top, bz, ax, b.base - 0.5, az, bx, top, bz, bx, b.base - 0.5, bz);

      const count = Math.floor((len - 1.2) / 2.9);
      if (count < 1) continue;
      // Wall space: u runs along the wall from b back to a, n points outward.
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      paint.frame.makeBasis(new THREE.Vector3(-dx, 0, -dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(dz, 0, -dx)).setPosition(bx, b.base, bz);
      for (let l = 0; l < b.levels; l++) {
        // Side and back walls: plain windows, lined up with the shopfront floors where there are any.
        const floor = fronts.size ? (l === 0 ? 0.4 : GROUND_FLOOR + (l - 1) * UPPER_FLOOR) : l * 3.4;
        for (let k = 0; k < count; k++) {
          const u = ((k + 0.5) * len) / count;
          paint.box(P.glass, u, floor + 1.95, 0.02, 1.05, 1.6, 0.06);
          paint.box(P.trim, u, floor + 1.1, 0.05, 1.35, 0.1, 0.14);
        }
      }
      paint.frame.identity();
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    g.computeVertexNormals();
    paint.add(g, wall, 0, 0, 0);

    roof(b.id, b.ring, top, house, wall);
  }

  /**
   * Roofs with real planes for the light to catch: hipped where the footprint is close to a
   * rectangle, sloped in from every edge where it is not, and flat behind a parapet for shops.
   */
  function roof(id: number, ring: number[], top: number, house: boolean, wall: number): void {
    const n = ring.length / 2;
    const rect = fitRectangle(ring);
    let area = 0;
    for (let i = 0; i < n; i++) area += ring[i * 2] * ring[((i + 1) % n) * 2 + 1] - ring[((i + 1) % n) * 2] * ring[i * 2 + 1];
    area = Math.abs(area) / 2;
    const boxy = area / (4 * rect.halfLong * rect.halfShort) > 0.84;
    const pitched = house || hash(id + 7) < 0.22;
    const tone = Math.floor(hash(id + 13) * 4);
    const out = new Tris();
    const c = Math.cos(rect.angle), s = Math.sin(rect.angle);

    if (pitched && boxy && rect.halfShort > 1.5) {
      // Hipped roof on the fitted rectangle, with a small overhang.
      const hx = rect.halfLong + 0.45, hz = rect.halfShort + 0.45;
      const rise = Math.min(hz * 0.62, 3.2);
      const ridge = Math.max(hx - hz, 0);
      const at = (lx: number, lz: number, y: number): [number, number, number] => [rect.cx + c * lx - s * lz, y, rect.cz + s * lx + c * lz];
      const A = at(-hx, -hz, top), B = at(hx, -hz, top), C = at(hx, hz, top), D = at(-hx, hz, top);
      const R1 = at(-ridge, 0, top + rise), R2 = at(ridge, 0, top + rise);
      for (const [p, q, r] of [[D, C, R2], [D, R2, R1], [B, A, R1], [B, R1, R2], [A, D, R1], [C, B, R2]]) out.tri(...p, ...q, ...r);
      paint.add(out.geometry(), PITCHED_ROOFS[tone], 0, 0, 0);
      // Ridge and hip caps, a shade darker, so the roof's shape is drawn as well as lit.
      const cap = new THREE.Color(PITCHED_ROOFS[tone]).multiplyScalar(0.8).getHex();
      for (const [p, q] of [[R1, R2], [A, R1], [D, R1], [B, R2], [C, R2]]) {
        const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
        const flat = Math.hypot(dx, dz);
        if (flat < 0.3) continue;
        paint.add(CAP, cap, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 0.05, (p[2] + q[2]) / 2, { sx: Math.hypot(flat, dy), sy: 0.14, sz: 0.32, ry: Math.atan2(-dz, dx), rz: Math.atan2(dy, flat) });
      }
      return;
    }

    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));

    if (pitched) {
      // Slope in from every edge to a flat top: works on L-shapes and other awkward footprints.
      const d = Math.min(1.8, rect.halfShort * 0.45);
      const rise = d * 0.75;
      const inner: THREE.Vector2[] = [];
      for (let i = 0; i < n; i++) {
        const p = contour[(i + n - 1) % n], v = contour[i], q = contour[(i + 1) % n];
        const l1 = Math.hypot(v.x - p.x, v.y - p.y) || 1, l2 = Math.hypot(q.x - v.x, q.y - v.y) || 1;
        // Inward is on the left of each edge.
        const n1x = -(v.y - p.y) / l1, n1z = (v.x - p.x) / l1, n2x = -(q.y - v.y) / l2, n2z = (q.x - v.x) / l2;
        const k = d / Math.max(0.35, 1 + n1x * n2x + n1z * n2z);
        inner.push(new THREE.Vector2(v.x + (n1x + n2x) * k, v.y + (n1z + n2z) * k));
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        out.tri(contour[i].x, top, contour[i].y, contour[j].x, top, contour[j].y, inner[j].x, top + rise, inner[j].y);
        out.tri(contour[i].x, top, contour[i].y, inner[j].x, top + rise, inner[j].y, inner[i].x, top + rise, inner[i].y);
      }
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(inner, [])) {
        out.tri(inner[i].x, top + rise, inner[i].y, inner[j].x, top + rise, inner[j].y, inner[k].x, top + rise, inner[k].y);
      }
      paint.add(out.geometry(), PITCHED_ROOFS[tone], 0, 0, 0);
      const rim = new THREE.Color(PITCHED_ROOFS[tone]).multiplyScalar(0.8).getHex();
      for (let i = 0; i < n; i++) {
        const a = inner[i], b = inner[(i + 1) % n];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 0.4) paint.box(rim, (a.x + b.x) / 2, top + rise + 0.05, (a.y + b.y) / 2, len, 0.14, 0.3, Math.atan2(-(b.y - a.y), b.x - a.x));
      }
      return;
    }

    // Flat roof sunk behind a parapet, with plant and skylights on top.
    const deck = top - 0.5;
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      out.tri(contour[i].x, deck, contour[i].y, contour[j].x, deck, contour[j].y, contour[k].x, deck, contour[k].y);
    }
    if (!out.empty) paint.add(out.geometry(), FLAT_ROOFS[tone], 0, 0, 0);
    for (let i = 0; i < n; i++) {
      const a = contour[i], b = contour[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.8) continue;
      const ix = (-(b.y - a.y) / len) * 0.15, iz = ((b.x - a.x) / len) * 0.15;
      const turn = Math.atan2(-(b.y - a.y), b.x - a.x);
      paint.box(wall, (a.x + b.x) / 2 + ix, top - 0.25, (a.y + b.y) / 2 + iz, len + 0.02, 0.5, 0.3, turn);
      paint.box(P.trim, (a.x + b.x) / 2 + ix, top + 0.03, (a.y + b.y) / 2 + iz, len + 0.1, 0.06, 0.4, turn);
    }
    const units = area > 140 ? 3 : area > 55 ? 2 : area > 25 ? 1 : 0;
    for (let u = 0; u < units; u++) {
      const lx = (hash(id * 3 + u * 11) - 0.5) * rect.halfLong * 1.2;
      const lz = (hash(id * 7 + u * 5) - 0.5) * rect.halfShort * 1.2;
      const x = rect.cx + c * lx - s * lz, z = rect.cz + s * lx + c * lz;
      if (!insideRing(x, z, ring)) continue;
      if (u === 0) paint.box(P.roofUnit, x, deck + 0.42, z, 1.7, 0.84, 1.2, -rect.angle);
      else if (u === 1) paint.box(P.slateBlue, x, deck + 0.13, z, 1.9, 0.26, 1.2, -rect.angle);
      else paint.cyl(P.roofUnit, x, deck + 0.4, z, 0.2, 0.2, 0.8, 8);
    }
  }

  // ---- Street furniture placed by the pipeline. ----
  const F = pack.props;
  if (F) {
    for (let i = 0; i < F.lamps.length; i += 4) {
      stand(F.lamps[i], F.lamps[i + 1] + 0.04, F.lamps[i + 2], F.lamps[i + 3], () => lamp(kit, unused, 0, 0));
      posts.push({ x: F.lamps[i], y: F.lamps[i + 1], z: F.lamps[i + 2], r: 0.2 });
    }
    for (let i = 0; i < F.planters.length; i += 3) {
      stand(F.planters[i], F.planters[i + 1] + 0.04, F.planters[i + 2], 0, () => planter(kit, unused, 0, 0));
      posts.push({ x: F.planters[i], y: F.planters[i + 1], z: F.planters[i + 2], r: 0.5 });
    }
    for (let i = 0; i < F.benches.length; i += 4) {
      stand(F.benches[i], F.benches[i + 1] + 0.04, F.benches[i + 2], F.benches[i + 3], () => bench(kit, unused, 0, 0, 0));
      posts.push({ x: F.benches[i], y: F.benches[i + 1], z: F.benches[i + 2], r: 0.7 });
    }
    const CARS = [P.cream, P.sage, P.navy, P.slateBlue, P.oxblood];
    for (let i = 0; i < F.cars.length; i += 5) {
      const x = F.cars[i], y = F.cars[i + 1], z = F.cars[i + 2], ry = F.cars[i + 3];
      // Cars sit on the road surface, not the curb.
      stand(x, y + 0.22, z, ry, () => car(kit, unused, 0, 0, true, CARS[F.cars[i + 4]]));
      const c = Math.cos(ry), s = Math.sin(ry);
      const corner = (lx: number, lz: number) => [x + c * lx + s * lz, z - s * lx + c * lz];
      const box = [corner(-2.35, -0.9), corner(2.35, -0.9), corner(2.35, 0.9), corner(-2.35, 0.9)];
      for (let k = 0; k < 4; k++) walls.push({ ax: box[k][0], az: box[k][1], bx: box[(k + 1) % 4][0], bz: box[(k + 1) % 4][1], y });
    }
    // Picnic tables in the parks, with someone at a few of them.
    for (let i = 0; F.picnics && i < F.picnics.length; i += 3) {
      const x = F.picnics[i], y = F.picnics[i + 1], z = F.picnics[i + 2];
      const turn = hash(i * 7 + 3) * Math.PI;
      stand(x, y + 0.15, z, turn, () => {
        paint.box(0x9a7758, 0, 0.76, 0, 1.9, 0.07, 0.8);
        for (const s of [-1, 1]) {
          paint.box(0x9a7758, 0, 0.46, s * 0.72, 1.9, 0.06, 0.3);
          paint.box(0x7a5a45, s * 0.7, 0.38, 0, 0.08, 0.76, 1.5);
        }
        if (hash(i * 3 + 1) < 0.35) paint.box([P.persimmon, P.navy, P.warmWhite][i % 3], 0.1, 0.81, 0, 0.9, 0.02, 0.6);
      });
      posts.push({ x, y, z, r: 1.15 });
      if (hash(i * 11 + 5) < 0.3) {
        const sx = Math.sin(turn), sz = Math.cos(turn);
        for (const s of [-1, 1]) seats.push({ x: x + s * 0.72 * sx, y: y - 0.02, z: z + s * 0.72 * sz, heading: turn + (s > 0 ? Math.PI : 0) });
      }
    }
    if (F.cedar) {
      const [x, y, z] = F.cedar;
      stand(x, y + 0.15, z, 0, () => cedar(kit, unused, 0, 0));
      posts.push({ x, y, z, r: 0.55 });
    }
    // On Sundays the farmers' market sets up round the plaza: stalls under canopies, heaped with
    // produce and flowers, with people shopping. (`?market` shows it on any day.)
    if (F.cedar && (new Date().getDay() === 0 || new URLSearchParams(location.search).has('market'))) {
      const [cx, , cz] = F.cedar;
      const CANOPY = [P.warmWhite, P.persimmon, P.sage, P.butter, P.warmWhite, P.slateBlue, P.blush, P.deepGreen];
      const GOODS = [[0xd94f3d, 0xf2c14e, 0x6f9a5b], [0xe87f8f, 0xb48ad6, 0xf4f0e6], [0xe0683f, 0xf2c14e, 0xd94f3d], [0x8db36a, 0x557f4f, 0xf4f0e6], [0xb9825e, 0xdcc878, 0xf2e5cd], [0xb48ad6, 0xe87f8f, 0xf2c14e]];
      const STALLS = 9;
      let placed = 0;
      for (let i = 0; i < 14 && placed < STALLS; i++) {
        const a = (i / 14) * Math.PI * 2 + 0.3;
        const x = cx + Math.cos(a) * 11.5, z = cz + Math.sin(a) * 11.5;
        // Keep stalls on the grass and paving: off the roads and clear of the fountain.
        if (offRoad(x, z) < 2.2 || (F.fountain && Math.hypot(F.fountain[0] - x, F.fountain[2] - z) < 5)) continue;
        const y = terrainY(x, z);
        const turn = -a + Math.PI / 2;
        const goods = GOODS[placed % GOODS.length];
        stand(x, y + 0.15, z, turn, () => {
          // A trestle table with crates, heaped with whatever is in season, under a square canopy.
          paint.box(0x9a7758, 0, 0.78, 0, 2.6, 0.07, 1.1);
          for (const sx of [-1.1, 1.1]) paint.box(0x7a5a45, sx, 0.38, 0, 0.07, 0.76, 0.9);
          paint.box(placed % 2 ? P.warmWhite : 0xe8d6ae, 0, 0.5, 0.56, 2.6, 0.6, 0.03);
          for (let c = 0; c < 3; c++) {
            const bx = -0.85 + c * 0.85;
            paint.box(0xb9906a, bx, 0.92, 0, 0.72, 0.2, 0.8);
            for (let g = 0; g < 7; g++) paint.blob(goods[(c + g) % 3], bx + ((g % 3) - 1) * 0.2, 1.08 + (g > 3 ? 0.1 : 0), ((g % 2) - 0.5) * 0.36 + (g > 3 ? 0.1 : 0), 0.12, 0.11, 0.12);
          }
          for (const sx of [-1.45, 1.45]) for (const sz of [-0.9, 0.9]) paint.cyl(P.trim, sx, 1.3, sz, 0.035, 0.035, 2.6, 5);
          paint.cone(CANOPY[placed % CANOPY.length], 0, 2.55, 0, Math.SQRT1_2, 0.7, 4, { ry: Math.PI / 4, sx: 3.3, sz: 2.2, flat: true });
          paint.box(CANOPY[placed % CANOPY.length], 0, 2.47, 0, 3.3, 0.18, 2.2);
          // Buckets of cut flowers at one end.
          paint.cyl(P.steel, 1.75, 0.2, 0.3, 0.17, 0.14, 0.4, 8);
          for (let g = 0; g < 5; g++) paint.blob([0xe87f8f, 0xf2c14e, 0xf4f0e6, 0xb48ad6][(g + placed) % 4], 1.75 + Math.cos(g * 1.3) * 0.12, 0.52 + (g % 2) * 0.08, 0.3 + Math.sin(g * 1.3) * 0.12, 0.09);
        });
        posts.push({ x, y, z, r: 1.7 });
        // The stallholder behind the table, and a shopper or two in front.
        const fx = Math.cos(a), fz = Math.sin(a);
        standers.push({ x: x - fx * 1.25, y: y + 0.05, z: z - fz * 1.25, heading: Math.atan2(fx, fz) });
        standers.push({ x: x + fx * 1.5 - fz * 0.5, y: y + 0.05, z: z + fz * 1.5 + fx * 0.5, heading: Math.atan2(-fx, -fz) });
        if (placed % 2 === 0) standers.push({ x: x + fx * 1.6 + fz * 0.7, y: y + 0.05, z: z + fz * 1.6 - fx * 0.7, heading: Math.atan2(-fx, -fz) + 0.3 });
        placed++;
      }
    }
    if (F.fountain) {
      const [x, y, z] = F.fountain;
      stand(x, y + 0.15, z, 0, () => {
        paint.cyl(P.stone, 0, 0.24, 0, 2.3, 2.4, 0.48, 20);
        paint.cyl(P.water, 0, 0.46, 0, 2.0, 2.0, 0.06, 20);
        paint.cyl(P.stone, 0, 0.8, 0, 0.2, 0.3, 1.0, 10);
        paint.cyl(P.stone, 0, 1.32, 0, 0.85, 0.3, 0.16, 14);
        paint.cyl(P.water, 0, 1.4, 0, 0.72, 0.72, 0.04, 14);
      });
      posts.push({ x, y, z, r: 2.45 });
    }
  }

  // ---- Trees. ----
  const greens = [P.leafA, P.leafB, P.leafC, P.leafSun];
  for (let i = 0; i < pack.trees.length; i += 4) {
    const x = pack.trees[i], y = pack.trees[i + 1], z = pack.trees[i + 2], s = pack.trees[i + 3];
    const r = hash(i + 11), trunk = 3.6 * s + r * 1.5;
    paint.cyl(P.trunk, x, y + trunk / 2, z, 0.12 * s, 0.2 * s, trunk, 6);
    for (let k = 0; k < 4; k++) {
      const a = k * 1.9 + r * 6;
      const d = k === 0 ? 0 : 0.9 * s;
      const rr = (k === 0 ? 1.5 : 1.05) * s;
      paint.blob(greens[Math.floor(hash(i * 5 + k) * 4)], x + Math.cos(a) * d, y + trunk + (k === 0 ? 0.6 : 0.1) * s, z + Math.sin(a) * d, rr, rr * 0.85, rr);
    }
    posts.push({ x, y, z, r: 0.25 * s });
  }

  for (const [batch, material] of [
    [paint, gouache({ vertexColors: true })],
    [over, gouache({ vertexColors: true, hole: true })],
  ] as const) {
    for (const mesh of batch.buildChunks(material, CHUNK)) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  for (const mesh of kit.glow.buildChunks(gouache({ vertexColors: true, unlit: true }), CHUNK)) group.add(mesh);
  const glint = kit.glint.build(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }));
  if (glint) {
    glint.renderOrder = 1;
    group.add(glint);
  }
  group.add(kit.signs);

  // People on the real sidewalks and the trail, drawn only near the cat.
  const people = new People({ seats, standers, walkways, walkers: 260, drawRadius: 140 });
  for (const mesh of lawnMeshes) group.add(mesh);
  group.add(people.group);

  // The painting fades to paper just past the region's edge.
  gouacheUniforms.uFadeCenter.value.set((B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2);
  gouacheUniforms.uFadeHalf.value.set((B.x1 - B.x0) / 2 - 6, (B.z1 - B.z0) / 2 - 6);
  gouacheUniforms.uFade.value.set(6, 34);

  // ---- Walking. ----
  // Walls are sorted into a coarse grid so only nearby ones are checked.
  const GRID = 16;
  const cells = new Map<number, Wall[]>();
  const key = (ix: number, iz: number) => ix * 4096 + iz;
  for (const w of walls) {
    const x0 = Math.floor(Math.min(w.ax, w.bx) / GRID), x1 = Math.floor(Math.max(w.ax, w.bx) / GRID);
    const z0 = Math.floor(Math.min(w.az, w.bz) / GRID), z1 = Math.floor(Math.max(w.az, w.bz) / GRID);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k)!.push(w);
      }
    }
  }

  /** Height of a bridge deck under a point, or null if the point is not over one. */
  /** The bridge deck over a point, if any: which bridge, its height there, and how far along it (0 to 1). */
  const deckAt = (x: number, z: number): { bridge: number; y: number; along: number } | null => {
    for (let n = 0; n < bridges.length; n++) {
      const b = bridges[n];
      const segments = b.pts.length / 3 - 1;
      for (let i = 0; i < b.pts.length - 3; i += 3) {
        const ax = b.pts[i], az = b.pts[i + 2], dx = b.pts[i + 3] - ax, dz = b.pts[i + 5] - az;
        const len2 = dx * dx + dz * dz;
        const t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
        if (t < 0 || t > 1) continue;
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) <= b.half) return { bridge: n, y: b.pts[i + 1] + (b.pts[i + 4] - b.pts[i + 1]) * t, along: (i / 3 + t) / segments };
      }
    }
    return null;
  };
  const deckY = (x: number, z: number): number | null => deckAt(x, z)?.y ?? null;

  // Whether the cat is on a bridge or under it. Height alone cannot tell where the ground is only
  // a little lower than the deck, so this is decided once, on stepping into a bridge's outline:
  // you get onto a bridge at one of its ends, and anywhere else you are passing underneath.
  let level: { bridge: number; onDeck: boolean } | null = null;
  const sensedAt = new THREE.Vector2(Infinity, Infinity);
  const sense = (pos: THREE.Vector3) => {
    const d = deckAt(pos.x, pos.z);
    sensedAt.set(pos.x, pos.z);
    if (!d) level = null;
    else if (!level || level.bridge !== d.bridge) {
      const gap = d.y - terrainY(pos.x, pos.z);
      // Where the drop is deep, height does tell: this also covers starting out in the middle of a deck.
      level = { bridge: d.bridge, onDeck: d.along < 0.1 || d.along > 0.9 || (gap > 2 && pos.y > d.y - 1) };
    }
  };

  // Start on Main Street, a few steps before the bridge over the freeway.
  const main = pack.roads.find((r) => r.bridge && r.name?.includes('Main Street'));
  let start = { x: 0, z: 0, heading: 0 };
  // Arriving from a neighbouring region, or starting in one without a set place: begin on the
  // Creek Trail, just inside the edge that leads there.
  const arriving = pack.exits?.find((e) => e.to === from) ?? (main ? undefined : pack.exits?.[0]);
  if (arriving) {
    const north = arriving.side === 'north';
    let best: number[] | null = null;
    for (const r of pack.roads) {
      if (r.kind !== 'cycleway' || r.bridge) continue;
      for (let i = 0; i < r.pts.length; i += 3) {
        const z = r.pts[i + 2];
        if (z < B.z0 + 14 || z > B.z1 - 14 || r.pts[i] < B.x0 + 14 || r.pts[i] > B.x1 - 14) continue;
        if (!best || (north ? z < best[2] : z > best[2])) best = [r.pts[i], r.pts[i + 1], z];
      }
    }
    if (best) start = { x: best[0], z: best[2], heading: north ? 0 : Math.PI };
  } else if (main) {
    const dx = main.pts[3] - main.pts[0], dz = main.pts[5] - main.pts[2];
    const len = Math.hypot(dx, dz) || 1;
    start = { x: main.pts[0] - (dx / len) * 14, z: main.pts[2] - (dz / len) * 14 + 4, heading: Math.atan2(dx, dz) };
  }

  // Points along open water and along the freeway, for judging how near each is.
  const waterPts: number[] = [];
  for (const w of pack.water) for (let i = 0; i < w.pts.length; i += 3) waterPts.push(w.pts[i], w.pts[i + 2]);
  for (const a of pack.areas) if (a.kind === 'lake') for (let i = 0; i < a.ring.length; i += 8) waterPts.push(a.ring[i], a.ring[i + 1]);
  const freewayPts: number[] = [];
  for (const r of pack.roads) {
    if (r.kind === 'motorway') for (let i = 0; i < r.pts.length; i += 3) freewayPts.push(r.pts[i], r.pts[i + 2]);
  }

  // Pencil ghosts of what used to stand at two of the sketch spots.
  const ghosts: Ghost[] = [];
  const has = (id: string) => pack.spots?.some((s) => s.id === id);
  if (main && has('bridge')) ghosts.push(bridgeGhost('bridge', main.pts, terrainY));
  const annex = pack.buildings.find((b) => b.hero === 'mill-annex');
  if (annex && has('mill')) ghosts.push(millGhost('mill', annex.ring, annex.base));
  for (const g of ghosts) group.add(g.group);

  // The steam train, running out and back along its line. Its station is beside the carousel.
  const depot = pack.buildings.find((b) => b.hero === 'carousel');
  const train = pack.train && pack.train.length >= 6 ? makeTrain(pack.train, depot ? { x: depot.cx, z: depot.cz } : null, deckY) : null;
  if (train) group.add(train.group);

  // Moving parts that landmarks brought with them, such as the carousel.
  const moving = kit.moving ?? [];
  for (const m of moving) group.add(m.object);
  const rides: Ride[] = [...(kit.rides ?? []), ...(train ? [train.ride] : [])];
  let clock = 0;
  let router: Router | null = null;

  return {
    group,
    title: pack.title,
    // The wander begins under the plaza's cedar.
    home: pack.props?.cedar ? { x: pack.props.cedar[0] + 2.4, z: pack.props.cedar[2] + 2.6, heading: 0.8 } : undefined,
    exits: (pack.exits ?? []).map((e) => ({ ...e, edge: e.side === 'north' ? B.z0 + 3 : B.z1 - 3 })),
    start,
    maxSpan: Math.max(420, (B.z1 - B.z0) * 0.6),
    resolve(pos, radius) {
      sense(pos);
      const ix = Math.floor(pos.x / GRID), iz = Math.floor(pos.z / GRID);
      for (let pass = 0; pass < 2; pass++) {
        for (let cx = ix - 1; cx <= ix + 1; cx++) {
          for (let cz = iz - 1; cz <= iz + 1; cz++) {
            for (const w of cells.get(key(cx, cz)) ?? []) {
              // A bridge railing only stops someone who is on that bridge. Other height-limited
              // walls, such as parked cars, stop anyone at their level.
              if (w.bridge !== undefined) {
                if (!(level?.onDeck && level.bridge === w.bridge)) continue;
              } else if (!Number.isNaN(w.y) && Math.abs(pos.y - w.y) > 1.2) continue;
              const dx = w.bx - w.ax, dz = w.bz - w.az;
              const len2 = dx * dx + dz * dz;
              const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pos.x - w.ax) * dx + (pos.z - w.az) * dz) / len2));
              const px = w.ax + dx * t, pz = w.az + dz * t;
              const ox = pos.x - px, oz = pos.z - pz;
              const d = Math.hypot(ox, oz);
              if (d >= radius || d < 1e-5) continue;
              pos.x = px + (ox / d) * radius;
              pos.z = pz + (oz / d) * radius;
            }
          }
        }
      }
      for (const c of posts) {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const min = c.r + radius;
        if (Math.abs(dx) >= min || Math.abs(dz) >= min || Math.abs(pos.y - c.y) > 2) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-5) continue;
        pos.x = c.x + (dx / d) * min;
        pos.z = c.z + (dz / d) * min;
      }
      pos.x = THREE.MathUtils.clamp(pos.x, B.x0 + 3, B.x1 - 3);
      pos.z = THREE.MathUtils.clamp(pos.z, B.z0 + 3, B.z1 - 3);
    },
    heightAt(x, z, currentY) {
      const groundY = terrainY(x, z);
      const d = deckAt(x, z);
      if (!d) return groundY;
      // For the cat itself, use what was decided as it stepped into the bridge's outline.
      if (level && level.bridge === d.bridge && Math.abs(sensedAt.x - x) < 1.5 && Math.abs(sensedAt.y - z) < 1.5) return level.onDeck ? Math.max(d.y, groundY) : groundY;
      // Otherwise: on a bridge you stay on the deck; underneath it you stay on the ground.
      return d.y <= currentY + 0.8 ? Math.max(d.y, groundY) : groundY;
    },
    update(dt, cat, catSpeed) {
      people.update(dt, cat, catSpeed);
      train?.update(dt);
      clock += dt;
      for (const m of moving) m.update(dt, clock);
    },
    rides,
    // At street level only people nearby are drawn; pulled back, people are too small to see at all.
    setView: (span) => people.setDrawRadius(span > 260 ? 0 : THREE.MathUtils.clamp(span * 1.6, 70, 150)),
    route(fromX, fromZ, toX, toZ) {
      // The network is only worked out the first time a route is asked for.
      router ??= makeRouter(pack.roads);
      return router(fromX, fromZ, toX, toZ);
    },
    spots: pack.spots ?? [],
    charm: (pos) => people.call(pos.x, pos.z, 11),
    ambience(pos) {
      const nearest = (pts: number[]) => {
        let best = Infinity;
        for (let i = 0; i < pts.length; i += 2) best = Math.min(best, Math.abs(pts[i] - pos.x) + Math.abs(pts[i + 1] - pos.z));
        return best;
      };
      const town = Math.min(1, people.countNear(pos.x, pos.z, 35) / 14);
      return {
        water: 1 - THREE.MathUtils.smoothstep(nearest(waterPts), 6, 60),
        traffic: 1 - THREE.MathUtils.smoothstep(nearest(freewayPts), 12, 130),
        town,
        green: Math.max(0.12, 1 - town * 1.6),
        train: train ? 1 - THREE.MathUtils.smoothstep(Math.hypot(train.at.x - pos.x, train.at.z - pos.z), 12, 130) : 0,
        carousel: moving.reduce((a, m) => (m.sound === 'carousel' ? Math.max(a, 1 - THREE.MathUtils.smoothstep(Math.hypot(m.x - pos.x, m.z - pos.z), 8, 90)) : a), 0),
      };
    },
    placeName(x, z) {
      // The nearest named street or trail.
      let best = pack.title, bestD = 60;
      for (const r of pack.roads) {
        if (!r.name) continue;
        for (let i = 0; i < r.pts.length; i += 3) {
          const d = Math.hypot(r.pts[i] - x, r.pts[i + 2] - z);
          if (d < bestD) [best, bestD] = [r.name, d];
        }
      }
      return best;
    },
    ghosts,
    covered(pos) {
      if (level && !level.onDeck) return true;
      // The camera looks down at an angle, so a deck hides the cat from a little way off to one side.
      for (const b of bridges) {
        for (let i = 0; i < b.pts.length - 3; i += 3) {
          if (b.pts[i + 1] < pos.y + 1.5) continue;
          const ax = b.pts[i], az = b.pts[i + 2], dx = b.pts[i + 3] - ax, dz = b.pts[i + 5] - az;
          const len2 = dx * dx + dz * dz;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pos.x - ax) * dx + (pos.z - az) * dz) / len2));
          if (Math.hypot(pos.x - (ax + dx * t), pos.z - (az + dz * t)) < b.half + (b.pts[i + 1] - pos.y) * 1.6) return true;
        }
      }
      return false;
    },
  };
}

/**
 * A small steam engine and three open cars. The train runs its line out and back, pausing at each
 * end and at the station so there is time to climb aboard.
 */
function makeTrain(line: number[], station: { x: number; z: number } | null, deckAt: (x: number, z: number) => number | null): { group: THREE.Group; at: THREE.Vector3; update(dt: number): void; ride: Ride } {
  const cum = [0];
  for (let i = 3; i < line.length; i += 3) cum.push(cum[cum.length - 1] + Math.hypot(line[i] - line[i - 3], line[i + 2] - line[i - 1]));
  const total = cum[cum.length - 1];
  const group = new THREE.Group();
  const material = gouache({ vertexColors: true, local: true });
  const vehicle = (draw: (b: Batch) => void) => {
    const b = new Batch();
    draw(b);
    const mesh = b.build(material)!;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  // The headlamp: a pale disc on the front of the boiler.
  const k_glow = (b: Batch, x: number, y: number) => b.cyl(P.lampGlow, x, y, 0, 0.13, 0.13, 0.06, 10, { rz: Math.PI / 2 });
  const wheels = (b: Batch, xs: number[]) => {
    for (const x of xs) for (const z of [-0.42, 0.42]) b.cyl(P.ink, x, 0.24, z, 0.24, 0.24, 0.1, 10, { rx: Math.PI / 2 });
  };
  // After a photograph of the real train: a black engine with a silver smokebox front and a brass
  // bell, and open cars in bright green with a yellow rail, carrying passengers.
  const GREEN = 0x3fa05a, RAIL = 0xf2c14e, BLACK = 0x26262b;
  const SHIRTS = [P.navy, P.warmWhite, P.oxblood, P.butter, P.slateBlue, P.persimmon];
  const SKINS = [0xf0cdb0, 0xdca883, 0xb9825e, 0x8a5a3e];
  // Vehicles are built facing +x.
  const cars = [
    vehicle((b) => {
      b.box(BLACK, 0, 0.42, 0, 3.0, 0.2, 0.9);
      b.cyl(BLACK, 0.35, 0.95, 0, 0.42, 0.42, 1.9, 12, { rz: Math.PI / 2 });
      b.cyl(0xc9ccd2, 1.32, 0.95, 0, 0.44, 0.44, 0.08, 12, { rz: Math.PI / 2 });
      k_glow(b, 1.38, 1.5);
      b.cyl(BLACK, 0.95, 1.7, 0, 0.16, 0.12, 0.7, 8);
      b.cyl(BLACK, 0.95, 2.08, 0, 0.22, 0.16, 0.12, 8);
      b.ball(P.brass, 0.3, 1.5, 0, 0.15, 0.19, 0.15);
      b.ball(BLACK, -0.15, 1.42, 0, 0.17, 0.2, 0.17);
      b.box(BLACK, -1.0, 1.1, 0, 0.95, 1.2, 1.0);
      b.box(BLACK, -1.0, 1.75, 0, 1.2, 0.1, 1.15);
      b.box(P.glass, -1.0, 1.3, 0.51, 0.5, 0.4, 0.02);
      b.box(P.glass, -1.0, 1.3, -0.51, 0.5, 0.4, 0.02);
      b.wedge(0xc9ccd2, 1.55, 0.3, 0, 0.9, 0.35, 0.45, Math.PI / 2);
      b.box(P.oxblood, 1.3, 0.75, 0.5, 0.25, 0.16, 0.02);
      wheels(b, [-0.9, 0, 0.9]);
    }),
    ...[0, 1, 2].map((n) =>
      vehicle((b) => {
        b.box(BLACK, 0, 0.42, 0, 2.6, 0.16, 0.9);
        b.box(GREEN, 0, 0.72, 0.5, 2.6, 0.5, 0.06);
        b.box(GREEN, 0, 0.72, -0.5, 2.6, 0.5, 0.06);
        for (const x of [-1.27, 1.27]) b.box(GREEN, x, 0.72, 0, 0.06, 0.5, 1.0);
        b.box(RAIL, 0, 0.99, 0.5, 2.64, 0.05, 0.08);
        b.box(RAIL, 0, 0.99, -0.5, 2.64, 0.05, 0.08);
        b.cyl(RAIL, 0, 0.72, 0.535, 0.14, 0.14, 0.02, 10, { rx: Math.PI / 2 });
        b.cyl(RAIL, 0, 0.72, -0.535, 0.14, 0.14, 0.02, 10, { rx: Math.PI / 2 });
        for (const x of [-0.7, 0.1, 0.9]) b.box(P.trunk, x, 0.72, 0, 0.12, 0.4, 0.9);
        // Passengers, leaving the front seat of the first car free for a cat.
        for (let seat = n === 0 ? 1 : 0; seat < 3; seat++) {
          for (const z of [-0.2, 0.22]) {
            const pick = n * 7 + seat * 3 + (z > 0 ? 1 : 0);
            if (pick % 5 === 4) continue;
            const x = 0.75 - seat * 0.8;
            b.cyl(SHIRTS[pick % 6], x, 1.12, z, 0.13, 0.17, 0.5, 7);
            b.ball(SKINS[pick % 4], x, 1.48, z, 0.11, 0.12, 0.11);
            b.ball([P.ink, 0x5b4336, 0xd9b96e, 0xb9b3b0][pick % 4], x - 0.02, 1.53, z, 0.115, 0.1, 0.12);
          }
        }
        wheels(b, [-0.85, 0.85]);
      }),
    ),
  ];
  const GAP = 3.1;
  const SPEED = 3.8;
  const WAIT = 12;

  // Where the train stops: both ends of the line, and the point on it nearest the station.
  const stops = [GAP * 3 + 1, total - 1];
  if (station) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < line.length; i += 3) {
      const d = Math.hypot(line[i] - station.x, line[i + 2] - station.z);
      if (d < bestD) [best, bestD] = [cum[i / 3], d];
    }
    if (best > stops[0] + 30 && best < stops[1] - 30) stops.splice(1, 0, best);
  }

  const at = new THREE.Vector3(line[0], line[1], line[2]);
  // Start waiting at the station if there is one, so the first thing a visitor finds is a train to board.
  let head = stops.length === 3 ? stops[1] : stops[0];
  let forward = true;
  let waiting = WAIT;

  const place = (mesh: THREE.Mesh, d: number) => {
    const along = Math.max(0, Math.min(total, d));
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < along) i++;
    const a = i * 3;
    const span = cum[i + 1] - cum[i] || 1;
    const t = (along - cum[i]) / span;
    const x = line[a] + (line[a + 3] - line[a]) * t, z = line[a + 2] + (line[a + 5] - line[a + 2]) * t;
    // On a trestle the train rides the deck, not the ground beneath it.
    const y = Math.max(line[a + 1] + (line[a + 4] - line[a + 1]) * t, deckAt(x, z) ?? -Infinity);
    mesh.position.set(x, y + 0.16, z);
    // The engine leads, so the whole train turns round at each end of the line.
    const dx = (line[a + 3] - line[a]) * (forward ? 1 : -1), dz = (line[a + 5] - line[a + 2]) * (forward ? 1 : -1);
    mesh.rotation.y = Math.atan2(-dz, dx);
  };
  const update = (dt: number) => {
    if (waiting > 0) {
      waiting -= dt;
    } else {
      const next = forward ? stops.find((s) => s > head + 0.01) : [...stops].reverse().find((s) => s < head - 0.01);
      if (next === undefined) {
        forward = !forward;
      } else {
        // Ease in to each stop.
        const left = Math.abs(next - head);
        head += (forward ? 1 : -1) * Math.min(left, SPEED * Math.min(1, 0.12 + left / 9) * dt);
        if (Math.abs(next - head) < 0.02) {
          head = next;
          waiting = WAIT;
          if (next === stops[0] || next === stops[stops.length - 1]) forward = !forward;
        }
      }
    }
    cars.forEach((mesh, i) => place(mesh, head - (forward ? 1 : -1) * i * GAP));
    at.copy(cars[0].position);
  };
  update(0);

  // The cat rides in the first open car, behind the engine.
  const car = cars[1];
  const ride: Ride = {
    label: 'Hop on the train',
    near: (pos) => cars.some((c) => Math.hypot(c.position.x - pos.x, c.position.z - pos.z) < 4.5 && Math.abs(c.position.y - pos.y) < 3),
    seat(out) {
      // The front seat of the first car, which is kept free.
      out.set(car.position.x + Math.cos(car.rotation.y) * 0.75, car.position.y + 0.42, car.position.z - Math.sin(car.rotation.y) * 0.75);
      return car.rotation.y + Math.PI / 2;
    },
    exit(out) {
      // Step down beside the car.
      out.set(car.position.x + Math.sin(car.rotation.y) * 2.2, car.position.y, car.position.z + Math.cos(car.rotation.y) * 2.2);
    },
  };
  return { group, at, update, ride };
}
