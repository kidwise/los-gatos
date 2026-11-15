import * as THREE from 'three';
import { P } from './palette';

// Shared by every painted surface, so the whole scene shifts together.
export const gouacheUniforms = {
  uPaper: { value: new THREE.Color(P.paper) },
  uLightTint: { value: new THREE.Color(0xfff7e8) },
  uHalfTint: { value: new THREE.Color(0xd9d4ea) },
  uShadowTint: { value: new THREE.Color(0x968cbc) },
  // The painted area: a centre and half-size (zero half-size gives a circle), then where the fade starts and ends beyond it.
  uFadeCenter: { value: new THREE.Vector2(0, 0) },
  uFadeHalf: { value: new THREE.Vector2(0, 0) },
  uFade: { value: new THREE.Vector2(35, 45) },
  // A round window cut through anything that roofs over the cat: screen position and radius in pixels.
  uHole: { value: new THREE.Vector3(0, 0, 0) },
};

const NOISE = /* glsl */ `
  float gHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float gNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(gHash(i), gHash(i + vec3(1, 0, 0)), f.x), mix(gHash(i + vec3(0, 1, 0)), gHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(gHash(i + vec3(0, 0, 1)), gHash(i + vec3(1, 0, 1)), f.x), mix(gHash(i + vec3(0, 1, 1)), gHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;

const PAINT = /* glsl */ `
  {
    #ifdef GOUACHE_HOLE
      if (uHole.z > 0.5) {
        float gHole = distance(gl_FragCoord.xy, uHole.xy) + (gNoise(vGWorld * 1.3) - 0.5) * uHole.z * 0.16;
        if (gHole < uHole.z) discard;
      }
    #endif
    vec3 gBase = diffuseColor.rgb;
    // Pigment unevenness inside a fill.
    gBase *= 1.0 + (gNoise(vGNoise * 0.55) - 0.5) * 0.09;
    #ifdef GOUACHE_UNLIT
      vec3 gCol = gBase;
    #else
      // How lit this point is, 0..1, including cast shadows.
      float gLit = dot(reflectedLight.directDiffuse, vec3(1.0)) / max(dot(diffuseColor.rgb, vec3(1.0)), 1e-4);
      // Brush wobble on the boundaries between the three tones.
      float gW = (gNoise(vGNoise * 2.3) - 0.5) * 0.09;
      float gHalf = smoothstep(0.10 + gW, 0.14 + gW, gLit);
      float gLight = smoothstep(0.50 + gW, 0.54 + gW, gLit);
      vec3 gCol = mix(gBase * uShadowTint, gBase * uHalfTint, gHalf);
      gCol = mix(gCol, gBase * uLightTint, gLight);
    #endif
    // The painting runs out into bare paper at its edge.
    float gD = length(max(abs(vGWorld.xz - uFadeCenter) - uFadeHalf, 0.0)) + (gNoise(vGWorld * 0.13) - 0.5) * 9.0;
    gCol = mix(gCol, uPaper, smoothstep(uFade.x, uFade.y, gD));
    outgoingLight = gCol;
  }
`;

export interface GouacheOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  /** Flat colour with no light or shadow, for lit windows and lamps. */
  unlit?: boolean;
  /** Noise follows the object instead of the world, for things that move. */
  local?: boolean;
  /** Can be cut away to show the cat underneath, for bridge decks. */
  hole?: boolean;
}

export function gouache(opts: GouacheOptions = {}): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: opts.color ?? 0xffffff,
    vertexColors: !!opts.vertexColors,
  });
  mat.defines = {
    ...(opts.unlit ? { GOUACHE_UNLIT: '' } : {}),
    ...(opts.local ? { GOUACHE_LOCAL: '' } : {}),
    ...(opts.hole ? { GOUACHE_HOLE: '' } : {}),
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, gouacheUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGWorld;\nvarying vec3 vGNoise;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec4 gW4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gW4 = instanceMatrix * gW4;
        #endif
        vGWorld = (modelMatrix * gW4).xyz;
        #ifdef GOUACHE_LOCAL
          vGNoise = transformed * 9.0;
        #else
          vGNoise = vGWorld;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGWorld;
        varying vec3 vGNoise;
        uniform vec3 uPaper, uLightTint, uHalfTint, uShadowTint;
        uniform vec2 uFade, uFadeCenter, uFadeHalf;
        uniform vec3 uHole;
        ${NOISE}`,
      )
      .replace('#include <opaque_fragment>', `${PAINT}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `gouache:${opts.unlit ? 'u' : ''}${opts.local ? 'l' : ''}${opts.hole ? 'h' : ''}`;
  return mat;
}
