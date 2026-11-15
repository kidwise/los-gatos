import * as THREE from 'three';
import { gouacheUniforms, MAX_REVEALS } from '../style/gouache';
import { P } from '../style/palette';
import type { SketchSpot } from '../world/world';
import type { CameraRig } from './cameraRig';
import type { Controls } from './controls';

/**
 * The heart of the game. The town starts as a pencil drawing. At each sketch spot the player frames
 * a view, the game keeps it as a page in the sketchbook, and colour washes out from that spot.
 */

interface SavedSketch {
  image: string;
  when: string;
}

interface Wash {
  x: number;
  z: number;
  radius: number;
  progress: number;
}

export interface SketchingOptions {
  regionId: string;
  regionTitle: string;
  spots: SketchSpot[];
  rig: CameraRig;
  controls: Controls;
  canvas: HTMLCanvasElement;
  heightAt: (x: number, z: number) => number;
  /** Where the cat starts: a small patch here is painted from the beginning. */
  home: { x: number; z: number };
  /** Called when the cat should settle down to sketch. */
  onSit: () => void;
}

const HOME_RADIUS = 26;
const NEAR = 7;
const FRAME_SPAN = 30;
const WASH_SECONDS = 4.5;
const PITCH_SIN = Math.sin(THREE.MathUtils.degToRad(35));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, id: string, parent: HTMLElement = document.body): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.id = id;
  parent.appendChild(node);
  return node;
}

export class Sketching {
  /** Markers that show where there is something to sketch. */
  readonly group = new THREE.Group();
  /** True while the player is framing a view; the cat stays put and the camera follows `focus`. */
  active = false;
  readonly focus = new THREE.Vector3();

  private saved: Record<string, SavedSketch> = {};
  private washes = new Map<string, Wash>();
  private everything = 0;
  private markers = new Map<string, THREE.Group>();
  private nearby: SketchSpot | null = null;
  private framing: SketchSpot | null = null;
  private spanBefore = 10;
  private capture = false;
  private time = 0;
  private readonly key: string;

  private cta = el('button', 'sketch-cta');
  private finder = el('div', 'finder');
  private bookButton = el('button', 'book-btn');
  private book = el('div', 'book');
  private toast = el('div', 'toast');
  private window_: HTMLDivElement;

  constructor(private o: SketchingOptions) {
    this.key = `los-gatos:sketches:${o.regionId}`;
    try {
      this.saved = JSON.parse(localStorage.getItem(this.key) ?? '{}');
    } catch {
      this.saved = {};
    }

    gouacheUniforms.uRevealAll.value = 0;
    this.washes.set('home', { x: o.home.x, z: o.home.z, radius: HOME_RADIUS, progress: 1 });
    for (const s of o.spots) {
      if (this.saved[s.id]) this.washes.set(s.id, { x: s.x, z: s.z, radius: s.radius, progress: 1 });
    }
    if (this.done === o.spots.length) this.everything = 1;

    // A bright ring and a turning diamond mark each spot: the only colour in a pencil town.
    const ink = new THREE.MeshBasicMaterial({ color: P.persimmon });
    const ring = new THREE.RingGeometry(0.75, 0.95, 36).rotateX(-Math.PI / 2);
    const gem = new THREE.OctahedronGeometry(0.34);
    for (const s of o.spots) {
      const m = new THREE.Group();
      m.add(new THREE.Mesh(ring, ink), new THREE.Mesh(gem, ink));
      m.position.set(s.x, o.heightAt(s.x, s.z) + 0.14, s.z);
      m.visible = !this.saved[s.id];
      this.markers.set(s.id, m);
      this.group.add(m);
    }

    // Viewfinder.
    this.window_ = el('div', 'finder-window', this.finder);
    const bar = el('div', 'finder-bar', this.finder);
    const title = el('div', 'finder-title', bar);
    title.textContent = 'Frame your sketch · drag to move, pinch to zoom';
    const draw = el('button', 'finder-draw', bar);
    draw.textContent = 'Draw it';
    const cancel = el('button', 'finder-cancel', bar);
    cancel.textContent = 'Not now';
    draw.onclick = () => (this.capture = true);
    cancel.onclick = () => this.leave();
    this.cta.onclick = () => this.nearby && this.enter(this.nearby);

    this.bookButton.onclick = () => this.openBook();
    this.refreshBookButton();
    this.push();
  }

  private get done(): number {
    return this.o.spots.filter((s) => this.saved[s.id]).length;
  }

  /** For style work and screenshots: skip the game and paint the whole town. */
  paintAll(): void {
    this.everything = 1;
    this.push();
  }

  /** Forget every sketch in a region, so the next visit starts again from pencil. */
  static forget(regionId: string): void {
    try {
      localStorage.removeItem(`los-gatos:sketches:${regionId}`);
    } catch {
      // Private browsing: nothing was saved anyway.
    }
  }

  /** For automated checks: start framing a spot, or take the sketch. */
  debug(action: 'enter' | 'draw', id?: string): void {
    if (action === 'enter') {
      const s = this.o.spots.find((x) => x.id === id);
      if (s) this.enter(s);
    } else this.capture = true;
  }

  update(dt: number, cat: THREE.Vector3, span: number): void {
    this.time += dt;

    // Colour spreading from the spots sketched so far.
    let moving = false;
    for (const w of this.washes.values()) {
      if (w.progress < 1) {
        w.progress = Math.min(1, w.progress + dt / WASH_SECONDS);
        moving = true;
      }
    }
    if (this.done === this.o.spots.length && this.o.spots.length > 0 && this.everything < 1 && !moving) {
      // Every page is filled: the last pencil corners colour in too.
      this.everything = Math.min(1, this.everything + dt / 3);
      moving = true;
    }
    if (moving) this.push();

    // Markers bob, turn, and grow as the camera pulls back so they can be found from afar.
    const size = Math.max(1, span / 24);
    for (const m of this.markers.values()) {
      if (!m.visible) continue;
      m.children[0].scale.setScalar(size * (1 + Math.sin(this.time * 2.4) * 0.08));
      m.children[1].scale.setScalar(size);
      m.children[1].position.y = (1.9 + Math.sin(this.time * 1.7) * 0.18) * size;
      m.children[1].rotation.y = this.time * 1.2;
    }

    // Offer to sketch when the cat reaches a spot.
    let near: SketchSpot | null = null;
    if (!this.active) {
      for (const s of this.o.spots) {
        if (this.saved[s.id]) continue;
        const m = this.markers.get(s.id)!;
        if (Math.hypot(s.x - cat.x, s.z - cat.z) < NEAR && Math.abs(m.position.y - cat.y) < 3) near = s;
      }
    }
    if (near !== this.nearby) {
      this.nearby = near;
      this.cta.textContent = near ? `✎  Sketch ${near.title}` : '';
      this.cta.classList.toggle('on', !!near);
    }
  }

  /** Call straight after the frame is drawn: this is the moment a sketch can be lifted off the screen. */
  afterRender(): void {
    if (!this.capture || !this.framing) return;
    this.capture = false;
    const spot = this.framing;

    // Copy what is inside the viewfinder: a pencil view, since this place is not painted yet.
    const canvas = this.o.canvas;
    const frame = this.window_.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    const k = canvas.width / box.width;
    const page = document.createElement('canvas');
    page.width = 720;
    page.height = Math.round((720 * frame.height) / frame.width);
    page.getContext('2d')!.drawImage(canvas, (frame.left - box.left) * k, (frame.top - box.top) * k, frame.width * k, frame.height * k, 0, 0, page.width, page.height);
    this.saved[spot.id] = { image: page.toDataURL('image/jpeg', 0.82), when: new Date().toISOString().slice(0, 10) };
    try {
      localStorage.setItem(this.key, JSON.stringify(this.saved));
    } catch {
      // Storage full or unavailable: the sketch still counts for this visit.
    }

    this.washes.set(spot.id, { x: spot.x, z: spot.z, radius: spot.radius, progress: 0.02 });
    this.finder.classList.add('flash');
    setTimeout(() => this.finder.classList.remove('flash'), 500);
    this.leave();
    this.refreshBookButton();
    this.say(`<b>${spot.title}</b> · page ${this.done} of ${this.o.spots.length}<span>${spot.blurb}</span>`);
  }

  private enter(spot: SketchSpot): void {
    this.active = true;
    this.framing = spot;
    this.focus.set(spot.x, this.o.heightAt(spot.x, spot.z) + 1, spot.z);
    this.spanBefore = this.o.rig.span;
    this.o.rig.span = FRAME_SPAN;
    this.o.rig.zoomBy(1);
    this.o.controls.framing = true;
    this.o.controls.target = null;
    this.o.controls.onPan = (dx, dy) => {
      // Dragging the picture moves the camera the other way, and never far from the spot.
      const perPixel = this.o.rig.span / Math.min(window.innerWidth, window.innerHeight);
      const right = new THREE.Vector3(), up = new THREE.Vector3();
      this.o.rig.groundAxes(right, up);
      this.focus.addScaledVector(right, -dx * perPixel).addScaledVector(up, (dy * perPixel) / PITCH_SIN);
      const ox = this.focus.x - spot.x, oz = this.focus.z - spot.z;
      const d = Math.hypot(ox, oz);
      if (d > 40) {
        this.focus.x = spot.x + (ox / d) * 40;
        this.focus.z = spot.z + (oz / d) * 40;
      }
    };
    this.o.onSit();
    // The marker steps out of the picture while it is being framed.
    this.markers.get(spot.id)!.visible = false;
    this.finder.classList.add('on');
    this.cta.classList.remove('on');
    this.nearby = null;
  }

  private leave(): void {
    if (this.framing) this.markers.get(this.framing.id)!.visible = !this.saved[this.framing.id];
    this.active = false;
    this.framing = null;
    this.o.controls.framing = false;
    this.o.controls.onPan = null;
    this.o.rig.span = this.spanBefore;
    this.o.rig.zoomBy(1);
    this.finder.classList.remove('on');
  }

  /** Send the current washes to the paint shader. */
  private push(): void {
    const list = [...this.washes.values()].slice(0, MAX_REVEALS);
    list.forEach((w, i) => gouacheUniforms.uReveal.value[i].set(w.x, w.z, w.radius, w.progress));
    gouacheUniforms.uRevealCount.value = list.length;
    gouacheUniforms.uRevealAll.value = this.everything;
  }

  private say(html: string): void {
    this.toast.innerHTML = html;
    this.toast.classList.add('on');
    setTimeout(() => this.toast.classList.remove('on'), 6500);
  }

  private refreshBookButton(): void {
    this.bookButton.textContent = `Sketchbook  ${this.done}/${this.o.spots.length}`;
  }

  private openBook(): void {
    this.book.innerHTML = '';
    const head = el('div', 'book-head', this.book);
    head.innerHTML = `<em>Sketchbook</em><span>${this.o.regionTitle} · ${this.done} of ${this.o.spots.length} pages</span>`;
    const close = el('button', 'book-close', head);
    close.textContent = 'Close';
    close.onclick = () => this.book.classList.remove('on');
    const pages = el('div', 'book-pages', this.book);
    for (const s of this.o.spots) {
      const page = document.createElement('figure');
      const got = this.saved[s.id];
      if (got) {
        const img = document.createElement('img');
        img.src = got.image;
        img.alt = `Pencil sketch of ${s.title}`;
        page.appendChild(img);
        const cap = document.createElement('figcaption');
        cap.innerHTML = `<b>${s.title}</b><span>${s.blurb}</span><i>${got.when}</i>`;
        page.appendChild(cap);
      } else {
        page.className = 'blank';
        const cap = document.createElement('figcaption');
        cap.innerHTML = '<b>A blank page</b><span>Somewhere in town there is a view for it.</span>';
        page.appendChild(cap);
      }
      pages.appendChild(page);
    }
    this.book.classList.add('on');
  }
}
