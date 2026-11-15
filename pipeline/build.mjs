// Turns a raw OpenStreetMap snapshot into a region pack the game can load.
// Usage: node pipeline/build.mjs <region>
//
// The pack is in game metres: x east, z south, y up, with the region's centre at the origin.
// OpenStreetMap has no ground heights, so the terrain here is inferred: the freeway and the creek
// are carved below town level, streets are kept level, and trails get a flat bench to run on.
// Real elevation data can replace the inferred terrain later without changing the pack format.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
// 5. Soften.
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
    name: t.name,
    kind: t.building === 'yes' ? (t.shop || t.amenity || t.office ? 'commercial' : 'yes') : t.building,
    use: t.amenity || t.shop || t.tourism || t.historic || undefined,
    levels: levelsOf(way),
    base: r2(base),
    ring: ring.flatMap(([x, z]) => [r2(x), r2(z)]),
  });
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
  pois,
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
console.log('  landmarks:', pois.map((p) => p.name).join(', '));
console.log(`  lowest ground ${Math.min(...height).toFixed(1)} m`);
