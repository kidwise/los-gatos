import * as THREE from 'three';

const YAW = Math.PI / 4;
const PITCH = THREE.MathUtils.degToRad(35);
const DISTANCE = 900;

/** Tilted diorama camera that follows a point and zooms between street level and an overview. */
export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2600);
  /** Metres visible across the shorter side of the screen. */
  span = 10;
  /** The width actually on screen, which eases toward `span`. */
  private shown = 10;
  readonly minSpan = 4.5;
  maxSpan = 70;
  private target = new THREE.Vector3();
  private aspect = 1;
  /** Compass direction the camera looks from. It only changes to show something off at a sketch spot. */
  yaw = YAW;
  private yawGoal = YAW;
  /** How steeply the camera looks down. It only lowers at a lookout, to show the mountains. */
  pitch = PITCH;
  private pitchGoal = PITCH;
  private lowest = PITCH;
  private readonly offset = new THREE.Vector3();

  resize(aspect: number): void {
    this.aspect = aspect;
    this.applySpan();
  }

  zoomBy(factor: number): void {
    this.span = THREE.MathUtils.clamp(this.span * factor, this.minSpan, this.maxSpan);
    this.applySpan();
  }

  snapTo(focus: THREE.Vector3): void {
    this.shown = this.span;
    this.applySpan();
    this.target.copy(focus);
    this.place();
  }

  /** Swing round to look from another direction, or back to the usual one. */
  turnTo(yaw: number | null): void {
    this.yawGoal = yaw ?? YAW;
  }

  /** Lower the camera toward the horizon, or return it to its usual angle. */
  tiltTo(pitch: number | null): void {
    this.pitchGoal = pitch ?? PITCH;
    if (pitch !== null) this.lowest = pitch;
  }

  /** How far the camera has lowered toward its lookout angle, from 0 to 1. */
  get lowered(): number {
    return this.lowest < PITCH ? THREE.MathUtils.clamp((PITCH - this.pitch) / (PITCH - this.lowest), 0, 1) : 0;
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.pitch += (this.pitchGoal - this.pitch) * (1 - Math.exp(-2.2 * dt));
    if (Math.abs(this.span - this.shown) > 0.001) {
      this.shown += (this.span - this.shown) * (1 - Math.exp(-9 * dt));
      this.applySpan();
    }
    const turn = Math.atan2(Math.sin(this.yawGoal - this.yaw), Math.cos(this.yawGoal - this.yaw));
    this.yaw += turn * (1 - Math.exp(-2.6 * dt));
    this.target.lerp(focus, 1 - Math.exp(-5 * dt));
    this.place();
  }

  /** Ground directions for "screen right" and "screen up", for keyboard movement. */
  groundAxes(right: THREE.Vector3, up: THREE.Vector3): void {
    right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    up.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  private place(): void {
    this.offset.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(DISTANCE);
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }

  private applySpan(): void {
    const h = this.aspect >= 1 ? this.shown : this.shown / this.aspect;
    const w = h * this.aspect;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
  }
}
