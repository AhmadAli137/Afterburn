import * as THREE from "three";
import { softSprite } from "./fx";
import { rnd } from "./noise";

/* The sky is a lit dome now: a gradient shader from horizon haze to zenith,
   a sun-glow lobe behind the big moon, real lit moons with halos, a star
   shell with a milky band, shader-driven aurora curtains and drifting cloud
   sprites. Nothing here is an asset; the sprites come off a canvas. */

const GLSL_NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

export interface SkyPalette { sky: THREE.Color; fog: THREE.Color; glowA: THREE.Color; glowB: THREE.Color }

export class Sky {
  private readonly domeU = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(-0.27, 0.2, -0.94).normalize() }, uMoonCol: { value: new THREE.Color() }, uTime: { value: 0 },
  };
  private readonly auroraU = { uTime: { value: 0 }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uOpacity: { value: 0.5 } };
  private readonly moonA: THREE.MeshStandardMaterial; private readonly moonB: THREE.MeshStandardMaterial;
  private readonly haloA: THREE.SpriteMaterial; private readonly haloB: THREE.SpriteMaterial;
  private readonly starMats: THREE.PointsMaterial[] = [];
  private readonly cloudMat: THREE.SpriteMaterial;
  private readonly clouds: THREE.Sprite[] = [];
  private readonly halos: { s: THREE.Sprite; base: number }[] = [];
  private sunMesh: THREE.Mesh | null = null; private sunHalo: THREE.Sprite | null = null;
  /** where the sun (the big moon) sits, as a direction */
  readonly sunDir = new THREE.Vector3(-0.27, 0.2, -0.94).normalize();
  /** Move the sun: the dome's glow lobe, the moon and its halo all follow. */
  setSun(dir: THREE.Vector3) {
    this.sunDir.copy(dir).normalize();
    this.domeU.uMoonDir.value.copy(this.sunDir);
    if (this.sunMesh) this.sunMesh.position.copy(this.sunDir).multiplyScalar(560);
    if (this.sunHalo) this.sunHalo.position.copy(this.sunDir).multiplyScalar(560);
  }
  /** 0 below the cloud deck .. 1 above it: the moons flare and the sky clears. */
  above(mix: number) {
    for (const h of this.halos) h.s.scale.setScalar(h.base * (1 + mix * 0.9));
    this.haloA.opacity = 0.4 + mix * 0.35; this.haloB.opacity = 0.3 + mix * 0.25;
    this.cloudMat.opacity = 0.16 * (1 - mix * 0.7);
  }

  constructor(scene: THREE.Scene) {
    // everything up here also lives on layer 1: the reflection probe renders only the sky
    const add = (o: THREE.Object3D) => { o.layers.enable(1); scene.add(o); };
    // dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(640, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.domeU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uZenith, uHorizon, uGlow, uMoonCol, uMoonDir; uniform float uTime; varying vec3 vDir;
        ${GLSL_NOISE}
        void main() {
          float h = vDir.y;
          vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.06, 0.55, h), 0.65));
          col += uGlow * exp(-abs(h - 0.02) * 12.0) * 0.32;              // horizon band
          float m = max(dot(vDir, uMoonDir), 0.0);
          col += uMoonCol * (pow(m, 90.0) * 0.55 + pow(m, 6.0) * 0.07);   // moon glow lobe
          float haze = fbm(vec2(atan(vDir.x, vDir.z) * 3.0, h * 8.0 + uTime * 0.01)) * 0.06 * (1.0 - smoothstep(0.0, 0.35, h));
          col += haze * uHorizon;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    dome.renderOrder = -10;
    add(dome);

    // stars: two shells of crisp points plus a milky band, outside the fog
    const star = softSprite(32, 0.5);
    const mkStars = (count: number, size: number, band: boolean, seed: number) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        let a = rnd(seed + i * 3) * Math.PI * 2, e: number;
        if (band) { // gaussian-ish spread around a tilted great circle
          const g = (rnd(seed + i * 5) + rnd(seed + i * 7) + rnd(seed + i * 11) - 1.5) * 0.28;
          e = Math.asin(Math.max(-0.05, Math.min(0.98, Math.sin(a * 0.5 + 0.8) * 0.45 + g)));
        } else e = Math.asin(rnd(seed + i * 5) * 0.98);
        const r = 600;
        pos[i * 3] = Math.cos(e) * Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.cos(e) * Math.sin(a) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xdfe6ff, size, sizeAttenuation: false, map: star, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      this.starMats.push(mat);
      add(new THREE.Points(geo, mat));
    };
    mkStars(700, 2.6, false, 11);
    mkStars(1400, 1.5, false, 29);
    mkStars(2600, 1.3, true, 47);

    // moons, lit by the scene sun, with additive halos
    this.moonA = new THREE.MeshStandardMaterial({ color: 0xd9d3e6, roughness: 1, metalness: 0 });
    this.moonB = new THREE.MeshStandardMaterial({ color: 0xcfd8e8, roughness: 1, metalness: 0 });
    const halo = softSprite(128, 0);
    this.haloA = new THREE.SpriteMaterial({ map: halo, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.haloB = new THREE.SpriteMaterial({ map: halo, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const mkMoon = (mat: THREE.MeshStandardMaterial, haloMat: THREE.SpriteMaterial, r: number, p: THREE.Vector3, haloScale: number, isSun = false) => {
      const geo = new THREE.SphereGeometry(r, 36, 24);
      // crater-ish relief via vertex displacement
      const pa = geo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const v = new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i));
        const n = Math.sin(v.x * 0.9) * Math.sin(v.y * 1.3) * Math.sin(v.z * 1.1) * 0.02;
        v.multiplyScalar(1 + n);
        pa.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(p);
      add(m);
      const s = new THREE.Sprite(haloMat);
      s.position.copy(p);
      s.scale.setScalar(haloScale);
      add(s);
      this.halos.push({ s, base: haloScale });
      if (isSun) { this.sunMesh = m; this.sunHalo = s; }
    };
    mkMoon(this.moonA, this.haloA, 30, new THREE.Vector3(-150, 112, -520), 210, true);
    mkMoon(this.moonB, this.haloB, 13, new THREE.Vector3(190, 80, -560), 90);

    // aurora curtains
    const auroraMat = new THREE.ShaderMaterial({
      uniforms: this.auroraU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime, uOpacity; uniform vec3 uColA, uColB; varying vec2 vUv;
        ${GLSL_NOISE}
        void main() {
          float x = vUv.x * 9.0;
          float body = smoothstep(0.25, 0.95, fbm(vec2(x + uTime * 0.05, uTime * 0.07)));
          float rays = 0.55 + 0.45 * sin(x * 22.0 + fbm(vec2(x * 3.0, uTime * 0.2)) * 9.0);
          float base = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.25, 1.0, vUv.y));
          float wave = smoothstep(0.0, 0.25, vUv.y + 0.15 * sin(x * 1.7 + uTime * 0.3));
          float a = body * rays * base * wave * uOpacity;
          vec3 col = mix(uColA, uColB, smoothstep(0.1, 0.8, vUv.y));
          gl_FragColor = vec4(col, a);
        }`,
    });
    for (let i = 0; i < 3; i++) {
      const a = new THREE.Mesh(new THREE.PlaneGeometry(420, 70, 1, 1), auroraMat);
      a.position.set((i - 1) * 90, 95 + i * 18, -420 - i * 40);
      a.rotation.set(0.15, 0, 0.1 * (i - 1));
      add(a);
    }

    // clouds: soft sprites that drift with the world
    this.cloudMat = new THREE.SpriteMaterial({ map: softSprite(128, 0.15), transparent: true, opacity: 0.16, depthWrite: false, color: 0xffffff });
    for (let i = 0; i < 18; i++) {
      const s = new THREE.Sprite(this.cloudMat);
      s.scale.set(28 + rnd(i * 3) * 46, 9 + rnd(i * 5) * 12, 1);
      s.position.set((rnd(i * 7) - 0.5) * 320, 14 + rnd(i * 11) * 26, -rnd(i * 13) * 300);
      this.clouds.push(s);
      add(s);
    }
  }

  update(dt: number, t: number, scroll: number, p: SkyPalette) {
    this.domeU.uTime.value = t;
    this.domeU.uZenith.value.copy(p.sky);
    this.domeU.uHorizon.value.copy(p.fog).lerp(p.glowB, 0.18).multiplyScalar(1.15);
    this.domeU.uGlow.value.copy(p.glowB);
    this.domeU.uMoonCol.value.copy(p.glowB);
    this.moonA.emissive.copy(p.glowB).multiplyScalar(0.28);
    this.moonB.emissive.copy(p.glowA).multiplyScalar(0.22);
    this.haloA.color.copy(p.glowB); this.haloB.color.copy(p.glowA);
    this.auroraU.uTime.value = t;
    this.auroraU.uColA.value.copy(p.glowA); this.auroraU.uColB.value.copy(p.glowB);
    this.starMats.forEach((m, i) => { m.opacity = 0.75 + Math.sin(t * (0.9 + i * 0.37)) * 0.12; });
    this.cloudMat.color.copy(p.fog).lerp(new THREE.Color(0xffffff), 0.55);
    for (const c of this.clouds) {
      c.position.z += scroll * 0.9 + dt * 0.6;
      if (c.position.z > 40) { c.position.z = -300; c.position.x = (Math.random() - 0.5) * 320; }
    }
  }
}
