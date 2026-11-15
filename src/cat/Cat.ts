import * as THREE from 'three';
import { gouache } from '../style/gouache';
import { P } from '../style/palette';

/** The cat is drawn larger than life so it reads at street scale. */
export const CAT_SCALE = 1.6;

const HIP_HEIGHT = 0.245;
const UPPER = 0.105;
const LOWER = 0.1;
const TAIL_SEGMENTS = 6;

interface Leg {
  upper: THREE.Group;
  lower: THREE.Group;
  front: boolean;
  /** Where in the stride this leg steps, for the walk and for the trot. */
  walkOffset: number;
  trotOffset: number;
}

export type DebugPose = 'stand' | 'walk' | 'trot' | 'sit';

const fract = (x: number) => x - Math.floor(x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const approach = (v: number, target: number, rate: number, dt: number) => lerp(v, target, 1 - Math.exp(-rate * dt));

/**
 * A stylized tuxedo cat built from simple painted forms and animated in code.
 * Poses update only a few times a second, like stop-motion, which suits the print look.
 */
export class Cat {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private head = new THREE.Group();
  private legs: Leg[] = [];
  private tail: THREE.Group[] = [];
  private eyes: THREE.Group[] = [];
  private ears: THREE.Mesh[] = [];
  private outfits: Record<string, THREE.Group> = {};

  private phase = 0;
  private time = 0;
  private stepClock = 1;
  private move = 0;
  private trot = 0;
  private sit = 0;
  private idleTime = 0;
  private nextBlink = 2;
  private blinkEnd = 0;
  private nextTwitch = 4;
  private twitchEnd = 0;

  /** Forces a pose for style screenshots. */
  debugPose: DebugPose | null = null;
  debugPhase = 0;

  constructor() {
    // The cat is always in full colour: it is what brings colour to the town.
    const body = gouache({ color: P.catBody, local: true, painted: true });
    const white = gouache({ color: P.catWhite, local: true, painted: true });
    const collar = gouache({ color: P.persimmon, local: true, painted: true });
    const brass = gouache({ color: P.brass, local: true, painted: true });
    const iris = gouache({ color: P.catEye, local: true, unlit: true, painted: true });
    const pupil = gouache({ color: P.ink, local: true, unlit: true, painted: true });
    const glint = gouache({ color: P.trim, local: true, unlit: true, painted: true });
    const nose = gouache({ color: P.catNose, local: true, painted: true });

    const rig = new THREE.Group();
    rig.scale.setScalar(CAT_SCALE);
    this.root.add(rig);
    rig.add(this.hips);

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
    part(sphere, body, this.hips, 0, 0.005, 0.12, 0.093, 0.09, 0.175);
    part(sphere, body, this.hips, 0, 0, 0.225, 0.094, 0.096, 0.09);
    part(sphere, body, this.hips, 0, 0.002, 0.0, 0.1, 0.1, 0.1);
    part(sphere, white, this.hips, 0, -0.04, 0.282, 0.062, 0.07, 0.042);

    // Head.
    this.head.position.set(0, 0.085, 0.335);
    this.head.scale.setScalar(1.18);
    this.hips.add(this.head);
    part(sphere, body, this.head, 0, 0, 0, 0.08, 0.071, 0.073);
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
      const ear = part(new THREE.ConeGeometry(0.04, 0.085, 4), body, this.head, s * 0.047, 0.072, -0.006);
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

    this.outfits = { beret, glasses, daisies };
    for (const g of Object.values(this.outfits)) g.visible = false;

    // Tail: a chain of segments, each bending a little from the last.
    let parent: THREE.Object3D = this.hips;
    const segLen = 0.062;
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const seg = new THREE.Group();
      if (i === 0) seg.position.set(0, 0.04, -0.075);
      else seg.position.set(0, 0, -segLen);
      parent.add(seg);
      const r = lerp(0.024, 0.014, i / (TAIL_SEGMENTS - 1));
      const geo = new THREE.CapsuleGeometry(r, segLen, 4, 8).rotateX(Math.PI / 2).translate(0, 0, -segLen / 2);
      part(geo, i === TAIL_SEGMENTS - 1 ? white : body, seg, 0, 0, 0);
      this.tail.push(seg);
      parent = seg;
    }

    // Legs with white socks.
    const makeLeg = (front: boolean, side: number, walkOffset: number, trotOffset: number) => {
      const upper = new THREE.Group();
      upper.position.set(side * (front ? 0.05 : 0.058), -0.02, front ? 0.25 : 0.0);
      this.hips.add(upper);
      const ru = front ? 0.027 : 0.036;
      part(new THREE.CapsuleGeometry(ru, UPPER - ru, 4, 8).translate(0, -UPPER / 2, 0), body, upper, 0, 0, 0);
      const lower = new THREE.Group();
      lower.position.y = -UPPER;
      upper.add(lower);
      part(new THREE.CapsuleGeometry(0.021, LOWER - 0.02, 4, 8).translate(0, -LOWER / 2, 0), white, lower, 0, 0, 0);
      part(sphere, white, lower, 0, -LOWER - 0.004, 0.012, 0.027, 0.019, 0.035);
      this.legs.push({ upper, lower, front, walkOffset, trotOffset });
    };
    makeLeg(false, -1, 0.0, 0.0);
    makeLeg(true, -1, 0.25, 0.5);
    makeLeg(false, 1, 0.5, 0.5);
    makeLeg(true, 1, 0.75, 0.0);

    this.pose();
  }

  /** Put a wardrobe piece on or take it off. */
  wear(item: string, on: boolean): void {
    if (this.outfits[item]) this.outfits[item].visible = on;
  }

  /** Sit down straight away, without the usual wait. */
  sitNow(): void {
    this.idleTime = 10;
  }

  /** speed is ground speed in metres per second. */
  update(dt: number, speed: number): void {
    this.time += dt;
    const moving = speed > 0.15;
    this.idleTime = moving ? 0 : this.idleTime + dt;

    this.move = approach(this.move, moving ? 1 : 0, 10, dt);
    this.trot = approach(this.trot, speed > 2.6 ? 1 : 0, 6, dt);
    this.sit = approach(this.sit, this.idleTime > 3.5 ? 1 : 0, 5, dt);

    // Stride length grows with speed, so the paws roughly keep their grip on the ground.
    const stride = lerp(0.62, 1.15, this.trot) * CAT_SCALE;
    this.phase = fract(this.phase + (speed * dt) / stride);

    if (this.debugPose) {
      this.move = this.debugPose === 'walk' || this.debugPose === 'trot' ? 1 : 0;
      this.trot = this.debugPose === 'trot' ? 1 : 0;
      this.sit = this.debugPose === 'sit' ? 1 : 0;
      this.phase = this.debugPhase;
    }

    // Hold each pose for a beat: twelve a second on the move, eight at rest.
    this.stepClock += dt;
    const interval = 1 / (this.move > 0.5 ? 12 : 8);
    if (this.stepClock >= interval) {
      this.stepClock = 0;
      this.pose();
    }
  }

  private pose(): void {
    const { move, trot, sit, phase, time } = this;
    const stand = 1 - sit;
    const TAU = Math.PI * 2;

    const bob = Math.sin(phase * TAU * 2) * 0.006 * move;
    const breath = Math.sin(time * 1.8) * 0.003 * (1 - move);
    this.hips.position.set(0, lerp(HIP_HEIGHT, 0.118, sit) + bob + breath, lerp(-0.12, -0.16, sit));
    this.hips.rotation.set(-0.66 * sit, 0, Math.sin(phase * TAU) * 0.04 * move);

    const swingAmp = lerp(0.42, 0.68, trot);
    const stanceShare = lerp(0.62, 0.5, trot);
    for (const leg of this.legs) {
      const p = fract(phase + lerp(leg.walkOffset, leg.trotOffset, trot));
      let swing: number;
      let lift = 0;
      if (p < stanceShare) {
        swing = lerp(-swingAmp, swingAmp, p / stanceShare);
      } else {
        const q = (p - stanceShare) / (1 - stanceShare);
        swing = lerp(swingAmp, -swingAmp, smooth(q));
        lift = Math.sin(q * Math.PI);
      }
      const walkUpper = (swing - lift * 0.35) * move;
      const walkLower = lift * lerp(0.9, 1.25, trot) * move;
      if (leg.front) {
        // Sitting: front legs stay upright under the raised chest.
        leg.upper.rotation.x = walkUpper * stand + 0.66 * sit;
        leg.lower.rotation.x = walkLower * stand;
      } else {
        // Sitting: haunches fold, feet tucked forward.
        leg.upper.rotation.x = walkUpper * stand - 0.75 * sit;
        leg.lower.rotation.x = walkLower * stand + 1.95 * sit;
      }
    }

    // Head stays level and looks about a little at rest.
    const look = Math.sin(time * 0.6) * 0.35 * (1 - move);
    this.head.rotation.set(0.58 * sit - bob * 4 + Math.sin(time * 0.9) * 0.04 * (1 - move), look, 0);

    // Tail: carried high with a hooked tip on the move, low and swaying at rest, wrapped round when sitting.
    for (let i = 0; i < this.tail.length; i++) {
      const seg = this.tail[i];
      const tip = i >= this.tail.length - 2;
      const walkX = i === 0 ? 0.9 : tip ? -0.38 : 0.1;
      const restX = i === 0 ? -0.5 : 0.15;
      const sitX = i === 0 ? 0.62 : 0.02;
      const standX = lerp(restX, walkX, move);
      const sway = Math.sin(phase * TAU + i * 0.7) * 0.1 * move + Math.sin(time * 1.3 + i * 0.6) * 0.09 * (1 - move);
      const flick = tip ? Math.sin(time * 5.5) * 0.25 * Math.max(0, Math.sin(time * 0.7)) * (1 - move) : 0;
      seg.rotation.set(lerp(standX, sitX, sit), lerp(sway + flick, i === 0 ? 0.5 : 0.52, sit), 0);
    }

    // Blink and ear twitch on their own slow clocks.
    if (time > this.nextBlink) {
      this.blinkEnd = time + 0.16;
      this.nextBlink = time + 2.5 + Math.random() * 3;
    }
    for (const e of this.eyes) e.scale.y = time < this.blinkEnd ? 0.12 : 1;
    if (time > this.nextTwitch) {
      this.twitchEnd = time + 0.2;
      this.nextTwitch = time + 3 + Math.random() * 4;
    }
    const twitch = time < this.twitchEnd ? 0.3 : 0;
    this.ears.forEach((ear, i) => (ear.rotation.z = (i === 0 ? 1 : -1) * (0.24 + (i === 0 ? twitch : 0))));
  }
}
