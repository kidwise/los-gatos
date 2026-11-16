import * as THREE from 'three';
import { gouache } from '../style/gouache';
import { P } from '../style/palette';
import type { Kit } from './buildings';
import { Batch } from './kit';
import type { Ride } from './world';

/**
 * Paints a lake and brings it to life: rippled water with pale shallows and a foam line, a sandy
 * shore with reeds, lily pads and stones, ducks, sailboats, pedal boats, and a pier with a boat
 * the cat can take out.
 */

const DEEP = 0x66a9b6;
const SHALLOW = 0x8fc9c4;
const SHALLOWEST = 0xbde0d2;
const FOAM = 0xf6f2e6;
const SAND = 0xe8d6ae;
const WOOD = 0x9a7758;

export interface LakeOptions {
  /** The shoreline, as x, z pairs. */
  ring: number[];
  /** Height of the water's surface. */
  level: number;
  kit: Kit;
  group: THREE.Group;
  terrainY: (x: number, z: number) => number;
  /** Boats out on the water: x, z, heading and colour index for each. */
  boats: number[];
  /** Where the boat rental is, to build the pier beside. */
  dockNear: { x: number; z: number } | null;
}

function hash(n: number): number {
  let t = (n ^ 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function insideRing(x: number, z: number, ring: number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    if (ring[i + 1] > z !== ring[j + 1] > z && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) inside = !inside;
  }
  return inside;
}

/** A small boat, built facing +x. Pedal boats have a canopy; the rowing boat is open. */
function boatMesh(material: THREE.Material, hull: number, kind: 'pedal' | 'row' | 'sail', crew: number[]): THREE.Mesh {
  const b = new Batch();
  if (kind === 'pedal') {
    b.box(hull, 0, 0.22, 0, 2.6, 0.44, 1.5);
    b.ball(hull, 1.3, 0.22, 0, 0.5, 0.22, 0.75);
    b.box(P.warmWhite, -0.2, 0.52, 0, 1.2, 0.16, 1.2);
    for (const sx of [-0.85, 0.5]) for (const sz of [-0.68, 0.68]) b.cyl(P.ink, sx, 1.0, sz, 0.03, 0.03, 1.1, 5);
    b.box(P.trim, -0.18, 1.58, 0, 1.7, 0.08, 1.6);
    b.box(hull, -0.18, 1.5, 0, 1.76, 0.1, 1.66);
  } else {
    // A pointed wooden hull with a pale rim and two thwarts.
    b.box(hull, -0.2, 0.2, 0, 2.3, 0.4, 1.3);
    b.add(new THREE.ConeGeometry(0.65, 1.3, 4), hull, 1.55, 0.2, 0, { rz: -Math.PI / 2, ry: Math.PI / 4, sz: 1, flat: true });
    b.box(P.warmWhite, -0.2, 0.42, 0.64, 2.3, 0.06, 0.06);
    b.box(P.warmWhite, -0.2, 0.42, -0.64, 2.3, 0.06, 0.06);
    b.box(WOOD, -0.7, 0.34, 0, 0.3, 0.05, 1.2);
    b.box(WOOD, 0.4, 0.34, 0, 0.3, 0.05, 1.2);
    if (kind === 'sail') {
      b.cyl(WOOD, 0.3, 2.2, 0, 0.04, 0.05, 3.9, 6);
      const sail = new THREE.BufferGeometry();
      sail.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0.22, 0.75, 0, 0.22, 4.0, 0, -1.6, 0.85, 0.25]), 3));
      sail.computeVertexNormals();
      b.add(sail, P.warmWhite, 0, 0, 0);
      const jib = new THREE.BufferGeometry();
      jib.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0.4, 0.75, 0, 0.4, 3.3, 0, 1.6, 0.6, -0.12]), 3));
      jib.computeVertexNormals();
      b.add(jib, P.persimmon, 0, 0, 0);
    } else {
      // Oars resting across the gunwales.
      for (const s of [-1, 1]) b.box(WOOD, 0, 0.5, s * 0.9, 0.06, 0.04, 1.3, s * 0.25);
    }
  }
  // People aboard: a body and a head each, in a few strokes.
  crew.forEach((color, i) => {
    const x = kind === 'pedal' ? -0.25 : -0.7 + i * 1.1;
    const z = kind === 'pedal' ? (i === 0 ? -0.32 : 0.32) : 0;
    b.cyl(color, x, 0.86, z, 0.15, 0.2, 0.56, 8);
    b.ball([0xf0cdb0, 0xdca883, 0xb9825e][i % 3], x, 1.26, z, 0.12, 0.13, 0.12);
    b.ball([P.ink, 0x5b4336, 0xd9b96e][(i + 1) % 3], x, 1.31, z - 0.02, 0.125, 0.11, 0.13);
  });
  const mesh = b.build(material)!;
  mesh.castShadow = true;
  return mesh;
}

function duckMesh(material: THREE.Material, mallard: boolean): THREE.Mesh {
  const b = new Batch();
  const body = mallard ? 0xb9a58c : 0x8a6f5c;
  b.ball(body, 0, 0.1, 0, 0.26, 0.13, 0.16);
  b.ball(P.warmWhite, -0.2, 0.14, 0, 0.1, 0.08, 0.1);
  b.ball(mallard ? P.deepGreen : 0x6f5a48, 0.2, 0.3, 0, 0.1, 0.11, 0.09);
  b.box(P.yellow, 0.32, 0.28, 0, 0.1, 0.03, 0.07);
  const mesh = b.build(material)!;
  mesh.castShadow = true;
  return mesh;
}

export function dressLake(o: LakeOptions): void {
  const { ring, level, kit } = o;
  const paint = kit.paint;
  const moving = (kit.moving ??= []);
  const n = ring.length / 2;

  // ---- The shoreline, resampled evenly, with a direction pointing into the water at each point. ----
  const shore: { x: number; z: number; ix: number; iz: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / 4));
    for (let k = 0; k < steps; k++) shore.push({ x: ax + ((bx - ax) * k) / steps, z: az + ((bz - az) * k) / steps, ix: 0, iz: 0 });
  }
  const S = shore.length;
  for (let i = 0; i < S; i++) {
    const p = shore[(i + S - 2) % S], q = shore[(i + 2) % S];
    const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    shore[i].ix = -(q.z - p.z) / len;
    shore[i].iz = (q.x - p.x) / len;
  }
  // Which side is water? Ask a handful of points and take the majority.
  let votes = 0;
  for (let i = 0; i < S; i += Math.max(1, Math.floor(S / 24))) votes += insideRing(shore[i].x + shore[i].ix * 2, shore[i].z + shore[i].iz * 2, ring) ? 1 : -1;
  if (votes < 0) for (const p of shore) [p.ix, p.iz] = [-p.ix, -p.iz];

  /** A band following the shore, from `from` to `to` metres into the water (negative is up the beach). */
  const band = (batch: Batch, color: number, from: (i: number) => number, to: (i: number) => number, height: (x: number, z: number) => number) => {
    const v: number[] = [];
    for (let i = 0; i < S; i++) {
      const p = shore[i], q = shore[(i + 1) % S];
      const a = [p.x + p.ix * from(i), p.z + p.iz * from(i)], b = [p.x + p.ix * to(i), p.z + p.iz * to(i)];
      const c = [q.x + q.ix * to(i + 1), q.z + q.iz * to(i + 1)], d = [q.x + q.ix * from(i + 1), q.z + q.iz * from(i + 1)];
      for (const [p0, p1, p2] of [[a, b, c], [a, c, d]]) {
        // Wind each triangle to face upward.
        const up = (p1[1] - p0[1]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[1] - p0[1]);
        const [m1, m2] = up >= 0 ? [p1, p2] : [p2, p1];
        v.push(p0[0], height(p0[0], p0[1]), p0[1], m1[0], height(m1[0], m1[1]), m1[1], m2[0], height(m2[0], m2[1]), m2[1]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    g.computeVertexNormals();
    batch.add(g, color, 0, 0, 0);
  };

  // ---- Water: deep in the middle, two paler steps toward the shore, all with moving ripples. ----
  const water = new Batch();
  {
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));
    const v: number[] = [];
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const a = contour[i], b = contour[j], c = contour[k];
      const up = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
      const [m1, m2] = up >= 0 ? [b, c] : [c, b];
      v.push(a.x, level, a.y, m1.x, level, m1.y, m2.x, level, m2.y);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    g.computeVertexNormals();
    water.add(g, DEEP, 0, 0, 0);
  }
  // The pale bands swell and narrow gently along the shore.
  const wide = (i: number) => 16 + 5 * Math.sin(i * 0.19) + 3 * Math.sin(i * 0.053 + 1);
  const narrow = (i: number) => 5.5 + 2 * Math.sin(i * 0.27 + 2) + 1.2 * Math.sin(i * 0.081);
  band(water, SHALLOW, () => -1, wide, () => level + 0.012);
  band(water, SHALLOWEST, () => -1, narrow, () => level + 0.024);
  const surface = water.build(gouache({ vertexColors: true, water: true }))!;
  surface.receiveShadow = true;
  o.group.add(surface);

  // A broken line of foam where the water meets the land, and a strip of sand above it.
  band(paint, FOAM, () => -0.3, (i) => 0.25 + hash(i * 3 + 9) * 0.9, () => level + 0.036);
  band(paint, SAND, () => -4.2, () => 0.2, (x, z) => Math.max(o.terrainY(x, z), level) + 0.05);

  // ---- The shore: reeds, stones and lily pads, in clumps. ----
  const greens = [P.leafC, P.leafA, P.leafSun, P.cedarA];
  const blooms = [P.pink, P.white, P.lilac];
  for (let i = 0; i < S; i += 2) {
    const p = shore[i];
    const r = hash(i * 13 + 5);
    if (r < 0.2) {
      // Reeds and cattails standing in the shallows.
      for (let k = 0; k < 7; k++) {
        const d = 0.3 + hash(i * 7 + k) * 1.6, side = (hash(i * 11 + k * 3) - 0.5) * 2.4;
        const x = p.x + p.ix * d - p.iz * side, z = p.z + p.iz * d + p.ix * side;
        const h = 1.1 + hash(i * 5 + k * 17) * 1.1;
        paint.cone(greens[k % 4], x, level - 0.05, z, 0.07, h, 4, { rx: (hash(i + k * 29) - 0.5) * 0.3, rz: (hash(i * 3 + k) - 0.5) * 0.3 });
        if (k % 3 === 0) paint.cyl(0x7a5a45, x, level + h * 0.86, z, 0.05, 0.05, 0.3, 5);
      }
    } else if (r < 0.27) {
      // A few stones at the water's edge.
      for (let k = 0; k < 3; k++) {
        const s = 0.25 + hash(i * 17 + k) * 0.45;
        paint.blob([P.stone, P.roofUnit, 0xc9bfb0][k], p.x + p.ix * (hash(i + k * 5) - 0.3) * 1.6 - p.iz * (k - 1) * 0.8, level + s * 0.2, p.z + p.iz * (hash(i + k * 5) - 0.3) * 1.6 + p.ix * (k - 1) * 0.8, s, s * 0.6, s * 0.85);
      }
    } else if (r < 0.34) {
      // Lily pads floating a little way out, with the odd flower.
      for (let k = 0; k < 6; k++) {
        const d = 3 + hash(i * 19 + k) * 5, side = (hash(i * 23 + k * 7) - 0.5) * 6;
        const x = p.x + p.ix * d - p.iz * side, z = p.z + p.iz * d + p.ix * side;
        if (!insideRing(x, z, ring)) continue;
        const s = 0.32 + hash(i + k * 31) * 0.3;
        paint.cyl(k % 2 ? P.leafB : P.leafC, x, level + 0.05, z, s, s, 0.03, 7);
        if (k % 3 === 0) paint.blob(blooms[(i + k) % 3], x + 0.08, level + 0.13, z, 0.13, 0.1, 0.13);
      }
    }
  }

  // ---- Life on the water. ----
  const material = gouache({ vertexColors: true, local: true });
  const bobbing = (object: THREE.Object3D, x: number, z: number, phase: number) => {
    object.position.set(x, level + 0.12, z);
    o.group.add(object);
    return (time: number) => {
      object.position.y = level + 0.12 + Math.sin(time * 1.4 + phase) * 0.035;
      object.rotation.z = Math.sin(time * 1.1 + phase) * 0.025;
    };
  };

  const HULLS = [P.persimmon, P.warmWhite, P.butter, P.slateBlue];
  const SHIRTS = [P.navy, P.warmWhite, P.oxblood, P.sage, P.butter];
  for (let i = 0; i < o.boats.length; i += 4) {
    const k = i / 4;
    const x = o.boats[i], z = o.boats[i + 1];
    // The first two are little sailboats that tack slowly round; the rest are pedal boats, drifting.
    const sailing = k < 2;
    const mesh = boatMesh(material, sailing ? [P.warmWhite, P.navy][k] : HULLS[o.boats[i + 3]], sailing ? 'sail' : 'pedal', sailing ? [SHIRTS[k]] : [SHIRTS[k % 5], SHIRTS[(k + 2) % 5]]);
    const bob = bobbing(mesh, x, z, k * 1.7);
    moving.push({
      object: mesh,
      x,
      z,
      update(_dt, time) {
        bob(time);
        if (sailing) {
          // A slow circle, well clear of the shore.
          const a = time * 0.11 + k * 2;
          mesh.position.x = x + Math.cos(a) * 3.6;
          mesh.position.z = z + Math.sin(a) * 3.6;
          mesh.rotation.y = -a - Math.PI / 2;
        } else {
          mesh.rotation.y = o.boats[i + 2] + Math.sin(time * 0.13 + k) * 0.5;
        }
      },
    });
  }

  // Ducks paddling in small circles near the shore.
  for (let d = 0, i = 7; d < 9 && i < S; i += Math.max(1, Math.floor(S / 9))) {
    const p = shore[i];
    const cx = p.x + p.ix * 8, cz = p.z + p.iz * 8;
    if (![0, 3, -3].every((off) => insideRing(cx + off, cz, ring) && insideRing(cx, cz + off, ring))) continue;
    for (let j = 0; j < 2 + (d % 2); j++) {
      const mesh = duckMesh(material, j === 0);
      const bob = bobbing(mesh, cx, cz, d + j);
      const lag = j * 0.55, speed = 0.32 + (d % 3) * 0.06;
      moving.push({
        object: mesh,
        x: cx,
        z: cz,
        update(_dt, time) {
          bob(time);
          const a = time * speed + d * 1.3 - lag;
          mesh.position.x = cx + Math.cos(a) * 2.4;
          mesh.position.z = cz + Math.sin(a) * 2.4;
          mesh.rotation.y = -a - Math.PI / 2;
        },
      });
    }
    d++;
  }

  // ---- The pier, and the boat the cat can take out. ----
  if (!o.dockNear) return;
  let at = shore[0], best = Infinity;
  for (const p of shore) {
    const d = Math.hypot(p.x - o.dockNear.x, p.z - o.dockNear.z);
    if (d < best) [at, best] = [p, d];
  }
  const PIER = 9;
  const turn = Math.atan2(-at.iz, at.ix);
  const frame = new THREE.Matrix4().makeRotationY(turn).setPosition(at.x, level, at.z);
  paint.frame.copy(frame);
  // Built along +x, running out over the water from two metres up the beach.
  paint.box(WOOD, PIER / 2 - 1, 0.5, 0, PIER + 2, 0.12, 1.8);
  for (let x = -1.6; x < PIER; x += 0.5) paint.box(0x86654a, x, 0.57, 0, 0.04, 0.02, 1.8);
  for (let x = 0.5; x <= PIER; x += 2.8) for (const s of [-0.85, 0.85]) paint.cyl(0x7a5a45, x, 0.1, s, 0.1, 0.11, 1.5, 7);
  paint.cyl(P.oxblood, PIER - 0.3, 0.95, 0.75, 0.2, 0.2, 0.1, 10, { rx: Math.PI / 2 });
  paint.cyl(WOOD, PIER - 0.3, 0.8, 0.85, 0.05, 0.05, 0.7, 6);
  paint.frame.identity();

  // Moored boats alongside: one to take out, one for company.
  const along = (d: number, side: number) => ({ x: at.x + at.ix * d - at.iz * side, z: at.z + at.iz * d + at.ix * side });
  const spare = boatMesh(material, P.butter, 'row', []);
  const spareAt = along(PIER - 2.5, -2);
  const spareBob = bobbing(spare, spareAt.x, spareAt.z, 2.2);
  spare.rotation.y = turn;
  moving.push({ object: spare, x: spareAt.x, z: spareAt.z, update: (_dt, time) => spareBob(time) });

  const boat = boatMesh(material, P.persimmon, 'row', []);
  const home = along(PIER - 4.5, 2);
  const state = { x: home.x, z: home.z, heading: turn, speed: 0 };
  const bob = bobbing(boat, home.x, home.z, 0.4);
  boat.rotation.y = turn;

  // Rings spreading out behind the boat as it moves.
  const wake = Array.from({ length: 7 }, () => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.95, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: FOAM, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    o.group.add(m);
    return { mesh: m, life: 0 };
  });
  let nextRing = 0, sinceRing = 0;
  let rowing = false;

  /** The nearest point on the shore, and how far away it is. */
  const nearestShore = (x: number, z: number) => {
    let near = shore[0], d = Infinity;
    for (const p of shore) {
      const dd = Math.abs(p.x - x) + Math.abs(p.z - z);
      if (dd < d) [near, d] = [p, dd];
    }
    return { near, d: Math.hypot(near.x - x, near.z - z) };
  };
  const afloat = (x: number, z: number) => insideRing(x, z, ring) && nearestShore(x, z).d > 1.9;

  moving.push({
    object: boat,
    x: home.x,
    z: home.z,
    update(dt, time) {
      bob(time);
      boat.position.x = state.x;
      boat.position.z = state.z;
      boat.rotation.y = state.heading;
      sinceRing += dt * state.speed;
      if (sinceRing > 2.2) {
        sinceRing = 0;
        const w = wake[nextRing++ % wake.length];
        w.life = 1;
        w.mesh.position.set(state.x - Math.cos(state.heading) * 1.4, level + 0.05, state.z + Math.sin(state.heading) * 1.4);
      }
      for (const w of wake) {
        w.life = Math.max(0, w.life - dt * 0.45);
        w.mesh.visible = w.life > 0;
        w.mesh.scale.setScalar(1 + (1 - w.life) * 2.6);
        w.mesh.material.opacity = w.life * 0.55;
      }
      // The boat glides to rest once nobody is rowing.
      if (!rowing) state.speed *= Math.exp(-2.5 * dt);
      rowing = false;
    },
  });

  const ride: Ride = {
    label: 'Take the boat out',
    near: (pos) => Math.hypot(pos.x - state.x, pos.z - state.z) < 13,
    seat(out) {
      out.set(state.x - Math.cos(state.heading) * 0.35, boat.position.y + 0.36, state.z + Math.sin(state.heading) * 0.35);
      return state.heading + Math.PI / 2;
    },
    steer(dt, dx, dz, pace) {
      if (pace <= 0) return;
      rowing = true;
      state.speed += (pace - state.speed) * (1 - Math.exp(-2.2 * dt));
      // Turn the bow toward where we are headed, then row that way.
      const goal = Math.atan2(-dz, dx);
      const diff = Math.atan2(Math.sin(goal - state.heading), Math.cos(goal - state.heading));
      state.heading += diff * (1 - Math.exp(-3 * dt));
      const step = state.speed * dt * Math.max(0.2, Math.cos(diff));
      const fx = Math.cos(state.heading), fz = -Math.sin(state.heading);
      // Stay on the water: if the way ahead is land, slide along the shore instead.
      if (afloat(state.x + fx * step, state.z + fz * step)) {
        state.x += fx * step;
        state.z += fz * step;
      } else if (afloat(state.x + fx * step, state.z)) state.x += fx * step;
      else if (afloat(state.x, state.z + fz * step)) state.z += fz * step;
      else state.speed = 0;
    },
    // You can only step out where there is land to step onto.
    canLeave: () => nearestShore(state.x, state.z).d < 10,
    leaveLabel: 'Step ashore',
    exit(out) {
      const { near } = nearestShore(state.x, state.z);
      out.set(near.x - near.ix * 4, 0, near.z - near.iz * 4);
    },
  };
  (kit.rides ??= []).push(ride);
}
