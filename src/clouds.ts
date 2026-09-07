import * as THREE from "three";
import { fbm, smoothstep, rnd } from "./noise";

/* The cloud deck: a broken layer of big soft sprites at DECK_Y with noise
   gaps. Fly through it and the world goes white; sit inside it and nobody
   can see you. Above it the tops catch the moon. The same noise mask drives
   both the sprites and the density query, so what you see is what hides you. */

export const DECK_Y = 64, DECK_HALF = 7;
const N = 130, SPAN = 480;

export class CloudDeck {
  private readonly sprites: { s: THREE.Sprite; course: number; seed: number }[] = [];
  private readonly matTop: THREE.SpriteMaterial;
  private readonly matBottom: THREE.SpriteMaterial;
  private above = false;

  constructor(scene: THREE.Scene, map: THREE.Texture) {
    this.matTop = new THREE.SpriteMaterial({ map, transparent: true, opacity: 0.55, depthWrite: false, color: 0xffffff });
    this.matBottom = new THREE.SpriteMaterial({ map, transparent: true, opacity: 0.5, depthWrite: false, color: 0x8a8aa8 });
    for (let i = 0; i < N; i++) {
      const s = new THREE.Sprite(this.matBottom);
      const e = { s, course: (i / N) * SPAN - 60, seed: i * 7.7 };
      this.place(e, true);
      this.sprites.push(e);
      scene.add(s);
    }
  }

  /** Coverage 0..1 of the deck at (x, course); gaps where the mask is low. */
  mask(x: number, course: number): number {
    return smoothstep(0.38, 0.55, fbm(x * 0.006 + 3, course * 0.006, 3) * 0.5 + 0.5);
  }
  /** How deep inside cloud a point is, 0..1. */
  density(x: number, y: number, course: number): number {
    const vertical = smoothstep(0, 3.5, DECK_HALF - Math.abs(y - DECK_Y));
    return vertical * this.mask(x, course);
  }

  private place(e: { s: THREE.Sprite; course: number; seed: number }, first: boolean) {
    if (!first) e.course += SPAN;
    // rejection-sample x against the mask so sprites sit where the deck is solid
    let x = 0;
    for (let k = 0; k < 6; k++) { x = (rnd(e.seed + k * 3 + e.course * 0.01) - 0.5) * 460; if (this.mask(x, e.course) > 0.5) break; }
    const r = rnd(e.seed + e.course * 0.013);
    e.s.scale.set(46 + r * 44, 16 + rnd(e.seed + 1) * 12, 1);
    e.s.position.x = x;
    e.s.position.y = DECK_Y + (rnd(e.seed + 2 + e.course * 0.02) - 0.5) * 6;
  }

  update(scroll: number, dist: number, camY: number, fogColor: THREE.Color, glow: THREE.Color) {
    const above = camY > DECK_Y + 2;
    if (above !== this.above) { this.above = above; for (const e of this.sprites) e.s.material = above ? this.matTop : this.matBottom; }
    this.matTop.color.copy(fogColor).lerp(glow, 0.35).lerp(new THREE.Color(0xffffff), 0.55);
    this.matBottom.color.copy(fogColor).lerp(new THREE.Color(0x9a98b8), 0.4);
    for (const e of this.sprites) {
      const z = -(e.course - dist);
      if (z > 60) this.place(e, false);
      e.s.position.z = -(e.course - dist);
      void scroll;
    }
  }
}
