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
import { gouacheUniforms } from './style/gouache';
import { makePaperPass } from './style/paperPass';
import { P } from './style/palette';
import { loadRegion } from './world/region';
import { cornerWorld, type World } from './world/world';

const WALK = 1.9;
const TROT = 4.4;
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
  const regionId = params.get('region');
  const world: World = regionId ? await loadRegion(regionId) : cornerWorld();
  scene.add(world.group);
  if (regionId) {
    document.getElementById('title')!.innerHTML = 'Los Gatos<em>Main Street</em>';
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
  const pos = new THREE.Vector3(num('x', world.start.x), 0, num('z', world.start.z));
  let heading = num('heading', world.start.heading);
  let speed = 0;
  let stuck = 0;
  const dir = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const before = new THREE.Vector3();
  // Start at the highest footing here (a bridge deck, if there is one) unless told otherwise.
  pos.y = num('y', world.heightAt(pos.x, pos.z, 1000));

  controls.groundY = () => pos.y;
  controls.onTap = (p) => {
    marker.position.set(p.x, world.heightAt(p.x, p.z, pos.y) + 0.12, p.z);
    markerLife = 1;
  };
  controls.onFirstInput = () => document.getElementById('hint')?.classList.add('gone');

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

  // The journal: things found along the way, and the sketchbook. Only on the real map.
  let journal: Journal | null = null;
  if (regionId) {
    document.body.classList.add('sketching');
    // `?reset` forgets everything found and drawn.
    if (params.has('reset')) Journal.forget(regionId);
    journal = new Journal({
      regionId,
      regionTitle: 'Main Street',
      finds: world.spots,
      rig,
      controls,
      canvas: renderer.domElement,
      heightAt: (x, z) => world.heightAt(x, z, 1000),
      placeName: (x, z) => world.placeName(x, z),
      view: (id) => world.ghosts.find((g) => g.spot === id)?.view ?? null,
      onSit: () => cat.sitNow(),
      onWear: (item, on) => cat.wear(item, on),
      onMeow: () => world.charm(pos),
    });
    scene.add(journal.group);
  }

  // A small handle for automated checks while developing.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __cat: {
        where: () => ({ x: pos.x, y: pos.y, z: pos.z }),
        journal: (action: 'camera' | 'draw' | 'meow') => journal?.debug(action),
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
    hole = THREE.MathUtils.lerp(hole, world.covered(pos) ? 1 : 0, 1 - Math.exp(-6 * dt));
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    seen.copy(pos).setY(pos.y + 0.4).project(rig.camera);
    const perMetre = Math.min(size.x, size.y) / rig.span;
    gouacheUniforms.uHole.value.set((seen.x * 0.5 + 0.5) * size.x, (seen.y * 0.5 + 0.5) * size.y, hole < 0.02 ? 0 : hole * Math.max(3.4 * perMetre, 70));
  };

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    controls.update();

    let want = 0;
    let moveDir: THREE.Vector3 | null = journal?.active ? null : controls.keyDirection(dir);
    if (journal?.active) controls.target = null;
    if (moveDir) {
      controls.target = null;
      want = controls.running ? TROT : WALK;
    } else if (controls.target) {
      dir.set(controls.target.x - pos.x, 0, controls.target.z - pos.z);
      const dist = dir.length();
      if (dist > 0.18) {
        moveDir = dir.divideScalar(dist);
        // A far-off finger or tap means hurry; close by, stroll and ease to a stop.
        want = dist > 5 ? TROT : Math.min(WALK, 0.5 + dist * 1.6);
      } else if (controls.arriving) {
        controls.target = null;
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
      pos.addScaledVector(moveDir, speed * facing * dt);
      world.resolve(pos, CAT_RADIUS);
      // Give up on a tap the cat cannot reach.
      const progress = Math.hypot(before.x - pos.x, before.z - pos.z) / Math.max(dt, 1e-4);
      stuck = progress < 0.2 ? stuck + dt : 0;
      if (stuck > 0.8 && controls.arriving) {
        controls.target = null;
        stuck = 0;
      }
    }
    place(0.35);
    cat.update(dt, moveDir ? speed : 0);
    world.update(dt, pos, moveDir ? speed : 0);

    if (markerLife > 0) {
      markerLife = Math.max(0, markerLife - dt * 1.4);
      marker.scale.setScalar(1 + (1 - markerLife) * 1.2);
      marker.material.opacity = markerLife * 0.8;
    }

    journal?.update(dt, pos, !!moveDir);
    // A ghost of what once stood here draws itself during its story moment.
    for (const g of world.ghosts) g.update(dt, journal?.momentId === g.spot || params.get('ghost') === g.spot);
    rig.update(dt, journal?.cameraFocus ?? focus.copy(pos).setY(pos.y + 0.45));
    // The pin grows with the view so it stays the same size on screen.
    const far = THREE.MathUtils.smoothstep(rig.span, 30, 50);
    pin.visible = far > 0.01 && !journal?.cameraFocus;
    if (pin.visible) {
      pin.position.copy(pos);
      pin.scale.setScalar((rig.span / 30) * (1 + Math.sin(now / 320) * 0.05));
      pinInk.opacity = far;
      pinLight.opacity = far;
    }
    aimSun();
    openHole(dt);
    composer.render();
    journal?.afterRender();
  });
}

void start();
