/* Deterministic 2D simplex noise and fractal helpers. Seeded once so every
   visitor flies through the same dream. */

const perm = new Uint8Array(512), permMod8 = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1337;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod8[i] = perm[i] % 8; }
}
const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;

/** Simplex noise in roughly -1..1. */
export function snoise(x: number, y: number): number {
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { const g = permMod8[ii + perm[jj]]; t0 *= t0; n += t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { const g = permMod8[ii + i1 + perm[jj + j1]]; t1 *= t1; n += t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { const g = permMod8[ii + 1 + perm[jj + 1]]; t2 *= t2; n += t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
  return 70 * n;
}

/** Fractal Brownian motion, roughly -1..1. */
export function fbm(x: number, y: number, oct = 5, lac = 2, gain = 0.5): number {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * snoise(x * f, y * f); norm += a; a *= gain; f *= lac; }
  return sum / norm;
}

/** Ridged multifractal, 0..1 — sharp crests, the shape real mountain ranges have. */
export function ridged(x: number, y: number, oct = 5): number {
  let a = 1, f = 1, sum = 0, norm = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(snoise(x * f, y * f));
    v = v * v * w;
    w = Math.min(1, Math.max(0, v * 2));
    sum += v * a; norm += a; a *= 0.5; f *= 2.1;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const rnd = (i: number) => Math.abs((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1);
