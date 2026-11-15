import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P } from '../style/palette';
import { fitRectangle } from './heroes';

/**
 * Pencil ghosts: things that once stood here, drawn in graphite over the present-day town.
 * A ghost draws itself in stroke by stroke, the way a sketch is made, and fades when it is done with.
 */

const VERT = /* glsl */ `
  attribute float aOrder;
  varying float vOrder;
  void main() {
    vOrder = aOrder;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uProgress, uAlpha;
  varying float vOrder;
  void main() {
    // Strokes appear in the order they were laid down.
    if (vOrder > uProgress) discard;
    gl_FragColor = vec4(uColor, uAlpha * smoothstep(0.0, 0.03, uProgress - vOrder + 0.03));
  }
`;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const DRAW_SECONDS = 3.2;

/** Collects pencil strokes (thin bars) and faint paper-coloured panels, remembering the order they were added. */
class Drawing {
  private strokes: THREE.BufferGeometry[] = [];
  private panels: THREE.BufferGeometry[] = [];
  private count = 0;

  private stamp(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const order = new Float32Array(g.attributes.position.count).fill(this.count++);
    g.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
    return g;
  }

  line(a: THREE.Vector3, b: THREE.Vector3, thickness = 0.1): void {
    const len = a.distanceTo(b);
    if (len < 0.01) return;
    const g = new THREE.BoxGeometry(len + thickness, thickness, thickness);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(X_AXIS, b.clone().sub(a).divideScalar(len)));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.strokes.push(this.stamp(g));
  }

  path(points: THREE.Vector3[], thickness = 0.1): void {
    for (let i = 0; i < points.length - 1; i++) this.line(points[i], points[i + 1], thickness);
  }

  /** A faint filled face, so the ghost reads as a solid thing and not a tangle of lines. */
  panel(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]), 3));
    this.panels.push(this.stamp(g));
  }

  build(): { group: THREE.Group; materials: THREE.ShaderMaterial[] } {
    const group = new THREE.Group();
    const materials: THREE.ShaderMaterial[] = [];
    const make = (parts: THREE.BufferGeometry[], color: number, alpha: number, order: number) => {
      if (parts.length === 0) return;
      // Turn each stroke's place in the queue into a 0..1 moment in the drawing.
      for (const g of parts) {
        const a = g.attributes.aOrder as THREE.BufferAttribute;
        for (let i = 0; i < a.count; i++) a.setX(i, a.getX(i) / this.count);
        g.deleteAttribute('normal');
        g.deleteAttribute('uv');
      }
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uColor: { value: new THREE.Color(color) }, uProgress: { value: 0 }, uAlpha: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      material.userData.alpha = alpha;
      const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), material);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      group.add(mesh);
      materials.push(material);
    };
    make(this.panels, P.paper, 0.62, 4);
    make(this.strokes, 0x55525c, 0.92, 5);
    return { group, materials };
  }
}

export class Ghost {
  readonly group: THREE.Group;
  private materials: THREE.ShaderMaterial[];
  private progress = 0;
  private alpha = 0;

  constructor(
    /** The sketch spot this ghost belongs to. */
    readonly spot: string,
    readonly x: number,
    readonly z: number,
    drawing: Drawing,
    /** How to frame the ghost while sketching it: where to look, how wide, and from which direction (null for the usual one). */
    readonly view: { x: number; y: number; z: number; span: number; yaw: number | null },
  ) {
    const built = drawing.build();
    this.group = built.group;
    this.materials = built.materials;
    this.group.visible = false;
  }

  /** While `on`, the ghost draws itself in; otherwise it fades, and is forgotten once gone. */
  update(dt: number, on: boolean): void {
    if (on) {
      this.progress = Math.min(1, this.progress + dt / DRAW_SECONDS);
      this.alpha = Math.min(1, this.alpha + dt * 3);
    } else {
      this.alpha = Math.max(0, this.alpha - dt / 1.6);
      if (this.alpha === 0) this.progress = 0;
    }
    this.group.visible = this.alpha > 0;
    for (const m of this.materials) {
      m.uniforms.uProgress.value = this.progress;
      m.uniforms.uAlpha.value = this.alpha * (m.userData.alpha as number);
    }
  }
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * The 1906 Main Street bridge: stone and concrete, carried on large arches over the creek, and
 * taken down in the 1950s for the freeway. It is drawn beside today's bridge so both can be seen;
 * the three-arch form and its proportions are an artist's impression, not a survey.
 */
export function bridgeGhost(spot: string, deck: number[], groundAt: (x: number, z: number) => number): Ghost {
  const n = deck.length / 3;
  const ax = deck[0], ay = deck[1], az = deck[2];
  const bx = deck[(n - 1) * 3], bz = deck[(n - 1) * 3 + 2];
  const length = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / length, dz = (bz - az) / length;
  // Stand on the side nearer the camera, which looks from the south-east.
  let nx = -dz, nz = dx;
  if (nx + nz < 0) [nx, nz] = [-nx, -nz];
  const OFFSET = 17;
  const HALF = 3.6;
  const at = (t: number, side: number, y: number) => v(ax + dx * t + nx * (OFFSET + side * HALF), y, az + dz * t + nz * (OFFSET + side * HALF));

  const d = new Drawing();
  const SPANS = 3;
  const span = length / SPANS;
  const spring = ay - 5.3;
  const crown = ay - 1.0;

  // The roadway first, then each arch, pier and parapet, as a draughtsman would.
  d.panel(at(0, -1, ay), at(length, -1, ay), at(length, 1, ay), at(0, 1, ay));
  for (const side of [1, -1]) {
    d.line(at(0, side, ay), at(length, side, ay), 0.14);
    d.line(at(0, side, ay - 0.7), at(length, side, ay - 0.7));
  }
  d.line(at(0, -1, ay), at(0, 1, ay));
  d.line(at(length, -1, ay), at(length, 1, ay));

  for (let k = 0; k < SPANS; k++) {
    for (const side of [1, -1]) {
      const arc: THREE.Vector3[] = [];
      for (let j = 0; j <= 16; j++) {
        const u = j / 16;
        arc.push(at(k * span + 0.9 + u * (span - 1.8), side, spring + (crown - spring) * Math.sin(Math.PI * u)));
      }
      d.path(arc, 0.13);
      // A second, lighter ring for the arch stones.
      d.path(arc.map((p) => p.clone().setY(Math.min(ay - 0.75, p.y + 0.55))), 0.06);
      // Solid spandrel wall above the arch, so the bridge reads as masonry.
      if (side === 1) {
        for (let j = 0; j < 16; j++) d.panel(arc[j], arc[j + 1], arc[j + 1].clone().setY(ay), arc[j].clone().setY(ay));
      }
    }
    for (const u of [0.2, 0.5, 0.8]) {
      const t = k * span + 0.9 + u * (span - 1.8);
      const y = spring + (crown - spring) * Math.sin(Math.PI * u);
      d.line(at(t, -1, y), at(t, 1, y), 0.06);
    }
  }

  for (let k = 0; k <= SPANS; k++) {
    const t = k * span;
    for (const side of [1, -1]) {
      for (const dt of [-0.9, 0.9]) {
        const p = at(t + dt, side, ay - 0.7);
        d.line(p, p.clone().setY(Math.min(spring, groundAt(p.x, p.z))), 0.12);
      }
    }
    const foot = at(t, 1, 0);
    const y = Math.min(spring, groundAt(foot.x, foot.z));
    d.panel(at(t - 0.9, 1, ay - 0.7), at(t + 0.9, 1, ay - 0.7), at(t + 0.9, 1, y), at(t - 0.9, 1, y));
    d.line(at(t - 0.9, 1, y), at(t + 0.9, 1, y));
  }

  // Parapets with posts, and a lamp standard over each pier.
  for (const side of [1, -1]) {
    d.line(at(0, side, ay + 1.0), at(length, side, ay + 1.0), 0.12);
    for (let t = 0; t <= length + 0.01; t += length / 26) d.line(at(t, side, ay), at(t, side, ay + 1.0), 0.07);
    for (let k = 0; k <= SPANS; k++) {
      const t = k * span;
      d.line(at(t, side, ay + 1.0), at(t, side, ay + 3.4), 0.09);
      d.path([at(t - 0.28, side, ay + 3.4), at(t + 0.28, side, ay + 3.4), at(t + 0.2, side, ay + 3.9), at(t - 0.2, side, ay + 3.9), at(t - 0.28, side, ay + 3.4)], 0.07);
    }
  }

  const mid = at(length / 2, 0, ay);
  // The bridge runs almost straight away from the usual camera, hiding its arches under the deck,
  // so it is sketched from three-quarters on to its side.
  return new Ghost(spot, mid.x, mid.z, d, { x: mid.x, y: ay - 2, z: mid.z, span: 62, yaw: Math.atan2(nx, nz) + 0.45 });
}

/**
 * The four-storey Forbes flour mill of the 1850s, of which only the annex survives. It is drawn
 * rising behind the annex and joined to it; its size and window pattern are an impression.
 */
export function millGhost(spot: string, annex: number[], base: number): Ghost {
  const r = fitRectangle(annex);
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  // Join the mill to whichever end of the annex is further from the camera, so it rises behind it.
  const end = c + s < 0 ? 1 : -1;
  const HX = 9, HZ = Math.max(r.halfShort + 1.6, 6.5);
  const FLOOR = 3.5, FLOORS = 4, RISE = 3.4;
  const H = FLOOR * FLOORS;
  const ox = r.cx + c * end * (r.halfLong + HX), oz = r.cz + s * end * (r.halfLong + HX);
  const at = (lx: number, y: number, lz: number) => v(ox + c * lx - s * lz, base + y, oz + s * lx + c * lz);

  const d = new Drawing();
  const corners: [number, number][] = [[-HX, -HZ], [HX, -HZ], [HX, HZ], [-HX, HZ]];

  // Walls as faint solids, then the outline from the ground up.
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % 4];
    d.panel(at(x0, 0, z0), at(x1, 0, z1), at(x1, H, z1), at(x0, H, z0));
  }
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % 4];
    d.line(at(x0, 0, z0), at(x1, 0, z1), 0.14);
  }
  for (const [x, z] of corners) d.line(at(x, 0, z), at(x, H, z), 0.14);
  for (let f = 1; f <= FLOORS; f++) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % 4];
      d.line(at(x0, f * FLOOR, z0), at(x1, f * FLOOR, z1), f === FLOORS ? 0.14 : 0.07);
    }
    // Rows of small windows on the faces turned to the camera.
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % 4];
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      // Outward direction of this face, in world terms.
      const wx = c * mx - s * mz, wz = s * mx + c * mz;
      if (wx + wz <= 0) continue;
      const count = Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 5 : 4;
      for (let k = 0; k < count; k++) {
        const u0 = (k + 0.5) / count - 0.035, u1 = (k + 0.5) / count + 0.035;
        const y0 = (f - 1) * FLOOR + 1.1, y1 = (f - 1) * FLOOR + 2.6;
        const p = (u: number, y: number) => at(x0 + (x1 - x0) * u, y, z0 + (z1 - z0) * u);
        d.path([p(u0, y0), p(u1, y0), p(u1, y1), p(u0, y1), p(u0, y0)], 0.06);
      }
    }
  }

  // Pitched roof with its ridge along the building.
  d.panel(at(-HX, H, HZ), at(HX, H, HZ), at(HX, H + RISE, 0), at(-HX, H + RISE, 0));
  d.panel(at(-HX, H, -HZ), at(HX, H, -HZ), at(HX, H + RISE, 0), at(-HX, H + RISE, 0));
  d.line(at(-HX, H + RISE, 0), at(HX, H + RISE, 0), 0.14);
  for (const x of [-HX, HX]) {
    d.line(at(x, H, -HZ), at(x, H + RISE, 0), 0.12);
    d.line(at(x, H, HZ), at(x, H + RISE, 0), 0.12);
  }
  for (let k = 1; k < 6; k++) {
    const x = -HX + (k / 6) * 2 * HX;
    d.line(at(x, H, HZ), at(x, H + RISE, 0), 0.05);
    d.line(at(x, H, -HZ), at(x, H + RISE, 0), 0.05);
  }

  // Frame the annex and the mill together.
  return new Ghost(spot, ox, oz, d, { x: (r.cx + ox) / 2, y: base + 8, z: (r.cz + oz) / 2, span: 66, yaw: null });
}
