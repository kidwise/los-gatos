// Turns a raw OpenStreetMap snapshot into a region pack the game can load.
// Usage: node pipeline/build.mjs <region>
//
// The pack is in game metres: x east, z south, y up, with the region's centre at the origin.
// OpenStreetMap has no ground heights, so the terrain here is inferred: the freeway and the creek
// are carved below town level, streets are kept level, and trails get a flat bench to run on.
// Real elevation data can replace the inferred terrain later without changing the pack format.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { REGIONS } from './regions.mjs';

const id = process.argv[2];
const region = REGIONS[id];
if (!region) {
  console.error(`Unknown region "${id}". Known: ${Object.keys(REGIONS).join(', ')}`);
  process.exit(1);
}
const raw = JSON.parse(readFileSync(`data/raw/${id}.osm.json`, 'utf8'));

// ---------- Projection ----------
const [S, W, N, E] = region.bbox;
const lat0 = (S + N) / 2;
const lon0 = (W + E) / 2;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((lat0 * Math.PI) / 180);
const project = (lat, lon) => [(lon - lon0) * M_PER_DEG_LON * region.scale, -(lat - lat0) * M_PER_DEG_LAT * region.scale];
const [bx0, bz1] = project(S, W);
const [bx1, bz0] = project(N, E);
const bounds = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 };
const MARGIN = 45;
const inBounds = (x, z, m = MARGIN) => x >= bounds.x0 - m && x <= bounds.x1 + m && z >= bounds.z0 - m && z <= bounds.z1 + m;

const nodes = new Map();
for (const el of raw.elements) if (el.type === 'node') nodes.set(el.id, project(el.lat, el.lon));
const ways = raw.elements.filter((el) => el.type === 'way' && el.tags && el.nodes.length > 1);
const pointsOf = (way) => way.nodes.map((n) => nodes.get(n)).filter(Boolean);
const closed = (way) => way.nodes.length > 3 && way.nodes[0] === way.nodes[way.nodes.length - 1];
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- Geometry helpers ----------
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

/** Nearest distance from a point to a polyline, and how far along the line that nearest point is (0..1). */
function distToLine(px, pz, pts, cum, total) {
  let best = Infinity, along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const { d, t } = distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) {
      best = d;
      along = total > 0 ? (cum[i] + t * (cum[i + 1] - cum[i])) / total : 0;
    }
  }
  return { d: best, along };
}

function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { cum, total: cum[cum.length - 1] };
}

/** Adds points so no two are more than `step` apart, so a line can follow the ground. */
function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Splits a line into the pieces that lie inside the region (plus margin). */
function clip(pts) {
  const pieces = [];
  let cur = [];
  for (const p of pts) {
    if (inBounds(p[0], p[1])) cur.push(p);
    else {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- Classify roads and paths ----------
const STREET = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
const TRAIL = new Set(['cycleway', 'path', 'footway', 'steps', 'track', 'pedestrian']);
const BASE_WIDTH = { motorway: 11, motorway_link: 6.5, primary: 12, secondary: 11, tertiary: 10, residential: 8.5, unclassified: 8, living_street: 7, service: 4.6, pedestrian: 5, cycleway: 3.2, path: 2, footway: 2.2, steps: 2.2, track: 3 };

const lines = [];
for (const way of ways) {
  const hw = way.tags.highway;
  if (!hw || !(hw in BASE_WIDTH)) continue;
  if (closed(way) && way.tags.area === 'yes') continue; // plazas are handled as areas
  const t = way.tags;
  let kind = hw;
  if (hw === 'footway' && t.footway === 'sidewalk') kind = 'sidewalk';
  if (hw === 'footway' && t.footway === 'crossing') kind = 'crossing';
  if (t.tunnel === 'building_passage') continue;
  let width = BASE_WIDTH[hw];
  if (STREET.has(hw) && t.lanes) width = Math.max(width, Number(t.lanes) * 3.3 + 2.4);
  if (hw === 'motorway' && t.lanes) width = Number(t.lanes) * 3.7 + 3.5;
  for (const piece of clip(pointsOf(way))) {
    lines.push({
      kind,
      name: t.name,
      width: width * region.scale,
      bridge: !!t.bridge && t.bridge !== 'no',
      layer: Number(t.layer ?? 0),
      sidewalks: STREET.has(hw) && t.sidewalk !== 'no' && t.sidewalk !== 'none',
      firstNode: way.nodes[0],
      lastNode: way.nodes[way.nodes.length - 1],
      pts: piece,
    });
  }
}

const streams = [];
for (const way of ways) {
  if (!way.tags.waterway) continue;
  for (const piece of clip(pointsOf(way))) streams.push({ name: way.tags.name, tunnel: !!way.tags.tunnel, pts: piece });
}

// ---------- Terrain ----------
const CELL = 3;
const tx0 = bounds.x0 - MARGIN, tz0 = bounds.z0 - MARGIN;
const cols = Math.ceil((bounds.x1 - bounds.x0 + MARGIN * 2) / CELL) + 1;
const rows = Math.ceil((bounds.z1 - bounds.z0 + MARGIN * 2) / CELL) + 1;
let height = new Float32Array(cols * rows);

function sample(h, x, z) {
  const gx = Math.max(0, Math.min(cols - 1.001, (x - tx0) / CELL));
  const gz = Math.max(0, Math.min(rows - 1.001, (z - tz0) / CELL));
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const a = h[iz * cols + ix], b = h[iz * cols + ix + 1], c = h[(iz + 1) * cols + ix], d = h[(iz + 1) * cols + ix + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Runs fn over every grid point within `reach` of a line. */
function nearLine(pts, reach, fn) {
  const { cum, total } = measure(pts);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const i0 = Math.max(0, Math.floor((minX - reach - tx0) / CELL)), i1 = Math.min(cols - 1, Math.ceil((maxX + reach - tx0) / CELL));
  const j0 = Math.max(0, Math.floor((minZ - reach - tz0) / CELL)), j1 = Math.min(rows - 1, Math.ceil((maxZ + reach - tz0) / CELL));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const { d, along } = distToLine(tx0 + i * CELL, tz0 + j * CELL, pts, cum, total);
      if (d <= reach) fn(j * cols + i, d, along);
    }
  }
}

const FREEWAY_DEPTH = 6.5 * region.scale;
const CREEK_DEPTH = 8 * region.scale;

// 1. The freeway runs in a cutting below the town.
const motorwayNodes = new Set(lines.filter((l) => l.kind === 'motorway').flatMap((l) => [l.firstNode, l.lastNode]));
for (const l of lines) {
  if (l.kind === 'motorway') {
    nearLine(l.pts, l.width / 2 + 13, (k, d) => {
      height[k] = Math.min(height[k], -FREEWAY_DEPTH * (1 - smoothstep(l.width / 2 + 2, l.width / 2 + 13, d)));
    });
  } else if (l.kind === 'motorway_link') {
    // Ramps climb from freeway level at one end to street level at the other.
    const downAtStart = motorwayNodes.has(l.firstNode);
    const downAtEnd = motorwayNodes.has(l.lastNode);
    nearLine(l.pts, l.width / 2 + 9, (k, d, along) => {
      const sunk = downAtStart && downAtEnd ? 1 : downAtStart ? 1 - along : downAtEnd ? along : 0.5;
      height[k] = Math.min(height[k], -FREEWAY_DEPTH * sunk * (1 - smoothstep(l.width / 2 + 1, l.width / 2 + 9, d)));
    });
  }
}
// 2. The creek has its own, deeper channel wherever it is open to the sky.
for (const s of streams) {
  if (s.tunnel) continue;
  nearLine(s.pts, 14, (k, d) => {
    height[k] = Math.min(height[k], -CREEK_DEPTH * (1 - smoothstep(2.5, 14, d)));
  });
}
// 3. Streets stay at town level, on fill where they pass close to the cutting.
for (const l of lines) {
  if (!(STREET.has(l.kind) || l.kind === 'service') || l.bridge) continue;
  nearLine(l.pts, l.width / 2 + 8, (k, d) => {
    height[k] *= smoothstep(l.width / 2 + 1.5, l.width / 2 + 8, d);
  });
}
// 4. Trails get a level bench cut into the slope they follow.
{
  const before = height.slice();
  for (const l of lines) {
    if (!TRAIL.has(l.kind) || l.bridge) continue;
    const pts = resample(l.pts, CELL);
    const ys = pts.map(([x, z]) => sample(before, x, z));
    const { cum, total } = measure(pts);
    nearLine(pts, l.width / 2 + 3.5, (k, d, along) => {
      // Height of the trail at the nearest point along it.
      const target = along * total;
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < target) i++;
      const f = cum[i + 1] > cum[i] ? (target - cum[i]) / (cum[i + 1] - cum[i]) : 0;
      const y = ys[i] + (ys[i + 1] - ys[i]) * Math.max(0, Math.min(1, f));
      const w = 1 - smoothstep(l.width / 2 + 0.5, l.width / 2 + 3.5, d);
      height[k] = height[k] * (1 - w) + y * w;
    });
  }
}
// 5. Buildings on a slope get a level pad to stand on, so no wall is half buried.
for (const way of ways) {
  if (!way.tags.building || !closed(way)) continue;
  const ring = pointsOf(way).slice(0, -1);
  if (ring.length < 3 || !ring.some(([x, z]) => inBounds(x, z, 10))) continue;
  const ys = ring.map(([x, z]) => sample(height, x, z));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 0.25) continue;
  const pad = (lo + hi) / 2;
  const flat = ring.flat();
  const inside = (x, z) => {
    let hit = false;
    for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
      if (flat[i + 1] > z !== flat[j + 1] > z && x < ((flat[j] - flat[i]) * (z - flat[i + 1])) / (flat[j + 1] - flat[i + 1]) + flat[i]) hit = !hit;
    }
    return hit;
  };
  nearLine([...ring, ring[0]], 5, (k, d) => {
    const w = 1 - smoothstep(0.5, 5, d);
    height[k] = height[k] * (1 - w) + pad * w;
  });
  // The strip above only reaches the edges; fill the middle of large footprints too.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  for (let j = Math.max(0, Math.floor((minZ - tz0) / CELL)); j <= Math.min(rows - 1, Math.ceil((maxZ - tz0) / CELL)); j++) {
    for (let i = Math.max(0, Math.floor((minX - tx0) / CELL)); i <= Math.min(cols - 1, Math.ceil((maxX - tx0) / CELL)); i++) {
      if (inside(tx0 + i * CELL, tz0 + j * CELL)) height[j * cols + i] = pad;
    }
  }
}
// 6. Soften.
{
  const out = new Float32Array(height.length);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let sum = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const jj = j + dj, ii = i + di;
          if (jj < 0 || jj >= rows || ii < 0 || ii >= cols) continue;
          const wgt = di === 0 && dj === 0 ? 4 : 1;
          sum += height[jj * cols + ii] * wgt;
          n += wgt;
        }
      }
      out[j * cols + i] = sum / n;
    }
  }
  height = out;
}
const ground = (x, z) => sample(height, x, z);

// ---------- Roads, with a height at every point ----------
const roads = lines.map((l) => {
  const pts = resample(l.pts, 4);
  let ys = pts.map(([x, z]) => ground(x, z));
  if (l.bridge) {
    // A bridge deck runs straight between its two banks, ignoring whatever is underneath.
    const { cum, total } = measure(pts);
    const a = Math.max(ys[0], l.layer > 0 && STREET.has(l.kind) ? 0 : -Infinity);
    const b = Math.max(ys[ys.length - 1], l.layer > 0 && STREET.has(l.kind) ? 0 : -Infinity);
    ys = cum.map((c) => a + (b - a) * (total > 0 ? c / total : 0));
  }
  return {
    kind: l.kind,
    name: l.name,
    width: r2(l.width),
    bridge: l.bridge || undefined,
    sidewalks: l.sidewalks || undefined,
    pts: pts.flatMap(([x, z], i) => [r2(x), r2(ys[i]), r2(z)]),
  };
});

const water = streams
  .filter((s) => !s.tunnel)
  .map((s) => {
    const pts = resample(s.pts, 4);
    return { name: s.name, width: r2(4.2 * region.scale), pts: pts.flatMap(([x, z]) => [r2(x), r2(ground(x, z) + 0.35), r2(z)]) };
  });

// ---------- Buildings ----------
function hash(n) {
  let t = (n ^ 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function levelsOf(way) {
  const t = way.tags;
  if (t['building:levels']) return Math.max(1, Math.round(Number(t['building:levels'])));
  if (t.height) return Math.max(1, Math.round(parseFloat(t.height) / 3.6));
  const h = hash(way.id);
  if (['house', 'detached', 'residential', 'garage', 'shed', 'roof'].includes(t.building)) return h < 0.6 ? 1 : 2;
  if (['church', 'cathedral', 'school', 'civic', 'public'].includes(t.building)) return 2;
  return h < 0.45 ? 1 : h < 0.92 ? 2 : 3;
}

// Which walls face a street closely enough to carry a shopfront.
const NO_SHOPS = new Set(['house', 'detached', 'residential', 'apartments', 'terrace', 'garage', 'garages', 'shed', 'roof', 'outbuilding', 'church', 'temple', 'school', 'public', 'civic', 'industrial']);
const CIVIC_USE = new Set(['library', 'place_of_worship', 'cinema', 'townhall', 'post_office', 'theatre', 'museum', 'fire_station', 'police']);
const shopStreets = lines.filter((l) => STREET.has(l.kind) && !l.bridge);
function shopfronts(ring, tags) {
  if (NO_SHOPS.has(tags.building) || CIVIC_USE.has(tags.amenity) || tags.tourism === 'museum') return [];
  const fronts = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 4.5) continue;
    const ex = (bx - ax) / len, ez = (bz - az) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    // Footprints are wound so that outside is on the right of each edge.
    const nx = ez, nz = -ex;
    const faces = shopStreets.some((l) => {
      const reach = l.width / 2 + 2.6 + 7;
      for (let k = 0; k < l.pts.length - 1; k++) {
        const [px, pz] = l.pts[k], [qx, qz] = l.pts[k + 1];
        const { d, t } = distToSegment(mx, mz, px, pz, qx, qz);
        if (d > reach) continue;
        const sl = Math.hypot(qx - px, qz - pz) || 1;
        const parallel = Math.abs((ex * (qx - px) + ez * (qz - pz)) / sl) > 0.82;
        const toward = nx * (px + (qx - px) * t - mx) + nz * (pz + (qz - pz) * t - mz) > 0;
        if (parallel && toward) return true;
      }
      return false;
    });
    if (faces) fronts.push(i);
  }
  return fronts;
}

const buildings = [];
for (const way of ways) {
  if (!way.tags.building || !closed(way)) continue;
  let ring = pointsOf(way).slice(0, -1);
  if (ring.length < 3) continue;
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  if (!inBounds(cx, cz, 10)) continue;
  // Wind every footprint the same way so the game can tell inside from outside.
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    area += ax * bz - bx * az;
  }
  if (area < 0) ring = ring.reverse();
  if (Math.abs(area) / 2 < 6) continue;
  const base = Math.min(...ring.map(([x, z]) => ground(x, z)), ground(cx, cz));
  const t = way.tags;
  buildings.push({
    id: way.id,
    // Only public landmarks keep their names. Shops and restaurants are left out: the game invents its own.
    name: CIVIC_USE.has(t.amenity) || t.historic || t.tourism === 'museum' ? t.name : undefined,
    fronts: shopfronts(ring, t),
    cx: r2(cx),
    cz: r2(cz),
    kind: t.building === 'yes' ? (t.shop || t.amenity || t.office ? 'commercial' : 'yes') : t.building,
    use: t.amenity || t.shop || t.tourism || t.historic || undefined,
    levels: levelsOf(way),
    base: r2(base),
    ring: ring.flatMap(([x, z]) => [r2(x), r2(z)]),
  });
}

// Mark the hand-built landmarks, and work out which way each one's front faces.
for (const hero of region.heroes ?? []) {
  let best = null;
  if (hero.way) best = buildings.find((b) => b.id === hero.way) ?? null;
  else {
    const el = raw.elements.find((e) => e.tags?.name === hero.near);
    if (el?.type === 'way' && el.tags.building) best = buildings.find((b) => b.id === el.id) ?? null;
    else {
      const at = el && (el.type === 'node' ? nodes.get(el.id) : pointsOf(el)[0]);
      let bestD = 30;
      for (const b of buildings) {
        const d = at ? Math.hypot(b.cx - at[0], b.cz - at[1]) : Infinity;
        if (d < bestD) [best, bestD] = [b, d];
      }
    }
  }
  if (!best) {
    console.warn(`  hero "${hero.id}": no matching building`);
    continue;
  }
  // The front looks toward the nearest point of the named street, or of any street.
  let toward = null, towardD = Infinity;
  for (const l of lines) {
    if (!STREET.has(l.kind) || (hero.faces && l.name !== hero.faces)) continue;
    for (const p of resample(l.pts, 3)) {
      const d = Math.hypot(p[0] - best.cx, p[1] - best.cz);
      if (d < towardD) [toward, towardD] = [p, d];
    }
  }
  best.hero = hero.id;
  best.fronts = [];
  if (toward) best.face = r2(Math.atan2(toward[0] - best.cx, toward[1] - best.cz));
  console.log(`  hero "${hero.id}" -> building ${best.id}, ${best.ring.length / 2} corners, front ${Math.round(towardD)} m from ${hero.faces ?? 'the nearest street'}`);
}

// ---------- Ground cover ----------
const AREA_KINDS = [
  ['park', (t) => t.leisure === 'park' || t.leisure === 'garden'],
  ['grass', (t) => t.landuse === 'grass' || t.leisure === 'pitch'],
  ['wood', (t) => t.natural === 'wood' || t.landuse === 'forest'],
  ['parking', (t) => t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey'],
  ['plaza', (t) => t.highway === 'pedestrian' && t.area === 'yes'],
  ['pool', (t) => t.leisure === 'swimming_pool' || t.natural === 'water' || t.amenity === 'fountain'],
];
const areas = [];
for (const way of ways) {
  if (!closed(way) || way.tags.building) continue;
  const found = AREA_KINDS.find(([, test]) => test(way.tags));
  if (!found) continue;
  const ring = pointsOf(way).slice(0, -1);
  if (!ring.some(([x, z]) => inBounds(x, z, 0))) continue;
  const y = ring.reduce((a, [x, z]) => a + ground(x, z), 0) / ring.length;
  areas.push({ kind: found[0], name: way.tags.name, y: r2(y), ring: ring.flatMap(([x, z]) => [r2(x), r2(z)]) });
}

// ---------- Trees and landmarks ----------
// Flat list of x, y, z, size. Mapped street trees first, then trees scattered on the creek banks
// and in woodland, placed by a fixed random sequence so every build gives the same result.
const trees = [];
const pois = [];
{
  let seed = 20261115;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const inRing = (x, z, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      if (ring[i + 1] > z !== ring[j + 1] > z && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) inside = !inside;
    }
    return inside;
  };
  const woods = areas.filter((a) => a.kind === 'wood');
  const keepClear = lines.filter((l) => l.kind !== 'sidewalk' && l.kind !== 'crossing').map((l) => ({ ...l, ...measure(l.pts) }));
  const openWater = streams.filter((s) => !s.tunnel).map((s) => ({ ...s, ...measure(s.pts) }));
  let placed = 0;
  for (let n = 0; n < 9000 && placed < 420; n++) {
    const x = bounds.x0 + rnd() * (bounds.x1 - bounds.x0);
    const z = bounds.z0 + rnd() * (bounds.z1 - bounds.z0);
    const y = ground(x, z);
    const onBank = y < -1.2 && y > -CREEK_DEPTH + 0.8;
    if (!onBank && !woods.some((a) => inRing(x, z, a.ring))) continue;
    if (keepClear.some((l) => distToLine(x, z, l.pts, l.cum, l.total).d < l.width / 2 + 2.5)) continue;
    if (openWater.some((s) => distToLine(x, z, s.pts, s.cum, s.total).d < 3.5)) continue;
    if (buildings.some((b) => inRing(x, z, b.ring))) continue;
    trees.push(r2(x), r2(y), r2(z), r2(0.8 + rnd() * 0.6));
    placed++;
  }
}
const LANDMARK = (t) => t.historic || t.tourism === 'museum' || t.tourism === 'artwork' || ['library', 'cinema', 'townhall', 'fountain', 'post_office', 'theatre'].includes(t.amenity) || t.leisure === 'park';
for (const el of raw.elements) {
  if (!el.tags) continue;
  let p = null;
  if (el.type === 'node') p = nodes.get(el.id);
  else if (el.type === 'way') {
    const pts = pointsOf(el);
    if (pts.length) p = [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
  }
  if (!p || !inBounds(p[0], p[1], 0)) continue;
  if (el.type === 'node' && el.tags.natural === 'tree') trees.push(r2(p[0]), r2(ground(p[0], p[1])), r2(p[1]), 1);
  // Public landmarks only. Shops and restaurants are left out: the game invents its own.
  else if (el.tags.name && LANDMARK(el.tags)) {
    pois.push({ name: el.tags.name, kind: el.tags.historic ? 'historic' : el.tags.amenity || el.tags.tourism || el.tags.leisure, x: r2(p[0]), y: r2(ground(p[0], p[1])), z: r2(p[1]) });
  }
}

// ---------- Street furniture ----------
// Trees, lamps, planters, benches and parked cars along the sidewalks, and the plaza's cedar and
// fountain. Positions are worked out here, once, so the game only has to draw them.
const props = { lamps: [], planters: [], benches: [], cars: [], cedar: null, fountain: null };
{
  const DOWNTOWN = new Set(['primary', 'secondary', 'tertiary']);
  const roadways = lines
    .filter((l) => STREET.has(l.kind) || l.kind === 'service' || l.kind === 'motorway' || l.kind === 'motorway_link')
    .map((l) => ({ line: l, ...measure(l.pts) }));
  const inside = (x, z, ring) => {
    let hit = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      if (ring[i + 1] > z !== ring[j + 1] > z && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) hit = !hit;
    }
    return hit;
  };
  const nearBuilding = (x, z, margin) =>
    buildings.some((b) => {
      if (Math.hypot(b.cx - x, b.cz - z) > 90) return false;
      if (inside(x, z, b.ring)) return true;
      for (let i = 0; i < b.ring.length; i += 2) {
        const j = (i + 2) % b.ring.length;
        if (distToSegment(x, z, b.ring[i], b.ring[i + 1], b.ring[j], b.ring[j + 1]).d < margin) return true;
      }
      return false;
    });
  // Clear of buildings, and not standing in any other street or driveway.
  const clear = (x, z, own, margin, roadGap) =>
    inBounds(x, z, -4) && !nearBuilding(x, z, margin) && !roadways.some((o) => o.line !== own && distToLine(x, z, o.line.pts, o.cum, o.total).d < o.line.width / 2 + roadGap);
  const pointAt = (pts, cum, d) => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < d) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const t = (d - cum[i]) / seg;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, (pts[i + 1][0] - pts[i][0]) / seg, (pts[i + 1][1] - pts[i][1]) / seg];
  };

  let n = 0;
  for (const l of lines) {
    if (!STREET.has(l.kind) || !l.sidewalks || l.bridge) continue;
    const { cum, total } = measure(l.pts);
    const downtown = DOWNTOWN.has(l.kind);
    const step = downtown ? 7 : 9;
    let slot = 0;
    for (let d = step / 2; d < total; d += step, slot++) {
      const [px, pz, tx, tz] = pointAt(l.pts, cum, d);
      for (const side of [-1, 1]) {
        const j = slot + (side > 0 ? 1 : 0);
        const r = hash(n++ * 7919 + 13);
        // Just inside the curb, on the sidewalk.
        const x = px - tz * side * (l.width / 2 + 0.55), z = pz + tx * side * (l.width / 2 + 0.55);
        const facing = Math.atan2(tz * side, -tx * side); // turned to look at the street
        const along = Math.atan2(-tz, tx);
        let kind = null;
        if (downtown) kind = j % 8 === 0 || j % 8 === 4 ? 'tree' : j % 8 === 2 ? 'lamp' : j % 8 === 6 ? (r < 0.45 ? 'planter' : r < 0.7 ? 'bench' : null) : null;
        else kind = j % 2 === 0 && r < 0.7 ? 'tree' : null;
        // Nothing stands right in front of a landmark's entrance.
        const atLandmark = buildings.some((b) => b.hero && Math.hypot(b.cx - x, b.cz - z) < 26);
        if (kind && !atLandmark && clear(x, z, l, kind === 'bench' ? 1.3 : 0.9, 0.2)) {
          const y = r2(ground(x, z));
          if (kind === 'tree') trees.push(r2(x), y, r2(z), r2(1 + r * 0.25));
          else if (kind === 'lamp') props.lamps.push(r2(x), y, r2(z), r2(along));
          else if (kind === 'planter') props.planters.push(r2(x), y, r2(z));
          else props.benches.push(r2(x), y, r2(z), r2(facing));
        }
        // Parked cars at the kerb on the wider streets, away from the corners.
        if (downtown && l.width >= 10 && d > 13 && d < total - 13 && hash(n * 31 + 5) < 0.22) {
          const cx = px - tz * side * (l.width / 2 - 1.05), cz = pz + tx * side * (l.width / 2 - 1.05);
          if (clear(cx, cz, l, 0.5, 1.4)) props.cars.push(r2(cx), r2(ground(cx, cz)), r2(cz), r2(along), Math.floor(hash(n * 17 + 3) * 5));
        }
      }
    }
  }

  // The plaza's deodar cedar and its fountain. Their places within the park are approximate.
  const plaza = areas.find((a) => a.name === 'Town Plaza Park');
  if (plaza) {
    let cx = 0, cz = 0;
    for (let i = 0; i < plaza.ring.length; i += 2) {
      cx += plaza.ring[i] / (plaza.ring.length / 2);
      cz += plaza.ring[i + 1] / (plaza.ring.length / 2);
    }
    const spot = (dx, dz) => (inside(cx + dx, cz + dz, plaza.ring) ? [r2(cx + dx), r2(ground(cx + dx, cz + dz)), r2(cz + dz)] : null);
    props.cedar = spot(4.5, 3) ?? spot(0, 0);
    props.fountain = spot(-9, -5) ?? spot(-6, 4) ?? spot(7, -6);
  }
}

// ---------- Sketch spots, from the hand-authored overlay ----------
const spots = [];
const overlayPath = `data/overlays/${id}.json`;
if (existsSync(overlayPath)) {
  const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
  const longest = (list) => list.slice().sort((a, b) => measure(b.pts).total - measure(a.pts).total)[0];
  const alongLine = (pts, f) => {
    const { cum, total } = measure(pts);
    const target = total * f;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < target) i++;
    const t = cum[i + 1] > cum[i] ? (target - cum[i]) / (cum[i + 1] - cum[i]) : 0;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
  };
  for (const s of overlay.spots ?? []) {
    let at = null;
    if (s.way) {
      // In front of one particular building: its centre, which is then moved out to clear ground below.
      const b = buildings.find((x) => x.id === s.way);
      if (b) at = [b.cx + Math.sin(b.face ?? 0) * 30, b.cz + Math.cos(b.face ?? 0) * 30];
    } else if (s.near) {
      const el = raw.elements.find((e) => e.tags?.name === s.near);
      if (el?.type === 'node') at = nodes.get(el.id);
      else if (el?.type === 'way') {
        const pts = pointsOf(el);
        at = [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
        // Stand outside a building, not in the middle of it: step out to the nearest street or path.
        if (el.tags.building) {
          let best = null, bestD = Infinity;
          for (const l of lines) {
            if (l.kind === 'motorway' || l.kind === 'motorway_link' || l.kind === 'service') continue;
            for (const p of l.pts) {
              const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
              if (d < bestD) [best, bestD] = [p, d];
            }
          }
          if (best && bestD < 60) at = best;
        }
      }
    } else if (s.bridge) {
      const l = lines.find((r) => r.bridge && r.name === s.bridge);
      if (l) at = alongLine(l.pts, 0.5);
    } else if (s.trailBridge) {
      const l = longest(lines.filter((r) => r.bridge && r.kind === 'cycleway'));
      if (l) at = alongLine(l.pts, 0.5);
    } else if (s.creek !== undefined) {
      const l = longest(streams.filter((r) => !r.tunnel));
      if (l) {
        // Beside the water, on the nearest path, not in it.
        const mid = alongLine(l.pts, s.creek);
        let best = mid, bestD = Infinity;
        for (const t of lines.filter((r) => TRAIL.has(r.kind) && !r.bridge)) {
          for (const p of t.pts) {
            const d = Math.hypot(p[0] - mid[0], p[1] - mid[1]);
            if (d < bestD) [best, bestD] = [p, d];
          }
        }
        at = best;
      }
    } else if (s.trail !== undefined) {
      const l = longest(lines.filter((r) => r.kind === 'cycleway' && !r.bridge));
      if (l) at = alongLine(l.pts, s.trail);
    }
    if (!at || !inBounds(at[0], at[1], -8)) {
      console.warn(`  spot "${s.id}": could not be placed`);
      continue;
    }
    // A spot must be somewhere the cat can stand. If it landed in or against a building, move it
    // to the nearest point on a street or path that is clear of every building.
    const ringHit = (x, z, ring) => {
      let hit = false;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        if (ring[i + 1] > z !== ring[j + 1] > z && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) hit = !hit;
      }
      return hit;
    };
    const blocked = (x, z) =>
      buildings.some((b) => {
        if (Math.hypot(b.cx - x, b.cz - z) > 80) return false;
        if (ringHit(x, z, b.ring)) return true;
        for (let i = 0; i < b.ring.length; i += 2) {
          const j = (i + 2) % b.ring.length;
          if (distToSegment(x, z, b.ring[i], b.ring[i + 1], b.ring[j], b.ring[j + 1]).d < 2) return true;
        }
        return false;
      });
    if (blocked(at[0], at[1])) {
      let best = null, bestD = Infinity;
      for (const l of lines) {
        if (l.kind === 'motorway' || l.kind === 'motorway_link' || l.bridge) continue;
        for (const p of resample(l.pts, 2)) {
          const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
          if (d < bestD && !blocked(p[0], p[1])) [best, bestD] = [p, d];
        }
      }
      if (!best) {
        console.warn(`  spot "${s.id}": no clear ground nearby`);
        continue;
      }
      console.log(`  spot "${s.id}" was inside a building; moved ${bestD.toFixed(0)} m to clear ground`);
      at = best;
    }
    spots.push({ id: s.id, kind: s.kind, item: s.item, title: s.title, blurb: s.blurb, x: r2(at[0]), z: r2(at[1]) });
  }
}

// ---------- Write ----------
const pack = {
  id,
  title: region.title,
  scale: region.scale,
  snapshot: raw.fetched,
  attribution: raw.attribution,
  origin: { lat: lat0, lon: lon0 },
  bounds: { x0: r2(bounds.x0), x1: r2(bounds.x1), z0: r2(bounds.z0), z1: r2(bounds.z1) },
  // Heights in tenths of a metre, row by row from the north-west corner.
  terrain: { x0: r2(tx0), z0: r2(tz0), cell: CELL, cols, rows, heights: Array.from(height, (h) => Math.round(h * 10)) },
  roads,
  water,
  buildings,
  areas,
  trees,
  props,
  pois,
  spots,
};

mkdirSync('public/regions', { recursive: true });
writeFileSync(`public/regions/${id}.json`, JSON.stringify(pack));
const manifest = Object.fromEntries(Object.entries(REGIONS).map(([key, r]) => [key, { title: r.title, file: `${key}.json` }]));
writeFileSync('public/regions/manifest.json', JSON.stringify(manifest, null, 2));

const kb = Math.round(JSON.stringify(pack).length / 1024);
const tally = {};
for (const r of roads) tally[r.kind] = (tally[r.kind] ?? 0) + 1;
console.log(`${id}: ${Math.round(bounds.x1 - bounds.x0)} x ${Math.round(bounds.z1 - bounds.z0)} m, ${kb} KB`);
console.log(`  ${buildings.length} buildings, ${roads.length} road pieces, ${water.length} open creek pieces, ${areas.length} areas, ${trees.length / 4} trees, ${pois.length} landmarks`);
console.log('  roads:', tally);
console.log('  bridges:', roads.filter((r) => r.bridge).map((r) => `${r.kind} ${r.name ?? ''} y=${r.pts[1]}..${r.pts[r.pts.length - 2]}`));
console.log(`  ${buildings.filter((b) => b.fronts.length).length} buildings with shopfronts, ${buildings.reduce((a, b) => a + b.fronts.length, 0)} shopfront walls`);
console.log(`  street furniture: ${props.lamps.length / 4} lamps, ${props.planters.length / 3} planters, ${props.benches.length / 4} benches, ${props.cars.length / 5} parked cars, cedar ${props.cedar ? 'yes' : 'no'}, fountain ${props.fountain ? 'yes' : 'no'}`);
console.log('  things to find:', spots.map((s) => `${s.id}/${s.kind} (${Math.round(s.x)}, ${Math.round(s.z)})`).join(', '));
console.log('  landmarks:', pois.map((p) => p.name).join(', '));
console.log(`  lowest ground ${Math.min(...height).toFixed(1)} m`);
