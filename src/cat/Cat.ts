import * as THREE from 'three';
import { gouache } from '../style/gouache';
import { P } from '../style/palette';

/** The cat is drawn larger than life so it reads at street scale. */
export const CAT_SCALE = 1.6;

export type DebugPose = 'stand' | 'walk' | 'trot' | 'gallop' | 'sit' | 'loaf' | 'groom';

/**
 * A tuxedo cat, built and animated entirely in code.
 *
 * The body is one continuous skin stretched along a flexible spine. Each leg has the real joints
 * of a cat's leg and is posed backwards from where its paw should be, so a paw on the ground stays
 * where it was put while the body travels over it. Three gaits blend with speed: a walk, a trot
 * and a gallop with a flexing back. The tail has weight and trails behind the movement. At rest the
 * cat sits, settles into a loaf, washes a paw, and looks about.
 *
 * Measurements are in metres for a life-size cat facing +z; the whole rig is then scaled up.
 */

// ---- Anatomy ----
// Proportions are a storybook cat's, not a real one's: a short round body, a big head and stubby legs.
const SHOULDER_Z = 0.082;
const HIP_Z = -0.085;
const SHOULDER_Y = 0.172;
const HIP_Y = 0.186;
const PAW_Y = 0.02;
const UPPER_ARM = 0.07, FOREARM = 0.112;
const THIGH = 0.084, SHANK = 0.088, HOCK = 0.06;
const TAIL_POINTS = 10, TAIL_STEP = 0.034;

// ---- Gaits ----
// Where in the stride each leg steps (left hind, left fore, right hind, right fore), for walk, trot, gallop.
const OFFSETS = [
  [0.0, 0.0, 0.0],
  [0.25, 0.5, 0.5],
  [0.5, 0.5, 0.12],
  [0.75, 1.0, 0.62],
];
/** Share of the stride each paw spends on the ground. */
const DUTY = [0.66, 0.5, 0.32];
/** How far a paw travels along the ground in one step, in world metres. */
const STEP = [0.22, 0.27, 0.34];
const LIFT = [0.028, 0.04, 0.06];
/** The legs go no faster than this many strides a second; beyond it the cat simply flies further. */
const MAX_CADENCE = 4.2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fract = (x: number) => x - Math.floor(x);
const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, x: number) => smooth(clamp((x - a) / (b - a), 0, 1));
const ease = (v: number, target: number, rate: number, dt: number) => lerp(v, target, 1 - Math.exp(-rate * dt));

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _t = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3();

/** A skin stretched round a line of points: the body and the tail are each one of these. */
class Tube {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private nor: Float32Array;

  constructor(private rings: number, private sides: number, material: THREE.Material, colorAt: (ring: number, angle: number) => number) {
    const n = rings * sides;
    this.pos = new Float32Array(n * 3);
    this.nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < sides; s++) {
        c.set(colorAt(r, (s / sides) * Math.PI * 2));
        col.set([c.r, c.g, c.b], (r * sides + s) * 3);
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rings - 1; r++) {
      for (let s = 0; s < sides; s++) {
        const a = r * sides + s, b = r * sides + ((s + 1) % sides), d = a + sides, e = b + sides;
        index.push(a, b, d, b, e, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(index);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** Lays the skin along the points, `rx` wide and `ry` tall at each. */
  update(points: THREE.Vector3[], rx: number[], ry: number[]): void {
    const { rings, sides, pos, nor } = this;
    for (let r = 0; r < rings; r++) {
      _t.subVectors(points[Math.min(r + 1, rings - 1)], points[Math.max(r - 1, 0)]).normalize();
      _side.crossVectors(UP, _t);
      if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
      _side.normalize();
      _up.crossVectors(_t, _side);
      const p = points[r];
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const k = (r * sides + s) * 3;
        pos[k] = p.x + _side.x * ca * rx[r] + _up.x * sa * ry[r];
        pos[k + 1] = p.y + _side.y * ca * rx[r] + _up.y * sa * ry[r];
        pos[k + 2] = p.z + _side.z * ca * rx[r] + _up.z * sa * ry[r];
        const nx = (_side.x * ca) / rx[r] + (_up.x * sa) / ry[r];
        const ny = (_side.y * ca) / rx[r] + (_up.y * sa) / ry[r];
        const nz = (_side.z * ca) / rx[r] + (_up.z * sa) / ry[r];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nor[k] = nx / nl;
        nor[k + 1] = ny / nl;
        nor[k + 2] = nz / nl;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

/**
 * Bends a two-part limb to reach from `joint` to `target`, with its middle joint pushed toward
 * `pole`. Writes the middle joint to `mid` and the point actually reached to `end`.
 */
function reach(joint: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3): void {
  _a.subVectors(target, joint);
  const d = clamp(_a.length(), Math.abs(a - b) + 0.004, a + b - 0.002);
  _a.normalize();
  end.copy(joint).addScaledVector(_a, d);
  const along = (a * a + d * d - b * b) / (2 * d);
  const out = Math.sqrt(Math.max(0, a * a - along * along));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1);
  _b.normalize();
  mid.copy(joint).addScaledVector(_a, along).addScaledVector(_b, out);
}

/** Stands a bone, modelled along +y from its origin, between two points. */
function span(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  mesh.position.copy(from);
  _a.subVectors(to, from).normalize();
  mesh.quaternion.setFromUnitVectors(UP, _a);
}

interface Leg {
  front: boolean;
  side: number;
  offsets: number[];
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  hock: THREE.Mesh | null;
  paw: THREE.Mesh;
  blade: THREE.Mesh;
}

export class Cat {
  readonly root = new THREE.Group();
  private rig = new THREE.Group();
  private body: Tube;
  private tailSkin: Tube;
  private rump: THREE.Mesh;
  private tailTip: THREE.Mesh;
  private head = new THREE.Group();
  private neck = new THREE.Group();
  private legs: Leg[] = [];
  private eyes: THREE.Group[] = [];
  private ears: THREE.Group[] = [];
  private outfits: Record<string, THREE.Group> = {};

  // The spine: six guide points, and the sixteen points the skin is laid along.
  private guide = Array.from({ length: 6 }, () => new THREE.Vector3());
  private spine = Array.from({ length: 16 }, () => new THREE.Vector3());
  private spineRx = new Array<number>(16).fill(0.05);
  private spineRy = new Array<number>(16).fill(0.05);
  // The tail, kept in world space so it trails behind the body's movement.
  private tail = Array.from({ length: TAIL_POINTS }, () => new THREE.Vector3());
  private tailWas = Array.from({ length: TAIL_POINTS }, () => new THREE.Vector3());
  private tailLocal = Array.from({ length: TAIL_POINTS }, () => new THREE.Vector3());
  private tailR = Array.from({ length: TAIL_POINTS }, (_, i) => lerp(0.03, 0.019, i / (TAIL_POINTS - 1)));
  private tailReady = false;

  private time = 0;
  private phase = 0;
  private moving = 0;
  private gait = [1, 0, 0];
  private sit = 0;
  private loaf = 0;
  private groom = 0;
  private idleTime = 0;
  private bend = 0;
  private lean = 0;
  private lastHeading = 0;
  private headYaw = 0;
  private headDip = 0;
  private nextBlink = 2;
  private blinkEnd = 0;
  private nextTwitch = 4;
  private twitchEnd = 0;
  private nextGroom = 9;
  private groomEnd = 0;
  private nextLook = 1;
  private lookGoal = 0;

  /** Forces a pose for style screenshots. */
  debugPose: DebugPose | null = null;
  debugPhase = 0;

  constructor() {
    this.rig.scale.setScalar(CAT_SCALE);
    this.root.add(this.rig);
    const fur = gouache({ vertexColors: true, local: true, painted: true });
    const dark = gouache({ color: P.catBody, local: true, painted: true });
    const white = gouache({ color: P.catWhite, local: true, painted: true });
    const pink = gouache({ color: P.catNose, local: true, painted: true });
    const collarRed = gouache({ color: P.persimmon, local: true, painted: true });
    const brass = gouache({ color: P.brass, local: true, painted: true });
    const iris = gouache({ color: P.catEye, local: true, unlit: true, painted: true });
    const pupil = gouache({ color: P.ink, local: true, unlit: true, painted: true });
    const glint = gouache({ color: P.trim, local: true, unlit: true, painted: true });
    const sphere = new THREE.SphereGeometry(1, 18, 14);
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // Body: charcoal, with a white bib down the chest and along the belly.
    this.body = new Tube(16, 12, fur, (ring, angle) => {
      const underneath = -Math.sin(angle);
      const chest = ring >= 9 && underneath > 0.15 - (ring - 9) * 0.05;
      const belly = ring >= 3 && ring < 9 && underneath > 0.82;
      return chest || belly ? P.catWhite : P.catBody;
    });
    this.rig.add(this.body.mesh);
    this.rump = part(sphere, dark, this.rig);

    // Tail, with a white tip.
    this.tailSkin = new Tube(TAIL_POINTS, 8, fur, (ring) => (ring >= TAIL_POINTS - 2 ? P.catWhite : P.catBody));
    this.rig.add(this.tailSkin.mesh);
    this.tailTip = part(sphere, white, this.rig);

    // Head.
    this.head.scale.setScalar(1.5);
    this.rig.add(this.head);
    part(sphere, dark, this.head, 0, 0, 0, 0.082, 0.074, 0.076);
    for (const s of [-1, 1]) part(sphere, dark, this.head, s * 0.05, -0.022, 0.02, 0.042, 0.038, 0.042);
    part(sphere, white, this.head, 0, -0.026, 0.05, 0.04, 0.029, 0.036);
    part(sphere, white, this.head, 0, -0.045, 0.03, 0.03, 0.022, 0.03);
    part(sphere, pink, this.head, 0, -0.013, 0.085, 0.011, 0.008, 0.008);
    for (const s of [-1, 1]) {
      // Soft round eyes: a wide dark pupil and a small catch-light keep the face friendly.
      const eye = new THREE.Group();
      eye.position.set(s * 0.034, 0.012, 0.06);
      eye.rotation.y = s * 0.32;
      this.head.add(eye);
      part(sphere, iris, eye, 0, 0, 0, 0.021, 0.023, 0.008).castShadow = false;
      part(sphere, pupil, eye, 0, -0.001, 0.004, 0.0145, 0.0168, 0.006).castShadow = false;
      part(sphere, glint, eye, -0.006, 0.007, 0.008, 0.005, 0.005, 0.003).castShadow = false;
      this.eyes.push(eye);

      // Ears that can turn and flatten, with a pink inside.
      const ear = new THREE.Group();
      ear.position.set(s * 0.048, 0.05, -0.006);
      this.head.add(ear);
      part(new THREE.ConeGeometry(0.04, 0.062, 4).translate(0, 0.027, 0), dark, ear).scale.set(1, 1, 0.42);
      const inner = part(new THREE.ConeGeometry(0.024, 0.042, 4).translate(0, 0.022, 0), pink, ear, 0, 0, 0.014);
      inner.scale.set(1, 1, 0.42);
      inner.castShadow = false;
      this.ears.push(ear);

      // Whiskers.
      for (let w = 0; w < 3; w++) {
        const whisker = part(new THREE.BoxGeometry(0.075, 0.0022, 0.0022).translate(0.0375, 0, 0), white, this.head, s * 0.03, -0.024 - w * 0.007, 0.062);
        whisker.rotation.set(0, s > 0 ? -0.25 : Math.PI + 0.25, s * (0.16 - w * 0.16));
        whisker.castShadow = false;
      }
    }

    // Collar and bell, which follow the neck.
    this.rig.add(this.neck);
    part(new THREE.TorusGeometry(0.05, 0.0065, 6, 20), collarRed, this.neck);
    part(sphere, brass, this.neck, 0, -0.054, 0.004, 0.0105);

    // Wardrobe: pieces the cat finds around town. All start put away.
    const navy = gouache({ color: P.navy, local: true, painted: true });
    const yellow = gouache({ color: P.yellow, local: true, painted: true });
    const leaf = gouache({ color: P.leafC, local: true, painted: true });
    const red = gouache({ color: P.oxblood, local: true, painted: true });
    const beret = new THREE.Group();
    beret.position.set(0.014, 0.068, -0.008);
    beret.rotation.set(-0.1, 0, -0.28);
    beret.scale.setScalar(0.86);
    this.head.add(beret);
    part(sphere, navy, beret, 0, 0, 0, 0.066, 0.021, 0.062);
    part(sphere, navy, beret, 0, 0.021, 0, 0.007);

    const glasses = new THREE.Group();
    this.head.add(glasses);
    for (const s of [-1, 1]) part(new THREE.TorusGeometry(0.023, 0.0036, 6, 18), brass, glasses, s * 0.034, 0.012, 0.072).rotation.y = s * 0.32;
    part(new THREE.BoxGeometry(0.024, 0.004, 0.004), brass, glasses, 0, 0.017, 0.08);

    const daisies = new THREE.Group();
    daisies.position.set(0, 0.058, -0.008);
    daisies.rotation.x = Math.PI / 2 + 0.12;
    daisies.scale.setScalar(0.9);
    this.head.add(daisies);
    part(new THREE.TorusGeometry(0.07, 0.016, 6, 18), leaf, daisies);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      part(sphere, white, daisies, Math.cos(a) * 0.082, Math.sin(a) * 0.082, 0, 0.024, 0.024, 0.012);
      part(sphere, yellow, daisies, Math.cos(a) * 0.082, Math.sin(a) * 0.082, 0.008, 0.01);
    }

    const neckerchief = new THREE.Group();
    this.neck.add(neckerchief);
    part(new THREE.TorusGeometry(0.052, 0.011, 6, 16), red, neckerchief, 0, 0, 0.006);
    const flap = part(new THREE.ConeGeometry(0.036, 0.06, 3), red, neckerchief, 0, -0.07, 0.012);
    flap.rotation.set(0, 0, Math.PI);
    flap.scale.z = 0.4;

    this.outfits = { beret, glasses, daisies, neckerchief };
    for (const g of Object.values(this.outfits)) g.visible = false;

    // Legs: dark above, with white socks.
    const bone = (radius: number, length: number, mat: THREE.Material) => part(new THREE.CapsuleGeometry(radius, length, 4, 8).translate(0, length / 2, 0), mat, this.rig);
    const sides = [-1, 1];
    [false, true].forEach((front) => {
      for (const side of sides) {
        this.legs.push({
          front,
          side,
          offsets: OFFSETS[(side > 0 ? 2 : 0) + (front ? 1 : 0)],
          upper: front ? bone(0.036, UPPER_ARM, dark) : bone(0.046, THIGH, dark),
          lower: front ? bone(0.03, FOREARM, dark) : bone(0.032, SHANK, dark),
          hock: front ? null : bone(0.026, HOCK, white),
          paw: part(sphere, white, this.rig, 0, 0, 0, 0.036, 0.022, 0.044),
          blade: part(sphere, dark, this.rig, 0, 0, 0, front ? 0.05 : 0.066, front ? 0.058 : 0.07, front ? 0.054 : 0.074),
        });
      }
    });
    // Order: left hind, left fore, right hind, right fore, matching the gait tables.
    this.legs.sort((p, q) => (p.side - q.side) * 2 + (Number(p.front) - Number(q.front)));
    this.legs.forEach((leg, i) => (leg.offsets = OFFSETS[i]));

    this.update(0, 0);
  }

  /** Put a wardrobe piece on or take it off. */
  wear(item: string, on: boolean): void {
    if (this.outfits[item]) this.outfits[item].visible = on;
  }

  /** Sit down straight away, without the usual wait. */
  sitNow(): void {
    this.idleTime = 8;
  }

  /** speed is ground speed in metres per second. */
  update(dt: number, speed: number): void {
    // A frame's length can come out slightly negative just after loading; never run time backwards.
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    const time = this.time;
    const debug = this.debugPose;
    if (debug) speed = debug === 'walk' ? 0.85 : debug === 'trot' ? 1.9 : debug === 'gallop' ? 5 : 0;
    const isMoving = speed > 0.1;
    this.idleTime = isMoving ? 0 : this.idleTime + dt;
    if (debug === 'sit' || debug === 'groom') this.idleTime = 8;
    if (debug === 'loaf') this.idleTime = 30;
    const snap = debug ? 1000 : 1;

    // ---- How the cat is moving ----
    this.moving = ease(this.moving, isMoving ? 1 : 0, 9 * snap, dt);
    const trot = smoothstep(1.0, 1.6, speed), gallop = smoothstep(2.9, 3.9, speed);
    const want = [(1 - trot) * (1 - gallop), trot * (1 - gallop), gallop];
    for (let i = 0; i < 3; i++) this.gait[i] = ease(this.gait[i], want[i], 7 * snap, dt);
    const total = this.gait[0] + this.gait[1] + this.gait[2] || 1;
    const [gw, gt, gg] = this.gait.map((g) => g / total);
    const mix = (v: number[]) => v[0] * gw + v[1] * gt + v[2] * gg;

    // One stride covers the ground a paw holds, divided by the share of time it holds it. Past
    // the legs' top speed, strides lengthen and the paws spend less of each one on the ground.
    const stepWorld = mix(STEP);
    let duty = mix(DUTY);
    let stride = stepWorld / duty;
    if (speed / stride > MAX_CADENCE) {
      stride = speed / MAX_CADENCE;
      duty = stepWorld / stride;
    }
    this.phase = debug ? this.debugPhase : fract(this.phase + (speed * dt) / stride);
    const phase = this.phase;
    const TAU = Math.PI * 2;
    const m = this.moving;
    const step = stepWorld / CAT_SCALE;
    const lift = mix(LIFT);

    // ---- Resting ----
    this.sit = ease(this.sit, this.idleTime > 3.5 && this.idleTime <= 18 ? 1 : 0, 4.5 * snap, dt);
    this.loaf = ease(this.loaf, this.idleTime > 18 ? 1 : 0, 2.5 * snap, dt);
    if (this.sit > 0.9 && time > this.nextGroom) {
      this.groomEnd = time + 2.8;
      this.nextGroom = time + 11 + Math.random() * 9;
    }
    if (isMoving) this.nextGroom = time + 7;
    this.groom = ease(this.groom, (debug === 'groom' || time < this.groomEnd) && this.sit > 0.5 ? 1 : 0, 6 * snap, dt);
    const sit = this.sit, loaf = this.loaf, groom = this.groom;
    const down = Math.max(sit, loaf);

    // ---- Turning: the body curves into a turn, and leans into it at speed ----
    const heading = this.root.rotation.y;
    const turned = Math.atan2(Math.sin(heading - this.lastHeading), Math.cos(heading - this.lastHeading));
    this.lastHeading = heading;
    const turnRate = dt > 0 ? clamp(turned / dt, -6, 6) : 0;
    this.bend = ease(this.bend, clamp(turnRate * 0.085, -0.42, 0.42) * m, 9, dt);
    this.lean = ease(this.lean, clamp(turnRate * speed * 0.012, -0.22, 0.22), 6, dt);
    const bend = this.bend;
    /** Curves a point round the body's vertical axis, more the nearer the head it is. */
    const curve = (v: THREE.Vector3) => {
      const a = bend * (v.z > 0 ? v.z / 0.25 : (v.z / 0.25) * 0.55);
      const c = Math.cos(a), s = Math.sin(a), x = v.x, z = v.z;
      v.x = x * c + z * s;
      v.z = -x * s + z * c;
      return v;
    };

    // ---- Shoulders and hips ----
    // Each end of the body rises as its own legs push off; in the gallop the back arches and stretches.
    const bob = gw * 0.004 * Math.cos(phase * TAU * 2) + gt * 0.009 * Math.cos(phase * TAU * 2);
    const drive = gg * m;
    const frontLift = drive * 0.03 * Math.sin((phase + 0.52) * TAU);
    const hindLift = drive * 0.034 * Math.sin((phase + 0.02) * TAU);
    const gather = drive * Math.cos((phase + 0.3) * TAU);
    const flight = drive * 0.02 * Math.sin((phase + 0.78) * TAU);
    const breath = Math.sin(time * 1.9) * 0.0035 * (1 - m);
    const crouch = (gt * 0.006 + gg * 0.014) * m;

    let shoulderY = SHOULDER_Y - crouch + bob * m + frontLift + flight;
    let hipY = HIP_Y - crouch - bob * m + hindLift + flight;
    shoulderY = lerp(lerp(shoulderY, 0.17, sit), 0.07, loaf) - groom * 0.01;
    hipY = lerp(lerp(hipY, 0.074, sit), 0.068, loaf);
    const shoulderZ = SHOULDER_Z - gather * 0.016 - sit * 0.012;
    const hipZ = HIP_Z + gather * 0.024 + sit * 0.022;
    const sway = Math.sin(phase * TAU) * 0.007 * m * (gw + gt * 0.5);

    // ---- Spine ----
    const G = this.guide;
    const arch = 0.016 + gather * 0.026 + sit * 0.012 - loaf * 0.008;
    G[1].set(-sway, hipY + 0.05, hipZ);
    G[3].set(sway, shoulderY + 0.06, shoulderZ);
    G[0].set(-sway, hipY + 0.03 - down * 0.02, hipZ - 0.06);
    G[2].set(0, (G[1].y + G[3].y) / 2 + arch, (hipZ + shoulderZ) / 2);
    const neckLift = 0.03 + sit * 0.008 + loaf * 0.01 - gg * m * 0.014;
    G[4].set(sway, G[3].y + neckLift, shoulderZ + 0.055 + gg * m * 0.014);
    G[5].set(sway * 0.5, G[4].y + neckLift * 0.8, shoulderZ + 0.095 + gg * m * 0.024);
    for (const p of G) curve(p);

    // Lay sixteen skin points along a smooth curve through the six guides.
    const RX = [0.06, 0.1, 0.104, 0.098, 0.078, 0.06];
    const RY = [0.064, 0.104, 0.106, 0.104, 0.082, 0.062];
    const haunch = 1 + down * 0.24;
    for (let i = 0; i < 16; i++) {
      const u = (i / 15) * 5;
      const k = Math.min(4, Math.floor(u)), f = u - k;
      const p0 = G[Math.max(k - 1, 0)], p1 = G[k], p2 = G[k + 1], p3 = G[Math.min(k + 2, 5)];
      const f2 = f * f, f3 = f2 * f;
      const s = this.spine[i];
      for (const ax of ['x', 'y', 'z'] as const) {
        s[ax] = 0.5 * (2 * p1[ax] + (p2[ax] - p0[ax]) * f + (2 * p0[ax] - 5 * p1[ax] + 4 * p2[ax] - p3[ax]) * f2 + (3 * p1[ax] - p0[ax] - 3 * p2[ax] + p3[ax]) * f3);
      }
      const wide = u < 2 ? lerp(haunch, 1, clamp(u / 2, 0, 1)) : 1;
      this.spineRx[i] = lerp(RX[k], RX[k + 1], smooth(f)) * wide;
      this.spineRy[i] = lerp(RY[k], RY[k + 1], smooth(f)) * (1 + breath * 4);
    }
    this.body.update(this.spine, this.spineRx, this.spineRy);
    this.rump.position.copy(this.spine[0]);
    this.rump.scale.set(this.spineRx[0], this.spineRy[0], 0.06);
    this.rig.rotation.z = -this.lean;

    // ---- Legs ----
    const joint = _c, target = _d;
    const mid = new THREE.Vector3(), end = new THREE.Vector3(), heel = new THREE.Vector3(), pole = new THREE.Vector3();
    this.legs.forEach((leg) => {
      const { front, side } = leg;
      const p = fract(phase + mix(leg.offsets));
      // On the ground the paw travels straight back under the body; in the air it swings forward.
      let along: number, up = 0, swing = 0;
      if (p < duty) along = lerp(0.5, -0.5, p / duty);
      else {
        swing = (p - duty) / (1 - duty);
        along = lerp(-0.5, 0.5, smooth(swing));
        up = Math.sin(swing * Math.PI);
      }
      const track = (front ? 0.058 : 0.066) * (1 - gg * m * 0.3);
      // The shoulder joint sits ahead of the paw, so the elbow tucks back and the forearm stands upright.
      const centre = front ? shoulderZ - 0.012 : hipZ - 0.01;
      joint.set(side * (front ? 0.058 : 0.064), front ? shoulderY : hipY, front ? shoulderZ + 0.01 : hipZ);
      target.set(side * track, PAW_Y + up * lift * m, centre + along * step * m);

      if (front) {
        // Sitting, the forelegs stand straight; loafing, they fold forward under the chest.
        target.z = lerp(target.z, shoulderZ + 0.1, loaf);
        target.x = lerp(target.x, side * 0.05, loaf);
        if (side > 0 && groom > 0) {
          // Washing: the right paw comes up to the mouth and works in small strokes.
          const lick = Math.sin(time * 9) * 0.012;
          target.x = lerp(target.x, 0.03, groom);
          target.y = lerp(target.y, shoulderY + 0.07 + lick, groom);
          target.z = lerp(target.z, shoulderZ + 0.125, groom);
        }
        curve(joint);
        curve(target);
        pole.set(side * 0.02, 0.02 - loaf * 0.4, -1);
        reach(joint, target, UPPER_ARM, FOREARM, pole, mid, end);
        span(leg.upper, joint, mid);
        span(leg.lower, mid, end);
        leg.paw.position.copy(end).y += 0.002;
        leg.paw.position.z += 0.014;
        leg.blade.position.copy(joint).y += 0.014;
      } else {
        // Sitting or loafing, the hind feet rest flat, forward of the hips, with the knees up beside the body.
        target.x = lerp(target.x, side * 0.095, down);
        target.z = lerp(target.z, hipZ + lerp(0.09, 0.075, loaf), down);
        curve(joint);
        curve(target);
        // The long hind foot: heel high as the paw lifts and trails, flat on the ground at rest.
        const tip = lerp(0.22 + 0.75 * up * m + (p < duty ? (0.5 - along - 0.5) * -0.25 * m : 0), 1.5, down);
        heel.set(target.x, target.y + Math.cos(tip) * HOCK, target.z - Math.sin(tip) * HOCK);
        pole.set(side * (0.1 + down * 0.9), 0.1, 1);
        reach(joint, heel, THIGH, SHANK, pole, mid, end);
        span(leg.upper, joint, mid);
        span(leg.lower, mid, end);
        span(leg.hock!, end, target);
        leg.paw.position.copy(target).y += 0.002;
        leg.paw.position.z += 0.016;
        leg.blade.position.copy(joint).y += 0.004;
        leg.blade.position.x += side * down * 0.012;
      }
      leg.paw.rotation.y = bend * (front ? 0.9 : -0.5);
    });

    // ---- Head and neck ----
    if (time > this.nextLook) {
      this.nextLook = time + 1.5 + Math.random() * 3.5;
      this.lookGoal = (Math.random() - 0.5) * 1.5;
    }
    const looking = (1 - m) * (1 - groom);
    this.headYaw = ease(this.headYaw, bend * 1.3 + this.lookGoal * looking - groom * 0.35, 5, dt);
    this.headDip = ease(this.headDip, groom * 0.55 + gg * m * 0.1 + loaf * 0.06, 6, dt);
    const nod = groom * Math.sin(time * 9) * 0.07;
    this.head.position.copy(G[5]);
    this.head.position.y += 0.03 - groom * 0.012;
    this.head.position.z += 0.05 * Math.cos(bend * 1.2);
    this.head.position.x += 0.05 * Math.sin(bend * 1.2);
    this.head.rotation.set(this.headDip + nod, this.headYaw, -this.lean * 0.5, 'YXZ');

    this.neck.position.copy(this.spine[12]);
    _t.subVectors(this.spine[13], this.spine[11]).normalize();
    this.neck.quaternion.setFromUnitVectors(_a.set(0, 0, 1), _t);
    this.neck.scale.setScalar(this.spineRy[12] / 0.047);

    // ---- Tail ----
    this.swishTail(dt, m, gw + gt, gg, down, heading);

    // ---- Face ----
    if (time > this.nextBlink) {
      this.blinkEnd = time + (loaf > 0.5 ? 0.5 : 0.15);
      this.nextBlink = time + 2.5 + Math.random() * 3;
    }
    const lids = time < this.blinkEnd ? 0.1 : 1 - loaf * 0.35;
    for (const e of this.eyes) e.scale.y = ease(e.scale.y, lids, 40, dt);
    if (time > this.nextTwitch) {
      this.twitchEnd = time + 0.22;
      this.nextTwitch = time + 2.5 + Math.random() * 4;
    }
    const twitch = time < this.twitchEnd ? 0.35 : 0;
    this.ears.forEach((ear, i) => {
      const s = i === 0 ? -1 : 1;
      // Ears swivel now and then, and lie back at a gallop.
      ear.rotation.set(-0.1 - gg * m * 0.75, s * (0.45 + (i === 0 ? twitch : 0)), -s * (0.42 + gg * m * 0.25));
    });
  }

  /** The tail follows its root with a little lag at every joint, settling toward a shape that suits the moment. */
  private swishTail(dt: number, moving: number, stepping: number, galloping: number, down: number, heading: number): void {
    this.rig.updateWorldMatrix(true, false);
    const root = _c.copy(this.spine[0]);
    root.y += 0.012;
    root.z -= 0.022;
    this.rig.localToWorld(root);
    const scale = CAT_SCALE;
    const time = this.time;
    const far = !this.tailReady || this.tail[0].distanceTo(root) > 1.5;
    this.tail[0].copy(root);
    const ch = Math.cos(heading), sh = Math.sin(heading);
    for (let i = 1; i < TAIL_POINTS; i++) {
      const f = i / (TAIL_POINTS - 1);
      // The shape the tail would hold: up with a hooked tip on the move, streaming back at a gallop,
      // low and curved at a stand, wrapped round the feet when resting.
      const carried = lerp(0.75, 1.45, Math.min(1, f * 1.6)) - Math.max(0, f - 0.75) * 2.2;
      const streaming = 0.3 - f * 0.12;
      const hanging = -0.75 + f * 1.25;
      let pitch = lerp(hanging, carried * stepping + streaming * galloping, moving);
      let yaw = Math.sin(time * 1.5 + f * 2.2) * 0.14 * (1 - moving) + Math.sin(this.phase * Math.PI * 2 + f * 2.5) * 0.12 * moving - this.bend * (0.6 + f);
      // A flick of the tip now and then.
      yaw += Math.max(0, Math.sin(time * 0.6)) * Math.sin(time * 6) * 0.22 * f * f * (1 - moving);
      pitch = lerp(pitch, -0.12, down);
      yaw = lerp(yaw, 0.35 + i * 0.3, down);
      const cp = Math.cos(pitch);
      const lx = Math.sin(yaw) * cp, ly = Math.sin(pitch), lz = -Math.cos(yaw) * cp;
      // Into world space, turned by the way the cat faces.
      _a.set(lx * ch + lz * sh, ly, -lx * sh + lz * ch).multiplyScalar(TAIL_STEP * scale).add(this.tail[i - 1]);
      if (far) {
        this.tail[i].copy(_a);
        this.tailWas[i].copy(_a);
        continue;
      }
      // Keep some of the last frame's motion, then be drawn toward the resting shape: stiff at the root, loose at the tip.
      _b.subVectors(this.tail[i], this.tailWas[i]).multiplyScalar(0.82);
      this.tailWas[i].copy(this.tail[i]);
      this.tail[i].add(_b).lerp(_a, 1 - Math.exp(-lerp(26, 9, f) * dt));
      // Each joint stays a fixed length from the one before.
      _b.subVectors(this.tail[i], this.tail[i - 1]).setLength(TAIL_STEP * scale);
      this.tail[i].copy(this.tail[i - 1]).add(_b);
    }
    this.tailReady = true;
    for (let i = 0; i < TAIL_POINTS; i++) {
      this.rig.worldToLocal(this.tailLocal[i].copy(this.tail[i]));
      this.tailLocal[i].y = Math.max(this.tailLocal[i].y, this.tailR[i] + 0.002);
    }
    this.tailSkin.update(this.tailLocal, this.tailR, this.tailR);
    this.tailTip.position.copy(this.tailLocal[TAIL_POINTS - 1]);
    this.tailTip.scale.setScalar(this.tailR[TAIL_POINTS - 1]);
  }
}
