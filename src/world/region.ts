import * as THREE from 'three';
import { gouache, gouacheUniforms } from '../style/gouache';
import { P } from '../style/palette';
import { GROUND_FLOOR, RECESS, UPPER_FLOOR, storefronts, type Kit } from './buildings';
import type { Spot } from './corner';
import { HEROES, fitRectangle } from './heroes';
import { People } from './people';
import { Batch, signOptions } from './kit';
import { shopAt } from './shops';
import type { World } from './world';

/** A region pack, as written by pipeline/build.mjs. Coordinates are game metres: x east, z south, y up. */
interface Pack {
  id: string;
  title: string;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  terrain: { x0: number; z0: number; cell: number; cols: number; rows: number; heights: number[] };
  roads: Road[];
  water: { width: number; pts: number[] }[];
  buildings: { id: number; name?: string; kind: string; levels: number; base: number; ring: number[]; fronts: number[]; hero?: string }[];
  areas: { kind: string; y: number; ring: number[] }[];
  trees: number[];
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
const PITCHED_ROOFS = [P.terracotta, 0xb8664a, 0xa8785a, 0x9a8f96];
const FLAT_ROOFS = [P.roof, 0xd3c8bb, 0xcfc6c0, 0xe0d6c8];
const WALKABLE = new Set(['cycleway', 'footway', 'path', 'pedestrian']);
const AREA_COLOR: Record<string, number> = { park: P.lawn, grass: P.lawn, wood: P.lawnDeep, parking: P.lot, plaza: P.plaza, pool: P.water };

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
}

export async function loadRegion(id: string): Promise<World> {
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
    const town = new THREE.Color(P.ground), bank = new THREE.Color(P.bank), bed = new THREE.Color(P.creekBed), c = new THREE.Color();
    for (let j = 0; j < T.rows; j++) {
      for (let i = 0; i < T.cols; i++) {
        const k = j * T.cols + i;
        const x = T.x0 + i * T.cell, z = T.z0 + j * T.cell, y = T.heights[k] / 10;
        pos.set([x, y, z], k * 3);
        // Town level is pale; the cut banks are green; the creek bed is gravel.
        c.copy(town).lerp(bank, THREE.MathUtils.smoothstep(-y, 0.4, 1.6)).lerp(bed, THREE.MathUtils.smoothstep(-y, 7.2, 7.9));
        if (y > -0.6) {
          const hit = boxed.find((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && inRing(x, z, b.a.ring));
          if (hit) c.set(AREA_COLOR[hit.a.kind]);
        }
        col.set([c.r, c.g, c.b], k * 3);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < T.rows - 1; j++) {
      for (let i = 0; i < T.cols - 1; i++) {
        const k = j * T.cols + i;
        index.push(k, k + T.cols, k + 1, k + 1, k + T.cols, k + T.cols + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, gouache({ vertexColors: true }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }

  // ---- Flat ground cover with crisp edges, where the ground really is flat. ----
  for (const a of pack.areas) {
    const contour: THREE.Vector2[] = [];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < a.ring.length; i += 2) {
      contour.push(new THREE.Vector2(a.ring[i], a.ring[i + 1]));
      const y = terrainY(a.ring[i], a.ring[i + 1]);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (hi - lo > 0.35) continue;
    const out = new Tris();
    const y = hi + (a.kind === 'pool' ? 0.05 : 0.025);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      out.tri(contour[i].x, y, contour[i].y, contour[j].x, y, contour[j].y, contour[k].x, y, contour[k].y);
    }
    if (!out.empty) paint.add(out.geometry(), AREA_COLOR[a.kind], 0, 0, 0);
  }

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
  function bridge(r: Road, width: number): void {
    bridges.push({ pts: r.pts, half: width / 2 });
    const { L, R } = edges(r.pts, width);
    const street = STREETS.has(r.kind);
    const rail = street ? 1.0 : 1.1;
    const depth = street ? 1.3 : 0.4;
    for (const side of [L, R]) {
      for (let i = 0; i < side.length - 3; i += 3) {
        const dx = side[i + 3] - side[i], dz = side[i + 5] - side[i + 2];
        const len = Math.hypot(dx, dz);
        const y = (side[i + 1] + side[i + 4]) / 2;
        over.box(street ? P.stone : P.trunk, (side[i] + side[i + 3]) / 2, y + (rail - depth) / 2, (side[i + 2] + side[i + 5]) / 2, len + 0.05, rail + depth, street ? 0.4 : 0.16, Math.atan2(-dz, dx));
        walls.push({ ax: side[i], az: side[i + 2], bx: side[i + 3], bz: side[i + 5], y });
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

  const LAYER_COLOR: Record<string, number> = { sidewalk: P.sidewalk, asphalt: P.asphalt, freeway: P.freeway, lot: P.lot, paint: P.roadPaint, stone: P.stone, curb: P.curb, trail: P.trail, earth: P.earth, plaza: P.plaza, water: P.water };
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
      HEROES[b.hero](kit, b.ring, b.base);
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
  }

  for (const [batch, material] of [
    [paint, gouache({ vertexColors: true })],
    [over, gouache({ vertexColors: true, hole: true })],
  ] as const) {
    const mesh = batch.build(material);
    if (!mesh) continue;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const glow = kit.glow.build(gouache({ vertexColors: true, unlit: true }));
  if (glow) group.add(glow);
  const glint = kit.glint.build(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }));
  if (glint) {
    glint.renderOrder = 1;
    group.add(glint);
  }
  group.add(kit.signs);

  // People on the real sidewalks and the trail, drawn only near the cat.
  const people = new People({ seats: [], standers, walkways, walkers: 260, drawRadius: 140 });
  group.add(people.group);

  // The painting fades to paper just past the region's edge.
  const B = pack.bounds;
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
  const deckY = (x: number, z: number): number | null => {
    for (const b of bridges) {
      for (let i = 0; i < b.pts.length - 3; i += 3) {
        const ax = b.pts[i], az = b.pts[i + 2], dx = b.pts[i + 3] - ax, dz = b.pts[i + 5] - az;
        const len2 = dx * dx + dz * dz;
        const t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
        if (t < 0 || t > 1) continue;
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) <= b.half) return b.pts[i + 1] + (b.pts[i + 4] - b.pts[i + 1]) * t;
      }
    }
    return null;
  };

  // Start on Main Street, a few steps before the bridge over the freeway.
  const main = pack.roads.find((r) => r.bridge && r.name?.includes('Main Street'));
  let start = { x: 0, z: 0, heading: 0 };
  if (main) {
    const dx = main.pts[3] - main.pts[0], dz = main.pts[5] - main.pts[2];
    const len = Math.hypot(dx, dz) || 1;
    start = { x: main.pts[0] - (dx / len) * 14, z: main.pts[2] - (dz / len) * 14 + 4, heading: Math.atan2(dx, dz) };
  }

  return {
    group,
    start,
    maxSpan: 420,
    resolve(pos, radius) {
      const ix = Math.floor(pos.x / GRID), iz = Math.floor(pos.z / GRID);
      for (let pass = 0; pass < 2; pass++) {
        for (let cx = ix - 1; cx <= ix + 1; cx++) {
          for (let cz = iz - 1; cz <= iz + 1; cz++) {
            for (const w of cells.get(key(cx, cz)) ?? []) {
              if (!Number.isNaN(w.y) && Math.abs(pos.y - w.y) > 1.2) continue;
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
      pos.x = THREE.MathUtils.clamp(pos.x, B.x0 + 3, B.x1 - 3);
      pos.z = THREE.MathUtils.clamp(pos.z, B.z0 + 3, B.z1 - 3);
    },
    heightAt(x, z, currentY) {
      const groundY = terrainY(x, z);
      const deck = deckY(x, z);
      // On a bridge you stay on the deck; underneath it you stay on the ground.
      if (deck !== null && deck <= currentY + 0.8) return Math.max(deck, groundY);
      return groundY;
    },
    update: (dt, cat, catSpeed) => people.update(dt, cat, catSpeed),
    covered(pos) {
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
