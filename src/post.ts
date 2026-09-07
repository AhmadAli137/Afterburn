import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/* One fullscreen pass for everything the air does to the picture:
   - god rays: light from the sun's screen position, occluded by whatever is
     dark between it and the pixel (ridges, the cloud deck), so shafts fall
     through the gaps;
   - radial motion blur on the outer frame, with a chromatic fringe, when the
     airspeed is going somewhere (the burner, a real dive);
   - heat shimmer: a refracting plume behind each nozzle, stronger on burner;
   - a hint of film grain so the gradients never band. */

export interface AtmoUniforms {
  tDiffuse: THREE.IUniform<THREE.Texture | null>;
  uTime: THREE.IUniform<number>;
  uSun: THREE.IUniform<THREE.Vector2>;      // sun in screen uv
  uRays: THREE.IUniform<number>;            // 0..1 shaft strength
  uRayColor: THREE.IUniform<THREE.Color>;
  uBlur: THREE.IUniform<number>;            // 0..1 radial blur
  uChroma: THREE.IUniform<number>;          // 0..1 fringe
  uHeat: THREE.IUniform<THREE.Vector4[]>;   // per plume: x,y start uv; z,w end uv (behind). [0],[1] nozzles, [2] the laser
  uHeatW: THREE.IUniform<THREE.Vector3>;    // width of each plume's shimmer, in uv
  uHeatAmp: THREE.IUniform<THREE.Vector3>;  // strength of each, 0..1
  uAspect: THREE.IUniform<number>;
  uGrain: THREE.IUniform<number>;
}

const FRAG = `
uniform sampler2D tDiffuse;
uniform float uTime, uRays, uBlur, uChroma, uAspect, uGrain;
uniform vec2 uSun; uniform vec3 uRayColor, uHeatW, uHeatAmp; uniform vec4 uHeat[3];
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
// distance from p to segment ab, in aspect-corrected uv
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  vec2 uv = vUv;
  vec2 asp = vec2(uAspect, 1.0);
  // ---- heat shimmer: displace the lookup around each plume ----
  for (int i = 0; i < 3; i++) {
    float amp = i == 0 ? uHeatAmp.x : i == 1 ? uHeatAmp.y : uHeatAmp.z;
    if (amp < 0.001) continue;
    float wd = i == 0 ? uHeatW.x : i == 1 ? uHeatW.y : uHeatW.z;
    vec2 a = uHeat[i].xy, b = uHeat[i].zw;
    float d = segDist(uv * asp, a * asp, b * asp);
    float w = smoothstep(wd, 0.0, d) * amp;
    if (w > 0.001) {
      // the laser's air is faster and finer than a jet plume's
      float sp = i == 2 ? 3.0 : 1.0, fr = i == 2 ? 2.2 : 1.0;
      float n = vnoise(uv * vec2(40.0, 60.0) * fr + vec2(0.0, uTime * 9.0 * sp)) - 0.5;
      float n2 = vnoise(uv * vec2(70.0, 90.0) * fr - vec2(uTime * 3.0 * sp, uTime * 14.0 * sp)) - 0.5;
      uv += vec2(n, n2) * 0.012 * w;
    }
  }
  vec2 dir = uv - 0.5;
  float r = length(dir * asp) * 1.2;
  float edge = smoothstep(0.5, 1.05, r);
  vec3 col;
  // ---- radial blur + chromatic fringe on the outer frame ----
  if (uBlur > 0.002 || uChroma > 0.002) {
    float amt = uBlur * edge * 0.06;
    float ca = uChroma * edge * 0.006;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float t = float(i) / 7.0;
      vec2 p = uv - dir * amt * t;
      acc.r += texture2D(tDiffuse, p + dir * ca).r;
      acc.g += texture2D(tDiffuse, p).g;
      acc.b += texture2D(tDiffuse, p - dir * ca).b;
    }
    col = acc / 8.0;
  } else col = texture2D(tDiffuse, uv).rgb;
  // ---- god rays: march toward the sun, gathering what is bright on the way ----
  if (uRays > 0.002 && uSun.x > -0.6 && uSun.x < 1.6 && uSun.y > -0.6 && uSun.y < 1.6) {
    vec2 toSun = (uSun - uv);
    float sd = length(toSun * asp);
    float fall = smoothstep(1.1, 0.05, sd);
    if (fall > 0.001) {
      /* March from the sun toward the pixel. Only what is bright near the sun
         counts (its disc and glow), and a dark silhouette between them cuts the
         shaft — which is what makes it a shaft and not a smear of every bright thing. */
      vec2 step = -toSun / 22.0;
      float jitter = hash(uv * 900.0 + uTime) * 0.8;
      vec3 acc = vec3(0.0); float w = 1.0, wsum = 0.0, occ = 1.0;
      vec2 p = uSun + step * jitter;
      for (int i = 0; i < 22; i++) {
        vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb;
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        float l = max(0.0, lum - 0.9);
        acc += s * l * w * occ; wsum += w; w *= 0.86;
        occ *= smoothstep(0.0, 0.35, lum + 0.08); // dark pixels along the way shade everything beyond them
        p += step;
      }
      col += acc / wsum * uRayColor * uRays * fall * 1.2;
    }
  }
  // ---- grain ----
  col += (hash(uv * 1200.0 + fract(uTime)) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeAtmoPass(): { pass: ShaderPass; u: AtmoUniforms } {
  const u: AtmoUniforms = {
    tDiffuse: { value: null }, uTime: { value: 0 }, uSun: { value: new THREE.Vector2(-9, -9) }, uRays: { value: 0 },
    uRayColor: { value: new THREE.Color(0xffe0f0) }, uBlur: { value: 0 }, uChroma: { value: 0 },
    uHeat: { value: [new THREE.Vector4(-9, -9, -9, -9), new THREE.Vector4(-9, -9, -9, -9), new THREE.Vector4(-9, -9, -9, -9)] },
    uHeatW: { value: new THREE.Vector3(0.045, 0.045, 0.03) }, uHeatAmp: { value: new THREE.Vector3() },
    uAspect: { value: 1 }, uGrain: { value: 0.012 },
  };
  const pass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: u as unknown as { [k: string]: THREE.IUniform },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: FRAG,
  }), "tDiffuse");
  return { pass, u };
}

/** A lens-flare disc or ring drawn on a canvas, so it is still not an asset. */
export function flareTexture(size: number, ring: boolean, hue: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const m = size / 2;
  if (ring) {
    const g = ctx.createRadialGradient(m, m, m * 0.62, m, m, m);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.55, hue); g.addColorStop(0.72, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  } else {
    const g = ctx.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, hue); g.addColorStop(0.5, "rgba(255,255,255,.12)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    // a few streaks off the core
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 6; i++) {
      ctx.save(); ctx.translate(m, m); ctx.rotate(i * Math.PI / 6 + 0.3);
      const s = ctx.createLinearGradient(-m, 0, m, 0);
      s.addColorStop(0, "rgba(255,255,255,0)"); s.addColorStop(0.5, "rgba(255,255,255,.35)"); s.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = s; ctx.fillRect(-m, -1, size, 2);
      ctx.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
