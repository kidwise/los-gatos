/**
 * Finds a way along streets, sidewalks and trails, so a far-off tap leads the cat round buildings
 * instead of into them. Roads that share a point on the map are joined there.
 */

const WALKABLE = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'pedestrian', 'cycleway', 'path', 'footway', 'sidewalk', 'crossing', 'steps', 'track']);
const CELL = 24;

export type Router = (fromX: number, fromZ: number, toX: number, toZ: number) => number[] | null;

export function makeRouter(roads: { kind: string; pts: number[] }[]): Router {
  const xs: number[] = [];
  const zs: number[] = [];
  const links: number[][] = [];
  const ids = new Map<string, number>();
  const cells = new Map<number, number[]>();
  const cellOf = (x: number, z: number) => Math.floor(x / CELL) * 8192 + Math.floor(z / CELL);

  for (const r of roads) {
    if (!WALKABLE.has(r.kind)) continue;
    let prev = -1;
    for (let i = 0; i < r.pts.length; i += 3) {
      const x = r.pts[i], z = r.pts[i + 2];
      const key = `${Math.round(x * 20)},${Math.round(z * 20)}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = xs.length;
        ids.set(key, id);
        xs.push(x);
        zs.push(z);
        links.push([]);
        const c = cellOf(x, z);
        if (!cells.has(c)) cells.set(c, []);
        cells.get(c)!.push(id);
      }
      if (prev >= 0 && prev !== id) {
        links[prev].push(id);
        links[id].push(prev);
      }
      prev = id;
    }
  }

  const nearest = (x: number, z: number): number => {
    let best = -1, bestD = Infinity;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let ring = 0; ring <= 4 && best < 0; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          for (const id of cells.get((cx + dx) * 8192 + cz + dz) ?? []) {
            const d = Math.hypot(xs[id] - x, zs[id] - z);
            if (d < bestD) [best, bestD] = [id, d];
          }
        }
      }
    }
    return best;
  };

  const n = xs.length;
  const cost = new Float64Array(n);
  const came = new Int32Array(n);

  return (fromX, fromZ, toX, toZ) => {
    const start = nearest(fromX, fromZ);
    const goal = nearest(toX, toZ);
    if (start < 0 || goal < 0) return null;
    cost.fill(Infinity);
    came.fill(-1);
    cost[start] = 0;
    // A small binary heap of [estimated total, node].
    const heap: [number, number][] = [[0, start]];
    const push = (item: [number, number]) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (heap[up][0] <= heap[i][0]) break;
        [heap[up], heap[i]] = [heap[i], heap[up]];
        i = up;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [, at] = pop();
      if (at === goal) break;
      for (const next of links[at]) {
        const c = cost[at] + Math.hypot(xs[next] - xs[at], zs[next] - zs[at]);
        if (c >= cost[next]) continue;
        cost[next] = c;
        came[next] = at;
        push([c + Math.hypot(xs[goal] - xs[next], zs[goal] - zs[next]), next]);
      }
    }
    if (goal !== start && came[goal] < 0) return null;
    const path: number[] = [];
    for (let at = goal; at >= 0; at = came[at]) path.unshift(xs[at], zs[at]);
    return path;
  };
}
