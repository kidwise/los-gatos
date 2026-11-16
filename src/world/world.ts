import * as THREE from 'three';
import { gouacheUniforms } from '../style/gouache';
import { buildCorner, type Collider } from './corner';
import type { Ambience } from '../game/sound';
import type { Ghost } from './ghosts';
import { CORNER_WALKWAYS, People } from './people';

/** A place the cat can walk around: the style-study corner, or a region built from the real map. */
export interface World {
  group: THREE.Group;
  title: string;
  /** Edges that lead on to a neighbouring region: which one, and the z of the edge. */
  exits: { to: string; side: 'north' | 'south'; edge: number }[];
  start: { x: number; z: number; heading: number };
  /** Where the very first visit begins, if this region is where the story starts. */
  home?: { x: number; z: number; heading: number };
  /** Widest the camera may zoom out, in metres across the short side of the screen. */
  maxSpan: number;
  /** Pushes a walker of the given radius out of anything solid. */
  resolve(pos: THREE.Vector3, radius: number): void;
  /** Ground height under a point, for a walker currently at currentY (which picks bridge deck or below). */
  heightAt(x: number, z: number, currentY: number): number;
  update(dt: number, cat: THREE.Vector3, catSpeed: number): void;
  /** Tells the world how much of it is on screen (metres across), so it need not animate what cannot be seen. */
  setView?(span: number): void;
  /** True when something walkable-over, like a bridge deck, is hiding a walker at this spot. */
  covered(pos: THREE.Vector3): boolean;
  /** A way along streets and paths between two points, as x, z pairs; null if there is none. */
  route(fromX: number, fromZ: number, toX: number, toZ: number): number[] | null;
  /** Things to ride. */
  rides: Ride[];
  /** Things to find. Empty where there are none. */
  spots: Find[];
  /** People near this point stop and turn to the cat. Returns how many did. */
  charm(pos: THREE.Vector3): number;
  /** A name for wherever this is. */
  placeName(x: number, z: number): string;
  /** What surrounds this point, for sound. */
  ambience(pos: THREE.Vector3): Ambience;
  /** Things that once stood here, which draw themselves in pencil at their sketch spot. */
  ghosts: Ghost[];
}

/** Something the cat can ride. While riding, the ride decides where the cat is. */
export interface Ride {
  /** What the button says, for example "Hop on the train". */
  label: string;
  /** Close enough to get on? */
  near(pos: THREE.Vector3): boolean;
  /** Puts the cat's seat position into `out` and returns the way it faces. */
  seat(out: THREE.Vector3): number;
  /** For a ride the player steers: head this way (a ground direction) at this speed, in metres a second. */
  steer?(dt: number, dirX: number, dirZ: number, pace: number): void;
  /** Whether there is somewhere to get off right now. Rides without this can be left at any time. */
  canLeave?(): boolean;
  leaveLabel?: string;
  /** True when the rider sits under a roof that should open to show them. */
  roofed?: boolean;
  /** Puts a spot to step off onto into `out`. */
  exit(out: THREE.Vector3): void;
}

/** Something to come across in town: a history moment, a thing to wear, or an extra trick. */
export interface Find {
  id: string;
  kind: 'story' | 'wear' | 'skill';
  /** Which wardrobe piece or trick this gives. */
  item?: string;
  title: string;
  blurb: string;
  /** The camera lowers here to look south to the mountains. */
  lookout?: boolean;
  /** Reaching this is the closing moment of the wander. */
  ending?: boolean;
  x: number;
  z: number;
}

export function cornerWorld(): World {
  const corner = buildCorner();
  // Sidewalks and the plaza sit a curb's height above the street.
  const heightAt = (x: number, z: number) => (Math.abs(x) < 4.5 || Math.abs(z) < 4.5 ? 0 : 0.15);
  const people = new People({ seats: corner.seats, standers: corner.standers, walkways: CORNER_WALKWAYS, walkers: 26, heightAt });
  const group = new THREE.Group();
  group.add(corner.group, people.group);
  const colliders: Collider[] = corner.colliders.slice();
  for (const s of corner.standers) colliders.push({ kind: 'circle', x: s.x, z: s.z, r: 0.25 });

  gouacheUniforms.uFadeCenter.value.set(0, 0);
  gouacheUniforms.uFadeHalf.value.set(0, 0);
  gouacheUniforms.uFade.value.set(35, 45);

  return {
    group,
    title: 'The Corner',
    exits: [],
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
    heightAt,
    update: (dt, cat, catSpeed) => people.update(dt, cat, catSpeed),
    covered: () => false,
    route: () => null,
    rides: [],
    spots: [],
    charm: (pos) => people.call(pos.x, pos.z, 11),
    placeName: () => 'The Corner',
    ambience: (pos) => ({ water: 0, traffic: 0, town: Math.min(1, 0.4 + people.countNear(pos.x, pos.z, 30) / 12), green: 0.35, train: 0, carousel: 0 }),
    ghosts: [],
  };
}
