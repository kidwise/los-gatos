import * as THREE from 'three';

const YAW = Math.PI / 4;
const PITCH = THREE.MathUtils.degToRad(35);
const DISTANCE = 140;

/** Tilted diorama camera that follows a point and zooms between street level and an overview. */
export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  /** Metres visible across the shorter side of the screen. */
  span = 10;
  readonly minSpan = 4.5;
  readonly maxSpan = 70;
  private target = new THREE.Vector3();
  private aspect = 1;
  private readonly offset = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH)).multiplyScalar(DISTANCE);

  resize(aspect: number): void {
    this.aspect = aspect;
    this.applySpan();
  }

  zoomBy(factor: number): void {
    this.span = THREE.MathUtils.clamp(this.span * factor, this.minSpan, this.maxSpan);
    this.applySpan();
  }

  snapTo(focus: THREE.Vector3): void {
    this.target.copy(focus);
    this.place();
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.target.lerp(focus, 1 - Math.exp(-5 * dt));
    this.place();
  }

  /** Ground directions for "screen right" and "screen up", for keyboard movement. */
  groundAxes(right: THREE.Vector3, up: THREE.Vector3): void {
    right.set(Math.cos(YAW), 0, -Math.sin(YAW));
    up.set(-Math.sin(YAW), 0, -Math.cos(YAW));
  }

  private place(): void {
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }

  private applySpan(): void {
    const h = this.aspect >= 1 ? this.span : this.span / this.aspect;
    const w = h * this.aspect;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
  }
}
