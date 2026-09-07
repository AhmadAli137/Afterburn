import * as THREE from "three";
import { fbm, rnd } from "./noise";

/* Surface detail, still with no assets: every texture is drawn on a canvas
   at startup. Noise is made tileable by sampling it around a circle, so the
   maps repeat without seams. Each comes with a normal map derived from its
   own height field, so the light actually catches the relief — panel seams
   on the airframe, striations in the rock, aggregate in the asphalt. Colour
   maps are near-white so the material colour (and the palette) stays in
   charge; they only modulate. */

type Field = (x: number, y: number) => number;

function makeCanvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c, ctx: c.getContext("2d")! };
}
function texture(c: HTMLCanvasElement, srgb: boolean, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Periodic fbm on the unit square: the square is mapped onto a torus so the edges meet. */
function tileNoise(u: number, v: number, scale: number, oct: number, seed: number): number {
  const a = u * Math.PI * 2, b = v * Math.PI * 2;
  return fbm(Math.cos(a) * scale + seed, Math.sin(a) * scale + Math.cos(b) * scale + seed * 0.37, oct) * 0.6 + fbm(Math.sin(b) * scale + seed * 1.7, Math.cos(a) * scale * 0.7 + seed * 2.3, oct) * 0.4;
}
/** Bake a scalar field (0..1) to a grayscale colour map, remapped into [lo, hi]. */
function bakeGray(size: number, f: Field, lo: number, hi: number): HTMLCanvasElement {
  const { c, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = Math.round(255 * (lo + (hi - lo) * Math.min(1, Math.max(0, f(x / size, y / size)))));
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
/** Tangent-space normal map from a height field, finite differences on the tiled square. */
function bakeNormal(size: number, h: Field, strength: number): HTMLCanvasElement {
  const { c, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const d = 1 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const dx = (h(u + d, v) - h(u - d, v)) * strength, dy = (h(u, v + d) - h(u, v - d)) * strength;
    const n = new THREE.Vector3(-dx, -dy, 1).normalize();
    const i = (y * size + x) * 4;
    img.data[i] = 128 + n.x * 127; img.data[i + 1] = 128 + n.y * 127; img.data[i + 2] = 128 + n.z * 127; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
const wrap = (x: number) => x - Math.floor(x);

export interface Surface { map: THREE.CanvasTexture; normal: THREE.CanvasTexture; rough?: THREE.CanvasTexture }

/** Weathered rock: bedding striations warped by noise, with fine grain. */
export function rockSurface(size = 256): Surface {
  const height: Field = (u, v) => {
    const warp = tileNoise(u, v, 2.2, 3, 5) - 0.5;
    const bands = 0.5 + 0.5 * Math.sin((v + warp * 0.35) * Math.PI * 2 * 9 + tileNoise(u, v, 4, 2, 9) * 2);
    const grain = tileNoise(u, v, 9, 4, 13);
    return bands * 0.45 + grain * 0.55;
  };
  return { map: texture(bakeGray(size, height, 0.5, 1.0), true), normal: texture(bakeNormal(size, height, 4.2), false) };
}

/** Airframe skin: a patchwork of panels with recessed seams, rivet lines, and streaked wear. */
export function panelSurface(size = 512): Surface {
  // split the square into panels: a few random cuts per axis, jittered per row so the seams don't line up
  const cols = 6, rows = 5;
  const colCut = Array.from({ length: cols + 1 }, (_, i) => i / cols + (i > 0 && i < cols ? (rnd(i * 3.1) - 0.5) * 0.06 : 0));
  const rowCut = Array.from({ length: rows + 1 }, (_, i) => i / rows + (i > 0 && i < rows ? (rnd(i * 5.3) - 0.5) * 0.06 : 0));
  const seam = (u: number, v: number) => { // 0 far from a seam .. 1 on it
    let s = 0;
    const row = rowCut.findIndex((r, i) => v < r && i > 0) - 1;
    const shift = row >= 0 ? rnd(row * 7.7) * 0.5 : 0; // panels staggered per row
    for (const c of colCut) { const d = Math.abs(wrap(u - shift + 0.5) - 0.5 - (c - 0.5)); s = Math.max(s, 1 - Math.min(1, d * size / 3.2)); }
    for (const r of rowCut) { const d = Math.abs(v - r); s = Math.max(s, 1 - Math.min(1, d * size / 3.2)); }
    return s;
  };
  const rivet = (u: number, v: number) => { // dots along the row seams
    let r = 0;
    for (const rc of rowCut) {
      const dv = v - rc - 0.012;
      if (Math.abs(dv) > 0.008) continue;
      const along = wrap(u * 22);
      const du = Math.min(along, 1 - along) / 22;
      r = Math.max(r, 1 - Math.min(1, Math.hypot(du, dv) * size / 2.2));
    }
    return r;
  };
  const height: Field = (u, v) => 0.6 - seam(u, v) * 0.45 + rivet(u, v) * 0.35 + (tileNoise(u, v, 12, 3, 21) - 0.5) * 0.06;
  const albedo: Field = (u, v) => {
    const wear = tileNoise(u, v, 3, 3, 31) * 0.14 + Math.pow(tileNoise(u * 0.25, v, 8, 2, 41), 3) * 0.1; // long streaks in u
    return 1 - seam(u, v) * 0.55 - wear * 1.3 + rivet(u, v) * 0.16;
  };
  const rough: Field = (u, v) => 0.35 + seam(u, v) * 0.5 + tileNoise(u, v, 5, 3, 51) * 0.25;
  return { map: texture(bakeGray(size, albedo, 0.45, 1.0), true), normal: texture(bakeNormal(size, height, 2.4), false), rough: texture(bakeGray(size, rough, 0, 1), false) };
}

/** Runway asphalt: coarse aggregate with faint longitudinal tyre wear. */
export function asphaltSurface(size = 256): Surface {
  const height: Field = (u, v) => tileNoise(u, v, 14, 4, 61) * 0.7 + tileNoise(u, v, 40, 2, 71) * 0.3;
  const albedo: Field = (u, v) => 0.85 + (height(u, v) - 0.5) * 0.5 - Math.pow(Math.abs(Math.sin(u * Math.PI * 2)), 6) * 0.18;
  return { map: texture(bakeGray(size, albedo, 0.5, 1.0), true), normal: texture(bakeNormal(size, height, 1.2), false) };
}
