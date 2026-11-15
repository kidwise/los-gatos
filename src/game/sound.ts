/**
 * All sound is made in code for now: filtered noise for the creek, traffic and street murmur,
 * short tones for birds, footsteps, the meow and the train. These are stand-ins with the right
 * behaviour (they rise and fall with where the cat is); real recordings can replace each one.
 */

/** How much of each kind of place surrounds the cat, each from 0 to 1. */
export interface Ambience {
  water: number;
  traffic: number;
  town: number;
  green: number;
  train: number;
}

const MUTE_KEY = 'los-gatos:muted';

export class Sound {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private creek!: GainNode;
  private traffic!: GainNode;
  private town!: GainNode;
  private train!: GainNode;
  private green = 0;
  private nextBird = 2;
  private nextStep = 0;
  private nextWhistle = 6;
  private time = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // No storage: start with sound on.
    }
  }

  /** Browsers only allow sound after a touch or key press, so this is called on the first one. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Creek: a steady wash plus a higher, wavering trickle.
    this.creek = this.bed([{ type: 'bandpass', freq: 1100, q: 0.7 }, { type: 'highpass', freq: 420, q: 0.5 }], 0.5);
    this.bed([{ type: 'bandpass', freq: 2700, q: 1.4 }], 0.22, 0.43, this.creek);
    // Freeway: a low rumble that swells slowly.
    this.traffic = this.bed([{ type: 'lowpass', freq: 190, q: 0.6 }], 0.9, 0.11);
    // Street murmur.
    this.town = this.bed([{ type: 'bandpass', freq: 480, q: 0.5 }, { type: 'lowpass', freq: 950, q: 0.5 }], 0.32, 0.19);
    // Steam train: a soft chuffing.
    this.train = this.bed([{ type: 'bandpass', freq: 700, q: 0.8 }], 0.5, 3.1);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // The choice lasts for this visit only.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  update(dt: number, around: Ambience, speed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.time += dt;
    const now = ctx.currentTime;
    this.creek.gain.setTargetAtTime(around.water * 0.2, now, 0.4);
    this.traffic.gain.setTargetAtTime(around.traffic * 0.26, now, 0.6);
    this.town.gain.setTargetAtTime(around.town * 0.085, now, 0.6);
    this.train.gain.setTargetAtTime(around.train * 0.12, now, 0.3);
    this.green = around.green;

    // Birdsong where it is leafy and quiet.
    if (this.time > this.nextBird) {
      this.nextBird = this.time + 1.2 + Math.random() * 5;
      if (this.green > 0.15) this.bird(this.green);
    }
    // The train's whistle, now and then, when it is within earshot.
    if (around.train > 0.25 && this.time > this.nextWhistle) {
      this.nextWhistle = this.time + 14 + Math.random() * 10;
      this.whistle(around.train);
    }
    // Paw steps.
    if (speed > 0.3 && this.time > this.nextStep) {
      this.nextStep = this.time + (speed > 2.6 ? 0.17 : 0.3);
      this.burst(1000, 0.028, 0.045);
    }
  }

  meow(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.linearRampToValueAtTime(790, t + 0.13);
    osc.frequency.linearRampToValueAtTime(640, t + 0.36);
    osc.frequency.linearRampToValueAtTime(430, t + 0.58);
    // Two resonances give it a mouth shape that opens and closes.
    const mouth = ctx.createBiquadFilter();
    mouth.type = 'bandpass';
    mouth.Q.value = 3;
    mouth.frequency.setValueAtTime(900, t);
    mouth.frequency.linearRampToValueAtTime(1700, t + 0.2);
    mouth.frequency.linearRampToValueAtTime(1000, t + 0.58);
    const air = ctx.createBiquadFilter();
    air.type = 'bandpass';
    air.frequency.value = 2900;
    air.Q.value = 4;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.05);
    g.gain.setValueAtTime(0.5, t + 0.36);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    osc.connect(mouth).connect(g);
    osc.connect(air).connect(airGain).connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.65);
  }

  /** Two soft notes when something is found. */
  chime(): void {
    this.tone(880, 0, 0.5, 0.12);
    this.tone(1318, 0.16, 0.7, 0.1);
  }

  private whistle(loudness: number): void {
    for (const f of [622, 740]) this.tone(f, 0, 1.1, 0.05 * loudness, 'triangle');
  }

  private bird(loudness: number): void {
    const base = 2600 + Math.random() * 1400;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) this.tone(base * (1 + (Math.random() - 0.3) * 0.25), i * 0.11, 0.09, 0.035 * loudness, 'sine', base * 1.15);
  }

  private tone(freq: number, delay: number, length: number, volume: number, type: OscillatorType = 'sine', glideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + Math.min(0.03, length / 3));
    g.gain.exponentialRampToValueAtTime(0.0005, t + length);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  /** A very short puff of filtered noise. */
  private burst(freq: number, length: number, volume: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + length);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + length + 0.02);
  }

  /** A continuous layer of filtered noise, silent until its gain is raised. A wobble rate makes it waver. */
  private bed(filters: { type: BiquadFilterType; freq: number; q: number }[], level: number, wobble = 0, into?: GainNode): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    let node: AudioNode = src;
    for (const f of filters) {
      const filter = ctx.createBiquadFilter();
      filter.type = f.type;
      filter.frequency.value = f.freq;
      filter.Q.value = f.q;
      node.connect(filter);
      node = filter;
    }
    const shape = ctx.createGain();
    shape.gain.value = level;
    if (wobble > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = wobble;
      const depth = ctx.createGain();
      depth.gain.value = level * 0.45;
      lfo.connect(depth).connect(shape.gain);
      lfo.start();
    }
    node.connect(shape);
    const out = into ?? ctx.createGain();
    if (!into) {
      out.gain.value = 0;
      out.connect(this.master);
    }
    shape.connect(out);
    src.start(0, Math.random() * 1.5);
    return out;
  }
}
