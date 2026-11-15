import * as THREE from 'three';
import type { CameraRig } from '../game/cameraRig';

/**
 * The Santa Cruz Mountains, as layered silhouettes behind the town.
 *
 * The everyday camera looks down too steeply to see a horizon, so the ridge only appears at a
 * lookout, when the camera lowers to look south. It is stage scenery, not terrain: flat painted
 * layers set up behind whatever the camera is looking at, sized to fill the top of the picture.
 */

const HALF_WIDTH = 900;

interface Layer {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Where the layer stands and how high it reaches, as fractions of the screen's half-height. */
  foot: number;
  peak: number;
  day: THREE.Color;
  dusk: THREE.Color;
}

/** A silhouette one unit tall with a rolling top edge, extending well below its foot. */
function silhouette(seed: number, roughness: number): THREE.BufferGeometry {
  const N = 160;
  const v: number[] = [];
  const top = (i: number) => {
    const x = (i / N) * 12 + seed;
    const rolling = Math.sin(x * 0.7) * 0.5 + Math.sin(x * 1.9 + 1.3) * 0.28 + Math.sin(x * 4.3 + 0.4) * 0.12 * roughness + Math.sin(x * 9.1) * 0.05 * roughness;
    return 0.62 + rolling * 0.38;
  };
  for (let i = 0; i < N; i++) {
    const x0 = (i / N - 0.5) * 2 * HALF_WIDTH, x1 = ((i + 1) / N - 0.5) * 2 * HALF_WIDTH;
    const y0 = top(i), y1 = top(i + 1);
    v.push(x0, -4, 0, x1, -4, 0, x1, y1, 0, x0, -4, 0, x1, y1, 0, x0, y0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  return g;
}

export class Ridge {
  readonly group = new THREE.Group();
  private layers: Layer[];
  private readonly south = new THREE.Vector3();

  constructor() {
    const make = (geo: THREE.BufferGeometry, foot: number, peak: number, day: number, dusk: number, order: number): Layer => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: day, transparent: true, side: THREE.DoubleSide }));
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, foot, peak, day: new THREE.Color(day), dusk: new THREE.Color(dusk) };
    };
    const sky = new THREE.BufferGeometry();
    sky.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-HALF_WIDTH, -4, 0, HALF_WIDTH, -4, 0, HALF_WIDTH, 1, 0, -HALF_WIDTH, -4, 0, HALF_WIDTH, 1, 0, -HALF_WIDTH, 1, 0]), 3));
    // Farthest first: sky, then three ridges, each nearer one darker and lower.
    this.layers = [
      make(sky, 0.4, 2.4, 0xe9eee6, 0xf6cfa2, 0),
      make(silhouette(3.1, 0.6), 0.37, 0.86, 0xbfd0cf, 0xd9a9a8, 1),
      make(silhouette(7.7, 0.9), 0.34, 0.7, 0x9ab6b1, 0xa98aa6, 2),
      make(silhouette(1.2, 1.2), 0.31, 0.56, 0x78a093, 0x7a6f9a, 3),
    ];
    this.group.visible = false;
  }

  /** Call every frame. The ridge shows itself as the camera lowers, and warms toward dusk. */
  update(rig: CameraRig, focus: THREE.Vector3, dusk: number): void {
    const shown = THREE.MathUtils.smoothstep(rig.lowered, 0.35, 0.95);
    this.group.visible = shown > 0.01;
    if (!this.group.visible) return;
    const p = rig.pitch;
    const top = rig.camera.top;
    // Away from the camera, along the ground.
    this.south.set(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));
    for (const l of this.layers) {
      // In this camera, a point D metres beyond the focus and h metres above it appears
      // D*sin(pitch) + h*cos(pitch) above the middle of the screen. Solve that for where to stand
      // and how tall to be.
      const D = (l.foot * top) / Math.sin(p);
      const height = ((l.peak - l.foot) * top) / Math.cos(p);
      l.mesh.position.copy(focus).addScaledVector(this.south, D);
      l.mesh.rotation.y = rig.yaw;
      l.mesh.scale.set(1, height, 1);
      l.mesh.material.color.copy(l.day).lerp(l.dusk, dusk);
      l.mesh.material.opacity = shown;
    }
  }
}
