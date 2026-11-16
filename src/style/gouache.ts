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
  // 1 draws the world painted; 0 draws it as a pencil sketch, which is how sketchbook pages are made.
  uPainted: { value: 1 },
  uDpr: { value: 1 },
  // Seconds since the game began, for water that moves.
  uTime: { value: 0 },
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
    #if defined(GOUACHE_WATER) || defined(GOUACHE_MEADOW)
      // Brush marks run across the picture: gU along the screen, gV into it.
      float gU = dot(vGWorld.xz, vec2(0.7071, -0.7071));
      float gV = dot(vGWorld.xz, vec2(0.7071, 0.7071));
      // Fine marks fade out when the view is pulled back, so they never turn to speckle.
      float gFine = 1.0 - smoothstep(0.12, 0.5, fwidth(gV));
    #endif
    #ifdef GOUACHE_WATER
    {
      // Painted in held frames, like the cat, so the ripples shift a few times a second.
      float gT = floor(uTime * 5.0) / 5.0;
      // Broad paler reaches where the sky lies on the water.
      float gSky = gNoise(vec3(gU * 0.02, gV * 0.055, gT * 0.04));
      gBase *= 0.95 + 0.15 * smoothstep(0.46, 0.5, gSky);
      // Rows of short brush dashes: mostly light, a few dark.
      float gRow = floor(gV / 1.5);
      float gIn = fract(gV / 1.5);
      float gMask = smoothstep(0.2, 0.3, gIn) * smoothstep(0.62, 0.52, gIn) * gFine;
      float gDash = gMask > 0.0 ? gNoise(vec3(gU * 0.22 + gRow * 7.31 + gT * 0.35, gRow * 1.7, 0.0)) : 0.5;
      gBase = mix(gBase, gBase * 1.2 + 0.03, smoothstep(0.66, 0.69, gDash) * gMask);
      gBase = mix(gBase, gBase * 0.86, smoothstep(0.3, 0.27, gDash) * gMask);
    }
    #endif
    #ifdef GOUACHE_MEADOW
    {
      // Only grass is painted this way: anything clearly green.
      float gGreen = smoothstep(0.015, 0.05, gBase.g - max(gBase.r, gBase.b));
      vec2 gM = vGWorld.xz;
      // Flat patches of sun-dried and of lusher grass, with wandering edges.
      vec3 gGrass = gBase;
      if (gGreen > 0.0) {
      float gPatch = gNoise(vec3(gM * 0.05, 1.0));
      gGrass = mix(gGrass, gBase * vec3(1.1, 1.06, 0.82), smoothstep(0.62, 0.64, gPatch));
      gGrass = mix(gGrass, gBase * vec3(0.84, 0.93, 0.86), smoothstep(0.4, 0.38, gPatch));
      // The fine marks are only worked out when close enough to see them.
      if (gFine > 0.02) {
      // Short strokes of grass, lighter and darker.
      float gStroke = gNoise(vec3(gU * 1.7, gV * 0.5, 2.0));
      gGrass *= 1.0 + (smoothstep(0.62, 0.65, gStroke) - smoothstep(0.38, 0.35, gStroke)) * 0.075 * gFine;
      // Drifts of wildflowers: white, yellow and pink dabs, each a little off its grid.
      float gDrift = 1.0 - gPatch;
      vec3 gCell = vec3(floor(gM / 0.6), 3.0);
      float gPick = gHash(gCell);
      vec2 gAt = fract(gM / 0.6) - 0.5 - (vec2(gHash(gCell + 2.0), gHash(gCell + 5.0)) - 0.5) * 0.5;
      float gDab = (1.0 - smoothstep(0.15, 0.2, length(gAt))) * step(0.7, gPick) * smoothstep(0.52, 0.56, gDrift) * gFine;
      vec3 gPetal = gPick > 0.9 ? vec3(0.8, 0.22, 0.26) : gPick > 0.8 ? vec3(0.9, 0.55, 0.09) : vec3(0.9, 0.88, 0.8);
      gGrass = mix(gGrass, gPetal, gDab);
      }
      }
      gBase = mix(gBase, gGrass, gGreen);
    }
    #endif
    float gHalf = 1.0;
    float gLight = 1.0;
    #ifdef GOUACHE_UNLIT
      vec3 gCol = gBase;
    #else
      // How lit this point is, 0..1, including cast shadows.
      float gLit = dot(reflectedLight.directDiffuse, vec3(1.0)) / max(dot(diffuseColor.rgb, vec3(1.0)), 1e-4);
      // Brush wobble on the boundaries between the three tones.
      float gW = (gNoise(vGNoise * 2.3) - 0.5) * 0.09;
      gHalf = smoothstep(0.10 + gW, 0.14 + gW, gLit);
      gLight = smoothstep(0.50 + gW, 0.54 + gW, gLit);
      vec3 gCol = mix(gBase * uShadowTint, gBase * uHalfTint, gHalf);
      gCol = mix(gCol, gBase * uLightTint, gLight);
      // A fourth, brightest tone for planes turned full to the sun, so roof slopes separate.
      gCol = mix(gCol, gBase * uLightTint * 1.09, smoothstep(0.84 + gW, 0.88 + gW, gLit));
    #endif
    #ifndef GOUACHE_PAINTED
      float gPaint = uPainted;
      // Unpainted, it is a pencil drawing: paper, a graphite wash for darker things, and hatching in shade.
      float gLum = dot(gBase, vec3(0.3, 0.59, 0.11));
      vec2 gPx = gl_FragCoord.xy / uDpr;
      float gHatchA = step(0.6, fract((gPx.x + gPx.y) / 7.0));
      float gHatchB = step(0.6, fract((gPx.x - gPx.y) / 7.0));
      float gTone = (1.0 - gLum) * 0.2
        + gHalf * (1.0 - gLight) * (0.04 + 0.15 * gHatchA)
        + (1.0 - gHalf) * (0.09 + 0.2 * gHatchA + 0.15 * gHatchB);
      vec3 gPencil = mix(uPaper, vec3(0.105, 0.1, 0.125), clamp(gTone, 0.0, 0.7));
      gCol = mix(gPencil, gCol, gPaint);
      gPaintOut = gPaint;
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
  /** Always in full colour, even where the world is still pencil. For the cat. */
  painted?: boolean;
  /** Rippling water. */
  water?: boolean;
  /** Grass painted with patches, strokes and wildflowers. */
  meadow?: boolean;
  map?: THREE.Texture;
  transparent?: boolean;
}

export function gouache(opts: GouacheOptions = {}): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: opts.color ?? 0xffffff,
    vertexColors: !!opts.vertexColors,
    map: opts.map ?? null,
    transparent: !!opts.transparent,
  });
  mat.defines = {
    ...(opts.unlit ? { GOUACHE_UNLIT: '' } : {}),
    ...(opts.local ? { GOUACHE_LOCAL: '' } : {}),
    ...(opts.hole ? { GOUACHE_HOLE: '' } : {}),
    ...(opts.painted ? { GOUACHE_PAINTED: '' } : {}),
    ...(opts.water ? { GOUACHE_WATER: '' } : {}),
    ...(opts.meadow ? { GOUACHE_MEADOW: '' } : {}),
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
        uniform float uPainted, uDpr, uTime;
        // Passed on in the alpha channel so the paper pass can draw pencil lines where nothing is painted.
        float gPaintOut = 1.0;
        ${NOISE}`,
      )
      .replace('#include <opaque_fragment>', `${PAINT}\n#include <opaque_fragment>`)
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n#ifdef OPAQUE\n  gl_FragColor.a = gPaintOut;\n#endif');
  };
  mat.customProgramCacheKey = () => `gouache:${opts.unlit ? 'u' : ''}${opts.local ? 'l' : ''}${opts.hole ? 'h' : ''}${opts.painted ? 'p' : ''}${opts.water ? 'w' : ''}${opts.meadow ? 'm' : ''}`;
  return mat;
}
