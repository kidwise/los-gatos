import * as THREE from 'three';
import { gouacheUniforms } from '../style/gouache';
import { P } from '../style/palette';
import type { Find } from '../world/world';
import type { CameraRig } from './cameraRig';
import type { Controls } from './controls';

/**
 * Everything the cat picks up along the way, and the sketchbook.
 *
 * The town is the point of the game, so this stays in the background: a handful of small rings that
 * only show when the cat is close, each giving something to wear, an extra trick, or a moment of
 * local history. Nothing is locked behind them. Sketching is a camera the player can use anywhere.
 */

export interface View {
  x: number;
  y: number;
  z: number;
  span: number;
  yaw: number | null;
}

interface Page {
  image: string;
  title: string;
  when: string;
}

interface Saved {
  found: string[];
  wearing: string[];
  pages: Page[];
}

export interface JournalOptions {
  regionTitle: string;
  /** What can be found here, with places. */
  finds: Find[];
  /** What can be found in the other regions, for the journal's lists. */
  elsewhere: { find: Omit<Find, 'x' | 'z'>; region: string }[];
  rig: CameraRig;
  controls: Controls;
  canvas: HTMLCanvasElement;
  heightAt: (x: number, z: number) => number;
  /** A name for wherever this is, to caption a sketch. */
  placeName: (x: number, z: number) => string;
  /** A particular way to look at a story spot, if it has one. */
  view: (id: string) => View | null;
  onSit: () => void;
  onWear: (item: string, on: boolean) => void;
  onMeow: () => void;
  /** Something was found for the first time. */
  onFound: () => void;
}

const SEE = 55; // rings are invisible until the cat is this close
const REACH = 2.6;
const MAX_PAGES = 24;
const MOMENT_SECONDS = 9;
const PITCH_SIN = Math.sin(THREE.MathUtils.degToRad(35));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, id: string, parent: HTMLElement = document.body): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (id) node.id = id;
  parent.appendChild(node);
  return node;
}

export class Journal {
  /** The rings. */
  readonly group = new THREE.Group();
  /** True while framing a sketch: the cat stays put. */
  active = false;

  private state: Saved = { found: [], wearing: [], pages: [] };
  private readonly key = 'los-gatos:journal';
  private markers = new Map<string, THREE.Group>();
  private inside = new Set<string>();
  private time = 0;

  // Where the camera should look instead of at the cat, while framing or during a story moment.
  private readonly focus = new THREE.Vector3();
  private moment: { id: string; t: number; settled: boolean } | null = null;
  private spanBefore = 10;
  private origin = new THREE.Vector3();

  // Taking a sketch: the view turns to pencil for a moment, and that is what gets kept.
  private captureIn = 0;
  private holdUntil = 0;

  private finder = el('div', 'finder');
  private window_: HTMLDivElement;
  private bookButton = el('button', 'book-btn');
  private cameraButton = el('button', 'cam-btn');
  private meowButton = el('button', 'meow-btn');
  private bubble = el('div', 'mrrp');
  private book = el('div', 'book');
  private toast = el('div', 'toast');

  constructor(private o: JournalOptions) {
    try {
      this.state = { ...this.state, ...JSON.parse(localStorage.getItem(this.key) ?? '{}') };
    } catch {
      // Unreadable or unavailable storage: start fresh.
    }
    for (const item of this.state.wearing) o.onWear(item, true);

    const ink = new THREE.MeshBasicMaterial({ color: P.persimmon });
    const ring = new THREE.RingGeometry(0.62, 0.76, 32).rotateX(-Math.PI / 2);
    const gem = new THREE.OctahedronGeometry(0.2);
    for (const f of o.finds) {
      const m = new THREE.Group();
      m.add(new THREE.Mesh(ring, ink), new THREE.Mesh(gem, ink));
      m.position.set(f.x, o.heightAt(f.x, f.z) + 0.14, f.z);
      m.visible = false;
      this.markers.set(f.id, m);
      this.group.add(m);
    }

    this.window_ = el('div', 'finder-window', this.finder);
    const bar = el('div', 'finder-bar', this.finder);
    el('div', 'finder-title', bar).textContent = 'Frame your sketch · drag to move, pinch to zoom';
    const draw = el('button', 'finder-draw', bar);
    draw.textContent = 'Draw it';
    const cancel = el('button', 'finder-cancel', bar);
    cancel.textContent = 'Not now';
    draw.onclick = () => this.draw();
    cancel.onclick = () => this.leaveFinder();

    this.cameraButton.textContent = '✎ Sketch';
    this.cameraButton.onclick = () => this.enterFinder();
    this.meowButton.textContent = 'Meow';
    this.meowButton.onclick = () => this.meow();
    this.bookButton.textContent = 'Journal';
    this.bookButton.onclick = () => this.openBook();
    this.bubble.textContent = 'mrrp!';
    this.refresh();
  }

  /** Forget everything found and drawn. */
  static forget(): void {
    try {
      localStorage.removeItem('los-gatos:journal');
    } catch {
      // Nothing was saved anyway.
    }
  }

  /** Where the camera should look, or null to follow the cat as usual. */
  get cameraFocus(): THREE.Vector3 | null {
    return this.active || this.moment ? this.focus : null;
  }

  /** The story being shown right now, if any. */
  get momentId(): string | null {
    return this.moment?.id ?? null;
  }

  /** For automated checks. */
  debug(action: 'camera' | 'draw' | 'meow'): void {
    if (action === 'camera') this.enterFinder();
    else if (action === 'draw') this.draw();
    else this.meow();
  }

  update(dt: number, cat: THREE.Vector3, moving: boolean): void {
    this.time += dt;
    this.origin.copy(cat);

    // Rings only show themselves when the cat is near, so they are found, not hunted.
    for (const f of this.o.finds) {
      const m = this.markers.get(f.id)!;
      const d = Math.hypot(f.x - cat.x, f.z - cat.z);
      const level = Math.abs(m.position.y - cat.y) < 3;
      const done = this.state.found.includes(f.id);
      // At street level a ring shows only when the cat is near. Pulled back to the map view, every
      // ring still to be found shows, grown large enough to pick out.
      const span = this.o.rig.span;
      const near = THREE.MathUtils.smoothstep(SEE - d, 0, 14);
      const onMap = THREE.MathUtils.smoothstep(span, 40, 65) * (span / 26);
      const shown = done || this.active ? 0 : Math.max(near, onMap);
      m.visible = shown > 0.01;
      if (m.visible) {
        m.children[0].scale.setScalar(shown * (1 + Math.sin(this.time * 2.4) * 0.07));
        m.children[1].scale.setScalar(shown);
        m.children[1].position.y = (1.35 + Math.sin(this.time * 1.7) * 0.12) * Math.max(1, shown);
        m.children[1].rotation.y = this.time * 1.2;
      }

      const here = d < REACH && level && !this.active;
      if (here && !this.inside.has(f.id)) this.arrive(f);
      if (here) this.inside.add(f.id);
      else if (d > REACH + 4) this.inside.delete(f.id);
    }

    // A story moment ends by itself, or as soon as the player walks on.
    if (this.moment) {
      this.moment.t += dt;
      // The cat stops to look; the moment lasts until the player sets off again.
      if (!moving) this.moment.settled = true;
      if (this.moment.t > MOMENT_SECONDS || (moving && this.moment.settled && this.moment.t > 1.2)) this.endMoment();
    }

    if (this.holdUntil && this.time > this.holdUntil) {
      this.holdUntil = 0;
      gouacheUniforms.uPainted.value = 1;
      this.leaveFinder();
    }
  }

  /** Call straight after the frame is drawn: this is when a sketch can be lifted off the screen. */
  afterRender(): void {
    if (this.captureIn === 0) return;
    if (--this.captureIn > 0) return;

    const canvas = this.o.canvas;
    const frame = this.window_.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    const k = canvas.width / box.width;
    const page = document.createElement('canvas');
    page.width = 720;
    page.height = Math.round((720 * frame.height) / frame.width);
    page.getContext('2d')!.drawImage(canvas, (frame.left - box.left) * k, (frame.top - box.top) * k, frame.width * k, frame.height * k, 0, 0, page.width, page.height);
    this.state.pages.unshift({
      image: page.toDataURL('image/jpeg', 0.82),
      title: this.o.placeName(this.focus.x, this.focus.z),
      when: new Date().toISOString().slice(0, 10),
    });
    this.save();
    this.refresh();
    // Leave the pencil view up for a beat so the player sees what was drawn.
    this.holdUntil = this.time + 0.7;
  }

  private arrive(f: Find): void {
    const first = !this.state.found.includes(f.id);
    if (first) {
      this.o.onFound();
      this.state.found.push(f.id);
      if (f.kind === 'wear' && f.item) {
        this.state.wearing.push(f.item);
        this.o.onWear(f.item, true);
      }
      this.save();
      this.refresh();
    }
    if (f.kind === 'story') {
      // History is worth seeing again: the moment replays whenever the cat comes back.
      this.say(`<b>${f.title}</b><span>${f.blurb}</span>`);
      const view = this.o.view(f.id);
      if (view) {
        this.moment = { id: f.id, t: 0, settled: false };
        this.o.controls.target = null;
        this.focus.set(view.x, view.y, view.z);
        this.spanBefore = this.o.rig.span;
        this.o.rig.span = Math.max(this.o.rig.span, view.span);
        this.o.rig.turnTo(view.yaw);
        this.o.onSit();
      }
    } else if (first) {
      this.say(`<b>${f.kind === 'skill' ? 'A new trick: Meow' : `Found: ${f.title.toLowerCase()}`}</b><span>${f.blurb}</span>`);
    }
  }

  private endMoment(): void {
    this.moment = null;
    this.o.rig.span = this.spanBefore;
    this.o.rig.turnTo(null);
  }

  private meow(): void {
    this.o.onMeow();
    this.bubble.classList.remove('on');
    void this.bubble.offsetWidth; // restart the little animation
    this.bubble.classList.add('on');
  }

  private enterFinder(): void {
    if (this.active) return;
    if (this.moment) this.endMoment();
    if (this.state.pages.length >= MAX_PAGES) {
      this.say('<b>The sketchbook is full</b><span>Open the journal and remove a page to make room.</span>');
      return;
    }
    this.active = true;
    this.focus.copy(this.origin).setY(this.origin.y + 1);
    const start = this.focus.clone();
    this.spanBefore = this.o.rig.span;
    this.o.rig.span = Math.max(this.o.rig.span, 16);
    this.o.controls.framing = true;
    this.o.controls.target = null;
    this.o.controls.onPan = (dx, dy) => {
      // Dragging the picture moves the camera the other way, and never far from the cat.
      const perPixel = this.o.rig.span / Math.min(window.innerWidth, window.innerHeight);
      const right = new THREE.Vector3(), up = new THREE.Vector3();
      this.o.rig.groundAxes(right, up);
      this.focus.addScaledVector(right, -dx * perPixel).addScaledVector(up, (dy * perPixel) / PITCH_SIN);
      const ox = this.focus.x - start.x, oz = this.focus.z - start.z;
      const d = Math.hypot(ox, oz);
      if (d > 45) {
        this.focus.x = start.x + (ox / d) * 45;
        this.focus.z = start.z + (oz / d) * 45;
      }
    };
    this.o.onSit();
    this.finder.classList.add('on');
    document.body.classList.add('framing');
  }

  private draw(): void {
    if (!this.active || this.captureIn || this.holdUntil) return;
    // Turn the view to pencil; the sketch is taken a couple of frames later, once it has been drawn that way.
    gouacheUniforms.uPainted.value = 0;
    this.captureIn = 3;
  }

  private leaveFinder(): void {
    if (!this.active) return;
    this.active = false;
    this.o.controls.framing = false;
    this.o.controls.onPan = null;
    this.o.rig.span = this.spanBefore;
    this.finder.classList.remove('on');
    document.body.classList.remove('framing');
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.state));
    } catch {
      // Storage full or unavailable: it still counts for this visit.
    }
  }

  private say(html: string): void {
    this.toast.innerHTML = html;
    this.toast.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('on'), 7000);
  }
  private toastTimer = 0;

  private has(item: string): boolean {
    return this.all().some((e) => e.find.item === item && this.state.found.includes(e.find.id));
  }

  /** Everything there is to find in the whole town: here first, then elsewhere. */
  private all(): { find: Omit<Find, 'x' | 'z'>; here: Find | null; region: string }[] {
    return [...this.o.finds.map((f) => ({ find: f, here: f, region: this.o.regionTitle })), ...this.o.elsewhere.map((e) => ({ ...e, here: null }))];
  }

  /** Where to look for something not found yet. */
  private hint(e: { here: Find | null; region: string }): string {
    return e.here ? `Not found yet · look near ${this.o.placeName(e.here.x, e.here.z)}` : `Not found yet · somewhere in ${e.region}`;
  }

  private refresh(): void {
    this.meowButton.classList.toggle('on', this.has('meow'));
  }

  private openBook(): void {
    const b = this.book;
    b.innerHTML = '';
    const head = el('div', 'book-head', b);
    head.innerHTML = '<em>Journal</em><span>Los Gatos</span>';
    const close = el('button', 'book-close', head);
    close.textContent = 'Close';
    close.onclick = () => b.classList.remove('on');

    const section = (title: string) => {
      const s = el('section', '', b);
      el('h3', '', s).textContent = title;
      return s;
    };

    // Wardrobe: tap to put on or take off.
    const wardrobe = section('Wardrobe');
    for (const e of this.all().filter((x) => x.find.kind === 'wear')) {
      const f = e.find;
      const chip = el('button', '', wardrobe);
      const got = this.state.found.includes(f.id);
      const on = !!f.item && this.state.wearing.includes(f.item);
      chip.className = `chip${got ? '' : ' unknown'}${on ? ' on' : ''}`;
      chip.textContent = got ? `${f.title}${on ? ' · wearing' : ''}` : this.hint(e);
      chip.disabled = !got;
      chip.onclick = () => {
        if (!f.item) return;
        this.state.wearing = on ? this.state.wearing.filter((i) => i !== f.item) : [...this.state.wearing, f.item];
        this.o.onWear(f.item, !on);
        this.save();
        this.openBook();
      };
    }

    const tricks = section('Tricks');
    for (const e of this.all().filter((x) => x.find.kind === 'skill')) {
      const f = e.find;
      const got = this.state.found.includes(f.id);
      const p = el('p', '', tricks);
      p.className = got ? '' : 'unknown';
      p.innerHTML = got ? `<b>Meow</b> ${f.blurb}` : this.hint(e);
    }

    const stories = section('Stories');
    for (const e of this.all().filter((x) => x.find.kind === 'story')) {
      const f = e.find;
      const got = this.state.found.includes(f.id);
      const p = el('p', '', stories);
      p.className = got ? '' : 'unknown';
      p.innerHTML = got ? `<b>${f.title}</b> ${f.blurb}` : this.hint(e);
    }

    const sketches = section(`Sketches · ${this.state.pages.length} of ${MAX_PAGES}`);
    const pages = el('div', 'book-pages', sketches);
    if (this.state.pages.length === 0) {
      const p = el('p', '', sketches);
      p.className = 'unknown';
      p.textContent = 'Tap ✎ Sketch anywhere in town to draw what you see.';
    }
    this.state.pages.forEach((page, i) => {
      const fig = el('figure', '', pages);
      const img = el('img', '', fig);
      img.src = page.image;
      img.alt = `Pencil sketch near ${page.title}`;
      const cap = el('figcaption', '', fig);
      cap.innerHTML = `<b>${page.title}</b><i>${page.when}</i>`;
      const remove = el('button', '', cap);
      remove.className = 'remove';
      remove.textContent = 'Remove';
      remove.onclick = () => {
        this.state.pages.splice(i, 1);
        this.save();
        this.openBook();
      };
    });
    b.classList.add('on');
  }
}
