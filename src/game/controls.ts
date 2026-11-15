import * as THREE from 'three';
import type { CameraRig } from './cameraRig';

const TAP_MS = 260;
const TAP_SLOP = 10;

/**
 * One-finger walking. Hold and the cat follows the finger; tap and it walks to that spot.
 * Two fingers or the wheel zoom. WASD or arrows work on a keyboard.
 */
export class Controls {
  /** Ground point the cat should head for, or null to stand still. */
  target: THREE.Vector3 | null = null;
  /** True while the target came from a tap, so the cat should stop when it arrives. */
  arriving = false;
  onTap: ((point: THREE.Vector3) => void) | null = null;
  onFirstInput: (() => void) | null = null;
  /** Height of the ground the walker is on, so taps land at that level instead of at sea level. */
  groundY: () => number = () => 0;
  /** While framing a sketch, one finger drags the view instead of leading the cat. */
  framing = false;
  onPan: ((dx: number, dy: number) => void) | null = null;

  private pointers = new Map<number, { x: number; y: number }>();
  private down = { x: 0, y: 0, t: 0 };
  private holding = false;
  private pinchDistance = 0;
  private keys = new Set<string>();
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private last = { x: 0, y: 0 };
  private touched = false;

  constructor(private el: HTMLElement, private rig: CameraRig) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      this.first();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Keyboard direction on the ground, or null when no movement key is held. */
  keyDirection(out: THREE.Vector3): THREE.Vector3 | null {
    const k = this.keys;
    const x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const y = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    if (x === 0 && y === 0) return null;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.rig.groundAxes(right, up);
    return out.copy(right).multiplyScalar(x).addScaledVector(up, y).normalize();
  }

  get running(): boolean {
    return this.keys.has('shift');
  }

  /** Call once a frame: while a finger is held, the target tracks it even as the camera moves. */
  update(): void {
    if (this.holding && this.pointers.size === 1) {
      const p = this.pick(this.last.x, this.last.y);
      if (p) {
        this.target = p;
        this.arriving = false;
      }
    }
  }

  private first(): void {
    if (this.touched) return;
    this.touched = true;
    this.onFirstInput?.();
  }

  private pick(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    this.ground.constant = -this.groundY();
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  private onDown = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.first();
    if (this.pointers.size === 1) {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.last = { x: e.clientX, y: e.clientY };
      this.holding = !this.framing;
    } else {
      // A second finger means zoom, not walk.
      this.holding = false;
      this.target = null;
      this.pinchDistance = this.spread();
    }
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 1) {
      if (this.framing) this.onPan?.(e.clientX - this.last.x, e.clientY - this.last.y);
      this.last = { x: e.clientX, y: e.clientY };
    } else if (this.pointers.size === 2) {
      const d = this.spread();
      if (this.pinchDistance > 0 && d > 0) this.rig.zoomBy(this.pinchDistance / d);
      this.pinchDistance = d;
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.holding && this.pointers.size === 0) {
      const quick = performance.now() - this.down.t < TAP_MS;
      const still = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < TAP_SLOP;
      if (quick && still) {
        const p = this.pick(e.clientX, e.clientY);
        if (p) {
          this.target = p;
          this.arriving = true;
          this.onTap?.(p);
        }
      } else {
        this.target = null;
      }
    }
    this.holding = false;
    this.pinchDistance = 0;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.first();
    this.rig.zoomBy(Math.exp(e.deltaY * 0.0015));
  };

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
