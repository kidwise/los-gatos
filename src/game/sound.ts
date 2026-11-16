/**
 * Everything the game sounds like, made in code with the Web Audio API.
 *
 * - Music: a slow, generative score in D major that never repeats exactly. It is livelier in town,
 *   sparse on the trail, flowing by the lake, and lower and slower at dusk.
 * - Places: creek, lake, wind in the trees, several kinds of birdsong, street murmur with the odd
 *   cup and bicycle bell, the market, the freeway, the train and the carousel organ.
 * - The cat: paw steps that differ on grass and paving, varied meows, and a purr when it settles.
 * - Space: one shared reverb, and stereo placement for things that have a direction.
 *
 * These are synthesized stand-ins tuned by measurement, not by ear; real recordings can replace
 * any layer.
 */

/** What surrounds the cat, each from 0 to 1. */
export interface Ambience {
  /** Running water: the creek. */
  water: number;
  lake: number;
  traffic: number;
  town: number;
  market: number;
  /** Leafy and quiet. */
  green: number;
  /** Standing on grass, as opposed to paving. */
  grass: number;
  train: number;
  carousel: number;
}

/** What is going on this frame, beyond the surroundings. */
export interface Moment {
  /** Ground speed of the cat, in metres a second. */
  speed: number;
  /** How settled the cat is, from 0 (up and about) to 1 (sitting or loafing). */
  resting: number;
  rowing: boolean;
  /** 0 by day, 1 at dusk. */
  dusk: number;
  /** How far the view is pulled back, 0 at street level to 1 on the map: the world grows quieter. */
  height: number;
  /** Left-right placement, -1 to 1, of things that have a direction. */
  pan: { water: number; train: number; carousel: number };
}

export type SoundMode = 'all' | 'effects' | 'off';
const MODE_KEY = 'los-gatos:sound';
const LABEL: Record<SoundMode, string> = { all: 'Sound on', effects: 'Music off', off: 'Sound off' };

/** Overall level, set by measurement so the mix averages about -19 dB with peaks well clear of distortion. */
const LOUDNESS = 2.1;
/** The music sits a little above the sounds of the place, not on top of them. */
const MUSIC = 0.5;

// ---- Music ----
// Notes are semitones above D. The melody keeps to the pentatonic scale, which sits well over every chord.
const D3 = 146.83;
const SCALE = [0, 2, 4, 7, 9];
const CHORDS = [
  { bass: 0, tones: [0, 4, 7, 11, 14] }, // D major 9
  { bass: -3, tones: [-3, 0, 4, 7, 12] }, // B minor 7
  { bass: -7, tones: [-7, 4, 9, 12, 16] }, // G major 7
  { bass: -5, tones: [-5, 2, 7, 9, 14] }, // A 6/9
];
const STEPS_PER_CHORD = 16;
const hz = (semitones: number, octave = 0) => D3 * Math.pow(2, semitones / 12 + octave);

// The carousel's band organ: an original tune in three-four time, as scale notes above C.
const C4 = 261.63;
const WALTZ = [0, 4, 7, 4, 7, 12, 11, 7, 4, 2, 5, 9, 7, 4, 0, 2, 5, 9, 7, 11, 2, 0, -1, -1];
const WALTZ_BASS = [0, 0, 7, 5, 0, 5, 7, 0];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class Sound {
  mode: SoundMode = 'all';
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private musicBus!: GainNode;
  private analyser!: AnalyserNode;
  private noise!: AudioBuffer;

  // Continuous layers.
  private creek!: GainNode;
  private creekPan!: StereoPannerNode;
  private lake!: GainNode;
  private wind!: GainNode;
  private traffic!: GainNode;
  private town!: GainNode;
  private train!: GainNode;
  private trainPan!: StereoPannerNode;
  private purr!: GainNode;
  private organPan!: StereoPannerNode;

  private time = 0;
  private around: Ambience = { water: 0, lake: 0, traffic: 0, town: 0, market: 0, green: 0, grass: 0, train: 0, carousel: 0 };
  private now: Moment = { speed: 0, resting: 0, rowing: false, dusk: 0, height: 0, pan: { water: 0, train: 0, carousel: 0 } };
  // When each kind of occasional sound is next due.
  private due = { bird: 2, dove: 9, cricket: 0, bubble: 0, town: 4, car: 6, whistle: 6, step: 0, stroke: 0, organ: 0, gust: 3 };
  private organNote = 0;
  // The music's clock, in audio time.
  private nextStep = 0;
  private step = 0;
  private melody = 7;
  private restful = 0;

  constructor() {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === 'all' || saved === 'effects' || saved === 'off') this.mode = saved;
      else if (localStorage.getItem('los-gatos:muted') === '1') this.mode = 'off';
    } catch {
      // No storage: start with everything on.
    }
  }

  get label(): string {
    return LABEL[this.mode];
  }

  /** Browsers only allow sound after a touch or key press, so this is called on the first one. */
  start(): void {
    if (this.ctx) {
      if (!document.hidden) void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());

    // Everything is mixed, gently levelled so nothing jumps out, and faded in.
    const squeeze = ctx.createDynamicsCompressor();
    squeeze.threshold.value = -20;
    squeeze.knee.value = 18;
    squeeze.ratio.value = 3;
    squeeze.attack.value = 0.02;
    squeeze.release.value = 0.4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(this.mode === 'off' ? 0 : LOUDNESS, ctx.currentTime, 0.9);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    squeeze.connect(this.master).connect(ctx.destination);
    this.master.connect(this.analyser);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // One reverb shared by everything: a soft outdoor bloom of about two seconds.
    const space = ctx.createConvolver();
    const tail = ctx.createBuffer(2, ctx.sampleRate * 2.4, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = tail.getChannelData(ch);
      let smoothed = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / d.length;
        // Darker as it dies away, like sound over open ground.
        smoothed += (Math.random() * 2 - 1 - smoothed) * (0.5 - t * 0.38);
        d[i] = smoothed * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
      }
    }
    space.buffer = tail;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.dry.connect(squeeze);
    this.wet.connect(space).connect(squeeze);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.mode === 'all' ? MUSIC : 0;
    this.musicBus.connect(this.dry);
    this.musicBus.connect(this.wet);

    // ---- Continuous layers, each silent until the cat is somewhere that calls for it ----
    this.creekPan = ctx.createStereoPanner();
    this.creekPan.connect(this.dry);
    this.creek = this.bed([{ type: 'bandpass', freq: 1000, q: 0.6 }, { type: 'highpass', freq: 380, q: 0.5 }], 0.5, 0, this.creekPan);
    this.bed([{ type: 'bandpass', freq: 2600, q: 1.2 }], 0.2, 0.37, this.creek);
    // The lake laps slowly at its shore.
    this.lake = this.bed([{ type: 'lowpass', freq: 520, q: 0.5 }], 0.5, 0.31, this.dry);
    this.bed([{ type: 'bandpass', freq: 1500, q: 0.8 }], 0.12, 0.19, this.lake);
    // Wind in the leaves, which comes and goes in gusts.
    this.wind = this.bed([{ type: 'bandpass', freq: 3200, q: 0.5 }, { type: 'highpass', freq: 1200, q: 0.5 }], 0.5, 0.07, this.dry);
    this.traffic = this.bed([{ type: 'lowpass', freq: 170, q: 0.6 }], 0.9, 0.11, this.dry);
    this.town = this.bed([{ type: 'bandpass', freq: 460, q: 0.5 }, { type: 'lowpass', freq: 900, q: 0.5 }], 0.32, 0.19, this.dry);
    this.trainPan = ctx.createStereoPanner();
    this.trainPan.connect(this.dry);
    this.trainPan.connect(this.wet);
    this.train = this.bed([{ type: 'bandpass', freq: 650, q: 0.8 }], 0.5, 3.1, this.trainPan);
    // The purr: a low rumble that flutters about twenty-five times a second and breathes in and out.
    this.purr = this.bed([{ type: 'bandpass', freq: 190, q: 1.1 }, { type: 'lowpass', freq: 520, q: 0.5 }], 0.55, 25, this.dry);
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.42;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    breath.connect(depth).connect(this.purr.gain);
    breath.start();
    this.purrBreath = depth;
    this.organPan = ctx.createStereoPanner();
    this.organPan.connect(this.dry);
    this.organPan.connect(this.wet);

    this.nextStep = ctx.currentTime + 1.2;
    // Nothing should keep playing once the game is out of sight.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
  }
  private purrBreath!: GainNode;

  /** Steps to the next of: everything, no music, silent. Returns the new label. */
  cycle(): string {
    this.mode = this.mode === 'all' ? 'effects' : this.mode === 'effects' ? 'off' : 'all';
    try {
      localStorage.setItem(MODE_KEY, this.mode);
    } catch {
      // The choice lasts for this visit only.
    }
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.mode === 'off' ? 0 : LOUDNESS, t, 0.08);
      this.musicBus.gain.setTargetAtTime(this.mode === 'all' ? MUSIC : 0, t, 0.3);
    }
    return this.label;
  }

  /** How loud the mix is right now, for automated checks: the peak and the average level, 0 to 1. */
  levels(): { peak: number; rms: number; running: boolean } {
    if (!this.ctx) return { peak: 0, rms: 0, running: false };
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let peak = 0, sum = 0;
    for (const v of buf) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / buf.length), running: this.ctx.state === 'running' };
  }

  update(dt: number, around: Ambience, now: Moment): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.time += dt;
    this.around = around;
    this.now = now;
    const t = ctx.currentTime;
    const time = this.time;
    // Pulled back to the map, the world below grows quieter and the music carries.
    const near = 1 - now.height * 0.65;
    const set = (g: GainNode, v: number, lag = 0.5) => g.gain.setTargetAtTime(v, t, lag);

    set(this.creek, around.water * 0.3 * near, 0.4);
    set(this.lake, around.lake * 0.26 * near);
    set(this.traffic, around.traffic * 0.13 * near, 0.7);
    set(this.town, (around.town * 0.3 + around.market * 0.22) * near, 0.7);
    set(this.train, around.train * 0.14 * near, 0.3);
    this.creekPan.pan.setTargetAtTime(now.pan.water * 0.6, t, 0.3);
    this.trainPan.pan.setTargetAtTime(now.pan.train * 0.8, t, 0.2);
    this.organPan.pan.setTargetAtTime(now.pan.carousel * 0.7, t, 0.2);
    // The carousel has its own music, so the score steps back near it.
    this.musicGain = 1 - around.carousel * 0.85;

    // Gusts: the wind swells and dies away every so often.
    if (time > this.due.gust) {
      this.due.gust = time + rand(5, 12);
      const strength = around.green * rand(0.05, 0.16) * near;
      this.wind.gain.cancelScheduledValues(t);
      this.wind.gain.setTargetAtTime(strength, t, 1.2);
      this.wind.gain.setTargetAtTime(around.green * 0.03 * near, t + rand(2.5, 4.5), 1.8);
    }

    // The cat settles and begins to purr.
    this.restful += ((now.resting > 0.8 && now.speed < 0.1 ? 1 : 0) - this.restful) * Math.min(1, dt * 0.6);
    set(this.purr, this.restful * 0.13, 0.3);
    this.purrBreath.gain.setTargetAtTime(this.restful * 0.06, t, 0.3);

    // ---- Occasional sounds ----
    const day = 1 - now.dusk;
    if (time > this.due.bird) {
      this.due.bird = time + rand(0.9, 4.5) / (0.4 + around.green);
      if (around.green * day * near > 0.12 && Math.random() < 0.85) this.bird(around.green * near);
    }
    if (time > this.due.dove) {
      this.due.dove = time + rand(9, 22);
      if (around.green * near > 0.3) this.dove(around.green * near);
    }
    if (now.dusk > 0.3 && time > this.due.cricket) {
      this.due.cricket = time + rand(0.5, 1.4);
      this.cricket(now.dusk * near);
    }
    if (around.water > 0.15 && time > this.due.bubble) {
      this.due.bubble = time + rand(0.05, 0.35) / around.water;
      this.bubble(around.water * near);
    }
    if (time > this.due.town) {
      this.due.town = time + rand(2.5, 8) / (0.5 + around.town + around.market);
      const busy = Math.max(around.town, around.market) * near;
      if (busy > 0.25) (Math.random() < 0.3 ? this.bikeBell : this.clink).call(this, busy);
    }
    if (around.traffic * near > 0.3 && time > this.due.car) {
      this.due.car = time + rand(4, 11);
      this.carPass(around.traffic * near);
    }
    if (around.train > 0.25 && time > this.due.whistle) {
      this.due.whistle = time + rand(14, 24);
      for (const f of [622, 740]) this.tone(f, { length: 1.1, volume: 0.045 * around.train * near, type: 'triangle', pan: now.pan.train, wet: 0.6 });
    }
    if (around.carousel * near > 0.05 && time > this.due.organ) {
      this.due.organ = time + 0.27;
      this.organ(around.carousel * near);
    }

    // Paw steps: a soft pat on paving, a softer brush through grass.
    if (now.speed > 0.3 && time > this.due.step) {
      const stride = now.speed > 2.9 ? 0.15 : now.speed > 1.2 ? 0.2 : 0.3;
      this.due.step = time + stride * rand(0.92, 1.08);
      if (around.grass > 0.5) this.burst({ freq: rand(2200, 3200), q: 0.7, type: 'bandpass', length: 0.07, volume: 0.07 * near });
      else this.burst({ freq: rand(700, 1000), q: 0.8, type: 'lowpass', length: 0.03, volume: 0.12 * near });
    }
    // Oars: a dip and a small splash on each stroke.
    if (now.rowing && time > this.due.stroke) {
      this.due.stroke = time + rand(1.25, 1.5);
      this.burst({ freq: 900, sweepTo: 320, q: 0.9, type: 'bandpass', length: 0.45, volume: 0.09, attack: 0.08 });
      this.burst({ freq: 2400, q: 1.2, type: 'bandpass', length: 0.16, volume: 0.03, delay: 0.3 });
      for (let i = 0; i < 3; i++) this.tone(rand(500, 900), { length: 0.07, volume: 0.02, glideTo: rand(1100, 1600), delay: 0.42 + i * rand(0.05, 0.11) });
    }

    this.playMusic();
  }
  private musicGain = 1;

  // ---- Things the game asks for by name ----

  meow(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // Three contours: a plain meow, a short chirrup, and a questioning rise.
    const [shape, length] = pick([
      [[1, 1.5, 1.22, 0.83], 0.6],
      [[1, 1.7, 1.5], 0.3],
      [[0.9, 1.15, 1.6, 1.5], 0.5],
    ] as const);
    const base = rand(470, 560);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    shape.forEach((m, i) => osc.frequency.linearRampToValueAtTime(base * m, t + (i / (shape.length - 1)) * length));
    // Two resonances give it a mouth that opens and closes.
    const mouth = ctx.createBiquadFilter();
    mouth.type = 'bandpass';
    mouth.Q.value = 3;
    mouth.frequency.setValueAtTime(900, t);
    mouth.frequency.linearRampToValueAtTime(1700, t + length * 0.35);
    mouth.frequency.linearRampToValueAtTime(1000, t + length);
    const air = ctx.createBiquadFilter();
    air.type = 'bandpass';
    air.frequency.value = 2900;
    air.Q.value = 4;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.05);
    g.gain.setValueAtTime(0.4, t + length * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    osc.connect(mouth).connect(g);
    osc.connect(air).connect(airGain).connect(g);
    g.connect(this.dry);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    g.connect(send).connect(this.wet);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  /** Something found: a rising figure on the chord the music is on, so it always belongs. */
  chime(): void {
    const tones = this.chord().tones;
    [tones[1], tones[2], tones[4]].forEach((n, i) => this.pluck(hz(n, 2), 0.09, i * 0.13, 0.9));
  }

  /** A story or a view opening up: a slow, warm swell. */
  swell(): void {
    const tones = this.chord().tones;
    tones.slice(0, 4).forEach((n, i) => this.pad(hz(n, 1), 0.03, 0.6 + i * 0.12, 5));
    this.pluck(hz(tones[4], 2), 0.06, 1.1, 0.9);
  }

  /** The end of the trail: the tune comes home. */
  ending(): void {
    [0, 4, 7, 12, 16].forEach((n, i) => this.pluck(hz(n, 1), 0.08, i * 0.34, 0.9));
    [0, 7, 16].forEach((n) => this.pad(hz(n, 1), 0.035, 1.6, 7));
  }

  /** Pencil on paper, for a sketch. */
  sketch(): void {
    for (let i = 0; i < 4; i++) this.burst({ freq: rand(2600, 3800), q: 1.5, type: 'bandpass', length: rand(0.09, 0.16), volume: 0.05, delay: i * 0.13, attack: 0.02 });
  }

  /** A soft tick for buttons. */
  tap(): void {
    this.tone(880, { length: 0.07, volume: 0.035, glideTo: 660 });
  }

  // ---- Music ----

  private chord(): (typeof CHORDS)[number] {
    return CHORDS[Math.floor(this.step / STEPS_PER_CHORD) % CHORDS.length];
  }

  /** Schedules the next few notes a little ahead of time, so the rhythm is steady whatever the frame rate. */
  private playMusic(): void {
    const ctx = this.ctx!;
    const { around, now } = this;
    // The pulse slows toward dusk and when the cat is resting.
    const stepLength = 0.44 + now.dusk * 0.1 + this.restful * 0.05;
    if (this.nextStep < ctx.currentTime - 1) this.nextStep = ctx.currentTime + 0.1;
    while (this.nextStep < ctx.currentTime + 0.3) {
      const at = this.nextStep - ctx.currentTime;
      const inChord = this.step % STEPS_PER_CHORD;
      const chord = this.chord();
      const level = this.musicGain;
      const lift = now.dusk > 0.5 ? -1 : 0;

      if (inChord === 0) {
        // A soft chord under everything, and a low note to stand on.
        chord.tones.slice(0, 4).forEach((n, i) => this.pad(hz(n, 1 + lift), 0.02 * level, at + i * 0.05, stepLength * STEPS_PER_CHORD + 2));
        this.pluck(hz(chord.bass, lift), 0.07 * level, at, 0.5, 2.4);
      }
      // How busy the melody is: livelier among people and on the move, sparse where it is quiet.
      const energy = clamp01(0.2 + around.town * 0.35 + around.market * 0.2 + Math.min(1, now.speed / 3) * 0.15 - now.dusk * 0.1 - this.restful * 0.08);
      const strong = inChord % 4 === 0;
      if (Math.random() < (strong ? energy + 0.25 : inChord % 2 === 0 ? energy * 0.7 : energy * 0.3)) {
        // The tune wanders by step, mostly, within an octave and a half.
        this.melody = Math.max(3, Math.min(11, this.melody + pick([-2, -1, -1, 0, 1, 1, 2])));
        let note = SCALE[this.melody % 5] + 12 * Math.floor(this.melody / 5);
        // On the strong beats it lands on a note of the chord.
        if (strong) {
          const near = (tone: number) => tone + 12 * Math.round((note - tone) / 12);
          note = chord.tones.map(near).reduce((a, b) => (Math.abs(b - note) < Math.abs(a - note) ? b : a));
        }
        this.pluck(hz(note, 1 + lift), (strong ? 0.065 : 0.045) * level, at + rand(0, 0.015), rand(-0.35, 0.35));
      }
      // By the lake, a harp-like figure runs up the chord.
      if (around.lake > 0.35 && inChord % 2 === 1 && Math.random() < 0.55) {
        this.pluck(hz(chord.tones[(inChord >> 1) % 5], 2 + lift), 0.03 * level * around.lake, at, rand(-0.6, 0.6), 0.9);
      }
      this.step++;
      this.nextStep += stepLength;
    }
  }

  /** A soft mallet note: a pure tone with a little shimmer, dying away. */
  private pluck(freq: number, volume: number, delay = 0, pan = 0, length = 1.5): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.0005) return;
    const t = ctx.currentTime + Math.max(0, delay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0004, t + length);
    for (const [mult, amount] of [[1, 1], [2, 0.28], [4.02, 0.07]] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * mult;
      const part = ctx.createGain();
      part.gain.value = amount;
      osc.connect(part).connect(g);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
    const place = ctx.createStereoPanner();
    place.pan.value = pan;
    g.connect(place).connect(this.musicBus);
  }

  /** A held, breathing tone for chords. */
  private pad(freq: number, volume: number, delay: number, length: number): void {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.0005) return;
    const t = ctx.currentTime + Math.max(0, delay);
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + length * 0.3);
    g.gain.setValueAtTime(volume, t + length * 0.55);
    g.gain.linearRampToValueAtTime(0, t + length);
    for (const cents of [-5, 5]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(soften);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
    soften.connect(g).connect(this.musicBus);
  }

  // ---- Voices of the place ----

  private bird(loudness: number): void {
    const pan = rand(-0.9, 0.9);
    const base = rand(2500, 4200);
    const kind = Math.random();
    if (kind < 0.4) {
      // A few quick chirps.
      const notes = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < notes; i++) this.tone(base * rand(0.92, 1.12), { delay: i * 0.11, length: 0.09, volume: 0.075 * loudness, glideTo: base * 1.18, pan, wet: 0.5 });
    } else if (kind < 0.7) {
      // Two clear falling notes.
      this.tone(base * 1.2, { length: 0.3, volume: 0.075 * loudness, glideTo: base * 1.16, pan, wet: 0.6 });
      this.tone(base * 0.96, { delay: 0.36, length: 0.38, volume: 0.07 * loudness, glideTo: base * 0.93, pan, wet: 0.6 });
    } else {
      // A trill.
      const notes = 7 + Math.floor(Math.random() * 6);
      for (let i = 0; i < notes; i++) this.tone(base * (i % 2 ? 1.07 : 1), { delay: i * 0.055, length: 0.05, volume: 0.055 * loudness, pan, wet: 0.5 });
    }
  }

  /** A mourning dove: soft, low, and slow. */
  private dove(loudness: number): void {
    const pan = rand(-0.7, 0.7);
    const f = rand(430, 480);
    this.tone(f, { length: 0.35, volume: 0.08 * loudness, glideTo: f * 1.28, pan, wet: 0.8, attack: 0.08 });
    [0.55, 1.15, 1.7].forEach((d, i) => this.tone(f * (i === 0 ? 1.02 : 0.98), { delay: d, length: 0.42, volume: 0.07 * loudness, pan, wet: 0.8, attack: 0.1 }));
  }

  private cricket(loudness: number): void {
    const pan = rand(-0.9, 0.9), f = rand(4200, 4900);
    for (let i = 0; i < 4; i++) this.tone(f, { delay: i * 0.045, length: 0.03, volume: 0.03 * loudness, pan, wet: 0.3 });
  }

  private bubble(loudness: number): void {
    const f = rand(450, 1300);
    this.tone(f, { length: rand(0.04, 0.09), volume: 0.05 * loudness, glideTo: f * rand(1.4, 2), pan: this.now.pan.water * 0.6 + rand(-0.3, 0.3) });
  }

  /** A cup set down on a saucer, somewhere nearby. */
  private clink(loudness: number): void {
    const f = rand(2300, 3300), pan = rand(-0.8, 0.8);
    this.tone(f, { length: 0.22, volume: 0.04 * loudness, pan, wet: 0.5 });
    this.tone(f * 1.52, { length: 0.14, volume: 0.02 * loudness, pan, wet: 0.5 });
  }

  private bikeBell(loudness: number): void {
    const pan = rand(-0.8, 0.8);
    for (const delay of [0, 0.19]) {
      this.tone(2090, { delay, length: 0.6, volume: 0.045 * loudness, pan, wet: 0.6 });
      this.tone(3140, { delay, length: 0.4, volume: 0.022 * loudness, pan, wet: 0.6 });
    }
  }

  /** A car going by on the freeway, from one side to the other. */
  private carPass(loudness: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime, length = rand(3, 4.5), from = Math.random() < 0.5 ? -1 : 1;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(380, t);
    f.frequency.linearRampToValueAtTime(620, t + length / 2);
    f.frequency.linearRampToValueAtTime(300, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * loudness, t + length / 2);
    g.gain.linearRampToValueAtTime(0, t + length);
    const place = ctx.createStereoPanner();
    place.pan.setValueAtTime(from * 0.9, t);
    place.pan.linearRampToValueAtTime(-from * 0.9, t + length);
    src.connect(f).connect(g).connect(place).connect(this.dry);
    src.start(t, Math.random() * 2);
    src.stop(t + length + 0.05);
  }

  /** The carousel's band organ: a tune over an oom-pah-pah. */
  private organ(loudness: number): void {
    const i = this.organNote++;
    const reed = (freq: number, volume: number, length: number) => {
      const ctx = this.ctx!;
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume * loudness, t + 0.02);
      g.gain.setValueAtTime(volume * loudness, t + length * 0.7);
      g.gain.linearRampToValueAtTime(0, t + length);
      for (const cents of [-6, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;
        osc.detune.value = cents;
        osc.connect(g);
        osc.start(t);
        osc.stop(t + length + 0.02);
      }
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 2400;
      g.connect(soften).connect(this.organPan);
    };
    const note = WALTZ[i % WALTZ.length];
    if (note >= 0) reed(C4 * 2 * Math.pow(2, note / 12), 0.022, 0.25);
    const bass = WALTZ_BASS[Math.floor(i / 3) % WALTZ_BASS.length];
    if (i % 3 === 0) reed((C4 / 2) * Math.pow(2, bass / 12), 0.04, 0.26);
    else for (const third of [4, 7]) reed(C4 * Math.pow(2, (bass + third) / 12), 0.013, 0.14);
  }

  // ---- Building blocks ----

  private tone(freq: number, o: { delay?: number; length: number; volume: number; type?: OscillatorType; glideTo?: number; pan?: number; wet?: number; attack?: number }): void {
    const ctx = this.ctx;
    if (!ctx || o.volume <= 0.0003) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.glideTo) osc.frequency.linearRampToValueAtTime(o.glideTo, t + o.length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.volume, t + (o.attack ?? Math.min(0.02, o.length / 3)));
    g.gain.exponentialRampToValueAtTime(0.0004, t + o.length);
    const place = ctx.createStereoPanner();
    place.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    osc.connect(g).connect(place).connect(this.dry);
    if (o.wet) {
      const send = ctx.createGain();
      send.gain.value = o.wet;
      place.connect(send).connect(this.wet);
    }
    osc.start(t);
    osc.stop(t + o.length + 0.03);
  }

  /** A short puff of filtered noise. */
  private burst(o: { freq: number; sweepTo?: number; q: number; type: BiquadFilterType; length: number; volume: number; delay?: number; attack?: number }): void {
    const ctx = this.ctx;
    if (!ctx || o.volume <= 0.0003) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.Q.value = o.q;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.volume, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0004, t + o.length);
    src.connect(f).connect(g).connect(this.dry);
    src.start(t, Math.random() * 2);
    src.stop(t + o.length + 0.03);
  }

  /** A continuous layer of filtered noise, silent until its gain is raised. A wobble rate makes it waver. */
  private bed(filters: { type: BiquadFilterType; freq: number; q: number }[], level: number, wobble: number, into: AudioNode): GainNode {
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
    src.start(0, Math.random() * 2);
    // A layer feeding another layer shares its volume; otherwise it gets its own, starting silent.
    if (into instanceof GainNode && into !== this.dry) {
      shape.connect(into);
      return into;
    }
    const out = ctx.createGain();
    out.gain.value = 0;
    shape.connect(out).connect(into);
    return out;
  }
}
