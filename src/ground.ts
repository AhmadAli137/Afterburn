import * as THREE from "three";
import { Particles, explode, sparkHit, Debris, Shockwaves } from "./fx";
import { groundHeight, regionAt, WATER_Y } from "./terrain";
import { rnd } from "./noise";
import type { Threats, ThreatEvents } from "./threats";

/* Ground targets. SAM sites on the shelf terraces and the ridge, radar domes
   among the graveyard monoliths, fuel depots wherever the ground is flat.
   They sit at fixed course positions so they loop with the world, they shoot
   first (a SAM when you are inside its envelope and not in the weather), and
   they die to bombs or the cannon. Bombs fall ballistically; the pipper on
   the HUD is where one released now would land. */

export type TargetKind = "sam" | "radar" | "depot";
export interface Target { kind: TargetKind; course: number; x: number; hp: number; alive: boolean; group: THREE.Group; cd: number; seen: boolean; dish: THREE.Object3D | null }
interface Bomb { pos: THREE.Vector3; vel: THREE.Vector3; alive: boolean; mesh: THREE.Mesh }

export interface GroundInput { dt: number; t: number; dist: number; player: THREE.Vector3; speed: number; scroll: number; cover: boolean; canHit: boolean; release: boolean }
export interface GroundEvents extends ThreatEvents { onTargetKilled(kind: TargetKind, p: THREE.Vector3): void; toast(t: string, cls?: string): void }

const _v = new THREE.Vector3(), _p = new THREE.Vector3();
const METAL = new THREE.Color(0x3a3540), FLASH = new THREE.Color(0xfff0d0), HOT = new THREE.Color(0xff7a3a);
const G = 22; // scene gravity for a falling bomb
const SAM_RANGE = 230, SAM_RELOAD = 7;

export class Ground {
  readonly targets: Target[] = [];
  private readonly bombs: Bomb[] = [];
  bombStock = 6; readonly bombMax = 6;
  /** where a bomb released now would land (scene), or null */
  ccip: THREE.Vector3 | null = null;
  killed = 0;
  active = false;
  constructor(scene: THREE.Scene, private sparks: Particles, private smoke: Particles, private debris: Debris, private waves: Shockwaves, private threats: Threats) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a34, roughness: 0.7, metalness: 0.4 });
    const pale = new THREE.MeshStandardMaterial({ color: 0xb8b4c0, roughness: 0.5, metalness: 0.3 });
    const hot = new THREE.MeshStandardMaterial({ color: 0x6a1e22, roughness: 0.6, metalness: 0.3, emissive: 0xff3a2a, emissiveIntensity: 0.6 });
    const kinds: TargetKind[] = ["sam", "sam", "sam", "sam", "sam", "sam", "radar", "radar", "radar", "radar", "depot", "depot", "depot", "depot"];
    for (const kind of kinds) {
      const g = new THREE.Group(); let dish: THREE.Object3D | null = null;
      if (kind === "sam") {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 4), dark));
        const rack = new THREE.Group(); rack.position.set(0, 1.2, 0); rack.rotation.x = -0.9;
        for (let i = 0; i < 4; i++) { const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.6, 8), pale); tube.rotation.x = Math.PI / 2; tube.position.set(-0.75 + (i % 2) * 1.5, (i < 2 ? 0.3 : -0.3), 0); rack.add(tube); }
        g.add(rack); dish = rack;
      } else if (kind === "radar") {
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 2.2, 10), dark));
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1.9, 16, 12), pale); dome.position.y = 2.6; g.add(dome);
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), pale); d.position.set(0, 4.4, 0); d.rotation.z = Math.PI / 2; g.add(d); dish = d;
      } else {
        for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 12), i === 1 ? hot : dark); t.position.set(-2.4 + i * 2.4, 1.2, 0); g.add(t); }
      }
      g.visible = false; scene.add(g);
      this.targets.push({ kind, course: -1e9, x: 0, hp: 3, alive: false, group: g, cd: 0, seen: false, dish });
    }
    const bombMat = new THREE.MeshStandardMaterial({ color: 0x3a4a3a, metalness: 0.5, roughness: 0.5 });
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.6, 4, 8), bombMat); m.rotation.x = Math.PI / 2; m.visible = false; scene.add(m); this.bombs.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), alive: false, mesh: m }); }
  }

  reset() { for (const t of this.targets) { t.alive = false; t.group.visible = false; t.course = -1e9; } for (const b of this.bombs) { b.alive = false; b.mesh.visible = false; } this.bombStock = this.bombMax; this.killed = 0; this.ccip = null; }
  aliveCount() { return this.targets.reduce((n, t) => n + (t.alive ? 1 : 0), 0); }

  /** Lay targets on the course ahead: sites every ~140 units through the sectors that have them, keyed by course so they loop. */
  private populate(dist: number) {
    for (let c = Math.floor((dist + 200) / 140) * 140; c < dist + 900; c += 140) {
      const r = regionAt(c);
      const wantSam = r.terrace > 0.5 || r.lift > 0.5, wantRadar = r.monoliths > 0.5, wantDepot = r.terrace > 0.3 || r.lake > 0.5 || r.forest > 0.8;
      const kind: TargetKind | null = wantRadar ? "radar" : wantSam ? "sam" : wantDepot && rnd(c * 0.13) < 0.5 ? "depot" : null;
      if (!kind) continue;
      if (this.targets.some((t) => t.alive && Math.abs(t.course - c) < 1)) continue;
      const t = this.targets.find((x) => !x.alive && x.kind === kind);
      if (!t) continue;
      const side = rnd(c * 0.31) > 0.5 ? 1 : -1;
      const x = side * (r.inner + 4 + rnd(c * 0.17) * 18);
      const gy = groundHeight(x, c);
      if (gy < WATER_Y + 0.5) continue;
      t.alive = true; t.course = c; t.x = x; t.hp = kind === "radar" ? 4 : 3; t.cd = 2 + rnd(c) * 3; t.seen = false;
      t.group.position.set(x, gy + 0.3, -(c - dist)); t.group.rotation.y = rnd(c * 0.7) * 6.28; t.group.visible = true;
    }
  }

  /** Ballistic drop from the jet: the bomb keeps the jet's forward speed, so in the scene frame it only falls and drifts back. */
  private release(player: THREE.Vector3, speed: number, ev: GroundEvents) {
    if (this.bombStock <= 0) { ev.toast("NO BOMBS", "bad"); return; }
    const b = this.bombs.find((x) => !x.alive); if (!b) return;
    this.bombStock--; b.alive = true; b.pos.copy(player).add(_v.set(0, -0.35, 0.2)); b.vel.set(0, -2, 0); b.mesh.visible = true; b.mesh.position.copy(b.pos);
    void speed;
  }

  update(inp: GroundInput, ev: GroundEvents) {
    if (!this.active) { this.ccip = null; return; }
    const { dt, dist, player, speed } = inp;
    this.populate(dist);
    if (inp.release) this.release(player, speed, ev);
    for (const t of this.targets) {
      if (!t.alive) continue;
      const z = -(t.course - dist);
      t.group.position.z = z;
      if (z > 120) { t.alive = false; t.group.visible = false; continue; }
      if (t.dish) t.dish.rotation.y = t.kind === "radar" ? inp.t * 1.2 : Math.atan2(player.x - t.x, -z) ;
      // SAM: inside the envelope, seeing you, off cooldown
      if (t.kind === "sam") {
        t.cd -= dt;
        const d = Math.hypot(player.x - t.x, player.y - t.group.position.y, z);
        if (d < SAM_RANGE && z < -20 && !inp.cover && t.cd <= 0 && player.y - t.group.position.y > 4) {
          t.cd = SAM_RELOAD;
          _p.copy(t.group.position); _p.y += 1.6;
          this.threats.launch("sam", _p, ev);
        }
        if (!t.seen && z > -260 && z < -40) { t.seen = true; ev.toast("SAM SITE AHEAD", "bad"); }
      }
    }
    // bombs
    this.ccip = null;
    for (const b of this.bombs) {
      if (!b.alive) continue;
      b.vel.y -= G * dt; b.vel.z += 6 * dt; // drag lets the world catch up: it drifts aft
      b.pos.addScaledVector(b.vel, dt); b.pos.z += inp.scroll;
      b.mesh.position.copy(b.pos); b.mesh.rotation.x = Math.PI / 2 + Math.atan2(-b.vel.y, 20) * 0.6;
      const c = dist - b.pos.z, gy = Math.max(groundHeight(b.pos.x, c), WATER_Y);
      if (b.pos.y <= gy + 0.2) {
        b.alive = false; b.mesh.visible = false;
        _p.set(b.pos.x, gy + 0.4, b.pos.z);
        explode(this.sparks, this.smoke, _p, 1.4, this.debris, this.waves, _v.set(0, 0, 0));
        for (const t of this.targets) if (t.alive && Math.hypot(t.x - b.pos.x, t.group.position.z - b.pos.z) < 7) this.kill(t, ev);
      }
    }
    // the pipper: integrate a bomb released now until it meets the ground
    {
      let y = player.y - 0.35, vy = -2, z = 0.2, vz = 0, tt = 0;
      for (let i = 0; i < 400 && tt < 8; i++) { vy -= G * 0.02; vz += 6 * 0.02; y += vy * 0.02; z += vz * 0.02; tt += 0.02; const gy = Math.max(groundHeight(player.x, dist - z), WATER_Y); if (y <= gy) { this.ccip = _v.set(player.x, gy + 0.1, z).clone(); break; } }
    }
  }
  /** The cannon can kill them too. */
  hitTest(p: THREE.Vector3, ev: GroundEvents): boolean {
    for (const t of this.targets) if (t.alive && Math.abs(t.group.position.z - p.z) < 3 && Math.abs(t.x - p.x) < 2.2 && p.y - t.group.position.y < 4) { t.hp--; sparkHit(this.sparks, p); if (t.hp <= 0) this.kill(t, ev); return true; }
    return false;
  }
  private kill(t: Target, ev: GroundEvents) {
    t.alive = false; t.group.visible = false; this.killed++;
    explode(this.sparks, this.smoke, t.group.position, t.kind === "depot" ? 2.2 : 1.3, this.debris, this.waves, _v.set(0, 0, 0));
    this.sparks.emit(t.group.position, _v.set(0, 0, 0), { life: 0.3, size0: 10, size1: 20, c0: FLASH, c1: HOT });
    this.debris.burst(t.group.position, _v.set(0, 4, 0), 10, 0.3, 9, METAL, 3);
    ev.onTargetKilled(t.kind, t.group.position);
  }
}
