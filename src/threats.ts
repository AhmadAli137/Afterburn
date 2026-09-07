import * as THREE from "three";
import { Particles, explode, Debris, Shockwaves, softSprite } from "./fx";

/* Hostile missiles and the answers to them. A SAM site or an interceptor
   launches one at you; it flies proportional navigation at a capped turn
   rate, so it arcs and can be beaten. Three ways to beat it: flares, if it is
   close and you drop them in time, it goes for the hottest thing it sees;
   the notch, a hard sideways beam holds the bearing still and the seeker
   loses it; and the cloud deck, where nothing can see anything. Everything
   is in the scrolling scene frame: player near the origin, world +z. */

export type MissileKind = "sam" | "air";
interface HMissile {
  alive: boolean; kind: MissileKind; pos: THREE.Vector3; vel: THREE.Vector3; spd: number; life: number; age: number;
  lockLost: boolean; decoy: THREE.Vector3 | null; trail: number; beamT: number;
  group: THREE.Group; plume: THREE.Mesh; glow: THREE.Sprite;
}
export interface Flare { pos: THREE.Vector3; vel: THREE.Vector3; life: number }

export interface ThreatInput {
  dt: number; player: THREE.Vector3; velX: number; velY: number; speed: number; scroll: number;
  /** buried in the deck: seekers see nothing */
  cover: boolean;
  /** the player can be hit this frame */
  canHit: boolean;
}
export interface ThreatEvents {
  onLaunch(kind: MissileKind, from: THREE.Vector3): void;
  onHit(): void;
  onDefeated(how: "flare" | "notch" | "cloud" | "timeout"): void;}

const MAX = 6, SPD_SAM = 78, SPD_AIR = 92, TURN_SAM = 2.4, TURN_AIR = 3.4, FUSE = 3.2, LIFE = 9;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _ax = new THREE.Vector3(), _v = new THREE.Vector3(), _prev = new THREE.Vector3(), _sw = new THREE.Vector3();
const FLASH = new THREE.Color(0xffe0d8), HOT = new THREE.Color(0xff3a2a), SMOKE0 = new THREE.Color(0xb8a8a8), SMOKE1 = new THREE.Color(0x3a2426);
const FLARE0 = new THREE.Color(0xfff8e0), FLARE1 = new THREE.Color(0xff9a3a);

export class Threats {
  private readonly pool: HMissile[] = [];
  readonly flares: Flare[] = [];
  /** the nearest inbound, for the HUD: seconds to impact, and its scene position */
  nearest: { t: number; pos: THREE.Vector3 } | null = null;
  flareStock = 4; readonly flareMax = 4;
  private flareCd = 0;
  constructor(scene: THREE.Scene, private sparks: Particles, private smoke: Particles, private debris: Debris, private waves: Shockwaves) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, metalness: 0.5, roughness: 0.5 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x3a2a2a, metalness: 0.5, roughness: 0.5 });
    const glowTex = softSprite(64, 0.3);
    for (let i = 0; i < MAX; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 10), bodyMat); body.rotation.x = Math.PI / 2; group.add(body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.36, 10), bodyMat); nose.rotation.x = -Math.PI / 2; nose.position.z = -0.83; group.add(nose);
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, 0.3), finMat); fin.position.set(Math.sin(a) * 0.16, Math.cos(a) * 0.16, 0.5); fin.rotation.z = -a; group.add(fin); }
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.11, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a5a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      plume.rotation.x = Math.PI / 2; plume.frustumCulled = false; group.add(plume);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff4a3a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.z = 0.75; glow.scale.setScalar(0.9); group.add(glow);
      group.visible = false; group.frustumCulled = false;
      scene.add(group);
      this.pool.push({ alive: false, kind: "sam", pos: new THREE.Vector3(), vel: new THREE.Vector3(), spd: 0, life: 0, age: 0, lockLost: false, decoy: null, trail: 0, beamT: 0, group, plume, glow });
    }
  }

  /** The jet has turned round: reflect everything through it. */
  mirror() {
    for (const m of this.pool) { if (!m.alive) continue; m.pos.x = -m.pos.x; m.pos.z = -m.pos.z; m.vel.x = -m.vel.x; m.vel.z = -m.vel.z; if (m.decoy) { m.decoy.x = -m.decoy.x; m.decoy.z = -m.decoy.z; } m.group.position.copy(m.pos); }
    for (const f of this.flares) { f.pos.x = -f.pos.x; f.pos.z = -f.pos.z; f.vel.x = -f.vel.x; f.vel.z = -f.vel.z; }
  }
  reset() { for (const m of this.pool) { m.alive = false; m.group.visible = false; } this.flares.length = 0; this.flareStock = this.flareMax; this.nearest = null; }
  count() { return this.pool.reduce((n, m) => n + (m.alive ? 1 : 0), 0); }
  /** Scene positions of everything inbound, for the warning receiver. */
  list(): { x: number; z: number }[] { return this.pool.filter((m) => m.alive && !m.lockLost).map((m) => ({ x: m.pos.x, z: m.pos.z })); }

  /** Fire one from a scene position at the player. */
  launch(kind: MissileKind, from: THREE.Vector3, ev: ThreatEvents): boolean {
    const m = this.pool.find((x) => !x.alive);
    if (!m) return false;
    m.alive = true; m.kind = kind; m.pos.copy(from); m.age = 0; m.life = LIFE; m.lockLost = false; m.decoy = null; m.trail = 0; m.beamT = 0;
    m.spd = kind === "sam" ? 18 : 40;
    // a SAM goes straight up off the rail; an air shot leaves along the shooter's line
    m.vel.set(0, kind === "sam" ? 1 : 0, kind === "sam" ? 0 : Math.sign(-from.z) || 1).normalize().multiplyScalar(m.spd);
    m.group.position.copy(m.pos); m.group.visible = true;
    this.sparks.emit(m.pos, _v.set(0, 0, 0), { life: 0.2, size0: 8, size1: 2, c0: FLASH, c1: HOT });
    for (let i = 0; i < 10; i++) this.smoke.emit(m.pos, _v.set((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8), { life: 0.9, size0: 0.4, size1: 3, c0: SMOKE0, c1: SMOKE1, drag: 2, alpha: 0.5 });
    ev.onLaunch(kind, from);
    return true;
  }

  /** Drop a pair of flares: hot, falling, drifting back. */
  dropFlares(player: THREE.Vector3, speed: number): boolean {
    if (this.flareStock <= 0 || this.flareCd > 0) return false;
    this.flareStock--; this.flareCd = 0.6;
    for (const s of [-1, 1]) this.flares.push({ pos: player.clone().add(_v.set(s * 0.5, -0.3, 0.6)), vel: new THREE.Vector3(s * 6, -4, speed * 0.25 + 6), life: 2.6 });
    return true;
  }

  update(inp: ThreatInput, ev: ThreatEvents) {
    const { dt, player } = inp;
    if (this.flareCd > 0) this.flareCd -= dt;
    // flares: burn hot, fall, drift aft
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.life -= dt; f.vel.y -= 9 * dt; f.vel.multiplyScalar(1 - 1.2 * dt);
      f.pos.addScaledVector(f.vel, dt); f.pos.z += inp.scroll;
      this.sparks.emit(f.pos, _v.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0), { life: 0.12, size0: 1.6 + Math.random(), size1: 0.6, c0: FLARE0, c1: FLARE1, alpha: 0.95 });
      if (Math.random() < 0.7) this.smoke.emit(f.pos, _v.set((Math.random() - 0.5) * 1.5, 0.8, 0), { life: 1.2, size0: 0.3, size1: 1.6, c0: SMOKE0, c1: SMOKE1, drag: 1.5, alpha: 0.35 });
      if (f.life <= 0) this.flares.splice(i, 1);
    }
    // the beam: hard sideways for long enough and a seeker loses the bearing
    const beaming = Math.abs(inp.velX) > 28;
    this.nearest = null;
    for (const m of this.pool) {
      if (!m.alive) continue;
      m.age += dt; m.life -= dt;
      const turn = m.kind === "sam" ? TURN_SAM : TURN_AIR, vmax = m.kind === "sam" ? SPD_SAM : SPD_AIR;
      m.spd = Math.min(vmax, m.spd + (m.kind === "sam" ? 55 : 70) * dt);
      if (!m.lockLost && m.age > 0.5) {
        if (inp.cover) { m.lockLost = true; m.decoy = null; ev.onDefeated("cloud"); }
        else {
          const d = m.pos.distanceTo(player);
          for (const f of this.flares) if (d < 60 && m.pos.distanceTo(f.pos) < d + 4 && Math.random() < dt * 4) { m.lockLost = true; m.decoy = f.pos.clone(); ev.onDefeated("flare"); break; }
          if (!m.lockLost && beaming && d < 40) { m.beamT += dt; if (m.beamT > 0.9) { m.lockLost = true; m.decoy = null; ev.onDefeated("notch"); } } else m.beamT = Math.max(0, m.beamT - dt);
        }
      }
      const tgt: THREE.Vector3 | null = m.lockLost ? m.decoy : player;
      _a.set(0, 0, 0);
      if (tgt) {
        _b.copy(tgt).sub(m.pos);
        const tt = THREE.MathUtils.clamp(_b.length() / Math.max(30, m.spd), 0, 1.5);
        if (tgt === player) _b.add(_v.set(inp.velX * tt, inp.velY * tt, 0));
        _a.copy(_b).normalize();
      }
      // the airframe turns the velocity toward the aim at a capped rate; with nothing to chase it flies on
      if (_a.lengthSq() > 1e-6) {
        _b.copy(m.vel).normalize();
        const ang = _b.angleTo(_a);
        if (ang > 1e-4) { _ax.crossVectors(_b, _a); if (_ax.lengthSq() > 1e-10) _b.applyAxisAngle(_ax.normalize(), Math.min(ang, turn * dt)); }
        m.vel.copy(_b).multiplyScalar(m.spd);
      } else m.vel.setLength(m.spd);
      _prev.copy(m.pos);
      m.pos.addScaledVector(m.vel, dt); m.pos.z += inp.scroll;
      m.group.position.copy(m.pos);
      if (m.vel.lengthSq() > 1e-6) { m.group.lookAt(_v.copy(m.pos).add(m.vel)); m.group.rotateY(Math.PI); }
      const fl = 0.8 + Math.random() * 0.4; m.plume.scale.set(fl, 1.4 * fl, fl); m.plume.position.z = 0.65 + 0.7;
      m.trail += dt;
      while (m.trail > 1 / 60) { m.trail -= 1 / 60; _v.copy(m.pos).addScaledVector(m.vel, -m.trail); this.smoke.emit(_v, _b.set((Math.random() - 0.5) * 1.5, 0.4, 0), { life: 1.3, size0: 1.4, size1: 3.6, c0: SMOKE0, c1: SMOKE1, drag: 1, alpha: 0.45 }); }
      this.sparks.emit(m.pos, _v.set(0, 0, 0), { life: 0.08, size0: 1.4, size1: 0.5, c0: FLASH, c1: HOT, alpha: 0.9 });
      // proximity fuse against the player, on the swept segment
      if (!m.lockLost && inp.canHit) {
        _sw.copy(m.pos).sub(_prev);
        const l2 = _sw.lengthSq();
        const u = l2 > 1e-8 ? THREE.MathUtils.clamp(_b.copy(player).sub(_prev).dot(_sw) / l2, 0, 1) : 0;
        _b.copy(_prev).addScaledVector(_sw, u);
        if (_b.distanceTo(player) < FUSE) { m.pos.copy(_b); this.blow(m); ev.onHit(); continue; }
      }
      if (m.lockLost && m.decoy && m.pos.distanceTo(m.decoy) < FUSE) { this.blow(m); continue; }
      if (!m.lockLost) { const d = m.pos.distanceTo(player); const t = d / Math.max(1, m.spd); if (!this.nearest || t < this.nearest.t) this.nearest = { t, pos: m.pos }; }
      if (m.life <= 0 || m.pos.z > 80 || m.pos.z < -500 || m.pos.y < -3) { if (!m.lockLost) ev.onDefeated("timeout"); this.blow(m); }
    }
  }
  private blow(m: HMissile) {
    m.alive = false; m.group.visible = false;
    explode(this.sparks, this.smoke, m.pos, 0.8, this.debris, this.waves, _v.set(0, 0, 0));
  }
}
