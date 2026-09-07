import * as THREE from "three";
import { fbm, smoothstep, rnd } from "./noise";

/* The cloud deck: a broken layer at DECK_Y with noise gaps. It is built in
   three bands — a dark flat underside, a middle, and puffy tops — so the
   sprites parallax against each other and the deck has a thickness to fly
   through. Each sprite is lit or shaded by which side of the sun it sits
   on, and when you are above it your own shadow slides over the tops. The
   same noise mask drives the sprites and the density query, so what you see
   is what hides you. */

export const DECK_Y = 64, DECK_HALF = 7;
const N = 156, SPAN = 480;
const BANDS = [-4.2, 0, 4.4];              // y offsets of the three bands
const WHITE = new THREE.Color(0xffffff);
const _c = new THREE.Color();

interface CloudSprite { s: THREE.Sprite; course: number; seed: number; band: number; lit: boolean }

export class CloudDeck {
  private readonly sprites: CloudSprite[] = [];
  /** [band][above ? 1 : 0][lit ? 1 : 0] */
  private readonly mats: THREE.SpriteMaterial[][][] = [];
  private readonly shadow: THREE.Sprite;
  private above = false;
  readonly sunDir = new THREE.Vector3(-0.27, 0.2, -0.94).normalize();

  constructor(scene: THREE.Scene, map: THREE.Texture, shadowMap: THREE.Texture) {
    for (let b = 0; b < 3; b++) {
      this.mats.push([]);
      for (let a = 0; a < 2; a++) {
        this.mats[b].push([]);
        for (let l = 0; l < 2; l++) this.mats[b][a].push(new THREE.SpriteMaterial({ map, transparent: true, opacity: 0.5, depthWrite: false, color: 0xffffff }));
      }
    }
    for (let i = 0; i < N; i++) {
      const band = i % 3;
      const s = new THREE.Sprite(this.mats[band][0][0]);
      const e: CloudSprite = { s, course: (i / N) * SPAN - 60, seed: i * 7.7, band, lit: false };
      this.place(e, true);
      this.sprites.push(e);
      scene.add(s);
    }
    this.shadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: shadowMap, transparent: true, opacity: 0, depthWrite: false, color: 0x000000 }));
    this.shadow.visible = false;
    scene.add(this.shadow);
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

  private place(e: CloudSprite, first: boolean) {
    if (!first) e.course += SPAN;
    let x = 0;
    for (let k = 0; k < 6; k++) { x = (rnd(e.seed + k * 3 + e.course * 0.01) - 0.5) * 460; if (this.mask(x, e.course) > 0.5) break; }
    const r = rnd(e.seed + e.course * 0.013);
    // the underside is wide and flat, the tops are rounder and smaller
    const wide = e.band === 0 ? 1.25 : e.band === 1 ? 1 : 0.8, tall = e.band === 0 ? 0.55 : e.band === 1 ? 0.9 : 1.15;
    e.s.scale.set((44 + r * 44) * wide, (18 + rnd(e.seed + 1) * 12) * tall, 1);
    e.s.position.x = x;
    e.s.position.y = DECK_Y + BANDS[e.band] + (rnd(e.seed + 2 + e.course * 0.02) - 0.5) * 2.5;
    e.s.material.rotation = 0;
    (e.s as THREE.Sprite).material = this.mats[e.band][this.above ? 1 : 0][0];
  }

  /** Per frame: colours from the palette and the sun, sides lit by the sun, tops or bottoms by where the camera is. */
  update(scroll: number, dist: number, camY: number, fogColor: THREE.Color, glow: THREE.Color, sunColor: THREE.Color) {
    const above = camY > DECK_Y + 2;
    if (above !== this.above) this.above = above;
    // palette: undersides take the fog, tops go white with the sun on them
    for (let b = 0; b < 3; b++) {
      const k = b / 2; // 0 underside .. 1 tops
      const base = _c.copy(fogColor).lerp(WHITE, 0.22 + k * 0.45);
      // seen from below, only the underside band is dark; the tops still catch light through the gaps
      const below = this.mats[b][0];
      below[0].color.copy(base).lerp(new THREE.Color(0x8a8aa8), 0.45 - k * 0.2);
      below[1].color.copy(base).lerp(sunColor, 0.22 + k * 0.2);
      const over = this.mats[b][1];
      over[0].color.copy(base).lerp(glow, 0.12).multiplyScalar(0.78 + k * 0.1);
      over[1].color.copy(base).lerp(sunColor, 0.35).lerp(WHITE, 0.2 + k * 0.3);
      below[0].opacity = 0.42 + k * 0.08; below[1].opacity = 0.46 + k * 0.08;
      over[0].opacity = 0.5 + k * 0.1; over[1].opacity = 0.55 + k * 0.12;
    }
    const sx = this.sunDir.x;
    for (const e of this.sprites) {
      const z = -(e.course - dist);
      if (z > 60) this.place(e, false);
      e.s.position.z = -(e.course - dist);
      // the sun side of the deck is lit: compare the sprite's bearing from the camera with the sun's
      const lit = (e.s.position.x * sx + (-e.s.position.z) * -this.sunDir.z * 0.35) > 0 ? true : false;
      const m = this.mats[e.band][above ? 1 : 0][lit ? 1 : 0];
      if (e.s.material !== m) e.s.material = m;
    }
    void scroll;
  }

  /** Your shadow on the tops: under the jet, thrown along the sun, softer and fainter with height. */
  castShadow(x: number, y: number, z: number, dist: number) {
    const h = y - (DECK_Y + DECK_HALF);
    const cover = this.mask(x, dist - z);
    if (h < 0 || h > 60 || cover < 0.35) { this.shadow.visible = false; return; }
    const spread = 1 + h * 0.06;
    this.shadow.visible = true;
    this.shadow.position.set(x - this.sunDir.x / Math.max(0.2, this.sunDir.y) * h * 0.5, DECK_Y + DECK_HALF - 0.5, z - this.sunDir.z / Math.max(0.2, this.sunDir.y) * h * 0.5);
    this.shadow.scale.set(4.5 * spread, 2.2 * spread, 1);
    (this.shadow.material as THREE.SpriteMaterial).opacity = 0.5 * cover * Math.max(0, 1 - h / 60);
  }
}
