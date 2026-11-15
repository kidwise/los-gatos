import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_SPHERE = new THREE.SphereGeometry(1, 16, 12);
const UNIT_BLOB = new THREE.IcosahedronGeometry(1, 1);

/** Right-triangle prism: back wall at z=0 rising to y=1, sloping down to the front edge at z=1. */
function wedgeGeometry(): THREE.BufferGeometry {
  const A = [-0.5, 0, 0], B = [0.5, 0, 0], C = [0.5, 1, 0], D = [-0.5, 1, 0], E = [-0.5, 0, 1], F = [0.5, 0, 1];
  const tris = [D, E, F, D, F, C, A, B, F, A, F, E, A, D, C, A, C, B, A, E, D, B, C, F];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  g.computeVertexNormals();
  return g;
}
const UNIT_WEDGE = wedgeGeometry();

export interface AddOptions {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Recompute normals per face, for crisp planes on cones and roofs. */
  flat?: boolean;
}

const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();

/**
 * Collects coloured pieces and merges them into one mesh, so a whole street is a single draw call.
 * `frame` is applied to everything added, which lets a facade be authored in its own flat coordinates.
 */
export class Batch {
  readonly frame = new THREE.Matrix4();
  private parts: THREE.BufferGeometry[] = [];

  add(src: THREE.BufferGeometry, color: number, x: number, y: number, z: number, o: AddOptions = {}): void {
    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    _mat.compose(
      _pos.set(x, y, z),
      _quat.setFromEuler(_euler.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)),
      _scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1),
    );
    g.applyMatrix4(_mat.premultiply(this.frame));
    if (o.flat) g.computeVertexNormals();

    _col.set(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = _col.r;
      colors[i * 3 + 1] = _col.g;
      colors[i * 3 + 2] = _col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
  }

  /** Box centred on (x, y, z). */
  box(color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): void {
    this.add(UNIT_BOX, color, x, y, z, { sx, sy, sz, ry });
  }

  /** Ellipsoid centred on (x, y, z). */
  ball(color: number, x: number, y: number, z: number, rx: number, ry = rx, rz = rx): void {
    this.add(UNIT_SPHERE, color, x, y, z, { sx: rx, sy: ry, sz: rz });
  }

  /** Low-detail ellipsoid, for things drawn by the hundred. */
  blob(color: number, x: number, y: number, z: number, rx: number, ry = rx, rz = rx): void {
    this.add(UNIT_BLOB, color, x, y, z, { sx: rx, sy: ry, sz: rz });
  }

  /** Upright cylinder or tapered post, centred on (x, y, z). */
  cyl(color: number, x: number, y: number, z: number, rTop: number, rBottom: number, h: number, seg = 12, o: AddOptions = {}): void {
    this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, x, y, z, o);
  }

  /** Cone with its base centre at (x, y, z). */
  cone(color: number, x: number, y: number, z: number, r: number, h: number, seg = 10, o: AddOptions = {}): void {
    this.add(new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0), color, x, y, z, o);
  }

  /** Sloped canopy: back edge on the wall at z, bottom at y, projecting forward along +z (turned by ry). */
  wedge(color: number, x: number, y: number, z: number, width: number, rise: number, projection: number, ry = 0): void {
    this.add(UNIT_WEDGE, color, x, y, z, { sx: width, sy: rise, sz: projection, ry });
  }

  build(material: THREE.Material): THREE.Mesh | null {
    if (this.parts.length === 0) return null;
    const geo = mergeGeometries(this.parts);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return new THREE.Mesh(geo, material);
  }
}

/** Small deterministic random source, so the corner looks the same on every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SignStyle = 'italic' | 'caps';

/** Lettering resolution. Scenes with many signs lower this to save memory. */
export const signOptions = { px: 96 };

/** Hand-lettered shop sign as a transparent plane, sized to fit within maxWidth x height metres. */
export function makeSign(text: string, style: SignStyle, ink: number, maxWidth: number, height: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const px = signOptions.px;
  const font = style === 'italic' ? `italic 600 ${px}px "Playfair Display", Georgia, serif` : `500 ${px * 0.72}px "Playfair Display", Georgia, serif`;
  const label = style === 'caps' ? text.toUpperCase() : text;
  const spacing = style === 'caps' ? px * 0.16 : 0;

  ctx.font = font;
  let width = 0;
  for (const ch of label) width += ctx.measureText(ch).width + spacing;
  canvas.width = Math.ceil(width + px * 0.5);
  canvas.height = Math.ceil(px * 1.35);

  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `#${ink.toString(16).padStart(6, '0')}`;
  let x = px * 0.25 + spacing / 2;
  for (const ch of label) {
    ctx.fillText(ch, x, canvas.height / 2);
    x += ctx.measureText(ch).width + spacing;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const aspect = canvas.width / canvas.height;
  const h = Math.min(height, maxWidth / aspect);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(h * aspect, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 2;
  return mesh;
}
