import * as THREE from "three";
import { WATER_Y } from "./terrain";

/* The carrier. A hull on the mirror sea with an angled deck, an island, deck
   edge lights, four wires, and the ball: the Fresnel lens on the port side
   that shows you high, on the slope, or low. She makes way, so the deck moves
   under you. Trap, bolter or wave-off is graded from where and how you touch. */

export const DECK_LEN = 96, DECK_W = 14, DECK_Y = WATER_Y + 3.4;
const WIRES = [-30, -34, -38, -42]; // local z of the four wires (aft of the ramp end at 0 .. bow at -DECK_LEN)

export class Carrier {
  readonly group = new THREE.Group();
  /** course position of the ramp (the aft end), and lateral offset */
  course = 0; x = 0;
  private readonly ball: THREE.Mesh; private readonly ballMat: THREE.MeshBasicMaterial;
  private readonly datum: THREE.Mesh[] = [];
  private readonly wake: THREE.Mesh;
  speed = 2.5; // the ship's own way, scene units per second
  constructor(scene: THREE.Scene) {
    const grey = new THREE.MeshStandardMaterial({ color: 0x4a4e58, roughness: 0.8, metalness: 0.4 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x2a2b33, roughness: 0.95, metalness: 0.1 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(DECK_W * 0.8, 6, DECK_LEN), grey); hull.position.set(0, -3.2, -DECK_LEN / 2); this.group.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(DECK_W * 0.4, 14, 4), grey); bow.rotation.x = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(0, -3.2, -DECK_LEN - 7); bow.scale.set(1, 1, 0.55); this.group.add(bow);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(DECK_W, 0.4, DECK_LEN + 4), deckMat); deck.position.set(0, 0, -DECK_LEN / 2 - 1); this.group.add(deck);
    const island = new THREE.Mesh(new THREE.BoxGeometry(2.6, 6, 8), grey); island.position.set(DECK_W / 2 + 0.6, 3, -DECK_LEN * 0.55); this.group.add(island);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 6, 6), grey); mast.position.set(DECK_W / 2 + 0.6, 9, -DECK_LEN * 0.55); this.group.add(mast);
    // centreline and edge lights
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), amber = new THREE.MeshBasicMaterial({ color: 0xffd27d }), green = new THREE.MeshBasicMaterial({ color: 0x7dffd9 });
    const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 2.2), white, 22);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 22; i++) { m.makeRotationX(-Math.PI / 2); m.setPosition(0, 0.22, -4 - i * 4.2); dashes.setMatrixAt(i, m); }
    this.group.add(dashes);
    const edge = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 6), amber, 48);
    for (let i = 0; i < 24; i++) for (const s of [-1, 1]) { m.makeTranslation(s * (DECK_W / 2 - 0.3), 0.3, -i * 4); edge.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m); }
    this.group.add(edge);
    // the wires
    for (const z of WIRES) { const w = new THREE.Mesh(new THREE.BoxGeometry(DECK_W - 1, 0.05, 0.12), green); w.position.set(0, 0.24, z); this.group.add(w); }
    // the ball: a lens on the port side with green datum lights either side
    this.ballMat = new THREE.MeshBasicMaterial({ color: 0xffb35c });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), this.ballMat); this.ball.position.set(-DECK_W / 2 - 1.2, 1.6, -36); this.group.add(this.ball);
    for (const s of [-1, 1]) { const d = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.16), green); d.position.set(-DECK_W / 2 - 1.2 + s * 1.3, 1.6, -36); this.group.add(d); this.datum.push(d); }
    this.wake = new THREE.Mesh(new THREE.PlaneGeometry(DECK_W * 0.9, 60), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
    this.wake.rotation.x = -Math.PI / 2; this.wake.position.set(0, -DECK_Y + WATER_Y + 0.08, 30); this.group.add(this.wake);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Put her on the water at a course position; she is only there when the sea is. */
  place(course: number, x: number) { this.course = course; this.x = x; this.group.visible = true; }
  hide() { this.group.visible = false; }
  /** Per frame: ride the world past, make way, and light the ball for a jet at (x, y) and deck-relative range. */
  update(dt: number, dist: number, jet: THREE.Vector3) {
    if (!this.group.visible) return;
    this.course += this.speed * dt; // steaming ahead, down the course
    this.group.position.set(this.x, DECK_Y, -(this.course - dist));
    this.group.rotation.z = Math.sin(dist * 0.02) * 0.006; this.group.rotation.x = Math.sin(dist * 0.013 + 1) * 0.004;
    // the ball: 3.5 degrees down to the wires; a ball-width is about a third of a degree
    const range = -(this.group.position.z + WIRES[1]) + jet.z; // distance from the jet to the wires, positive when short
    if (range > 4 && range < 900) {
      const ideal = DECK_Y + 1.0 + Math.tan(3.5 * Math.PI / 180) * range;
      const err = (jet.y - ideal) / Math.max(1, range * Math.tan(0.35 * Math.PI / 180));
      const e = THREE.MathUtils.clamp(err, -3, 3);
      this.ball.position.y = 1.6 + e * 0.35;
      this.ballMat.color.set(e < -2 ? 0xff3a3a : Math.abs(e) < 0.7 ? 0xffb35c : 0xffd27d);
      (this.ball.material as THREE.MeshBasicMaterial).color.copy(this.ballMat.color);
    }
    (this.wake.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(dist * 0.1) * 0.03;
  }
  /** Is a scene point over the deck? Returns local z (0 ramp .. -DECK_LEN bow) or null. */
  overDeck(p: THREE.Vector3): number | null {
    if (!this.group.visible) return null;
    const lz = p.z - this.group.position.z, lx = p.x - this.x;
    return Math.abs(lx) < DECK_W / 2 && lz <= 0 && lz >= -DECK_LEN ? lz : null;
  }
  deckY() { return DECK_Y + 0.2; }
  /** Grade a touchdown at local z with a sink rate (positive down, m/s) and centreline offset. */
  grade(lz: number, sink: number, offset: number): { wire: number; grade: string; bonus: number } {
    let wire = 0;
    for (let i = 0; i < WIRES.length; i++) if (lz < WIRES[i] + 2 && lz > WIRES[i] - 2.2) wire = i + 1;
    if (wire === 0 && lz < WIRES[3] - 2.2 && lz > WIRES[0] + 2) wire = 2;
    if (wire === 0) return { wire: 0, grade: "BOLTER", bonus: 0 };
    const ok = wire === 3 && sink < 7 && Math.abs(offset) < 2.5;
    const fair = wire === 2 || wire === 4 ? sink < 9 : sink < 11;
    return ok ? { wire, grade: "OK · 3-WIRE", bonus: 4000 } : fair ? { wire, grade: `FAIR · ${wire}-WIRE`, bonus: 2500 } : { wire, grade: `NO GRADE · ${wire}-WIRE`, bonus: 1200 };
  }
  /** Distance from the jet to the ramp, for the HUD. */
  range(jetZ: number) { return -(this.group.position.z) + jetZ; }
}
