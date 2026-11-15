// Downloads a pinned OpenStreetMap snapshot for a region into data/raw.
// Usage: node pipeline/fetch.mjs <region>
// Map data (c) OpenStreetMap contributors, ODbL.
import { writeFile } from 'node:fs/promises';
import { REGIONS } from './regions.mjs';

const id = process.argv[2];
const region = REGIONS[id];
if (!region) {
  console.error(`Unknown region "${id}". Known: ${Object.keys(REGIONS).join(', ')}`);
  process.exit(1);
}

// The main OpenStreetMap API returns everything inside a small box. It allows boxes up to
// 0.25 square degrees and 50,000 nodes, which is far more than one region needs.
const [s, w, n, e] = region.bbox;
const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${w},${s},${e},${n}`;
const res = await fetch(url, { headers: { 'User-Agent': 'map-pipeline/0.1' }, signal: AbortSignal.timeout(90000) });
if (!res.ok) {
  console.error(`${url} failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const data = await res.json();

// Keep only geometry and tags: no editor names, changesets or timestamps.
const elements = data.elements.map((el) => {
  const out = { type: el.type, id: el.id };
  if (el.type === 'node') Object.assign(out, { lat: el.lat, lon: el.lon });
  if (el.nodes) out.nodes = el.nodes;
  if (el.members) out.members = el.members;
  if (el.tags) out.tags = el.tags;
  return out;
});

const out = `data/raw/${id}.osm.json`;
await writeFile(out, JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), bbox: region.bbox, attribution: '(c) OpenStreetMap contributors, ODbL', elements }));
const count = (t) => elements.filter((el) => el.type === t).length;
console.log(`saved ${out}: ${count('node')} nodes, ${count('way')} ways, ${count('relation')} relations`);
