import * as THREE from 'three';
import { gouacheUniforms } from '../style/gouache';
import { buildCorner, type Collider } from './corner';
import { People } from './people';

/** A place the cat can walk around: the style-study corner, or a region built from the real map. */
export interface World {
  group: THREE.Group;
  start: { x: number; z: number; heading: number };
  /** Widest the camera may zoom out, in metres across the short side of the screen. */
  maxSpan: number;
  /** Pushes a walker of the given radius out of anything solid. */
  resolve(pos: THREE.Vector3, radius: number): void;
  /** Ground height under a point, for a walker currently at currentY (which picks bridge deck or below). */
  heightAt(x: number, z: number, currentY: number): number;
  update(dt: number, cat: THREE.Vector3, catSpeed: number): void;
  /** True when something walkable-over, like a bridge deck, is hiding a walker at this spot. */
  covered(pos: THREE.Vector3): boolean;
}

export function cornerWorld(): World {
  const corner = buildCorner();
  const people = new People(corner.seats, corner.standers);
  const group = new THREE.Group();
  group.add(corner.group, people.group);
  const colliders: Collider[] = corner.colliders.slice();
  for (const s of corner.standers) colliders.push({ kind: 'circle', x: s.x, z: s.z, r: 0.25 });

  gouacheUniforms.uFadeCenter.value.set(0, 0);
  gouacheUniforms.uFadeHalf.value.set(0, 0);
  gouacheUniforms.uFade.value.set(35, 45);

  return {
    group,
    start: { x: -3, z: -6.2, heading: 2.2 },
    maxSpan: 70,
    resolve(pos, radius) {
      for (const c of colliders) {
        if (c.kind === 'box') {
          const x0 = c.x0 - radius, x1 = c.x1 + radius, z0 = c.z0 - radius, z1 = c.z1 + radius;
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
          const min = c.r + radius;
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
      if (d > corner.radius) {
        pos.x *= corner.radius / d;
        pos.z *= corner.radius / d;
      }
    },
    // Sidewalks and the plaza sit a curb's height above the street.
    heightAt: (x, z) => (Math.abs(x) < 4.5 || Math.abs(z) < 4.5 ? 0 : 0.15),
    update: (dt, cat, catSpeed) => people.update(dt, cat, catSpeed),
    covered: () => false,
  };
}
