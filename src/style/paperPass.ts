import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { P } from './palette';

// Final pass: hand-wobbled edges, pooled pigment at colour boundaries, and paper grain.
const PaperShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uDpr: { value: 1 },
    uPaper: { value: new THREE.Color(P.paper).convertLinearToSRGB() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uDpr;
    uniform vec3 uPaper;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }

    void main() {
      vec2 css = vUv * uRes / uDpr;       // position in CSS pixels, so the look is the same on any screen
      vec2 px = uDpr / uRes;              // one CSS pixel in uv

      // Slightly unsteady edges, as if cut by hand.
      vec2 wob = vec2(noise(css / 46.0), noise(css / 46.0 + 31.7)) - 0.5;
      wob += (vec2(noise(css / 9.0 + 5.1), noise(css / 9.0 + 77.3)) - 0.5) * 0.45;
      vec2 uv = vUv + wob * px * 2.6;

      vec3 c = texture2D(tDiffuse, uv).rgb;

      // Pigment pools a little darker where two colours meet.
      vec3 cx = texture2D(tDiffuse, uv + vec2(px.x * 1.2, 0.0)).rgb;
      vec3 cy = texture2D(tDiffuse, uv + vec2(0.0, px.y * 1.2)).rgb;
      float edge = smoothstep(0.05, 0.32, length(c - cx) + length(c - cy));
      c *= 1.0 - edge * 0.16;

      // Paper tooth and fibres.
      float grain = noise(css / 1.3);
      float fibre = noise(vec2(css.x / 2.2, css.y / 17.0));
      c *= 0.95 + 0.065 * grain;
      c *= 0.985 + 0.03 * fibre;

      // Print speckle: paper showing through the darker inks.
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      float speck = step(0.93, hash(floor(css / 1.4)));
      c = mix(c, uPaper, speck * 0.16 * (1.0 - lum));

      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function makePaperPass(): ShaderPass {
  return new ShaderPass(PaperShader);
}
