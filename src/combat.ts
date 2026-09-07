import * as THREE from "three";
import { buildJet, Jet, ENEMY_JET, emitExhaust } from "./jet";
import { Particles, explode, sparkHit, Debris, Shockwaves, softSprite } from "./fx";

/* SORTIE mode. Hostile jets fly the same corridor with their own airspeed:
   chasers try to hold station ahead of you by throttling, but can't match a
   lit burner, so boosting closes to knife range; braking lets them pull away.
   Now and then one throttles back and drops behind you to shoot from your
   six — a reversal (hard brake and loop) makes it overshoot back in front.
   Interceptors come in head-on. Attacks are telegraphed: a jet lights its
   burner and flashes red for half a second before it fires. Everything
   lives in the scrolling scene frame: player near the origin, world +z. */

type Kind = "chaser" | "interceptor";
interface Enemy {
  jet: Jet; alive: boolean; kind: Kind; hp: number; seed: number; t: number;
  fireT: number; tele: number; over: number; dropT: number; es: number; behindT: number; hp0: number; shot: boolean;
  vx: number; vy: number; tx: number; ty: number;
}
interface Bullet { pos: THREE.Vector3; vel: THREE.Vector3; life: number; prevZ: number; who?: number }
/* A missile you can actually watch. It drops off the rail, the motor lights a
   beat later with a flash, and from then on it is a bright dot at the head of a
   smoke column pulling away from you at closing speed. Guidance is lead pursuit
   with a turn-rate cap, so it arcs onto the target instead of snapping to it —
   and it can miss. */
interface Missile {
  pos: THREE.Vector3; vel: THREE.Vector3; life: number; age: number; spd: number; side: number; trail: number;
  target: Enemy | null; alive: boolean;
  group: THREE.Group; plume: THREE.Mesh; halo: THREE.Mesh; glow: THREE.Sprite;
}

export interface CombatInput {
  dt: number; t: number; speed: number; player: THREE.Vector3; fire: boolean; laser: boolean; canHit: boolean; scroll: number;
  /** lateral aim of the nose (rudder), as x per unit of forward travel */
  aimX: number;
  /** true while the player is buried in the cloud deck: nobody can see you, so nobody shoots */
  cover: boolean;
  /** g-load 0..1: the guns spread under a pull */
  spread: number;
  /** the wingman's position, if he is up: rounds near him hit him */
  wingman: THREE.Vector3 | null;
  /** a bandit head-on inside this range takes a missile shot at you (0 disables) */
  missileRange: number;
  /** cloud density at a scene point, 0..1 — a target inside cloud can't be locked */
  cloudAt(x: number, y: number, z: number): number;
}
export interface CombatEvents {
  onPlayerHit(): void;
  onCollision(p: THREE.Vector3): void;
  onKill(p: THREE.Vector3, byMissile: boolean): void;
  onWaveClear(wave: number): void;
  onRTB(): void;
  onEnemyFire(p: THREE.Vector3, fromBehind: boolean): void;
  /** a round just went past the canopy without hitting; `fromBehind` says which way it was travelling */
  onNearMiss(p: THREE.Vector3, fromBehind: boolean): void;
  /** a bandit on your six has settled its aim and will fire in about a second */
  onRearTelegraph(): void;
  /** the rack got one back — three kills, or a wave cleared */
  onRearm(): void;
  /** an interceptor has launched at you from p */
  onMissileLaunch(p: THREE.Vector3): void;
  /** a hostile round went through the wingman */
  onWingmanHit(): void;
  toast(t: string, cls?: string): void;
}

export const FINAL_WAVE = 5;
/** From this wave on, chasers may throttle back and drop onto your six. Before it they stay in front where you can see them. */
export const REAR_WAVE = 4;
const MAX_ENEMIES = 8, MAX_BULLETS = 80, MAX_EBULLETS = 60, MAX_MISSILES = 4;
const ROUND_G = 6; // gravity on hostile rounds, scene units per second squared
/* The missile's life, in order: it falls clear of the rail, the motor lights and
   burns, then it coasts. Speeds are relative to the launching jet, which is what
   the scrolling scene frame measures — so MSL_VMAX is closing speed, not airspeed. */
const MSL_DROP = 0.26, MSL_BURN = 1.4, MSL_VMAX = 110, MSL_ACC = 165, MSL_TURN = 5.2, MSL_LIFE = 6.5, MSL_FUSE = 4.2;
/* Separation: it flies out and up away from the launch aircraft before it turns
   onto the target — which is what real ones do, and what lets you watch it go. */
const MSL_SEP = 0.55;
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _ax = new THREE.Vector3(), _tv = new THREE.Vector3(), _sep = new THREE.Vector3();
const _prev = new THREE.Vector3(), _sweep = new THREE.Vector3();
const FAR = new THREE.Vector3(0, -999, 0);
const RED = new THREE.Color(0xff3a2a), FLASH = new THREE.Color(0xfff0d0), HOT = new THREE.Color(0xff7a3a);
const SMOKE0 = new THREE.Color(0xe8e4e0), SMOKE1 = new THREE.Color(0x4e4a58);
const ENEMY_EXHAUST = [new THREE.Color(0xffe0b0), new THREE.Color(0xff8a4a), new THREE.Color(0x3a1010)];

export class Combat {
  readonly enemies: Enemy[] = [];
  private readonly bullets: Bullet[] = [];
  private readonly ebullets: Bullet[] = [];
  private readonly missiles: Missile[] = [];
  /* Each round is drawn twice: a thin bright core and a fat additive halo, both stretched along the
     velocity so a fast round reads as a streak. Enemy rounds are red-orange, yours yellow-white. */
  private readonly tracer: THREE.InstancedMesh; private readonly tracerGlow: THREE.InstancedMesh;
  private readonly etracer: THREE.InstancedMesh; private readonly etracerGlow: THREE.InstancedMesh;
  private readonly wtracer: THREE.InstancedMesh; private readonly wtracerGlow: THREE.InstancedMesh;
  /** a camera-facing incandescent dot on each hostile round: seen end-on a streak is nothing, a dot is a dot */
  private readonly etips: THREE.Sprite[] = [];
  /** inbound rounds this frame (scene positions), for the HUD markers */
  threats: THREE.Vector3[] = [];
  wave = 0; queued = 0; spawnT = 0; clearT = -1; rtb = false; active = false;
  /** how many waves this sortie runs; missions set it */
  finalWave = FINAL_WAVE;
  /* Three on the rails and no more. The rack gets one back every third kill and
     one at the end of a wave, so a missile is a decision, not a trigger pull. */
  ammo = 3; readonly maxAmmo = 3; readonly rearmKills = 3; killsToRearm = 0;
  fireT = 0; lock: Enemy | null = null; lockT = 0;
  kills = 0;
  /** HUD signals, refreshed every update. */
  behind = 0; incoming = false; incomingBehind = false; telegraph: THREE.Vector3 | null = null; nearest = 999;
  /** where the incoming fire is coming from, for the HUD banner */
  incomingFrom = "";
  /** debug: the last round to cross the player's plane, and how far off it was */
  lastCross = { dx: -1, dy: -1, n: 0 };
  roundsInFlight() { return this.ebullets.length; }
  /** debug: how many missiles are in the air, and where the first one is */
  missilesInFlight() { return this.missiles.filter((m) => m.alive).map((m) => ({ z: +m.pos.z.toFixed(1), spd: Math.round(m.spd), age: +m.age.toFixed(2) })); }
  /** Where the laser beam terminates this frame (scene z), for drawing it. */
  laserHitZ = -320;
  private lastSpeed = 30;
  private wingPos: THREE.Vector3 | null = null;
  private railSide = 1;
  private gunSide = 1;

  constructor(scene: THREE.Scene, private sparks: Particles, private smoke: Particles, private exhaust: Particles, private debris: Debris, private waves: Shockwaves) {
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const jet = buildJet(ENEMY_JET);
      jet.group.scale.setScalar(1.5);
      jet.group.visible = false;
      scene.add(jet.group, jet.light); // light lives in the scene permanently (see jet.ts)
      this.enemies.push({ jet, alive: false, kind: "chaser", hp: 0, hp0: 1, seed: i * 7.3, t: 0, fireT: 0, tele: 0, over: 0, dropT: 0, es: 30, behindT: 0, vx: 0, vy: 0, tx: 0, ty: 2, shot: false });
    }
    // a tracer is a bright incandescent tip with a thin tail that fades: the core is the tip, the tail is a
    // narrow additive cone whose wide end sits at the tip and tapers to nothing behind it
    const core = new THREE.BoxGeometry(0.055, 0.055, 0.35), tail = new THREE.CylinderGeometry(0.02, 0.09, 1, 6, 1, true);
    tail.rotateX(Math.PI / 2); tail.translate(0, 0, 0.5); // z: 0 at the tip .. 1 behind it
    const tailMat = (c: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    /* Who fired what, at a glance: your rounds are cyan-white, Two's are blue, theirs are red. */
    this.tracer = new THREE.InstancedMesh(core, new THREE.MeshBasicMaterial({ color: 0xeaffff }), MAX_BULLETS);
    this.tracerGlow = new THREE.InstancedMesh(tail, tailMat(0x7dffd9), MAX_BULLETS);
    this.wtracer = new THREE.InstancedMesh(core, new THREE.MeshBasicMaterial({ color: 0xdce8ff }), MAX_BULLETS);
    this.wtracerGlow = new THREE.InstancedMesh(tail, tailMat(0x5f9dff), MAX_BULLETS);
    this.etracer = new THREE.InstancedMesh(core, new THREE.MeshBasicMaterial({ color: 0xffd6cc }), MAX_EBULLETS);
    this.etracerGlow = new THREE.InstancedMesh(tail, tailMat(0xff3a2a), MAX_EBULLETS);
    for (const m of [this.tracer, this.tracerGlow, this.wtracer, this.wtracerGlow, this.etracer, this.etracerGlow]) { m.frustumCulled = false; scene.add(m); }
    const tipMat = new THREE.SpriteMaterial({ map: softSprite(32, 0.45), color: 0xff6a5a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < MAX_EBULLETS; i++) { const s = new THREE.Sprite(tipMat); s.scale.setScalar(0.55); s.visible = false; scene.add(s); this.etips.push(s); }
    /* The airframe: a slim body with a seeker head, four tail fins and four canards.
       Seen from the chase camera the shape is almost nothing — what reads is the
       motor: a bright core cone, a wide soft halo and a camera-facing glow, all
       additive, at the head of a smoke column. */
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8edf4, metalness: 0.55, roughness: 0.42 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x2b303a, metalness: 0.6, roughness: 0.45 });
    const seekMat = new THREE.MeshStandardMaterial({ color: 0x2a1418, metalness: 0.3, roughness: 0.2, emissive: 0xff3a2a, emissiveIntensity: 0.8 });
    const bodyGeo = new THREE.CylinderGeometry(0.062, 0.062, 0.86, 12);
    const noseGeo = new THREE.ConeGeometry(0.062, 0.3, 12);
    const finGeo = new THREE.BoxGeometry(0.014, 0.17, 0.19), canGeo = new THREE.BoxGeometry(0.012, 0.1, 0.11);
    const plumeGeo = new THREE.ConeGeometry(0.075, 1, 12, 1, true), haloGeo = new THREE.ConeGeometry(0.16, 1, 12, 1, true);
    const glowTex = softSprite(64, 0.3);
    for (let i = 0; i < MAX_MISSILES; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat); body.rotation.x = Math.PI / 2; group.add(body);
      const nose = new THREE.Mesh(noseGeo, bodyMat); nose.rotation.x = -Math.PI / 2; nose.position.z = -0.58; group.add(nose);
      const seeker = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), seekMat); seeker.position.z = -0.72; seeker.scale.z = 1.4; group.add(seeker);
      for (let k = 0; k < 4; k++) {
        const ang = k * Math.PI / 2;
        const fin = new THREE.Mesh(finGeo, finMat);
        fin.position.set(Math.sin(ang) * 0.11, Math.cos(ang) * 0.11, 0.36); fin.rotation.z = -ang; group.add(fin);
        const can = new THREE.Mesh(canGeo, finMat);
        can.position.set(Math.sin(ang) * 0.08, Math.cos(ang) * 0.08, -0.2); can.rotation.z = -ang; group.add(can);
      }
      // the motor: apex trailing behind the nozzle, so scaling y lengthens the flame aft
      const plume = new THREE.Mesh(plumeGeo, new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      plume.rotation.x = halo.rotation.x = Math.PI / 2;
      plume.frustumCulled = halo.frustumCulled = false;
      group.add(plume, halo);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xa8ecff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.z = 0.5; group.add(glow);
      group.visible = false; group.frustumCulled = false;
      scene.add(group);
      this.missiles.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, age: 0, spd: 0, side: 1, trail: 0, target: null, alive: false, group, plume, halo, glow });
    }
    this.hideTracers();
  }

  private hideTracers() {
    _m.makeTranslation(FAR.x, FAR.y, FAR.z);
    for (let i = 0; i < MAX_BULLETS; i++) { this.tracer.setMatrixAt(i, _m); this.tracerGlow.setMatrixAt(i, _m); this.wtracer.setMatrixAt(i, _m); this.wtracerGlow.setMatrixAt(i, _m); }
    this.wtracer.instanceMatrix.needsUpdate = this.wtracerGlow.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_EBULLETS; i++) { this.etracer.setMatrixAt(i, _m); this.etracerGlow.setMatrixAt(i, _m); }
    this.tracer.instanceMatrix.needsUpdate = this.tracerGlow.instanceMatrix.needsUpdate = this.etracer.instanceMatrix.needsUpdate = this.etracerGlow.instanceMatrix.needsUpdate = true;
  }

  reset() {
    this.wave = 0; this.queued = 0; this.spawnT = 0; this.clearT = 1.5; this.rtb = false; this.ammo = this.maxAmmo; this.killsToRearm = 0; this.kills = 0; this.lock = null; this.lockT = 0;
    this.behind = 0; this.incoming = false; this.telegraph = null; this.nearest = 999; this.incomingFrom = "";
    this.enemies.forEach((e) => { e.alive = false; e.jet.group.visible = false; e.jet.light.intensity = 0; });
    this.bullets.length = 0; this.ebullets.length = 0;
    this.missiles.forEach((m) => { m.alive = false; m.group.visible = false; });
    this.hideTracers();
  }
  setActive(on: boolean) { this.active = on; this.reset(); }
  /** Dev shortcut: skip straight to the return-to-base leg. */
  skipToRTB() { this.wave = FINAL_WAVE; this.queued = 0; this.clearT = 0.5; }

  private startWave(n: number) { this.wave = n; this.queued = 2 + n; this.spawnT = 0.5; }
  private spawn(kind: Kind) {
    const e = this.enemies.find((x) => !x.alive);
    if (!e) return;
    e.alive = true; e.kind = kind; e.t = 0; e.fireT = 2 + Math.random() * 2; e.tele = 0; e.over = 0; e.dropT = 0; e.behindT = 0; e.vx = e.vy = 0; e.es = 30;
    e.hp = kind === "chaser" ? 4 + Math.floor(this.wave * 0.7) : 3;
    e.hp0 = e.hp; e.jet.setDamage(0); e.shot = false;
    const side = Math.random() < 0.5 ? -1 : 1;
    if (kind === "chaser") e.jet.group.position.set(side * (4 + Math.random() * 5), 2 + Math.random() * 5, -170);
    else e.jet.group.position.set(side * (2 + Math.random() * 6), 1.5 + Math.random() * 6, -330);
    e.tx = e.jet.group.position.x; e.ty = e.jet.group.position.y;
    e.jet.group.rotation.set(0, kind === "interceptor" ? Math.PI : 0, 0);
    e.jet.group.visible = true;
  }

  private kill(e: Enemy, byMissile: boolean, ev: CombatEvents) {
    e.alive = false; e.jet.group.visible = false; e.jet.light.intensity = 0; this.kills++;
    // the wreck keeps the jet's momentum: sideways drift plus whatever it had relative to the airflow
    _v.set(e.vx * 0.5, e.vy * 0.5, e.kind === "interceptor" ? this.lastSpeed * 0.6 : (this.lastSpeed - e.es) * 0.6);
    /* A missile kill is the big one: twice the fireball, and the wreck comes apart
       toward you, so the pieces stream back past the canopy and the camera. */
    explode(this.sparks, this.smoke, e.jet.group.position, byMissile ? 2.1 : 1.2, this.debris, this.waves, _v);
    if (byMissile) {
      const p = e.jet.group.position;
      this.debris.burst(p, _v.set(e.vx * 0.3, 2, this.lastSpeed * 0.9 + 30), 22, 0.3, 16, new THREE.Color(0x3a3238), 6);
      this.debris.burst(p, _v.set(0, 6, this.lastSpeed * 0.5 + 12), 10, 0.5, 8, new THREE.Color(0x7a2630), 4);
      this.waves.fire(p, 16);
      for (let i = 0; i < 24; i++) this.sparks.emit(p, _v.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, this.lastSpeed + 20 + Math.random() * 30), { life: 0.6 + Math.random() * 0.6, size0: 0.5, size1: 0.08, c0: FLASH, c1: HOT, gravity: 6, drag: 0.8 });
    }
    if (this.lock === e) this.lock = null;
    ev.onKill(e.jet.group.position, byMissile);
    // three kills buys a missile back
    if (++this.killsToRearm >= this.rearmKills) { this.killsToRearm = 0; this.rearm(ev); }
  }

  private rearm(ev: CombatEvents) {
    if (this.ammo >= this.maxAmmo) return;
    this.ammo++;
    ev.onRearm();
  }

  /** Off the rail: alternating sides, dropped clear before the motor lights. */
  fireMissile(from: THREE.Vector3): boolean {
    if (!this.active || this.ammo <= 0 || !this.lock || this.lockT < 0.35) return false;
    const m = this.missiles.find((x) => !x.alive);
    if (!m) return false;
    this.ammo--;
    this.railSide = -this.railSide;
    m.alive = true; m.life = MSL_LIFE; m.age = 0; m.spd = 0; m.trail = 0; m.side = this.railSide; m.target = this.lock;
    m.pos.copy(from).add(_v.set(m.side * 0.62, -0.16, 0.05));
    m.vel.set(m.side * 1.2, -1.6, 0);
    m.group.position.copy(m.pos);
    m.group.rotation.set(0, 0, 0);
    m.group.visible = true;
    m.plume.visible = m.halo.visible = false;
    (m.glow.material as THREE.SpriteMaterial).opacity = 0;
    // the rail: a puff of smoke and a shove of hot gas where it hung
    for (let i = 0; i < 8; i++) this.smoke.emit(m.pos, _v.set((Math.random() - 0.5) * 3, -1 - Math.random() * 2, 4 + Math.random() * 5), { life: 0.5 + Math.random() * 0.4, size0: 0.2, size1: 1.1, c0: SMOKE0, c1: SMOKE1, drag: 2.2, alpha: 0.4 });
    return true;
  }

  /** A burst from the wingman: the same rounds as yours, from his nose, aimed at a bandit. */
  friendlyShot(from: THREE.Vector3, at: THREE.Vector3) {
    const d = at.clone().sub(from); const tt = Math.max(0.15, d.length() / 150);
    const b: Bullet = { pos: from.clone(), vel: new THREE.Vector3(d.x / tt + (Math.random() - 0.5) * 3, d.y / tt + (Math.random() - 0.5) * 2, d.z / tt), life: 1.4, prevZ: 0, who: 1 };
    this.bullets.push(b); if (this.bullets.length > MAX_BULLETS) this.bullets.shift();
    this.sparks.emit(from, new THREE.Vector3(0, 0, 0), { life: 0.06, size0: 1, size1: 0.4, c0: FLASH, c1: HOT });
  }
  /** The reversal: anything on your six flies straight past and ends up in front. Returns how many. */
  overshoot(): number {
    let n = 0;
    for (const e of this.enemies) {
      if (e.alive && e.kind === "chaser" && e.jet.group.position.z > -10) { e.over = 1.0; e.dropT = 0; e.fireT = Math.max(e.fireT, 2.5); e.tele = 0; e.ty = Math.min(100, e.jet.group.position.y + 14); n++; }
    }
    return n;
  }

  /** A bandit's velocity in the scene frame, for leading it. */
  private enemyVel(e: Enemy, speed: number, out: THREE.Vector3) {
    return out.set(e.vx, e.vy, e.kind === "interceptor" ? speed + 44 : e.over > 0 ? -75 : speed - e.es);
  }

  /** The warhead goes off: whatever is inside the burst radius goes down with it. */
  private detonate(m: Missile, ev: CombatEvents) {
    m.alive = false; m.group.visible = false;
    explode(this.sparks, this.smoke, m.pos, 0.9, this.debris, this.waves, _v.set(0, 0, 0));
    let hit: Enemy | null = null, bd = MSL_FUSE;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.jet.group.position.distanceTo(m.pos);
      if (d < bd) { bd = d; hit = e; }
    }
    // only call it a miss if the thing it was chasing is still flying
    if (hit) this.kill(hit, true, ev);
    else if (m.target && m.target.alive) ev.toast("MISSILE MISSED", "bad");
  }

  update(inp: CombatInput, ev: CombatEvents) {
    if (!this.active) return;
    const { dt, t, speed, player } = inp;
    this.lastSpeed = speed; this.wingPos = inp.wingman;

    // ---- wave flow ----
    if (!this.rtb) {
      if (this.clearT >= 0) {
        this.clearT -= dt;
        if (this.clearT < 0) {
          if (this.wave >= this.finalWave) { this.rtb = true; ev.onRTB(); }
          else { this.startWave(this.wave + 1); ev.toast(this.wave === REAR_WAVE ? `WAVE ${this.wave} · WATCH YOUR SIX` : `WAVE ${this.wave}`, "hot"); }
        }
      } else {
        if (this.queued > 0) {
          this.spawnT -= dt;
          if (this.spawnT <= 0) { this.spawn(this.queued % 3 === 0 && this.wave > 1 ? "interceptor" : "chaser"); this.queued--; this.spawnT = 1.4; }
        } else if (!this.enemies.some((e) => e.alive)) {
          this.clearT = 3; this.killsToRearm = 0; this.rearm(ev); // a wave cleared puts one back on the rails
          ev.onWaveClear(this.wave);
        }
      }
    }

    // ---- enemies ----
    this.behind = 0; this.telegraph = null; this.nearest = 999;
    let teleZ = -1e9;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.t += dt;
      const g = e.jet.group;
      const isBehind = g.position.z > 3;
      if (e.kind === "chaser") {
        // lateral: weave, drift toward the player's lane
        if (Math.floor(e.t * 0.7 + e.seed) !== Math.floor((e.t - dt) * 0.7 + e.seed)) {
          e.tx = THREE.MathUtils.clamp(player.x * 0.5 + (Math.random() - 0.5) * 14, -30, 30);
          e.ty = THREE.MathUtils.clamp(player.y * 0.85 + 1 + (Math.random() - 0.5) * 6, 0.8, 100);
        }
        const wx = Math.sin(e.t * 1.6 + e.seed) * 1.4, wy = Math.cos(e.t * 1.1 + e.seed * 2) * 0.8;
        e.vx += ((e.tx + wx - g.position.x) * 6 - e.vx * 2.6) * dt;
        e.vy += ((e.ty + wy - g.position.y) * 6 - e.vy * 2.6) * dt;
        g.position.x += e.vx * dt; g.position.y += e.vy * dt;

        // longitudinal: throttle to hold station; sometimes throttle back and drop behind
        const zTarget = -28 - (e.seed % 4) * 9;
        const rearOK = this.wave >= REAR_WAVE; // early waves: nobody drops back, and they have the legs to stay ahead of your burner
        if (e.dropT > 0) e.dropT -= dt;
        else if (rearOK && g.position.z < -12 && Math.random() < dt * 0.05) e.dropT = 4 + Math.random() * 3;
        const desired = e.dropT > 0 ? 18 : THREE.MathUtils.clamp(speed + (g.position.z - zTarget) * 0.6, 16, rearOK ? 50 : 90);
        e.es += (desired - e.es) * (1 - Math.pow(0.25, dt));
        if (e.over > 0) { e.over -= dt; g.position.z -= 75 * dt; e.es = 50; }
        else g.position.z += (speed - e.es) * dt;
        g.position.z = THREE.MathUtils.clamp(g.position.z, -220, rearOK ? 12 : -9); // behind you it sits in mirror range
        e.behindT = isBehind ? e.behindT + dt : 0;
        // pass-through: never sit exactly on the player
        if (Math.abs(g.position.z) < 3 && Math.hypot(g.position.x - player.x, g.position.y - player.y) < 2) g.position.x += Math.sign(g.position.x - player.x || 1) * 6 * dt;

        g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, THREE.MathUtils.clamp(-e.vx * 0.12, -0.9, 0.9), 1 - Math.pow(0.02, dt));
        g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, e.vy * 0.06 + (e.over > 0 ? 0.25 : 0), 1 - Math.pow(0.02, dt));

        // attack: telegraph, then a burst. From ahead it shoots over its shoulder; from behind, right up your tailpipe.
        // from behind it has to settle its aim first (behindT), warns you, and shoots slower, wider rounds
        if (e.over <= 0 && (g.position.z < -14 || (isBehind && e.behindT > 2.2)) && !inp.cover) {
          e.fireT -= dt;
          const teleLen = isBehind ? 1.0 : 0.6;
          if (e.fireT <= teleLen && e.tele <= 0 && e.fireT > 0) { e.tele = teleLen; if (isBehind) ev.onRearTelegraph(); }
          if (e.fireT <= 0) {
            e.fireT = (isBehind ? 2.6 : 2.4) + Math.random() * 2; e.tele = 0;
            const vz = isBehind ? speed + 36 : 46;
            for (let i = 0; i < (isBehind ? 3 : 4); i++) setTimeout(() => this.enemyShoot(e, player, vz, i, ev, isBehind ? 2.2 : 1), i * 110);
          }
        }
        if (isBehind) this.behind++;
      } else {
        // interceptor: head-on pass
        g.position.z += (speed + 44) * dt;
        g.position.x += (e.tx - g.position.x) * 1.2 * dt;
        g.position.y += (e.ty - g.position.y) * 1.2 * dt;
        g.rotation.z = Math.sin(e.t * 2 + e.seed) * 0.35;
        if (inp.missileRange > 0 && this.wave >= 2 && !e.shot && g.position.z > -inp.missileRange && g.position.z < -60 && !inp.cover) { e.shot = true; ev.onMissileLaunch(g.position); }
        if (g.position.z > -170 && g.position.z < -40 && !inp.cover) {
          e.fireT -= dt;
          if (e.fireT <= 0.5 && e.tele <= 0 && e.fireT > 0) e.tele = 0.5;
          if (e.fireT <= 0) { e.fireT = 1.1; e.tele = 0; for (let i = 0; i < 3; i++) setTimeout(() => this.enemyShoot(e, player, speed + 62, i, ev), i * 70); }
        }
        if (g.position.z > 30) { // slipped past: it becomes a chaser from behind the horizon
          e.kind = "chaser"; g.position.z = -170; g.rotation.y = 0; e.tx = g.position.x; e.ty = g.position.y; e.es = 30;
        }
      }
      if (e.tele > 0) {
        e.tele -= dt;
        // the telegraph: burner lit, nose flashing red
        _v.copy(g.position); _v.z -= 1.2 * (e.kind === "interceptor" ? -1 : 1);
        this.sparks.emit(_v, new THREE.Vector3(0, 0, 0), { life: 0.09, size0: 1.4 + Math.sin(t * 40) * 0.5, size1: 0.6, c0: RED, c1: HOT, alpha: 0.9 });
        if (!isBehind && g.position.z > teleZ) { teleZ = g.position.z; this.telegraph = g.position; }
      }
      const burner = e.kind === "interceptor" || e.tele > 0 || e.over > 0 ? 1 : e.dropT > 0 ? 0 : 0.25;
      e.jet.update(dt, t, e.dropT > 0 ? 0.35 : 0.9, burner);
      emitExhaust(e.jet, this.exhaust, dt, 0.8, burner * 0.7, speed, ENEMY_EXHAUST);
      if (!isBehind) this.nearest = Math.min(this.nearest, -g.position.z);
      // mid-air collision: the bandit comes apart, you take the hit
      if (inp.canHit && Math.abs(g.position.z - player.z) < 2 && Math.hypot(g.position.x - player.x, g.position.y - player.y) < 1.8) {
        this.kill(e, false, ev); ev.onCollision(g.position);
      }
    }

    // ---- laser: everything on the line burns ----
    this.laserHitZ = -320;
    if (inp.laser) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const p = e.jet.group.position;
        if (p.z < -2 && Math.abs(p.x - player.x) < 2 && Math.abs(p.y - player.y) < 1.7) {
          e.hp -= dt * 40; this.laserHitZ = Math.max(this.laserHitZ, p.z); e.jet.setDamage(1 - e.hp / e.hp0);
          sparkHit(this.sparks, p);
          if (e.hp <= 0) this.kill(e, false, ev);
        }
      }
      for (let i = this.ebullets.length - 1; i >= 0; i--) {
        const b = this.ebullets[i];
        if (b.pos.z < -1 && Math.abs(b.pos.x - player.x) < 1.7 && Math.abs(b.pos.y - player.y) < 1.5) { sparkHit(this.sparks, b.pos); this.ebullets.splice(i, 1); }
      }
    }

    // ---- lock-on: nearest enemy in the forward cone, or anywhere below you (you can strike down, never up) ----
    let bestD = 1e9, best: Enemy | null = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const p = e.jet.group.position;
      if (p.z > -6 || p.z < -220 || inp.cover || inp.cloudAt(p.x, p.y, p.z) > 0.4) continue;
      const dx = Math.abs(p.x - player.x), dy = p.y - player.y; // dy < 0: target is below
      const cone = 2.6 + (-p.z) * 0.04;
      const below = dy < 0;
      if (dx < cone * (below ? 2.2 : 1) && dy < cone * 0.8 && dy > -60) {
        const d = dx + Math.max(0, dy) + Math.max(0, -dy) * 0.15 - p.z * 0.02;
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    if (best !== this.lock) { this.lock = best; this.lockT = 0; } else if (best) this.lockT += dt;

    // ---- player cannon ----
    this.fireT -= dt;
    if (inp.fire && this.fireT <= 0) {
      this.fireT = 1 / 13;
      // two guns either side of the nose, converging at seventy; a hard pull opens the pattern
      this.gunSide = -this.gunSide;
      const sp = 1 + inp.spread * 3;
      const b: Bullet = { pos: player.clone().add(_v.set(this.gunSide * 0.36, -0.1, -0.6)), vel: new THREE.Vector3(-this.gunSide * 0.36 / 70 * 150 + (Math.random() - 0.5) * 2.2 * sp + inp.aimX * 150, (Math.random() - 0.5) * 1.6 * sp, -150), life: 1.6, prevZ: 0 };
      this.bullets.push(b);
      if (this.bullets.length > MAX_BULLETS) this.bullets.shift();
      _v.copy(player); _v.z -= 0.9;
      this.sparks.emit(_v, new THREE.Vector3(0, 0, 0), { life: 0.06, size0: 1.2, size1: 0.5, c0: FLASH, c1: HOT });
    }
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt; b.vel.y -= 2 * dt; b.pos.addScaledVector(b.vel, dt); // your rounds arc a little
      let hit = false;
      if (this.groundHit && b.pos.y < 30 && this.groundHit(b.pos)) hit = true;
      for (const e of this.enemies) {
        if (hit || !e.alive) continue;
        const p = e.jet.group.position;
        if (Math.abs(b.pos.x - p.x) < 1.6 && Math.abs(b.pos.y - p.y) < 1.1 && Math.abs(b.pos.z - p.z) < 3.6) {
          hit = true; e.hp--; sparkHit(this.sparks, b.pos); e.jet.setDamage(1 - e.hp / e.hp0);
          if (e.hp <= 0) this.kill(e, false, ev);
          break;
        }
      }
      if (hit || b.life <= 0) this.bullets.splice(i, 1);
    }

    // ---- missiles ----
    for (const m of this.missiles) {
      if (!m.alive) continue;
      m.life -= dt; m.age += dt;
      // the thing it was chasing came apart: it goes ballistic and self-destructs shortly after
      if (m.target && !m.target.alive) m.life = Math.min(m.life, 1.2);
      const lit = m.age >= MSL_DROP, burning = lit && m.age < MSL_DROP + MSL_BURN;
      if (!lit) {
        // still falling clear of the wing: no thrust, no guidance
        m.vel.y -= 24 * dt;
        m.vel.x += m.side * 4 * dt;
      } else {
        if (m.age - dt < MSL_DROP) {
          // ignition: a hard flash and a ring of gas off the nozzle
          this.sparks.emit(m.pos, _v.set(0, 0, 0), { life: 0.2, size0: 12, size1: 2.5, c0: FLASH, c1: HOT });
          this.waves.fire(m.pos, 2.2);
          for (let i = 0; i < 14; i++) this.smoke.emit(m.pos, _v.set((Math.random() - 0.5) * 11, (Math.random() - 0.5) * 11, 6 + Math.random() * 9), { life: 0.7 + Math.random() * 0.6, size0: 0.35, size1: 2.6, c0: SMOKE0, c1: SMOKE1, drag: 2, alpha: 0.6 });
        }
        m.spd = burning ? Math.min(MSL_VMAX, m.spd + MSL_ACC * dt) : Math.max(24, m.spd - 26 * dt);
        // lead pursuit: aim where the bandit will be when the missile arrives
        const tgt = m.target && m.target.alive ? m.target : null;
        _a.set(0, 0, -1);
        if (tgt) {
          const tp = tgt.jet.group.position;
          _b.copy(tp).sub(m.pos);
          const tt = THREE.MathUtils.clamp(_b.length() / Math.max(30, m.spd), 0, 1.8);
          this.enemyVel(tgt, speed, _tv);
          _a.copy(tp).addScaledVector(_tv, tt).sub(m.pos);
        }
        // the airframe can only pull so hard: turn the velocity toward the aim point at a capped rate
        if (_a.lengthSq() > 1e-8) {
          _a.normalize();
          /* Fly clear of the wing first, out to the rail side and climbing, then come
             back onto the aim. Only when there is room for it: at knife range there is
             no time to go round the houses, so the separation fades out with range. */
          const room = THREE.MathUtils.clamp((tgt ? tgt.jet.group.position.distanceTo(m.pos) - 30 : 999) / 55, 0, 1);
          const sep = THREE.MathUtils.clamp(1 - (m.age - MSL_DROP) / MSL_SEP, 0, 1) * room;
          if (sep > 0) _a.lerp(_sep.set(m.side * 1.15, 0.5, -1).normalize(), sep * 0.85).normalize();
          if (m.vel.lengthSq() < 1e-8) _b.set(0, 0, -1); else _b.copy(m.vel).normalize();
          const ang = _b.angleTo(_a);
          if (ang > 1e-4) {
            _ax.crossVectors(_b, _a);
            if (_ax.lengthSq() > 1e-10) _b.applyAxisAngle(_ax.normalize(), Math.min(ang, MSL_TURN * dt));
          }
          m.vel.copy(_b).multiplyScalar(m.spd);
        }
      }
      _prev.copy(m.pos);
      m.pos.addScaledVector(m.vel, dt);
      m.group.position.copy(m.pos);
      if (m.vel.lengthSq() > 1e-6) { m.group.lookAt(_v.copy(m.pos).add(m.vel)); m.group.rotateY(Math.PI); }

      // the motor, and the column it leaves behind
      const thrust = burning ? 1 : lit ? Math.max(0, 1 - (m.age - MSL_DROP - MSL_BURN) * 3) : 0;
      const flick = 0.8 + Math.random() * 0.4, len = thrust * (1.5 + Math.random() * 0.6);
      m.plume.visible = m.halo.visible = thrust > 0.02;
      if (thrust > 0.02) {
        m.plume.scale.set(flick, len, flick); m.plume.position.z = 0.44 + len * 0.5;
        m.halo.scale.set(flick, len * 1.5, flick); m.halo.position.z = 0.44 + len * 0.75;
      }
      (m.glow.material as THREE.SpriteMaterial).opacity = thrust * (0.75 + Math.random() * 0.25);
      m.glow.scale.setScalar(0.45 + thrust * 0.6);
      if (lit) {
        m.trail += dt;
        // spaced tightly and born fat, so the column is a column from the first metre
        // rather than a dotted line that only closes up once it is behind you
        const step = 1 / (burning ? 90 : 22);
        while (m.trail > step) {
          m.trail -= step;
          _v.copy(m.pos).addScaledVector(m.vel, -m.trail);
          this.smoke.emit(_v, _b.set((Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 1.4 + 0.6, (Math.random() - 0.5) * 1.8), {
            life: 1.2 + Math.random() * 0.9, size0: burning ? 2.1 : 0.6, size1: burning ? 4.4 : 2, c0: SMOKE0, c1: SMOKE1, drag: 1.1, alpha: burning ? 0.5 : 0.28,
          });
        }
        // the incandescent head, so it stays a bright point once the shape is too far to read
        if (burning) this.sparks.emit(m.pos, _v.set(0, 0, 0), { life: 0.09, size0: 1.6, size1: 0.5, c0: FLASH, c1: HOT, alpha: 0.95 });
      }

      /* Proximity fuse, measured against the whole segment the missile swept this
         frame. At better than a hundred units a second a frame is several lengths of
         it, so testing only where it ended up lets it pass clean through a bandit. */
      const tgt = m.target && m.target.alive ? m.target : null;
      if (tgt && lit) {
        const tp = tgt.jet.group.position;
        _sweep.copy(m.pos).sub(_prev);
        const len2 = _sweep.lengthSq();
        const u = len2 > 1e-8 ? THREE.MathUtils.clamp(_b.copy(tp).sub(_prev).dot(_sweep) / len2, 0, 1) : 0;
        _b.copy(_prev).addScaledVector(_sweep, u);
        const d = _b.distanceTo(tp);
        if (d < MSL_FUSE) { m.pos.copy(_b); this.detonate(m, ev); continue; }
        // gone past and opening: a clean miss, so let it go off out there rather than loop back forever
        _a.copy(tp).sub(m.pos);
        if (_a.dot(m.vel) < 0 && _a.length() > 22) { this.detonate(m, ev); continue; }
      }
      if (m.life <= 0 || m.pos.z < -430 || m.pos.z > 90) { this.detonate(m, ev); continue; }
    }

    // ---- enemy bullets: glow trail, incoming warning, near misses, hit test ----
    this.incoming = false; this.incomingBehind = false; this.incomingFrom = ""; this.threats.length = 0;
    for (let i = this.ebullets.length - 1; i >= 0; i--) {
      const b = this.ebullets[i];
      b.prevZ = b.pos.z;
      b.life -= dt; b.vel.y -= ROUND_G * dt; b.pos.addScaledVector(b.vel, dt);
      if (Math.random() < 0.5) this.sparks.emit(b.pos, new THREE.Vector3(0, 0, 0), { life: 0.16, size0: 0.35, size1: 0.1, c0: FLASH, c1: HOT, alpha: 0.5 }); // a thread of hot gas
      const approaching = b.vel.z > 0 ? b.pos.z < player.z : b.pos.z > player.z;
      if (approaching) {
        const tt = (player.z - b.pos.z) / b.vel.z;
        if (tt < 1.4 && Math.abs(b.pos.x + b.vel.x * tt - player.x) < 3.2 && Math.abs(b.pos.y + b.vel.y * tt - player.y) < 2.6) {
          this.incoming = true; this.threats.push(b.pos);
          if (b.vel.z < 0) this.incomingBehind = true;
          const dx = b.pos.x - player.x;
          this.incomingFrom = Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(b.pos.z - player.z) * 0.35 ? (dx < 0 ? "LEFT" : "RIGHT") : b.vel.z < 0 ? "BEHIND" : "AHEAD";
        }
      }
      // the crossing: it either hits you or goes past
      const crossed = (b.prevZ - player.z) * (b.pos.z - player.z) <= 0;
      const dx = Math.abs(b.pos.x - player.x), dy = Math.abs(b.pos.y - player.y);
      if (crossed) { this.lastCross.dx = +dx.toFixed(1); this.lastCross.dy = +dy.toFixed(1); this.lastCross.n++; }
      if (crossed && dx < 1.0 && dy < 0.75) {
        if (inp.canHit) { this.ebullets.splice(i, 1); ev.onPlayerHit(); continue; }
      } else if (crossed && dx < 4.5 && dy < 3.5) ev.onNearMiss(b.pos, b.vel.z < 0);
      if (inp.wingman) {
        const w = inp.wingman, crossedW = (b.prevZ - w.z) * (b.pos.z - w.z) <= 0;
        if (crossedW && Math.abs(b.pos.x - w.x) < 1.4 && Math.abs(b.pos.y - w.y) < 1.0) { this.ebullets.splice(i, 1); ev.onWingmanHit(); continue; }
      }
      if (b.life <= 0 || b.pos.z > 40 || b.pos.z < -300) this.ebullets.splice(i, 1);
    }

    // ---- tracers: oriented along the velocity, stretched by speed ----
    const pack = (list: Bullet[], n: number, core: THREE.InstancedMesh, glow: THREE.InstancedMesh, len: number) => {
      for (let i = 0; i < n; i++) {
        const b = list[i];
        if (b) {
          _q.setFromEuler(_e.set(-Math.atan2(b.vel.y, Math.hypot(b.vel.x, b.vel.z)), Math.atan2(b.vel.x, b.vel.z), 0, "YXZ"));
          const l = Math.min(7, b.vel.length() * len);
          _m.compose(b.pos, _q, _s.set(1, 1, 1)); core.setMatrixAt(i, _m);
          _m.compose(b.pos, _q, _s.set(1, 1, l)); glow.setMatrixAt(i, _m);
        } else { _m.makeTranslation(FAR.x, FAR.y, FAR.z); core.setMatrixAt(i, _m); glow.setMatrixAt(i, _m); }
      }
      core.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true;
    };
    pack(this.bullets.filter((b) => !b.who), MAX_BULLETS, this.tracer, this.tracerGlow, 0.03);
    pack(this.bullets.filter((b) => b.who === 1), MAX_BULLETS, this.wtracer, this.wtracerGlow, 0.03);
    pack(this.ebullets, MAX_EBULLETS, this.etracer, this.etracerGlow, 0.06);
    for (let i = 0; i < MAX_EBULLETS; i++) { const b = this.ebullets[i], s = this.etips[i]; s.visible = !!b; if (b) s.position.copy(b.pos); }
    _s.set(1, 1, 1);
  }

  private enemyShoot(e: Enemy, player0: THREE.Vector3, vz: number, i: number, ev: CombatEvents, spread = 1) {
    if (!e.alive || !this.active) return;
    const player = this.wingPos && (e.seed * 7) % 4 < 1 ? this.wingPos : player0;
    const from = e.jet.group.position.clone();
    const dir = player.clone().sub(from);
    const sign = Math.sign(dir.z) || 1;
    const tt = Math.max(0.2, Math.abs(dir.z) / vz);
    // aimed with elevation: the round drops under ROUND_G on the way, so the gunner holds off by the same amount
    const v = new THREE.Vector3(dir.x / tt + (Math.random() - 0.5) * 3 * spread + i * 0.3, dir.y / tt + 0.5 * ROUND_G * tt + (Math.random() - 0.5) * 2 * spread, sign * vz);
    this.ebullets.push({ pos: from.add(new THREE.Vector3(0, -0.1, -sign * 0.8)), vel: v, life: 3, prevZ: from.z });
    if (this.ebullets.length > MAX_EBULLETS) this.ebullets.shift();
    // muzzle flash
    _v.copy(e.jet.group.position); _v.z -= sign * 1.4;
    this.sparks.emit(_v, new THREE.Vector3(0, 0, 0), { life: 0.08, size0: 2.4, size1: 0.8, c0: FLASH, c1: HOT });
    if (i === 0) ev.onEnemyFire(e.jet.group.position, sign < 0);
  }

  aliveCount() { return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0); }
  /** Hostile missiles in the air (scene positions), for the warning receiver. */
  hostileMissiles(): { x: number; z: number }[] { return this.threatList ? this.threatList() : []; }
  /** the owner plugs the threat pool in here */
  threatList: (() => { x: number; z: number }[]) | null = null;
  /** your rounds against something on the ground: the owner tests them */
  groundHit: ((p: THREE.Vector3) => boolean) | null = null;
  /** Radar contacts: scene-relative positions plus flags. */
  contacts(): { x: number; z: number; locked: boolean; head: boolean; tele: boolean }[] {
    const out: { x: number; z: number; locked: boolean; head: boolean; tele: boolean }[] = [];
    for (const e of this.enemies) if (e.alive) out.push({ x: e.jet.group.position.x, z: e.jet.group.position.z, locked: e === this.lock && this.lockT >= 0.35, head: e.kind === "interceptor", tele: e.tele > 0 });
    return out;
  }
  lockPos(): THREE.Vector3 | null { return this.lock && this.lock.alive ? this.lock.jet.group.position : null; }
}
