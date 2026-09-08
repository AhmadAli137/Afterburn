import * as THREE from "three";
import { softSprite } from "./fx";
import { rnd, fbm } from "./noise";

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
const MID_ZENITH = new THREE.Color(0x02040c), MID_HORIZON = new THREE.Color(0x0c1430);
const BLOOD_ZENITH = new THREE.Color(0x0a0206), BLOOD_HORIZON = new THREE.Color(0x3a0a12), BLOOD_MOON = new THREE.Color(0xff4a2e), BLOOD_HALO = new THREE.Color(0xff3a30);

/** The sun's corona for totality: a bright inner ring falling off into streamers. */
function coronaTexture(size = 256): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const m = size / 2;
  const g = ctx.createRadialGradient(m, m, m * 0.26, m, m, m);
  g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.02, "rgba(255,250,235,1)"); g.addColorStop(0.12, "rgba(255,235,200,.55)"); g.addColorStop(0.45, "rgba(255,220,180,.12)"); g.addColorStop(1, "rgba(255,220,180,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 22; i++) {
    ctx.save(); ctx.translate(m, m); ctx.rotate(i * Math.PI * 2 / 22 + rnd(i) * 0.2);
    const s = ctx.createLinearGradient(m * 0.28, 0, m * (0.6 + rnd(i + 9) * 0.4), 0);
    s.addColorStop(0, "rgba(255,245,225,.5)"); s.addColorStop(1, "rgba(255,245,225,0)");
    ctx.fillStyle = s; ctx.fillRect(m * 0.28, -1.5 - rnd(i + 3) * 2, m, 3 + rnd(i + 3) * 4);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The face of the full moon: maria and craters from noise, a little rayed crater, all on a canvas. */
function moonFace(size = 512): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const m = size / 2;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x - m) / m, dy = (y - m) / m, r = Math.hypot(dx, dy);
    const i = (y * size + x) * 4;
    if (r > 1) { img.data[i + 3] = 0; continue; }
    // maria: broad dark noise; highlands: bright with fine grain
    const maria = fbm(dx * 2.3 + 4, dy * 2.3 + 9, 3) * 0.5 + 0.5;
    const grain = fbm(dx * 14 + 2, dy * 14 + 7, 3) * 0.5 + 0.5;
    let v = 0.72 + 0.2 * grain - 0.34 * Math.pow(Math.max(0, maria - 0.42), 0.8) * 1.6;
    // limb darkening, and a soft edge
    v *= 1 - Math.pow(r, 6) * 0.35;
    const edge = Math.min(1, (1 - r) * 40);
    const col = [v * 0.98, v * 0.97, v * 1.0];
    img.data[i] = Math.min(255, col[0] * 255); img.data[i + 1] = Math.min(255, col[1] * 255); img.data[i + 2] = Math.min(255, col[2] * 255); img.data[i + 3] = 255 * edge;
  }
  ctx.putImageData(img, 0, 0);
  // craters: rings with a shadowed side, one big rayed one
  const r = (i: number) => rnd(i * 3.1 + 7);
  for (let k = 0; k < 40; k++) {
    const a = r(k) * Math.PI * 2, d = Math.sqrt(r(k + 100)) * 0.88 * m, cx = m + Math.cos(a) * d, cy = m + Math.sin(a) * d, rad = 3 + r(k + 200) * 14;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + rad * 0.2, cy + rad * 0.2, rad * 0.85, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,10,.16)"; ctx.fill();
  }
  ctx.save(); ctx.translate(m * 0.62, m * 1.35);
  for (let k = 0; k < 18; k++) { ctx.save(); ctx.rotate(k * Math.PI * 2 / 18 + 0.2); const g = ctx.createLinearGradient(0, 0, m * 0.5, 0); g.addColorStop(0, "rgba(255,255,255,.35)"); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(0, -1, m * 0.5, 2); ctx.restore(); }
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fill();
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
  /* The sun itself: a burning disc, not a lit rock. Limb-darkened, with slow
     granulation crawling over it and a warm rim, bright enough that the bloom
     makes it glow. The palette tints it; the eclipser slides in front of it. */
  private readonly sunU = { uCol: { value: new THREE.Color(0xffe6c0) }, uTime: { value: 0 } };
  private readonly sunMat = new THREE.ShaderMaterial({
    uniforms: this.sunU, fog: false, depthWrite: true,
    vertexShader: `varying vec3 vN; varying vec2 vUv; void main() { vN = normalize(normalMatrix * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uCol; uniform float uTime; varying vec3 vN; varying vec2 vUv;
      ${GLSL_NOISE}
      void main() {
        float facing = max(dot(normalize(vN), vec3(0.0, 0.0, 1.0)), 0.0);
        float limb = pow(facing, 0.45);
        float gran = fbm(vUv * vec2(48.0, 24.0) + vec2(uTime * 0.02, -uTime * 0.013)) * 0.5 + 0.5;
        float cells = smoothstep(0.35, 0.8, gran);
        vec3 core = uCol * (0.9 + 0.45 * cells);
        vec3 rim = mix(uCol, vec3(1.0, 0.45, 0.25), 0.6) * (1.0 - limb);
        float edge = smoothstep(0.0, 0.22, facing);       // the last sliver before the limb
        vec3 col = core * (0.5 + 0.5 * limb) * 0.92 + rim * 0.35;
        col *= 0.35 + 0.65 * edge;                        // the disc ends; it does not fade into the sky
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  /* Midnight. For a while in every cycle a full moon stands high over the
     deck: big, close, cratered, with a cold halo, and the whole sky goes deep
     blue under it. `midnight` is 0..1 from the caller. */
  private readonly fullMoon: THREE.Mesh; private readonly fullMoonMat: THREE.MeshBasicMaterial; private readonly fullHalo: THREE.Sprite;
  readonly moonDir = new THREE.Vector3(0.14, 0.7, -0.7).normalize();
  private midnight = 0; private blood = 0;
  /** m: how deep into midnight; blood: 0 silver moon .. 1 blood moon */
  setMidnight(m: number, blood = 0) { this.midnight = m; this.blood = blood; }
  /* Eclipse. The small moon slides across the sun; at totality only the corona
     is left, and the light goes out of the world for half a minute. */
  private eclipser: THREE.Mesh | null = null; private eclipserHalo: THREE.Sprite | null = null;
  private eclipserHome = new THREE.Vector3(); private eclipserScale = 1;
  private readonly corona: THREE.Sprite;
  private eclipse = 0;
  setEclipse(e: number) {
    this.eclipse = e;
    if (!this.eclipser || !this.eclipserHalo) return;
    // slide from home to a spot just in front of the sun, and grow to cover it
    const cover = new THREE.Vector3().copy(this.sunDir).multiplyScalar(548);
    const t = Math.min(1, e * 1.15);
    this.eclipser.position.copy(this.eclipserHome).lerp(cover, t);
    this.eclipser.scale.setScalar(this.eclipserScale * (1 + t * 1.55));
    this.eclipserHalo.position.copy(this.eclipser.position);
    (this.eclipserHalo.material as THREE.SpriteMaterial).opacity = 0.3 * (1 - t);
    this.corona.visible = e > 0.55;
    this.corona.position.copy(this.sunDir).multiplyScalar(552);
    const tot = Math.max(0, (e - 0.55) / 0.45);
    (this.corona.material as THREE.SpriteMaterial).opacity = tot;
    this.corona.scale.setScalar(150 + tot * 40);
    if (this.sunHalo) (this.sunHalo.material as THREE.SpriteMaterial).opacity = (0.4 + 0.35 * 0) * (1 - e * 0.85);
  }
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
    const mkMoon = (mat: THREE.MeshStandardMaterial, haloMat: THREE.SpriteMaterial, r: number, p: THREE.Vector3, haloScale: number, isSun = false, isEclipser = false) => {
      const geo = new THREE.SphereGeometry(r, 48, 32);
      // crater-ish relief via vertex displacement
      const pa = geo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const v = new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i));
        const n = Math.sin(v.x * 0.9) * Math.sin(v.y * 1.3) * Math.sin(v.z * 1.1) * 0.02;
        v.multiplyScalar(1 + n);
        pa.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, isSun ? this.sunMat : mat);
      m.position.copy(p);
      add(m);
      const s = new THREE.Sprite(haloMat);
      s.position.copy(p);
      s.scale.setScalar(haloScale);
      add(s);
      this.halos.push({ s, base: haloScale });
      if (isSun) { this.sunMesh = m; this.sunHalo = s; }
      if (isEclipser) { this.eclipser = m; this.eclipserHalo = s; this.eclipserHome.copy(p); this.eclipserScale = 1; }
    };
    mkMoon(this.moonA, this.haloA, 30, new THREE.Vector3(-150, 112, -520), 210, true);
    // the full moon: a lit disc with craters drawn on a canvas, and a wide cold halo
    this.fullMoonMat = new THREE.MeshBasicMaterial({ map: moonFace(), transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.fullMoon = new THREE.Mesh(new THREE.CircleGeometry(46, 64), this.fullMoonMat);
    this.fullMoon.position.copy(this.moonDir).multiplyScalar(560);
    this.fullMoon.lookAt(0, 0, 0);
    this.fullMoon.visible = false;
    add(this.fullMoon);
    this.fullHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0xbfd0ff }));
    this.fullHalo.position.copy(this.moonDir).multiplyScalar(560);
    this.fullHalo.scale.setScalar(330);
    this.fullHalo.visible = false;
    add(this.fullHalo);
    mkMoon(this.moonB, this.haloB, 13, new THREE.Vector3(190, 80, -560), 90, false, true);
    // the corona: a soft annulus, white going gold, only at totality
    this.corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: coronaTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0xfff2d8 }));
    this.corona.visible = false;
    add(this.corona);

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
    const m = this.midnight, e = this.eclipse, b = this.blood;
    this.domeU.uTime.value = t;
    this.domeU.uZenith.value.copy(p.sky).lerp(MID_ZENITH, m * 0.9).lerp(BLOOD_ZENITH, m * b * 0.8).multiplyScalar(1 - e * 0.6);
    this.domeU.uHorizon.value.copy(p.fog).lerp(p.glowB, 0.18).multiplyScalar(1.15).lerp(MID_HORIZON, m * 0.8).lerp(BLOOD_HORIZON, m * b * 0.85).multiplyScalar(1 - e * 0.55);
    this.domeU.uGlow.value.copy(p.glowB).multiplyScalar((1 - m * 0.7) * (1 - e * 0.7));
    this.fullMoon.visible = this.fullHalo.visible = m > 0.01;
    this.fullMoonMat.opacity = m;
    this.fullMoonMat.color.setRGB(1, 1, 1).lerp(BLOOD_MOON, b);
    (this.fullHalo.material as THREE.SpriteMaterial).opacity = 0.55 * m;
    (this.fullHalo.material as THREE.SpriteMaterial).color.set(0xbfd0ff).lerp(BLOOD_HALO, b);
    this.fullHalo.scale.setScalar(330 + Math.sin(t * 0.3) * 12);
    this.domeU.uMoonCol.value.copy(p.glowB);
    this.sunU.uTime.value = t;
    this.sunU.uCol.value.copy(p.glowB).lerp(new THREE.Color(0xfff0d0), 0.55);
    this.moonA.emissive.copy(p.glowB).multiplyScalar(0.28);
    this.moonB.emissive.copy(p.glowA).multiplyScalar(0.22);
    this.haloA.color.copy(p.glowB); this.haloB.color.copy(p.glowA);
    this.auroraU.uTime.value = t;
    this.auroraU.uColA.value.copy(p.glowA); this.auroraU.uColB.value.copy(p.glowB);
    this.starMats.forEach((sm, i) => { sm.opacity = 0.75 + Math.sin(t * (0.9 + i * 0.37)) * 0.12 + m * 0.2; });
    this.cloudMat.color.copy(p.fog).lerp(new THREE.Color(0xffffff), 0.55);
    for (const c of this.clouds) {
      c.position.z += scroll * 0.9 + dt * 0.6;
      if (c.position.z > 40) { c.position.z = -300; c.position.x = (Math.random() - 0.5) * 320; }
    }
  }
}
