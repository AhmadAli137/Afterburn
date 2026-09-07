import * as THREE from "three";
import { buildJet, Jet, PLAYER_JET, emitExhaust, BLUE_FLAME } from "./jet";
import { Particles, explode, Debris, Shockwaves } from "./fx";

/* Two. A wingman who holds formation off your left wing with a little lag,
   calls what he sees, and takes a shot when you drag a bandit across his
   nose. He can be hit; losing him costs more than any kill earns. */

export interface WingmanInput { dt: number; t: number; player: THREE.Vector3; speed: number; scroll: number; bandits: { pos: THREE.Vector3; alive: boolean }[]; combat: boolean }
export interface WingmanEvents { onShoot(from: THREE.Vector3, at: THREE.Vector3): void; onCall(text: string, say: string): void; onLost(): void }

const _v = new THREE.Vector3(), _p = new THREE.Vector3();
export class Wingman {
  readonly jet: Jet;
  alive = false; hp = 4; readonly hpMax = 4;
  private vx = 0; private vy = 0; private fireT = 0; private callT = 0; private tally = false; private hitFlash = 0;
  private side = -1;
  constructor(scene: THREE.Scene, private sparks: Particles, private smoke: Particles, private exhaust: Particles, private debris: Debris, private waves: Shockwaves) {
    this.jet = buildJet({ ...PLAYER_JET, body: 0x7f9ab8, accent: 0x4f5d78, flame: BLUE_FLAME });
    this.jet.group.visible = false;
    scene.add(this.jet.group, this.jet.light);
  }
  spawn(player: THREE.Vector3) {
    this.alive = true; this.hp = this.hpMax; this.jet.setDamage(0); this.tally = false; this.callT = 4;
    this.jet.group.position.set(player.x - 3.5, player.y + 0.2, player.z + 3);
    this.jet.group.rotation.set(0, 0, 0); this.jet.group.visible = true;
  }
  hide() { this.alive = false; this.jet.group.visible = false; this.jet.light.intensity = 0; }
  /** A hostile round near him: he takes it. */
  hit(ev: WingmanEvents) {
    if (!this.alive) return;
    this.hp--; this.hitFlash = 0.3; this.jet.setDamage(1 - this.hp / this.hpMax);
    if (this.hp <= 0) { this.alive = false; this.jet.group.visible = false; this.jet.light.intensity = 0; explode(this.sparks, this.smoke, this.jet.group.position, 1.1, this.debris, this.waves, _v.set(0, 0, 0)); ev.onLost(); }
    else ev.onCall(this.hp === 1 ? "TWO · HIT · CRITICAL" : "TWO · HIT", this.hp === 1 ? "Two's hit! I'm in trouble." : "Two's hit. Still with you.");
  }
  update(inp: WingmanInput, ev: WingmanEvents) {
    if (!this.alive) return;
    const { dt, player } = inp, g = this.jet.group;
    // formation: off the wing, a length back, lagging the leader
    const tx = player.x + this.side * 3.6, ty = player.y + 0.25;
    this.vx += ((tx - g.position.x) * 5 - this.vx * 2.4) * dt;
    this.vy += ((ty - g.position.y) * 5 - this.vy * 2.4) * dt;
    g.position.x += this.vx * dt; g.position.y += this.vy * dt;
    g.position.z += (3.2 - g.position.z) * (1 - Math.pow(0.1, dt));
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, THREE.MathUtils.clamp(-this.vx * 0.05, -0.8, 0.8), 1 - Math.pow(0.02, dt));
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, this.vy * 0.03, 1 - Math.pow(0.02, dt));
    this.jet.update(dt, inp.t, 0.9, 0);
    emitExhaust(this.jet, this.exhaust, dt, 0.85, 0, inp.speed);
    if (this.hitFlash > 0) this.hitFlash -= dt;
    // eyes: the first bandit ahead gets a tally; a bandit across his nose gets a burst
    let best: THREE.Vector3 | null = null, bd = 1e9;
    for (const b of inp.bandits) { if (!b.alive || b.pos.z > -8 || b.pos.z < -160) continue; const d = Math.hypot(b.pos.x - g.position.x, b.pos.y - g.position.y); if (d < bd) { bd = d; best = b.pos; } }
    if (best && !this.tally) { this.tally = true; ev.onCall("TWO · TALLY", "Two, tally bandit, twelve o'clock."); }
    if (!best) this.tally = false;
    this.fireT -= dt;
    if (best && bd < 9 && this.fireT <= 0 && inp.combat) { this.fireT = 0.09; _p.copy(g.position); _p.z -= 0.8; ev.onShoot(_p, best); }
    this.callT -= dt;
    if (this.callT <= 0) { this.callT = 25 + Math.random() * 20; ev.onCall("TWO · ON YOUR WING", ["Two's on your wing.", "Two, holding formation.", "Looking good, lead."][Math.floor(Math.random() * 3)]); }
  }
}
