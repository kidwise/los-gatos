import '@fontsource/playfair-display/500.css';
import '@fontsource/playfair-display/600-italic.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Cat, CAT_SCALE, type DebugPose } from './cat/Cat';
import { CameraRig } from './game/cameraRig';
import { Controls } from './game/controls';
import { Journal } from './game/journal';
import { Sound, type Ambience } from './game/sound';
import { gouacheUniforms } from './style/gouache';
import { makePaperPass } from './style/paperPass';
import { P } from './style/palette';
import { loadRegion } from './world/region';
import { Ridge } from './world/ridge';
import { cornerWorld, type Find, type Ride, type World } from './world/world';

const WALK = 1.9;
const TROT = 4.4;
/** Top speed when travelling across the zoomed-out map. */
const DASH = 26;
const CAT_RADIUS = 0.2 * CAT_SCALE;
const SUN = new THREE.Vector3(68, 76, 28).normalize();

async function start(): Promise<void> {
  // Sign lettering is drawn to canvas, so the typeface must be ready first.
  await Promise.all([
    document.fonts.load('italic 600 96px "Playfair Display"'),
    document.fonts.load('500 70px "Playfair Display"'),
  ]).catch(() => undefined);

  const params = new URLSearchParams(location.search);
  const num = (key: string, fallback: number) => (params.has(key) ? Number(params.get(key)) : fallback);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(P.paper);

  // One warm sun. Its strength is PI so a fully lit surface measures exactly 1 in the paint shader.
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // `?region=main-street` loads a region built from the real map; without it, the style-study corner.
  // Where the cat was when the game was last closed, so a visit picks up where the last one ended.
  const PLACE_KEY = 'los-gatos:place';
  let saved: { region: string; x: number; z: number } | null = null;
  try {
    if (params.has('reset')) localStorage.removeItem(PLACE_KEY);
    saved = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  // `?region=` picks a region and `?corner` the style study; otherwise resume, or begin on Main Street.
  const regionId = params.get('region') ?? (params.has('corner') ? null : saved?.region ?? 'main-street');
  const placed = params.has('region') || params.has('x');
  // The very first visit opens with the cat asleep under the plaza cedar.
  const firstVisit = !placed && !saved && !!regionId && (params.has('reset') || Journal.fresh);
  const world: World = regionId ? await loadRegion(regionId, params.get('from')) : cornerWorld();
  scene.add(world.group);
  if (regionId) {
    document.getElementById('title')!.innerHTML = `Los Gatos<em>${world.title}</em>`;
    document.getElementById('credit')!.textContent = 'Map data © OpenStreetMap contributors';
  }

  const cat = new Cat();
  scene.add(cat.root);
  if (params.has('pose')) {
    cat.debugPose = params.get('pose') as DebugPose;
    cat.debugPhase = num('phase', 0.1);
  }

  const rig = new CameraRig();
  rig.maxSpan = world.maxSpan;
  rig.span = num('span', 8.5);
  const controls = new Controls(renderer.domElement, rig);

  // Tap marker: a ring that opens and fades where the cat is headed.
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.3, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: P.persimmon, transparent: true, opacity: 0, depthWrite: false, depthTest: false }),
  );
  marker.renderOrder = 3;
  scene.add(marker);
  let markerLife = 0;

  // "You are here": a pin over the cat that appears as the camera pulls back, so it is never lost on the map.
  const pinInk = new THREE.MeshBasicMaterial({ color: P.navy, transparent: true, depthTest: false, depthWrite: false });
  const pinLight = new THREE.MeshBasicMaterial({ color: P.trim, transparent: true, depthTest: false, depthWrite: false });
  const pin = new THREE.Group();
  const pinHead = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), pinInk);
  pinHead.position.y = 2.25;
  const pinTip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 20).rotateX(Math.PI).translate(0, 1.15, 0), pinInk);
  const pinDot = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), pinLight);
  pinDot.position.y = 2.25;
  const pinRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 32).rotateX(-Math.PI / 2), pinInk);
  pinRing.position.y = 0.1;
  for (const m of [pinRing, pinTip, pinHead]) m.renderOrder = 6;
  pinDot.renderOrder = 7;
  pin.add(pinRing, pinTip, pinHead, pinDot);
  scene.add(pin);

  const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, rig.camera));
  composer.addPass(new OutputPass());
  const paper = makePaperPass();
  composer.addPass(paper);

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    paper.uniforms.uRes.value.set(w * dpr, h * dpr);
    paper.uniforms.uDpr.value = dpr;
    gouacheUniforms.uDpr.value = dpr;
    rig.resize(w / h);
  };
  window.addEventListener('resize', resize);
  resize();

  // The cat's place in the world.
  const begin = firstVisit && world.home ? world.home : !placed && saved?.region === regionId ? { x: saved.x, z: saved.z, heading: world.start.heading } : world.start;
  const pos = new THREE.Vector3(num('x', begin.x), 0, num('z', begin.z));
  let heading = num('heading', begin.heading);
  let speed = 0;
  let stuck = 0;
  const dir = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const before = new THREE.Vector3();
  // Start at the highest footing here (a bridge deck, if there is one) unless told otherwise.
  pos.y = num('y', world.heightAt(pos.x, pos.z, 1000));

  controls.groundY = () => pos.y;
  // A far-off tap is followed along streets and paths, as x, z waypoints still to pass.
  let path: number[] = [];
  controls.onTap = (p) => {
    // On the map view, tapping a place already found takes the cat straight there.
    if (rig.span > 55 && journal) {
      const reach = rig.span * 0.045;
      const known = world.spots.find((s) => journal!.isFound(s.id) && Math.hypot(s.x - p.x, s.z - p.z) < reach);
      if (known) {
        controls.target = null;
        travelTo(known.x + 4, known.z);
        return;
      }
    }
    marker.position.set(p.x, world.heightAt(p.x, p.z, pos.y) + 0.12, p.z);
    marker.scale.setScalar(Math.max(1, rig.span / 30));
    markerLife = 1;
    path = Math.hypot(p.x - pos.x, p.z - pos.z) > 22 ? world.route(pos.x, pos.z, p.x, p.z) ?? [] : [];
  };

  // Being carried somewhere: the picture fades to paper, the cat is moved, and it fades back.
  const fade = document.getElementById('fade') as HTMLDivElement;
  const travelTo = (x: number, z: number) => {
    fade.classList.add('on');
    setTimeout(() => {
      pos.set(x, 0, z);
      world.resolve(pos, CAT_RADIUS);
      pos.y = world.heightAt(pos.x, pos.z, 1000);
      path = [];
      controls.target = null;
      rig.span = 8.5;
      place(1);
      rig.snapTo(focus.copy(pos).setY(pos.y + 0.45));
      fade.classList.remove('on');
    }, 420);
  };
  controls.onFirstInput = () => document.getElementById('hint')?.classList.add('gone');

  // Sound starts with the first touch, which is when browsers allow it.
  const sound = new Sound();
  const wake = () => sound.start();
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  const soundButton = document.getElementById('sound-btn') as HTMLButtonElement;
  const showSound = () => (soundButton.textContent = sound.muted ? 'Sound off' : 'Sound on');
  soundButton.onclick = () => {
    sound.toggleMute();
    showSound();
  };
  showSound();
  let around: Ambience = { water: 0, traffic: 0, town: 0, green: 0, train: 0, carousel: 0 };
  let listenIn = 0;

  const place = (ease: number) => {
    pos.y = THREE.MathUtils.lerp(pos.y, world.heightAt(pos.x, pos.z, pos.y), ease);
    cat.root.position.copy(pos);
    cat.root.rotation.y = heading;
  };
  place(1);
  rig.snapTo(focus.copy(pos).setY(pos.y + 0.45));

  // Shadows are drawn only around the cat, in a box that widens as the camera pulls back.
  let shadowHalf = 0;
  const aimSun = () => {
    const half = Math.max(56, rig.span * 0.75);
    if (half !== shadowHalf) {
      shadowHalf = half;
      const c = sun.shadow.camera;
      c.left = c.bottom = -half;
      c.right = c.top = half;
      c.near = 1;
      c.far = half * 4 + 200;
      c.updateProjectionMatrix();
    }
    // Move in whole shadow-map pixels so shadow edges do not shimmer as the cat walks.
    const texel = (half * 2) / sun.shadow.mapSize.x;
    const sx = Math.round(pos.x / texel) * texel;
    const sz = Math.round(pos.z / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx, 0, sz).addScaledVector(SUN, shadowHalf * 2 + 100);
  };

  const regionTitles: Record<string, string> = {};
  // The journal: things found along the way, and the sketchbook. Only on the real map.
  let journal: Journal | null = null;
  if (regionId) {
    document.body.classList.add('sketching');
    // `?reset` forgets everything found and drawn.
    if (params.has('reset')) Journal.forget();
    // What there is to find in the other regions, for the journal's lists.
    type Listing = Record<string, { title: string; finds?: Omit<Find, 'x' | 'z'>[] }>;
    const manifest: Listing = await fetch(`${import.meta.env.BASE_URL}regions/manifest.json`).then((r) => r.json()).catch(() => ({}));
    for (const e of world.exits) regionTitles[e.to] = manifest[e.to]?.title ?? e.to;
    const elsewhere = Object.entries(manifest)
      .filter(([key]) => key !== regionId)
      .flatMap(([, r]) => (r.finds ?? []).map((find) => ({ find, region: r.title })));
    journal = new Journal({
      regionTitle: world.title,
      finds: world.spots,
      elsewhere,
      rig,
      controls,
      canvas: renderer.domElement,
      heightAt: (x, z) => world.heightAt(x, z, 1000),
      placeName: (x, z) => world.placeName(x, z),
      view: (id) => {
        const ghost = world.ghosts.find((g) => g.spot === id);
        if (ghost) return ghost.view;
        // At a lookout the camera comes down low and turns south, to the mountains.
        const spot = world.spots.find((s) => s.id === id);
        return spot?.lookout ? { x: spot.x, y: world.heightAt(spot.x, spot.z, 1000) + 2, z: spot.z, span: 120, yaw: Math.PI - 0.22, pitch: 0.17 } : null;
      },
      onSit: () => cat.sitNow(),
      onWear: (item, on) => cat.wear(item, on),
      onMeow: () => {
        world.charm(pos);
        sound.meow();
      },
      onFound: () => sound.chime(),
    });
    scene.add(journal.group);
  }

  // A small handle for automated checks while developing.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __cat: {
        where: () => ({ x: pos.x, y: pos.y, z: pos.z }),
        journal: (action: 'camera' | 'draw' | 'meow') => journal?.debug(action),
        riding: () => !!riding,
        tap: (x: number, z: number) => {
          const p = new THREE.Vector3(x, 0, z);
          controls.target = p;
          controls.arriving = true;
          controls.onTap?.(p);
        },
        zoom: (span: number) => (rig.span = span),
        go: (x: number, z: number) => {
          controls.target = new THREE.Vector3(x, 0, z);
          controls.arriving = true;
        },
      },
    });
  }

  // When a bridge deck hides the cat, a round window opens in the deck around it.
  let hole = 0;
  const seen = new THREE.Vector3();
  const openHole = (dt: number) => {
    hole = THREE.MathUtils.lerp(hole, world.covered(pos) || riding?.roofed ? 1 : 0, 1 - Math.exp(-6 * dt));
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    seen.copy(pos).setY(pos.y + 0.4).project(rig.camera);
    const perMetre = Math.min(size.x, size.y) / rig.span;
    gouacheUniforms.uHole.value.set((seen.x * 0.5 + 0.5) * size.x, (seen.y * 0.5 + 0.5) * size.y, hole < 0.02 ? 0 : hole * Math.max(3.4 * perMetre, 70));
  };

  // The mountains, which show at lookouts, and the dusk that falls at the end of the trail.
  const ridge = new Ridge();
  scene.add(ridge.group);
  const DAY = { light: new THREE.Color(0xfff7e8), half: new THREE.Color(0xd9d4ea), shadow: new THREE.Color(0x968cbc) };
  const DUSK = { light: new THREE.Color(0xffe0bd), half: new THREE.Color(0xe2b9c2), shadow: new THREE.Color(0x7a68a8) };
  const endingId = world.spots.find((s) => s.ending)?.id ?? null;
  let dusk = 0;
  let endingIn = -1;
  const endingCard = document.getElementById('ending') as HTMLDivElement;
  (document.getElementById('ending-close') as HTMLButtonElement).onclick = () => endingCard.classList.remove('on');

  // The opening: the town seen from above, the cat asleep, until the first touch.
  const intro = document.getElementById('intro') as HTMLDivElement;
  let opening = firstVisit;
  if (opening) {
    intro.classList.add('on');
    rig.span = 46;
    rig.snapTo(focus.copy(pos).setY(pos.y + 0.45));
    document.getElementById('hint')!.classList.add('gone');
    const wakeUp = () => {
      opening = false;
      intro.classList.remove('on');
      rig.span = 8.5;
      window.removeEventListener('pointerdown', wakeUp);
      window.removeEventListener('keydown', wakeUp);
    };
    window.addEventListener('pointerdown', wakeUp);
    window.addEventListener('keydown', wakeUp);
  }

  // Remember where the cat is, every few seconds and when the page is put away.
  const remember = () => {
    if (!regionId || riding || opening) return;
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify({ region: regionId, x: Math.round(pos.x * 10) / 10, z: Math.round(pos.z * 10) / 10 }));
    } catch {
      // Without storage the next visit simply starts from the beginning.
    }
  };
  setInterval(remember, 4000);
  window.addEventListener('pagehide', remember);

  // Rides: near a train car or the carousel, a button offers a seat. While riding, the ride moves the cat.
  const rideButton = document.getElementById('ride-btn') as HTMLButtonElement;
  let riding: Ride | null = null;
  let offered: Ride | null = null;
  rideButton.onclick = () => {
    if (riding) {
      riding.exit(pos);
      world.resolve(pos, CAT_RADIUS);
      pos.y = world.heightAt(pos.x, pos.z, pos.y + 0.5);
      riding = null;
    } else if (offered) {
      riding = offered;
      controls.target = null;
    }
    offered = null;
    rideButton.classList.remove('on');
  };

  const exitButton = document.getElementById('exit-btn') as HTMLButtonElement;
  let exitShown: World['exits'][number] | null = null;

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    controls.update();

    let want = 0;
    const held = journal?.active || !!riding || opening;
    if (opening) cat.sitNow();
    let moveDir: THREE.Vector3 | null = held ? null : controls.keyDirection(dir);
    if (held) controls.target = null;
    if (moveDir) {
      controls.target = null;
      want = controls.running ? TROT : WALK;
    } else if (controls.target) {
      if (!controls.arriving) path = [];
      // Drop waypoints as they are reached; a faster cat is allowed to cut each corner wider.
      while (path.length && Math.hypot(path[0] - pos.x, path[1] - pos.z) < Math.max(1.6, speed * 0.22)) path.splice(0, 2);
      const far = Math.hypot(controls.target.x - pos.x, controls.target.z - pos.z);
      if (path.length) dir.set(path[0] - pos.x, 0, path[1] - pos.z);
      else dir.set(controls.target.x - pos.x, 0, controls.target.z - pos.z);
      const dist = dir.length();
      if (far > 0.18 && dist > 0.01) {
        moveDir = dir.divideScalar(dist);
        // The wider the view, the faster the cat covers ground: a trot at street level, a dash on the map.
        const pace = THREE.MathUtils.lerp(TROT, DASH, THREE.MathUtils.smoothstep(rig.span, 26, 190));
        // A far-off finger or tap means hurry; close by, stroll and ease to a stop.
        want = far > 5 ? Math.min(pace, TROT + far * 0.9) : Math.min(WALK, 0.5 + far * 1.6);
      } else if (controls.arriving) {
        controls.target = null;
        path = [];
      }
    }

    speed = THREE.MathUtils.lerp(speed, want, 1 - Math.exp(-7 * dt));
    if (moveDir && speed > 0.05) {
      const goal = Math.atan2(moveDir.x, moveDir.z);
      const diff = Math.atan2(Math.sin(goal - heading), Math.cos(goal - heading));
      heading += diff * (1 - Math.exp(-10 * dt));
      // Slow down through sharp turns so the cat arcs instead of sliding sideways.
      const facing = Math.max(0.15, Math.cos(diff));
      before.copy(pos);
      // Move in short steps so that even at a dash the cat cannot pass through a wall.
      const travel = speed * facing * dt;
      const steps = Math.max(1, Math.ceil(travel / 0.25));
      for (let i = 0; i < steps; i++) {
        pos.addScaledVector(moveDir, travel / steps);
        world.resolve(pos, CAT_RADIUS);
      }
      // Give up on a tap the cat cannot reach.
      const progress = Math.hypot(before.x - pos.x, before.z - pos.z) / Math.max(dt, 1e-4);
      stuck = progress < 0.2 ? stuck + dt : 0;
      if (stuck > 0.8 && controls.arriving) {
        path = [];
        controls.target = null;
        stuck = 0;
      }
    }
    if (!riding) place(0.35);
    // The legs only go so fast; beyond that the cat simply covers more ground.
    cat.update(dt, moveDir ? Math.min(speed, 7) : 0);
    world.update(dt, pos, moveDir ? speed : 0);
    if (riding) {
      // The ride carries the cat, sitting, wherever it goes.
      heading = riding.seat(pos);
      cat.root.position.copy(pos);
      cat.root.rotation.y = heading;
      cat.sitNow();
      speed = 0;
    }
    const canRide = riding ?? (journal?.active ? null : world.rides.find((r) => r.near(pos)) ?? null);
    if (canRide !== offered) {
      offered = canRide;
      rideButton.classList.toggle('on', !!canRide);
      if (canRide) rideButton.textContent = riding ? 'Hop off' : canRide.label;
    }

    if (markerLife > 0) {
      markerLife = Math.max(0, markerLife - dt * 1.4);
      marker.scale.setScalar(Math.max(1, rig.span / 30) * (1 + (1 - markerLife) * 1.2));
      marker.material.opacity = markerLife * 0.8;
    }

    journal?.update(dt, pos, !!moveDir);
    // At an edge that leads on, offer the way to the next region.
    const exit = world.exits.find((e) => Math.abs(pos.z - e.edge) < 18) ?? null;
    if (exit !== exitShown) {
      exitShown = exit;
      exitButton.classList.toggle('on', !!exit);
      if (exit) {
        exitButton.textContent = `Walk on to ${regionTitles[exit.to] ?? exit.to} →`;
        exitButton.onclick = () => (location.search = `?region=${exit.to}&from=${regionId}`);
      }
    }
    // A ghost of what once stood here draws itself during its story moment.
    for (const g of world.ghosts) g.update(dt, journal?.momentId === g.spot || params.get('ghost') === g.spot);
    const lookAt = journal?.cameraFocus ?? focus.copy(pos).setY(pos.y + 0.45);
    rig.update(dt, lookAt);

    // Dusk falls while the cat sits at the end of the trail, and lifts when it walks on.
    const atEnd = !!endingId && journal?.momentId === endingId;
    dusk += ((atEnd ? 1 : 0) - dusk) * (1 - Math.exp(-0.9 * dt));
    gouacheUniforms.uLightTint.value.copy(DAY.light).lerp(DUSK.light, dusk);
    gouacheUniforms.uHalfTint.value.copy(DAY.half).lerp(DUSK.half, dusk);
    gouacheUniforms.uShadowTint.value.copy(DAY.shadow).lerp(DUSK.shadow, dusk);
    ridge.update(rig, lookAt, dusk);
    // A few seconds into that last view, a quiet closing card.
    if (atEnd && endingIn < 0) endingIn = 5;
    if (!atEnd) {
      endingIn = -1;
      endingCard.classList.remove('on');
    } else if (endingIn > 0 && (endingIn -= dt) <= 0) {
      endingIn = 0;
      const s = journal!.summary;
      document.getElementById('ending-tally')!.textContent = `${s.found} of ${s.total} things found · ${s.pages} ${s.pages === 1 ? 'sketch' : 'sketches'} drawn`;
      endingCard.classList.add('on');
    }
    // The pin grows with the view so it stays the same size on screen.
    const far = THREE.MathUtils.smoothstep(rig.span, 30, 50);
    pin.visible = far > 0.01 && !journal?.cameraFocus;
    if (pin.visible) {
      pin.position.copy(pos);
      pin.scale.setScalar((rig.span / 30) * (1 + Math.sin(now / 320) * 0.05));
      pinInk.opacity = far;
      pinLight.opacity = far;
    }
    // What the cat can hear is checked a few times a second, not every frame.
    listenIn -= dt;
    if (listenIn <= 0) {
      listenIn = 0.25;
      around = world.ambience(pos);
    }
    sound.update(dt, around, moveDir ? speed : 0);
    aimSun();
    openHole(dt);
    composer.render();
    journal?.afterRender();
  });
}

void start();
