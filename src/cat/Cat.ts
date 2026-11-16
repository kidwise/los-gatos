import * as THREE from 'three';
import { gouache } from '../style/gouache';
import { P } from '../style/palette';

/** The cat is drawn larger than life so it reads at street scale. */
export const CAT_SCALE = 1.6;

export type DebugPose = 'stand' | 'walk' | 'trot' | 'gallop' | 'sit' | 'loaf' | 'groom';

/**
 * A stylized tuxedo cat built from simple painted forms and animated in code.
 *
 * The shapes are deliberately plain and elegant: a body of three rounded forms, a small head, slim
 * straight legs with white socks, and a tapering tail. The movement is where the care goes. Each
 * leg is posed backwards from where its paw should be, so a paw on the ground stays where it was
 * put while the body travels over it. Three gaits blend with speed: a walk, a trot and a gallop.
 * The tail has weight and trails behind the movement. At rest the cat sits, settles into a loaf,
 * washes a paw, and looks about.
 *
 * Measurements are in metres for a life-size cat facing +z; the whole rig is then scaled up.
 */

// ---- Anatomy (the original cat's) ----
const HIP_HEIGHT = 0.245;
const UPPER = 0.105;
const LOWER = 0.1;
const PAW_Y = 0.022;
const TAIL_SEGMENTS = 6;
const TAIL_STEP = 0.062;
/** Where the legs join the body, measured from the hip joint. */
const FRONT_JOINT = { x: 0.05, y: -0.02, z: 0.25 };
const HIND_JOINT = { x: 0.058, y: -0.02, z: 0.0 };

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
const STEP = [0.21, 0.27, 0.33];
const LIFT = [0.03, 0.04, 0.055];
/** How far the body sinks to give the legs room to stride. */
const CROUCH = [0.014, 0.02, 0.03];
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

/**
 * Bends a two-part limb to reach from `joint` to `target`, with its middle joint pushed toward
 * `pole`. Writes the middle joint to `mid` and the point actually reached to `end`.
 */
function reach(joint: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3): void {
  _a.subVectors(target, joint);
  const d = clamp(_a.length(), Math.abs(a - b) + 0.004, a + b - 0.0005);
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
  paw: THREE.Mesh;
}

export class Cat {
  readonly root = new THREE.Group();
  private rig = new THREE.Group();
  /** The body block: torso, head, collar and wardrobe move together, as on the original cat. */
  private hips = new THREE.Group();
  private head = new THREE.Group();
  private legs: Leg[] = [];
  private tailBones: THREE.Mesh[] = [];
  private eyes: THREE.Group[] = [];
  private ears: THREE.Mesh[] = [];
  private outfits: Record<string, THREE.Group> = {};

  // The tail, kept in world space so it trails behind the body's movement.
  private tail = Array.from({ length: TAIL_SEGMENTS + 1 }, () => new THREE.Vector3());
  private tailWas = Array.from({ length: TAIL_SEGMENTS + 1 }, () => new THREE.Vector3());
  private tailLocal = Array.from({ length: TAIL_SEGMENTS + 1 }, () => new THREE.Vector3());
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
    // The cat is always in full colour: it is what brings colour to the town.
    const dark = gouache({ color: P.catBody, local: true, painted: true });
    const white = gouache({ color: P.catWhite, local: true, painted: true });
    const collar = gouache({ color: P.persimmon, local: true, painted: true });
    const brass = gouache({ color: P.brass, local: true, painted: true });
    const iris = gouache({ color: P.catEye, local: true, unlit: true, painted: true });
    const pupil = gouache({ color: P.ink, local: true, unlit: true, painted: true });
    const glint = gouache({ color: P.trim, local: true, unlit: true, painted: true });
    const nose = gouache({ color: P.catNose, local: true, painted: true });

    this.rig.scale.setScalar(CAT_SCALE);
    this.root.add(this.rig);
    this.rig.add(this.hips);

    const sphere = new THREE.SphereGeometry(1, 18, 14);
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // Torso, measured from the hip joint with +z forward.
    part(sphere, dark, this.hips, 0, 0.005, 0.12, 0.093, 0.09, 0.175);
    part(sphere, dark, this.hips, 0, 0, 0.225, 0.094, 0.096, 0.09);
    part(sphere, dark, this.hips, 0, 0.002, 0.0, 0.1, 0.1, 0.1);
    part(sphere, white, this.hips, 0, -0.04, 0.282, 0.062, 0.07, 0.042);

    // Head.
    this.head.position.set(0, 0.085, 0.335);
    this.head.scale.setScalar(1.18);
    this.hips.add(this.head);
    part(sphere, dark, this.head, 0, 0, 0, 0.08, 0.071, 0.073);
    part(sphere, white, this.head, 0, -0.024, 0.048, 0.04, 0.03, 0.036);
    part(sphere, nose, this.head, 0, -0.012, 0.083, 0.01, 0.008, 0.008);
    for (const s of [-1, 1]) {
      // Soft round eyes: a wide dark pupil and a small catch-light keep the face friendly.
      const eye = new THREE.Group();
      eye.position.set(s * 0.034, 0.012, 0.06);
      eye.rotation.y = s * 0.32;
      this.head.add(eye);
      part(sphere, iris, eye, 0, 0, 0, 0.019, 0.02, 0.008).castShadow = false;
      part(sphere, pupil, eye, 0, -0.001, 0.004, 0.0125, 0.0145, 0.006).castShadow = false;
      part(sphere, glint, eye, -0.005, 0.006, 0.008, 0.0042, 0.0042, 0.003).castShadow = false;
      this.eyes.push(eye);
      const ear = part(new THREE.ConeGeometry(0.04, 0.085, 4), dark, this.head, s * 0.047, 0.072, -0.006);
      ear.rotation.set(-0.12, s * 0.5, -s * 0.24);
      this.ears.push(ear);
    }
    const band = part(new THREE.TorusGeometry(0.068, 0.014, 6, 16), collar, this.hips, 0, 0.034, 0.275);
    band.rotation.x = Math.PI / 2 - 0.55;
    part(sphere, brass, this.hips, 0, -0.036, 0.318, 0.016);

    // Wardrobe: pieces the cat finds around town. All start put away.
    const navy = gouache({ color: P.navy, local: true, painted: true });
    const yellow = gouache({ color: P.yellow, local: true, painted: true });
    const beret = new THREE.Group();
    beret.position.set(0.014, 0.068, -0.008);
    beret.rotation.set(-0.1, 0, -0.28);
    this.head.add(beret);
    part(sphere, navy, beret, 0, 0, 0, 0.066, 0.021, 0.062);
    part(sphere, navy, beret, 0, 0.021, 0, 0.007);

    const glasses = new THREE.Group();
    this.head.add(glasses);
    for (const s of [-1, 1]) part(new THREE.TorusGeometry(0.023, 0.0036, 6, 18), brass, glasses, s * 0.034, 0.012, 0.072).rotation.y = s * 0.32;
    part(new THREE.BoxGeometry(0.024, 0.004, 0.004), brass, glasses, 0, 0.017, 0.08);

    const daisies = new THREE.Group();
    // Worn as a crown round the ears, where it shows from every side.
    daisies.position.set(0, 0.05, -0.004);
    daisies.rotation.x = Math.PI / 2 + 0.12;
    daisies.scale.setScalar(0.9);
    this.head.add(daisies);
    const leaf = gouache({ color: P.leafC, local: true, painted: true });
    part(new THREE.TorusGeometry(0.07, 0.016, 6, 18), leaf, daisies, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      part(sphere, white, daisies, Math.cos(a) * 0.082, Math.sin(a) * 0.082, 0, 0.024, 0.024, 0.012);
      part(sphere, yellow, daisies, Math.cos(a) * 0.082, Math.sin(a) * 0.082, 0.008, 0.01);
    }

    const red = gouache({ color: P.oxblood, local: true, painted: true });
    const neckerchief = new THREE.Group();
    neckerchief.position.set(0, 0.034, 0.275);
    neckerchief.rotation.x = Math.PI / 2 - 0.55;
    this.hips.add(neckerchief);
    part(new THREE.TorusGeometry(0.07, 0.02, 6, 16), red, neckerchief, 0, 0, 0);
    const flap = part(new THREE.ConeGeometry(0.062, 0.1, 3), red, neckerchief, 0, 0.085, 0.03);
    flap.rotation.set(-0.4, 0, Math.PI);
    flap.scale.z = 0.35;

    this.outfits = { beret, glasses, daisies, neckerchief };
    for (const g of Object.values(this.outfits)) g.visible = false;

    // Tail: a chain of tapering segments with a white tip.
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const r = lerp(0.024, 0.014, i / (TAIL_SEGMENTS - 1));
      const geo = new THREE.CapsuleGeometry(r, TAIL_STEP, 4, 8).translate(0, TAIL_STEP / 2, 0);
      this.tailBones.push(part(geo, i === TAIL_SEGMENTS - 1 ? white : dark, this.rig, 0, 0, 0));
    }

    // Legs with white socks. Order: left hind, left fore, right hind, right fore, matching the gait tables.
    const bone = (radius: number, length: number, mat: THREE.Material) => part(new THREE.CapsuleGeometry(radius, length - radius, 4, 8).translate(0, length / 2, 0), mat, this.rig, 0, 0, 0);
    for (const side of [-1, 1]) {
      for (const front of [false, true]) {
        this.legs.push({
          front,
          side,
          offsets: OFFSETS[this.legs.length],
          upper: bone(front ? 0.027 : 0.036, UPPER, dark),
          lower: bone(0.021, LOWER, white),
          paw: part(sphere, white, this.rig, 0, 0, 0, 0.027, 0.019, 0.035),
        });
      }
    }

    this.update(0, 0);
  }

  /** Put a wardrobe piece on or take it off. */
  wear(item: string, on: boolean): void {
    if (this.outfits[item]) this.outfits[item].visible = on;
  }

  /** How settled the cat is, from 0 (up and about) to 1 (sitting or loafing). */
  get resting(): number {
    return Math.max(this.sit, this.loaf);
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

    // ---- The body block ----
    // It sinks a little to give the legs room, bobs with the step, and at a gallop rocks and bounds.
    const drive = gg * m;
    const bob = (gw * 0.004 + gt * 0.008) * Math.cos(phase * TAU * 2) * m;
    const bound = drive * 0.022 * Math.sin((phase + 0.78) * TAU);
    const rock = drive * 0.13 * Math.sin((phase + 0.3) * TAU);
    const stretch = drive * 0.05 * Math.cos((phase + 0.3) * TAU);
    const breath = Math.sin(time * 1.8) * 0.003 * (1 - m);
    const standing = HIP_HEIGHT - mix(CROUCH) * m + bob + bound + breath;
    const hips = this.hips;
    hips.position.set(0, lerp(lerp(standing, 0.118, sit), 0.098, loaf), lerp(lerp(-0.12, -0.16, sit), -0.13, loaf));
    hips.rotation.set(lerp(lerp(rock, -0.66, sit), -0.04, loaf), 0, Math.sin(phase * TAU) * 0.035 * m * (gw + gt) - this.lean);
    hips.scale.set(1, 1, 1 - stretch);
    hips.updateMatrix();

    // ---- Legs ----
    const joint = _c, target = _d;
    const mid = new THREE.Vector3(), end = new THREE.Vector3(), pole = new THREE.Vector3();
    for (const leg of this.legs) {
      const { front, side } = leg;
      const p = fract(phase + mix(leg.offsets));
      // On the ground the paw travels straight back under the body; in the air it swings forward.
      let along: number, up = 0;
      if (p < duty) along = lerp(0.5, -0.5, p / duty);
      else {
        const swing = (p - duty) / (1 - duty);
        along = lerp(-0.5, 0.5, smooth(swing));
        up = Math.sin(swing * Math.PI);
      }
      const J = front ? FRONT_JOINT : HIND_JOINT;
      joint.set(side * J.x, J.y, J.z).applyMatrix4(hips.matrix);
      // The paw's place on the ground, under where the leg joins a standing body.
      const home = -0.12 + J.z;
      target.set(side * J.x, PAW_Y + up * lift * m, home + along * step * m);
      // Paws step toward the inside of a turn.
      target.x += bend * (front ? 0.05 : -0.03);

      if (front) {
        // Loafing, the forelegs fold forward under the chest.
        target.z = lerp(target.z, home + 0.07, loaf);
        if (side > 0 && groom > 0) {
          // Washing: the right paw comes up to the mouth and works in small strokes.
          const lick = Math.sin(time * 9) * 0.012;
          this.head.getWorldPosition(_b);
          this.rig.worldToLocal(_b);
          target.x = lerp(target.x, _b.x + 0.022, groom);
          target.y = lerp(target.y, _b.y - 0.07 + lick, groom);
          target.z = lerp(target.z, _b.z + 0.045, groom);
        }
        pole.set(side * 0.05, 0.05 - loaf * 0.5, -1);
      } else {
        // Sitting or loafing, the hind feet rest forward of the hips with the knees up beside the body.
        target.x = lerp(target.x, side * 0.085, down);
        target.z = lerp(target.z, lerp(home + 0.03, home + 0.1, sit), down);
        pole.set(side * down * 1.2, 0.2, 1);
      }
      reach(joint, target, UPPER, LOWER, pole, mid, end);
      span(leg.upper, joint, mid);
      span(leg.lower, mid, end);
      leg.paw.position.set(end.x, end.y - 0.004, end.z + 0.012);
    }

    // ---- Head ----
    // It stays level whatever the body does, turns into a turn, and looks about at rest.
    if (time > this.nextLook) {
      this.nextLook = time + 1.5 + Math.random() * 3.5;
      this.lookGoal = (Math.random() - 0.5) * 1.4;
    }
    const looking = (1 - m) * (1 - groom);
    this.headYaw = ease(this.headYaw, bend * 1.6 + this.lookGoal * looking - groom * 0.3, 5, dt);
    this.headDip = ease(this.headDip, groom * 0.5 + drive * 0.06 + loaf * 0.05, 6, dt);
    const nod = groom * Math.sin(time * 9) * 0.07;
    this.head.rotation.set(-hips.rotation.x * 0.88 + this.headDip + nod - bob * 3, this.headYaw, hips.rotation.z * -0.7, 'YXZ');

    // ---- Tail ----
    this.swishTail(dt, m, gw + gt, gg, down, this.root.rotation.y);

    // ---- Face ----
    if (time > this.nextBlink) {
      this.blinkEnd = time + (loaf > 0.5 ? 0.5 : 0.16);
      this.nextBlink = time + 2.5 + Math.random() * 3;
    }
    const lids = time < this.blinkEnd ? 0.12 : 1 - loaf * 0.35;
    for (const e of this.eyes) e.scale.y = ease(e.scale.y, lids, 40, dt);
    if (time > this.nextTwitch) {
      this.twitchEnd = time + 0.2;
      this.nextTwitch = time + 3 + Math.random() * 4;
    }
    const twitch = time < this.twitchEnd ? 0.3 : 0;
    this.ears.forEach((ear, i) => {
      const s = i === 0 ? -1 : 1;
      // Ears swivel now and then, and lie back at a gallop.
      ear.rotation.set(-0.12 - drive * 0.3, s * 0.5, -s * (0.24 + (i === 0 ? twitch : 0) + drive * 0.12));
    });
  }

  /** The tail follows its root with a little lag at every joint, settling toward a shape that suits the moment. */
  private swishTail(dt: number, moving: number, stepping: number, galloping: number, down: number, heading: number): void {
    this.rig.updateWorldMatrix(true, false);
    const root = _c.set(0, 0.04, -0.075).applyMatrix4(this.hips.matrix);
    this.rig.localToWorld(root);
    const time = this.time;
    const far = !this.tailReady || this.tail[0].distanceTo(root) > 1.5;
    this.tail[0].copy(root);
    const ch = Math.cos(heading), sh = Math.sin(heading);
    for (let i = 1; i <= TAIL_SEGMENTS; i++) {
      const f = i / TAIL_SEGMENTS;
      // The shape the tail would hold: up with a hooked tip on the move, streaming back at a gallop,
      // low and curved at a stand, wrapped round the feet when resting.
      const carried = lerp(0.85, 1.45, Math.min(1, f * 1.5)) - Math.max(0, f - 0.7) * 2.0;
      const streaming = 0.32 - f * 0.12;
      const hanging = -0.5 + f * 1.05;
      let pitch = lerp(hanging, carried * stepping + streaming * galloping, moving);
      let yaw = Math.sin(time * 1.3 + f * 2.2) * 0.14 * (1 - moving) + Math.sin(this.phase * Math.PI * 2 + f * 2.5) * 0.12 * moving - this.bend * (0.6 + f);
      // A flick of the tip now and then.
      yaw += Math.max(0, Math.sin(time * 0.7)) * Math.sin(time * 5.5) * 0.25 * f * f * (1 - moving);
      pitch = lerp(pitch, -0.1, down);
      yaw = lerp(yaw, 0.3 + i * 0.5, down);
      const cp = Math.cos(pitch);
      const lx = Math.sin(yaw) * cp, ly = Math.sin(pitch), lz = -Math.cos(yaw) * cp;
      // Into world space, turned by the way the cat faces.
      _a.set(lx * ch + lz * sh, ly, -lx * sh + lz * ch).multiplyScalar(TAIL_STEP * CAT_SCALE).add(this.tail[i - 1]);
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
      _b.subVectors(this.tail[i], this.tail[i - 1]).setLength(TAIL_STEP * CAT_SCALE);
      this.tail[i].copy(this.tail[i - 1]).add(_b);
    }
    this.tailReady = true;
    for (let i = 0; i <= TAIL_SEGMENTS; i++) {
      this.rig.worldToLocal(this.tailLocal[i].copy(this.tail[i]));
      this.tailLocal[i].y = Math.max(this.tailLocal[i].y, 0.02);
    }
    for (let i = 0; i < TAIL_SEGMENTS; i++) span(this.tailBones[i], this.tailLocal[i], this.tailLocal[i + 1]);
  }
}
