import * as THREE from "three";

/* Pooled GPU point particles with per-particle size, colour and fade — used
   for exhaust plumes, tracer sparks, explosions, smoke and debris trails —
   plus instanced solid debris that tumbles under gravity and bounces on the
   terrain, and expanding shockwave rings. Sprites are drawn on a canvas at
   startup so there are still no assets. */

export function softSprite(size = 64, hardness = 0): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(Math.min(0.95, 0.1 + hardness * 0.7), "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A cumulus puff: a cluster of soft blobs with a flatter base, so the deck reads as cloud and not as fog. */
export function cloudSprite(size = 128, seed = 1): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const r = (i: number) => Math.abs((Math.sin(i * 127.1 + seed * 311.7) * 43758.5453) % 1);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 14; i++) {
    const bx = size * (0.2 + r(i) * 0.6), by = size * (0.32 + r(i + 20) * 0.34), br = size * (0.1 + r(i + 40) * 0.16);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(0.5, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  }
  // fade the whole thing out toward the edges so no blob ever shows a hard bound
  ctx.globalCompositeOperation = "destination-in";
  const m = ctx.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size / 2);
  m.addColorStop(0, "rgba(255,255,255,1)"); m.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = m; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface EmitOpts {
  life: number; size0: number; size1: number;
  c0: THREE.Color; c1: THREE.Color;
  gravity?: number; drag?: number; alpha?: number;
}

const VERT = `
attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
varying vec3 vColor; varying float vAlpha;
uniform float uFogNear, uFogFar, uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float fog = smoothstep(uFogNear, uFogFar, -mv.z);
  float near = smoothstep(0.6, 5.0, -mv.z);          // fade out as sprites pass the camera
  vColor = aColor; vAlpha = aAlpha * (1.0 - fog) * near;
  gl_PointSize = min(aSize * uScale / max(0.5, -mv.z), 160.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uMap; varying vec3 vColor; varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export class Particles {
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly pos: Float32Array; private readonly col: Float32Array;
  private readonly alpha: Float32Array; private readonly size: Float32Array;
  private readonly vel: Float32Array; private readonly life: Float32Array; private readonly maxLife: Float32Array;
  private readonly s0: Float32Array; private readonly s1: Float32Array;
  private readonly c0: Float32Array; private readonly c1: Float32Array;
  private readonly grav: Float32Array; private readonly drag: Float32Array; private readonly a0: Float32Array;
  private head = 0;
  private readonly uniforms: { uMap: THREE.IUniform; uFogNear: THREE.IUniform<number>; uFogFar: THREE.IUniform<number>; uScale: THREE.IUniform<number> };

  constructor(scene: THREE.Scene, n: number, map: THREE.Texture, additive = true) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.a0 = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uMap: { value: map }, uFogNear: { value: 60 }, uFogFar: { value: 320 }, uScale: { value: 300 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setFog(near: number, far: number) { this.uniforms.uFogNear.value = near; this.uniforms.uFogFar.value = far; }
  setScale(s: number) { this.uniforms.uScale.value = s; }

  emit(p: THREE.Vector3, v: THREE.Vector3, o: EmitOpts) {
    const i = this.head; this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = this.maxLife[i] = o.life;
    this.s0[i] = o.size0; this.s1[i] = o.size1;
    this.c0[i * 3] = o.c0.r; this.c0[i * 3 + 1] = o.c0.g; this.c0[i * 3 + 2] = o.c0.b;
    this.c1[i * 3] = o.c1.r; this.c1[i * 3 + 1] = o.c1.g; this.c1[i * 3 + 2] = o.c1.b;
    this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 0; this.a0[i] = o.alpha ?? 1;
  }

  /** Advance; `scroll` is how far the world moved toward the camera this frame. */
  update(dt: number, scroll: number) {
    const { pos, vel, life } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      life[i] -= dt;
      const t = 1 - life[i] / this.maxLife[i];
      const d = 1 - this.drag[i] * dt;
      vel[i * 3] *= d; vel[i * 3 + 1] = vel[i * 3 + 1] * d - this.grav[i] * dt; vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt + scroll;
      this.col[i * 3] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t;
      this.col[i * 3 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t;
      this.col[i * 3 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 8 + 0.2);
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
    }
    const g = this.points.geometry;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() { this.life.fill(0); }
}

// ---------- solid debris: instanced chunks with gravity, tumble, ground bounce ----------
export type GroundFn = (x: number, z: number) => number;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private readonly pos: Float32Array; private readonly vel: Float32Array;
  private readonly rot: Float32Array; private readonly rotV: Float32Array;
  private readonly life: Float32Array; private readonly size: Float32Array; private readonly hot: Float32Array;
  private head = 0;
  private readonly tint = new THREE.Color();

  constructor(scene: THREE.Scene, n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3); this.rotV = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.size = new Float32Array(n); this.hot = new Float32Array(n);
    const geo = new THREE.TetrahedronGeometry(1, 0);
    geo.scale(1, 0.55, 1.4);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.55, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (let i = 0; i < n; i++) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); }
    scene.add(this.mesh);
  }

  /** Throw `count` chunks from p with base velocity v plus spread; `hot` chunks trail fire for a while. */
  burst(p: THREE.Vector3, v: THREE.Vector3, count: number, size: number, spread: number, color: THREE.Color, hot = 0) {
    for (let k = 0; k < count; k++) {
      const i = this.head; this.head = (this.head + 1) % this.n;
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI, sp = spread * (0.4 + Math.random());
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = v.x + Math.cos(a) * Math.cos(b) * sp;
      this.vel[i * 3 + 1] = v.y + Math.sin(b) * sp + 3;
      this.vel[i * 3 + 2] = v.z + Math.sin(a) * Math.cos(b) * sp;
      this.rot[i * 3] = Math.random() * 6; this.rot[i * 3 + 1] = Math.random() * 6; this.rot[i * 3 + 2] = Math.random() * 6;
      this.rotV[i * 3] = (Math.random() - 0.5) * 14; this.rotV[i * 3 + 1] = (Math.random() - 0.5) * 14; this.rotV[i * 3 + 2] = (Math.random() - 0.5) * 14;
      this.life[i] = 2.5 + Math.random() * 2;
      this.size[i] = size * (0.5 + Math.random());
      this.hot[i] = k < hot ? 1.4 : 0;
      this.mesh.setColorAt(i, color);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number, scroll: number, ground: GroundFn, sparks?: Particles, smoke?: Particles) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      this.vel[i * 3 + 1] -= 18 * dt;
      this.vel[i * 3] *= 1 - 0.3 * dt; this.vel[i * 3 + 2] *= 1 - 0.3 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt + scroll;
      const gy = ground(this.pos[i * 3], this.pos[i * 3 + 2]) + this.size[i] * 0.4;
      if (this.pos[i * 3 + 1] < gy) { // bounce, scrub speed, slow the tumble
        this.pos[i * 3 + 1] = gy;
        this.vel[i * 3 + 1] *= -0.28; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6;
        this.rotV[i * 3] *= 0.5; this.rotV[i * 3 + 1] *= 0.5; this.rotV[i * 3 + 2] *= 0.5;
        if (Math.abs(this.vel[i * 3 + 1]) < 1.5) this.vel[i * 3 + 1] = 0;
      }
      this.rot[i * 3] += this.rotV[i * 3] * dt; this.rot[i * 3 + 1] += this.rotV[i * 3 + 1] * dt; this.rot[i * 3 + 2] += this.rotV[i * 3 + 2] * dt;
      _p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      _q.setFromEuler(_e.set(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2]));
      const s = this.size[i] * Math.min(1, this.life[i] * 2);
      _m.compose(_p, _q, _s.set(s, s, s));
      this.mesh.setMatrixAt(i, _m);
      if (this.hot[i] > 0 && sparks && smoke) {
        this.hot[i] -= dt;
        burn(sparks, smoke, _p, 0, 0.6);
        this.tint.setRGB(1, 0.45 + this.hot[i] * 0.2, 0.2).lerp(new THREE.Color(0x2a2530), 1 - Math.min(1, this.hot[i] / 1.4));
        this.mesh.setColorAt(i, this.tint);
        this.mesh.instanceColor!.needsUpdate = true;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.life.fill(0); for (let i = 0; i < this.n; i++) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); } this.mesh.instanceMatrix.needsUpdate = true; }
}

// ---------- shockwave rings ----------
export class Shockwaves {
  private readonly rings: { m: THREE.Mesh; t: number; scale: number }[] = [];
  constructor(scene: THREE.Scene, n = 6) {
    const geo = new THREE.TorusGeometry(1, 0.06, 6, 48);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff1d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; scene.add(m);
      this.rings.push({ m, t: -1, scale: 10 });
    }
  }
  fire(p: THREE.Vector3, scale = 10) {
    const r = this.rings.find((x) => x.t < 0) ?? this.rings[0];
    r.t = 0; r.scale = scale; r.m.visible = true; r.m.position.copy(p);
    r.m.rotation.set(Math.random() * 0.6 - 0.3, Math.random() * 6, 0);
  }
  update(dt: number, scroll: number) {
    for (const r of this.rings) {
      if (r.t < 0) continue;
      r.t += dt * 2.2;
      r.m.position.z += scroll;
      const s = 0.5 + r.t * r.scale;
      r.m.scale.set(s, s, s);
      (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - r.t) * 0.8;
      if (r.t >= 1) { r.t = -1; r.m.visible = false; }
    }
  }
}

const _v = new THREE.Vector3();
const C = (h: number) => new THREE.Color(h);
const WHITE = C(0xffffff), ORANGE = C(0xff9a3c), EMBER = C(0xff3c1a), DARK = C(0x2a2024), GRAY = C(0x6d6a78), SMOKE = C(0x1a1620), METAL = C(0x2a2530);

/** A big fireball: flash, sparks, tumbling embers, a lingering smoke column, and — if given — a shockwave and debris. */
export function explode(sparks: Particles, smoke: Particles, p: THREE.Vector3, scale = 1, debris?: Debris, waves?: Shockwaves, vel?: THREE.Vector3) {
  sparks.emit(p, _v.set(0, 0, 0), { life: 0.18, size0: 9 * scale, size1: 16 * scale, c0: WHITE, c1: ORANGE });
  sparks.emit(p, _v.set(0, 0, 0), { life: 0.5, size0: 5 * scale, size1: 11 * scale, c0: ORANGE, c1: EMBER });
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI, sp = (6 + Math.random() * 18) * scale;
    _v.set(Math.cos(a) * Math.cos(b) * sp, Math.sin(b) * sp, Math.sin(a) * Math.cos(b) * sp);
    sparks.emit(p, _v, { life: 0.5 + Math.random() * 0.9, size0: 0.35 * scale, size1: 0.05, c0: i % 3 ? ORANGE : WHITE, c1: EMBER, gravity: 9, drag: 1.2 });
  }
  for (let i = 0; i < 16; i++) {
    _v.set((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5).multiplyScalar(scale);
    smoke.emit(p, _v, { life: 1.4 + Math.random() * 1.6, size0: 1.2 * scale, size1: 6 * scale, c0: GRAY, c1: SMOKE, drag: 1.5, alpha: 0.55 });
  }
  if (waves) waves.fire(p, 9 * scale);
  if (debris) {
    const v = vel ?? _v.set(0, 0, 0);
    debris.burst(p, v, Math.round(18 * scale), 0.22 * scale, 14 * scale, METAL, 0);
    debris.burst(p, v, 4, 0.55 * scale, 9 * scale, METAL, 4); // the big burning pieces
  }
}

/** Brief impact sparks for a cannon hit. */
export function sparkHit(sparks: Particles, p: THREE.Vector3) {
  for (let i = 0; i < 7; i++) {
    _v.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, 8 + Math.random() * 14);
    sparks.emit(p, _v, { life: 0.25 + Math.random() * 0.25, size0: 0.28, size1: 0.04, c0: WHITE, c1: ORANGE, drag: 2 });
  }
}

/** Fire and smoke pouring off a burning airframe or chunk. */
export function burn(sparks: Particles, smoke: Particles, p: THREE.Vector3, scroll: number, scale = 1) {
  _v.set((Math.random() - 0.5) * 2, 1 + Math.random() * 2, scroll * 0.4 + (Math.random() - 0.5) * 2);
  sparks.emit(p, _v, { life: 0.35 + Math.random() * 0.3, size0: 0.4 * scale, size1: 0.08, c0: WHITE, c1: EMBER, drag: 2, alpha: 0.8 });
  if (Math.random() < 0.6) {
    _v.set((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, scroll * 0.5);
    smoke.emit(p, _v, { life: 1.2 + Math.random(), size0: 0.5 * scale, size1: 2.6 * scale, c0: DARK, c1: SMOKE, drag: 1.2, alpha: 0.5 });
  }
}

/** Damage smoke trailing a hurt jet; heavier as `severity` rises 0..1. */
export function damageTrail(sparks: Particles, smoke: Particles, p: THREE.Vector3, scroll: number, severity: number) {
  _v.set((Math.random() - 0.5) * 0.6, 0.4 + Math.random(), scroll * 0.7 + 2);
  smoke.emit(p, _v, { life: 0.8 + severity, size0: 0.25, size1: 1.4 + severity * 2, c0: severity > 0.6 ? DARK : GRAY, c1: SMOKE, drag: 1, alpha: 0.25 + severity * 0.35 });
  if (severity > 0.6 && Math.random() < 0.35) sparks.emit(p, _v.set((Math.random() - 0.5) * 3, -1, scroll * 0.6 + 4), { life: 0.3, size0: 0.25, size1: 0.05, c0: WHITE, c1: EMBER, gravity: 6 });
}
