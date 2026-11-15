import * as THREE from 'three';
import type { CameraRig } from '../game/cameraRig';

/**
 * The Santa Cruz Mountains, painted behind the town.
 *
 * The everyday camera looks down too steeply to see a horizon, so the mountains only appear at a
 * lookout, when the camera lowers to look south. They are stage scenery: flat sheets set up behind
 * whatever the camera is looking at. Each sheet is painted in the same language as the town,
 * with three flat tones of light on folded slopes, wobbling brush edges, forest and dry grass,
 * and mist pooling at the foot of each ridge so the layers recede.
 */

const HALF_WIDTH = 1400;

const VERT = /* glsl */ `
  uniform float uOffset;
  varying vec2 vP;
  varying float vLocal;
  void main() {
    // x in world metres along the sheet, so the painting stays put as the camera moves.
    vP = vec2(position.x + uOffset, position.y);
    vLocal = position.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.3; a *= 0.5; }
    return s / 0.9375;
  }
`;

const RIDGE_FRAG = /* glsl */ `
  uniform vec3 uLit, uHalf, uShade, uMist, uGrass;
  uniform float uSeed, uScale, uTrees, uGrassAmount, uMistAmount, uOpacity;
  varying vec2 vP;
  ${NOISE}

  // The crest line: long swells, shoulders, and a fringe of treetops on the nearer ridges.
  float crest(float x) {
    float c = 0.56 + 0.62 * (fbm(vec2(x * 0.8 + uSeed, 3.7)) - 0.5) * 2.0;
    c += 0.16 * (fbm(vec2(x * 3.3 + uSeed * 2.0, 9.1)) - 0.5);
    c += uTrees * 0.016 * (noise(vec2(x * 46.0, uSeed)) - 0.5);
    return clamp(c, 0.24, 1.0);
  }

  // The lie of the land below the crest: spurs and gullies running downhill.
  float land(vec2 q) {
    return fbm(vec2(q.x * 4.6 + uSeed + q.y * 1.1, q.y * 1.7)) + 0.35 * fbm(vec2(q.x * 13.0 - q.y * 2.0, q.y * 5.0 + uSeed));
  }

  void main() {
    float x = vP.x / uScale;
    float top = crest(x);
    if (vP.y > top) discard;
    float down = top - vP.y;

    // Which way a slope faces decides its tone. The sun is to the left, as it is over the town.
    vec2 q = vec2(x, down);
    float facing = (land(q + vec2(0.03, 0.0)) - land(q - vec2(0.03, 0.0))) * 9.0;
    // The crest itself catches light on its sunward side.
    facing += (crest(x + 0.03) - crest(x - 0.03)) * 14.0 * smoothstep(0.3, 0.0, down);
    float wob = (noise(vec2(x * 30.0, down * 40.0)) - 0.5) * 0.12;
    vec3 col = mix(uShade, uHalf, smoothstep(-0.13 + wob, -0.1 + wob, facing));
    col = mix(col, uLit, smoothstep(0.1 + wob, 0.13 + wob, facing));

    // Dry golden grass on the open, sunlit lower slopes.
    float open = smoothstep(0.5, 0.56, fbm(vec2(x * 2.6 + 4.0 + uSeed, down * 3.4))) * smoothstep(0.1, 0.3, down);
    col = mix(col, uGrass * (0.86 + 0.14 * smoothstep(-0.1, 0.2, facing)), open * uGrassAmount);

    // Forest: dabs of darker green, thick near the crest and in the gullies, thinning on the grass.
    float dabs = smoothstep(0.56, 0.62, noise(vec2(x * 52.0 + uSeed, down * 64.0)));
    float woods = (1.0 - open * uGrassAmount * 0.8) * (0.45 + 0.55 * smoothstep(0.1, -0.2, facing));
    col = mix(col, uShade * 0.86, dabs * woods * uTrees * 0.6);

    // Mist pools at the foot of each ridge, which is what sets one behind another.
    float mist = smoothstep(0.2, 0.0, vP.y + (fbm(vec2(x * 2.0, uSeed)) - 0.5) * 0.1);
    col = mix(col, uMist, mist * uMistAmount);

    // Pigment unevenness, as in every other fill.
    col *= 1.0 + (noise(vec2(x * 1.7, vP.y * 5.0 + uSeed)) - 0.5) * 0.08;
    gl_FragColor = vec4(col, uOpacity);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uHorizon, uZenith, uCloud, uCloudShade, uSun;
  uniform float uOpacity, uSunAmount;
  varying vec2 vP;
  varying float vLocal;
  ${NOISE}

  float cloud(vec2 p) {
    return fbm(vec2(p.x * 0.0026, p.y * 4.2)) + 0.25 * fbm(vec2(p.x * 0.011, p.y * 15.0));
  }

  void main() {
    float y = clamp(vP.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.75, y));

    // A low sun, for the end of the day.
    float sun = 1.0 - smoothstep(0.058, 0.064, length(vec2(vLocal / 420.0 + 0.28, (vP.y - 0.2) * 0.9)));
    col = mix(col, uSun, sun * uSunAmount);

    // Flat painted clouds with a shaded underside, in long drifts higher up.
    float edge = (noise(vec2(vP.x * 0.05, vP.y * 60.0)) - 0.5) * 0.03;
    float band = smoothstep(0.12, 0.4, y);
    float c = smoothstep(0.66 + edge, 0.69 + edge, cloud(vP)) * band;
    float lit = smoothstep(0.66 + edge, 0.69 + edge, cloud(vP - vec2(0.0, 0.03)));
    col = mix(col, uCloudShade, c);
    col = mix(col, uCloud, c * lit);

    col *= 1.0 + (noise(vP * vec2(0.004, 6.0)) - 0.5) * 0.05;
    gl_FragColor = vec4(col, uOpacity);
  }
`;

interface Tones {
  lit: number;
  half: number;
  shade: number;
  mist: number;
  grass: number;
}

interface Layer {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Where the sheet stands and how high it reaches, as fractions of the screen's half-height. */
  foot: number;
  peak: number;
  /** How wide the sheet's landforms are, as a multiple of the screen's half-height. */
  breadth: number;
  /** Colour uniforms that shift from day to dusk: name, day colour, dusk colour. */
  shifts: [string, THREE.Color, THREE.Color][];
}

/** One flat sheet, standing from just below its foot (so nothing shows beneath the town) up to its top. */
function sheet(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const W = HALF_WIDTH;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-W, -0.12, 0, W, -0.12, 0, W, 1, 0, -W, -0.12, 0, W, 1, 0, -W, 1, 0]), 3));
  return g;
}

export class Ridge {
  readonly group = new THREE.Group();
  private layers: Layer[] = [];
  private sky: Layer;
  private readonly away = new THREE.Vector3();

  constructor() {
    const geo = sheet();
    const add = (fragment: string, uniforms: Record<string, THREE.IUniform>, foot: number, peak: number, order: number, shifts: Record<string, [number, number]>): Layer => {
      const pairs: [string, THREE.Color, THREE.Color][] = Object.entries(shifts).map(([name, [day, dusk]]) => [name, new THREE.Color(day), new THREE.Color(dusk)]);
      for (const [name, day] of pairs) uniforms[name] = { value: day.clone() };
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: fragment,
        uniforms: { uOffset: { value: 0 }, uOpacity: { value: 1 }, ...uniforms },
        transparent: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, foot, peak, breadth: 1, shifts: pairs };
    };
    const ridge = (seed: number, breadth: number, trees: number, grass: number, mist: number, foot: number, peak: number, order: number, day: Tones, dusk: Tones) => {
      const layer = add(
        RIDGE_FRAG,
        { uSeed: { value: seed }, uScale: { value: 1 }, uTrees: { value: trees }, uGrassAmount: { value: grass }, uMistAmount: { value: mist } },
        foot,
        peak,
        order,
        { uLit: [day.lit, dusk.lit], uHalf: [day.half, dusk.half], uShade: [day.shade, dusk.shade], uMist: [day.mist, dusk.mist], uGrass: [day.grass, dusk.grass] },
      );
      layer.breadth = breadth;
      return layer;
    };

    // Farthest first. Each nearer ridge is lower, darker, greener and more detailed.
    this.sky = add(SKY_FRAG, { uSunAmount: { value: 0 } }, 0.43, 2.6, 0, {
      uHorizon: [0xf1ead6, 0xf9c98f],
      uZenith: [0xc3dbe0, 0xc9a9c4],
      uCloud: [0xfbf6ea, 0xffdcb4],
      uCloudShade: [0xd4d6e2, 0xd99aa6],
      uSun: [0xfff3cf, 0xfff0c8],
    });
    this.layers = [
      ridge(3.1, 1.25, 0, 0, 0.75, 0.4, 0.95, 1,
        { lit: 0xc7d6d6, half: 0xb3c7cb, shade: 0xa1b8c2, mist: 0xe8ece2, grass: 0xc7d6d6 },
        { lit: 0xf0bfa6, half: 0xd9a3aa, shade: 0xbd90ae, mist: 0xf7cf9f, grass: 0xf0bfa6 }),
      ridge(7.7, 0.95, 0.35, 0.15, 0.7, 0.37, 0.8, 2,
        { lit: 0xa6c1ae, half: 0x8aaba3, shade: 0x71959a, mist: 0xd6e2d8, grass: 0xc9c79a },
        { lit: 0xdba08e, half: 0xb8839a, shade: 0x93709f, mist: 0xf0bd9c, grass: 0xe0a987 }),
      ridge(1.2, 0.72, 0.8, 0.5, 0.6, 0.34, 0.66, 3,
        { lit: 0x8fb07c, half: 0x6c9470, shade: 0x4f7a6a, mist: 0xc3d6c4, grass: 0xd6c47c },
        { lit: 0xc98a70, half: 0x9a6f84, shade: 0x6f5a8e, mist: 0xe3ac98, grass: 0xd9a06a }),
      ridge(5.4, 0.5, 1, 0.95, 0.35, 0.31, 0.5, 4,
        { lit: 0xa3b877, half: 0x7d9c66, shade: 0x5a8060, mist: 0xbfd0b2, grass: 0xdcc878 },
        { lit: 0xc98f63, half: 0x966a72, shade: 0x645482, mist: 0xd9a48e, grass: 0xdea463 }),
    ];
    this.group.visible = false;
  }

  /** Call every frame. The mountains show themselves as the camera lowers, and warm toward dusk. */
  update(rig: CameraRig, focus: THREE.Vector3, dusk: number): void {
    const shown = THREE.MathUtils.smoothstep(rig.lowered, 0.35, 0.95);
    this.group.visible = shown > 0.01;
    if (!this.group.visible) return;
    const p = rig.pitch;
    const top = rig.camera.top;
    // Away from the camera, along the ground; and the direction the sheets run across the view.
    this.away.set(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));
    const rightX = Math.cos(rig.yaw), rightZ = -Math.sin(rig.yaw);
    for (const l of [this.sky, ...this.layers]) {
      // In this camera, a point D metres beyond the focus and h metres above it appears
      // D*sin(pitch) + h*cos(pitch) above the middle of the screen. Solve that for where each
      // sheet must stand and how tall it must be to fill its share of the picture.
      const D = (l.foot * top) / Math.sin(p);
      const height = ((l.peak - l.foot) * top) / Math.cos(p);
      l.mesh.position.copy(focus).addScaledVector(this.away, D);
      l.mesh.rotation.y = rig.yaw;
      l.mesh.scale.set(1, height, 1);
      const u = l.mesh.material.uniforms;
      u.uOffset.value = l.mesh.position.x * rightX + l.mesh.position.z * rightZ;
      u.uOpacity.value = shown;
      // Landforms are sized to the view, so a ridge always shows a few peaks across the screen.
      if (u.uScale) u.uScale.value = l.breadth * top;
      for (const [name, day, late] of l.shifts) (u[name].value as THREE.Color).copy(day).lerp(late, dusk);
    }
    this.sky.mesh.material.uniforms.uSunAmount.value = dusk;
  }
}
