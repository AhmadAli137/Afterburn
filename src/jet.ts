import * as THREE from "three";
import { Particles } from "./fx";
import { panelSurface, Surface } from "./textures";

/* A fighter with intakes, delta wings, canted twin tails, afterburner nozzles
   and shader-driven exhaust plumes. Nose points -z (flying away from camera).
   The plume is three nested additive cones — white core, blue-cyan body,
   violet outer sheath — with noise flicker and shock diamonds that stack up
   as the burner lights. Exhaust particles pour from the nozzles. */

const FLAME_VERT = `
uniform float uTime, uLen, uFlicker;
varying float vV, vA;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main() {
  float v = 1.0 - uv.y;          // 0 at nozzle, 1 at tip
  vV = v; vA = uv.x;
  float n = vnoise(vec2(uv.x * 5.0, v * 4.0 - uTime * 16.0));
  vec3 p = position;
  p.xz *= 1.0 + (n - 0.5) * uFlicker * (0.3 + v);
  p.y *= uLen * (1.0 + (n - 0.5) * 0.3 * v);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FLAME_FRAG = `
uniform vec3 uCore, uMid, uOuter; uniform float uTime, uBoost, uAlpha, uDiamonds;
varying float vV, vA;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main() {
  float v = vV;
  float n = vnoise(vec2(vA * 7.0, v * 6.0 - uTime * 24.0));
  float body = pow(1.0 - v, 1.5) * (0.6 + 0.8 * n);
  float d = pow(max(0.0, sin(v * uDiamonds * 6.2832 - 1.3)), 14.0) * (1.0 - v) * (0.35 + uBoost * 1.4);
  vec3 col = mix(uCore, uMid, smoothstep(0.0, 0.3, v));
  col = mix(col, uOuter, smoothstep(0.25, 1.0, v));
  col += vec3(1.0, 0.95, 0.85) * d;
  float a = clamp((body + d) * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(col * (1.0 + uBoost * 0.25), a);
}`;

interface Layer { mesh: THREE.Mesh; u: { uTime: THREE.IUniform<number>; uLen: THREE.IUniform<number>; uFlicker: THREE.IUniform<number>; uBoost: THREE.IUniform<number>; uAlpha: THREE.IUniform<number>; uDiamonds: THREE.IUniform<number>; uCore: THREE.IUniform<THREE.Color>; uMid: THREE.IUniform<THREE.Color>; uOuter: THREE.IUniform<THREE.Color> }; baseLen: number; baseAlpha: number }

export interface FlameColors { core: number; mid: number; outer: number }
export const BLUE_FLAME: FlameColors = { core: 0xffffff, mid: 0x7fd8ff, outer: 0x6a4cff };
export const RED_FLAME: FlameColors = { core: 0xfff1d0, mid: 0xffb35c, outer: 0xff3a2a };

export class Flame {
  readonly group = new THREE.Group();
  private readonly layers: Layer[] = [];
  constructor(colors: FlameColors) {
    const mk = (r: number, len: number, alpha: number, diamonds: number, core: number, mid: number, outer: number, flicker: number) => {
      const geo = new THREE.CylinderGeometry(r, 0.001, 1, 18, 14, true);
      geo.translate(0, -0.5, 0); // nozzle at y=0, tip at y=-1
      const u = {
        uTime: { value: 0 }, uLen: { value: len }, uFlicker: { value: flicker }, uBoost: { value: 0 }, uAlpha: { value: alpha }, uDiamonds: { value: diamonds },
        uCore: { value: new THREE.Color(core) }, uMid: { value: new THREE.Color(mid) }, uOuter: { value: new THREE.Color(outer) },
      };
      const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2; // -y -> +z: the plume trails behind
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.layers.push({ mesh, u, baseLen: len, baseAlpha: alpha });
    };
    mk(0.045, 0.8, 1.0, 5, colors.core, colors.core, colors.mid, 0.25);
    mk(0.08, 1.4, 0.55, 4, colors.mid, colors.mid, colors.outer, 0.45);
    mk(0.16, 1.9, 0.2, 3, colors.outer, colors.outer, colors.outer, 0.7);
  }
  /** throttle 0..1 sets plume length; boost 0..1 lights the burner. */
  update(t: number, throttle: number, boost: number) {
    const len = 0.35 + throttle * 0.65 + boost * 1.7;
    for (const l of this.layers) {
      l.u.uTime.value = t + Math.random() * 0.002;
      l.u.uLen.value = l.baseLen * len;
      l.u.uBoost.value = boost;
      l.u.uAlpha.value = l.baseAlpha * (0.55 + throttle * 0.45 + boost * 0.5);
    }
    this.group.visible = throttle > 0.02 || boost > 0.02;
  }
}

export interface JetOpts { body: number; accent: number; flame: FlameColors; glow: number }
export const PLAYER_JET: JetOpts = { body: 0x8fb4cc, accent: 0x5f6f86, flame: BLUE_FLAME, glow: 0x9fdcff };
export const ENEMY_JET: JetOpts = { body: 0x3a3238, accent: 0x7a2630, flame: RED_FLAME, glow: 0xff7a5a };

export interface Jet {
  group: THREE.Group;
  /** the skin, so the owner can hand it an environment map */
  mats: { body: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial; canopy: THREE.MeshStandardMaterial };
  navL: THREE.MeshStandardMaterial; navR: THREE.MeshStandardMaterial;
  flames: Flame[]; nozzleGlow: THREE.MeshBasicMaterial; light: THREE.PointLight;
  nozzles: THREE.Vector3[];
  update(dt: number, t: number, throttle: number, boost: number): void;
}

function wingShape(span: number, rootChord: number, tipChord: number, sweep: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(span, sweep);
  s.lineTo(span, sweep + tipChord);
  s.lineTo(0, rootChord);
  s.closePath();
  return s;
}

let PANEL: Surface | null = null; // the airframe skin, drawn once and shared by every jet
export function buildJet(o: JetOpts): Jet {
  const g = new THREE.Group();
  PANEL ??= panelSurface();
  const skin = { map: PANEL.map, roughnessMap: PANEL.rough, normalMap: PANEL.normal, normalScale: new THREE.Vector2(0.8, 0.8) };
  const body = new THREE.MeshStandardMaterial({ color: o.body, metalness: 0.9, roughness: 0.42, ...skin });
  const accent = new THREE.MeshStandardMaterial({ color: o.accent, metalness: 0.85, roughness: 0.5, ...skin });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141820, metalness: 0.9, roughness: 0.35 });

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.95, 8, 22), body);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.scale.set(1, 0.88, 1);
  g.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.128, 0.55, 22), accent);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.72;
  g.add(nose);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.9), body);
  spine.position.set(0, 0.08, 0.15);
  g.add(spine);

  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x0b1120, metalness: 0.6, roughness: 0.04, emissive: o.glow, emissiveIntensity: 0.2, transparent: true, opacity: 0.92 });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), canopyMat);
  canopy.position.set(0, 0.12, -0.28);
  canopy.scale.set(0.85, 0.62, 1.9);
  g.add(canopy);

  // intakes either side, with a dark mouth
  for (const s of [-1, 1]) {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.55), accent);
    intake.position.set(s * 0.2, -0.03, 0.02);
    g.add(intake);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.11), dark);
    mouth.position.set(s * 0.2, -0.03, -0.256);
    mouth.rotation.y = Math.PI;
    g.add(mouth);
  }

  // delta wings + horizontal stabilisers, extruded for real thickness
  const wingGeo = new THREE.ExtrudeGeometry(wingShape(0.78, 0.55, 0.14, 0.42), { depth: 0.026, bevelEnabled: false });
  const stabGeo = new THREE.ExtrudeGeometry(wingShape(0.34, 0.24, 0.09, 0.2), { depth: 0.02, bevelEnabled: false });
  const finGeo = new THREE.ExtrudeGeometry(wingShape(0.3, 0.32, 0.1, 0.22), { depth: 0.02, bevelEnabled: false });
  const navL = new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff2b2b, emissiveIntensity: 2 });
  const navR = new THREE.MeshStandardMaterial({ color: 0x4dff88, emissive: 0x19ff6b, emissiveIntensity: 2 });
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, accent);
    wing.rotation.x = Math.PI / 2;           // shape xy -> xz plane
    wing.rotation.y = s < 0 ? Math.PI : 0;   // mirror
    wing.position.set(s * 0.12, -0.04, -0.2);
    g.add(wing);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), s < 0 ? navL : navR);
    tip.position.set(s * 0.9, -0.03, 0.26);
    g.add(tip);
    const stab = new THREE.Mesh(stabGeo, accent);
    stab.rotation.x = Math.PI / 2;
    stab.rotation.y = s < 0 ? Math.PI : 0;
    stab.position.set(s * 0.14, -0.02, 0.42);
    g.add(stab);
    const fin = new THREE.Mesh(finGeo, accent);
    fin.rotation.y = s < 0 ? Math.PI : 0;   // stands up, in the yz plane
    fin.rotation.z = -s * 0.28;              // canted outward
    fin.position.set(s * 0.09, 0.1, 0.35);
    fin.rotation.order = "YZX";
    fin.rotateY(Math.PI / 2);
    g.add(fin);
  }

  // engines: nozzle cans, petal ring, glowing throat, and the plumes
  const nozzleGlow = new THREE.MeshBasicMaterial({ color: o.glow, transparent: true, opacity: 0.9 });
  const flames: Flame[] = [];
  const nozzles: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.092, 0.36, 16, 1, true), dark);
    can.rotation.x = Math.PI / 2;
    can.position.set(s * 0.15, -0.045, 0.5);
    g.add(can);
    const petals = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.018, 8, 16), accent);
    petals.position.set(s * 0.15, -0.045, 0.68);
    g.add(petals);
    const throat = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), nozzleGlow);
    throat.position.set(s * 0.15, -0.045, 0.665);
    g.add(throat);
    const f = new Flame(o.flame);
    f.group.position.set(s * 0.15, -0.045, 0.68);
    g.add(f.group);
    flames.push(f);
    nozzles.push(new THREE.Vector3(s * 0.15, -0.045, 0.7));
  }
  /* The nozzle light is NOT parented to the group: three.js bakes the number
     of visible lights into every shader, so a light that appears with a
     hidden jet would force the whole scene to recompile. The owner adds it to
     the scene once and moves it with the jet. */
  const light = new THREE.PointLight(o.glow, 0, 9, 2);

  const blinkOffset = Math.random() * 10;
  return {
    group: g, mats: { body, accent, canopy: canopyMat }, navL, navR, flames, nozzleGlow, light, nozzles,
    update(_dt, t, throttle, boost) {
      const blink = (Math.sin((t + blinkOffset) * 6) + 1) / 2;
      navL.emissiveIntensity = 0.6 + blink * 3;
      navR.emissiveIntensity = 0.6 + (1 - blink) * 3;
      for (const f of flames) f.update(t, throttle, boost);
      nozzleGlow.opacity = 0.3 + throttle * 0.4 + boost * 0.3;
      light.intensity = g.visible ? throttle * 2 + boost * 5 + (Math.random() - 0.5) * boost * 0.6 : 0;
      light.position.set(0, -0.05, 0.9); g.localToWorld(light.position);
    },
  };
}

const _p = new THREE.Vector3(), _v = new THREE.Vector3();
const C_CORE = new THREE.Color(0xeaf6ff), C_MID = new THREE.Color(0x7fd8ff), C_OUT = new THREE.Color(0x2a1a66);
/** Pour glowing exhaust out of each nozzle into the world-space particle pool. */
export function emitExhaust(jet: Jet, ex: Particles, dt: number, throttle: number, boost: number, speed: number, colors = [C_CORE, C_MID, C_OUT]) {
  if (throttle < 0.05) return;
  const per = Math.max(1, Math.round((3 + boost * 9) * throttle * dt * 60 / 4));
  for (const n of jet.nozzles) {
    for (let i = 0; i < per; i++) {
      _p.copy(n).add(_v.set((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, Math.random() * 0.4));
      jet.group.localToWorld(_p);
      _v.set((Math.random() - 0.5) * (0.6 + boost * 2), (Math.random() - 0.5) * (0.6 + boost * 2), speed * 0.35 + 6 + boost * 10 + Math.random() * 4);
      ex.emit(_p, _v, {
        life: 0.3 + Math.random() * 0.3 + boost * 0.3,
        size0: 0.25 + boost * 0.3, size1: 0.9 + boost * 1.4,
        c0: Math.random() < 0.3 + boost * 0.4 ? colors[0] : colors[1], c1: colors[2],
        drag: 1.4, alpha: 0.22 + boost * 0.16,
      });
    }
  }
}
