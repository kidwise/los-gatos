import '@fontsource/playfair-display/500.css';
import '@fontsource/playfair-display/600-italic.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Cat, CAT_SCALE, type DebugPose } from './cat/Cat';
import { CameraRig } from './game/cameraRig';
import { Controls } from './game/controls';
import { makePaperPass } from './style/paperPass';
import { P } from './style/palette';
import { buildCorner, type Collider } from './world/corner';
import { People } from './world/people';

const WALK = 1.9;
const TROT = 4.4;
const CAT_RADIUS = 0.2 * CAT_SCALE;

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
  sun.position.set(68, 76, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -56;
  sun.shadow.camera.right = 56;
  sun.shadow.camera.top = 56;
  sun.shadow.camera.bottom = -56;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const corner = buildCorner();
  scene.add(corner.group);

  const people = new People(corner.seats, corner.standers);
  scene.add(people.group);
  for (const s of corner.standers) corner.colliders.push({ kind: 'circle', x: s.x, z: s.z, r: 0.25 });

  const cat = new Cat();
  scene.add(cat.root);
  if (params.has('pose')) {
    cat.debugPose = params.get('pose') as DebugPose;
    cat.debugPhase = num('phase', 0.1);
  }

  const rig = new CameraRig();
  rig.span = num('span', 8.5);
  const controls = new Controls(renderer.domElement, rig);

  // Tap marker: a ring that opens and fades where the cat is headed.
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.3, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: P.persimmon, transparent: true, opacity: 0, depthWrite: false }),
  );
  marker.renderOrder = 3;
  scene.add(marker);
  let markerLife = 0;
  controls.onTap = (p) => {
    marker.position.set(p.x, 0.2, p.z);
    markerLife = 1;
  };
  controls.onFirstInput = () => document.getElementById('hint')?.classList.add('gone');

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
    rig.resize(w / h);
  };
  window.addEventListener('resize', resize);
  resize();

  // The cat's place in the world.
  const pos = new THREE.Vector3(num('x', -3), 0, num('z', -6.2));
  let heading = num('heading', 2.2);
  let speed = 0;
  let stuck = 0;
  const dir = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const before = new THREE.Vector3();

  const place = () => {
    // Sidewalks and the plaza sit a curb's height above the street.
    const onStreet = Math.abs(pos.x) < 4.5 || Math.abs(pos.z) < 4.5;
    pos.y = THREE.MathUtils.lerp(pos.y, onStreet ? 0 : 0.15, 0.35);
    cat.root.position.copy(pos);
    cat.root.rotation.y = heading;
  };
  pos.y = Math.abs(pos.x) < 4.5 || Math.abs(pos.z) < 4.5 ? 0 : 0.15;
  place();
  rig.snapTo(focus.copy(pos).setY(pos.y + 0.45));

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    controls.update();

    let want = 0;
    let moveDir: THREE.Vector3 | null = controls.keyDirection(dir);
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
      collide(pos, corner.colliders, corner.radius);
      // Give up on a tap the cat cannot reach.
      const progress = before.distanceTo(pos) / Math.max(dt, 1e-4);
      stuck = progress < 0.2 ? stuck + dt : 0;
      if (stuck > 0.8 && controls.arriving) {
        controls.target = null;
        stuck = 0;
      }
    }
    place();
    cat.update(dt, moveDir ? speed : 0);
    people.update(dt, pos, moveDir ? speed : 0);

    if (markerLife > 0) {
      markerLife = Math.max(0, markerLife - dt * 1.4);
      marker.scale.setScalar(1 + (1 - markerLife) * 1.2);
      marker.material.opacity = markerLife * 0.8;
    }

    rig.update(dt, focus.copy(pos).setY(pos.y + 0.45));
    composer.render();
  });
}

/** Push the cat out of anything solid and keep it inside the painted area. */
function collide(pos: THREE.Vector3, colliders: Collider[], radius: number): void {
  for (const c of colliders) {
    if (c.kind === 'box') {
      const x0 = c.x0 - CAT_RADIUS, x1 = c.x1 + CAT_RADIUS, z0 = c.z0 - CAT_RADIUS, z1 = c.z1 + CAT_RADIUS;
      if (pos.x <= x0 || pos.x >= x1 || pos.z <= z0 || pos.z >= z1) continue;
      const exits = [pos.x - x0, x1 - pos.x, pos.z - z0, z1 - pos.z];
      const side = exits.indexOf(Math.min(...exits));
      if (side === 0) pos.x = x0;
      else if (side === 1) pos.x = x1;
      else if (side === 2) pos.z = z0;
      else pos.z = z1;
    } else {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const min = c.r + CAT_RADIUS;
      const d = Math.hypot(dx, dz);
      if (d >= min) continue;
      if (d < 1e-4) pos.x += min;
      else {
        pos.x = c.x + (dx / d) * min;
        pos.z = c.z + (dz / d) * min;
      }
    }
  }
  const d = Math.hypot(pos.x, pos.z);
  if (d > radius) {
    pos.x *= radius / d;
    pos.z *= radius / d;
  }
}

void start();
