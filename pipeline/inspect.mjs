// Prints a quick summary of a raw snapshot. Usage: node pipeline/inspect.mjs <region>
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(`data/raw/${process.argv[2]}.osm.json`));
const ways = d.elements.filter((e) => e.type === 'way' && e.tags);
const tally = (k) => { const m = {}; for (const w of ways) { const v = w.tags[k]; if (v) m[v] = (m[v] || 0) + 1; } return m; };
for (const k of ['highway', 'waterway', 'natural', 'leisure', 'landuse', 'amenity']) console.log(k, tally(k));
console.log('buildings', ways.filter((w) => w.tags.building).length, 'with levels', ways.filter((w) => w.tags['building:levels']).length, 'with height', ways.filter((w) => w.tags.height).length);
console.log('bridges', ways.filter((w) => w.tags.bridge).map((w) => [w.tags.highway || w.tags.railway || w.tags.man_made, w.tags.name, w.tags.layer, w.nodes.length].join('|')));
console.log('tunnels', ways.filter((w) => w.tags.tunnel).map((w) => [w.tags.highway || w.tags.waterway, w.tags.name, w.tags.layer, w.tags.tunnel].join('|')));
console.log('waterways', ways.filter((w) => w.tags.waterway).map((w) => [w.tags.waterway, w.tags.name, w.tags.layer, w.tags.tunnel, w.nodes.length].join('|')));
console.log('named roads:', [...new Set(ways.filter((w) => w.tags.highway && w.tags.name).map((w) => w.tags.name))].join(', '));
console.log('named places:', [...new Set(d.elements.filter((e) => e.tags?.name && (e.tags.building || e.tags.amenity || e.tags.historic || e.tags.leisure || e.tags.tourism)).map((e) => e.tags.name))].slice(0, 70).join(', '));
console.log('trees', d.elements.filter((e) => e.type === 'node' && e.tags?.natural === 'tree').length);
