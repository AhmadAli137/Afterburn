import * as THREE from "three";
import { fbm, ridged, snoise, smoothstep, rnd } from "./noise";
import { Surface } from "./textures";

/* Ground is a real heightfield: ridged-multifractal ranges either side of a
   flight corridor, smooth-shaded, coloured in the shader by height and slope
   from palette uniforms. The course is a loop of eight SECTORS, each with its
   own character (terraces, canyon walls, a sea, a spire forest, a mountain
   pass, a monolith field...), blended at the seams, plus four one-off
   landmarks. Two segments leapfrog; each refill samples noise at its course
   coordinate so the seam is continuous. */

export const SEG = 160;
const W = 280, NX = 120, NZ = 104;
const H_MAX = 44;
export const WATER_Y = -2.6;
export const SECTOR = 1000, LOOP = 8;

export interface Region { name: string; inner: number; outer: number; amp: number; terrace: number; canyon: number; lake: number; spike: number; lift: number; islands: number; monoliths: number; forest: number; crystal: number }
export const REGIONS: Region[] = [
  { name: "the valley",     inner: 9,  outer: 36, amp: 1.0, terrace: 0, canyon: 0, lake: 0, spike: 0, lift: 0, islands: 1.0, monoliths: 0, forest: 1.0, crystal: 0.15 },
  { name: "the shelf",      inner: 12, outer: 42, amp: 0.8, terrace: 1, canyon: 0, lake: 0, spike: 0, lift: 0, islands: 0.6, monoliths: 0, forest: 0.5, crystal: 0.1 },
  { name: "the canyon",     inner: 7,  outer: 14, amp: 1.3, terrace: 0, canyon: 1, lake: 0, spike: 0, lift: 0, islands: 0.3, monoliths: 0, forest: 0.3, crystal: 0.2 },
  { name: "the mirror sea", inner: 22, outer: 80, amp: 0.6, terrace: 0, canyon: 0, lake: 1, spike: 0, lift: 0, islands: 1.3, monoliths: 0, forest: 0.4, crystal: 0.05 },
  { name: "spire forest",   inner: 10, outer: 30, amp: 0.5, terrace: 0, canyon: 0, lake: 0, spike: 1, lift: 0, islands: 0.5, monoliths: 0, forest: 0.2, crystal: 1.0 },
  { name: "the ridge",      inner: 9,  outer: 30, amp: 1.2, terrace: 0, canyon: 0, lake: 0, spike: 0, lift: 1, islands: 0.8, monoliths: 0, forest: 1.0, crystal: 0.1 },
  { name: "the graveyard",  inner: 14, outer: 46, amp: 0.4, terrace: 0, canyon: 0, lake: 0, spike: 0, lift: 0, islands: 0.2, monoliths: 1, forest: 0.0, crystal: 0.3 },
  { name: "the reach",      inner: 12, outer: 52, amp: 1.7, terrace: 0, canyon: 0, lake: 0, spike: 0, lift: 0, islands: 1.7, monoliths: 0, forest: 1.2, crystal: 0.15 },
];
const NUM_KEYS = ["inner", "outer", "amp", "terrace", "canyon", "lake", "spike", "lift", "islands", "monoliths", "forest", "crystal"] as const;
const _r: Region = { ...REGIONS[0] };

/** Region parameters at course coordinate c, blended across the last 15% of each sector. */
export function regionAt(c: number): Region {
  const cc = ((c % (SECTOR * LOOP)) + SECTOR * LOOP) % (SECTOR * LOOP);
  const idx = Math.floor(cc / SECTOR), t = (cc - idx * SECTOR) / SECTOR;
  const a = REGIONS[idx], b = REGIONS[(idx + 1) % LOOP];
  const f = smoothstep(0.85, 1, t);
  for (const k of NUM_KEYS) _r[k] = a[k] + (b[k] - a[k]) * f;
  _r.name = f > 0.5 ? b.name : a.name;
  return _r;
}
export function sectorIndex(c: number): number { return Math.floor((((c % (SECTOR * LOOP)) + SECTOR * LOOP) % (SECTOR * LOOP)) / SECTOR); }

export function groundHeight(x: number, c: number): number {
  const p = regionAt(c);
  const ax = Math.abs(x);
  const corridor = smoothstep(p.inner, p.outer, ax);
  const roll = fbm(x * 0.03 + 7.3, c * 0.03, 3) * 1.1;
  const massif = 0.5 + 0.5 * fbm(x * 0.004 + 1.7, c * 0.004, 2);
  const ridge = ridged(x * 0.011 + 3.1, c * 0.011, 5);
  let mountain = Math.pow(ridge, 1.7) * H_MAX * massif * corridor * p.amp;
  if (p.canyon > 0) mountain += p.canyon * smoothstep(p.inner, p.inner + 9, ax) * (24 + 10 * fbm(c * 0.02, x * 0.02, 2));
  if (p.terrace > 0) { const step = 6, q = mountain / step, fl = Math.floor(q); mountain += p.terrace * ((fl + smoothstep(0.75, 1, q - fl)) * step - mountain); }
  if (p.spike > 0) mountain += p.spike * Math.pow(Math.max(0, snoise(x * 0.09 + 5, c * 0.09)), 6) * 28 * smoothstep(p.inner, p.inner + 6, ax);
  const sectorT = ((c % SECTOR) + SECTOR) % SECTOR / SECTOR;
  const lift = p.lift * 30 * Math.sin(Math.PI * sectorT);
  let h = -2 + roll * (0.12 + 0.88 * corridor) + mountain + lift;
  if (p.lake > 0) h += p.lake * (1 - smoothstep(p.outer - 10, p.outer + 30, ax)) * ((-4.8 + roll * 0.3 + mountain * 0.35) - h);
  return h;
}

export interface TerrainUniforms {
  uLow: THREE.IUniform<THREE.Color>; uMid: THREE.IUniform<THREE.Color>;
  uHigh: THREE.IUniform<THREE.Color>; uSnow: THREE.IUniform<THREE.Color>;
}

export function makeTerrainMaterial(u: TerrainUniforms, surface: Surface): THREE.MeshStandardMaterial {
  // the rock detail rides on a course-space uv (see fillGrid), so it stays glued to the ground as it scrolls
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, map: surface.map, normalMap: surface.normal, normalScale: new THREE.Vector2(1.1, 1.1) });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aMix; varying vec2 vMix;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMix = aMix;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMix; uniform vec3 uLow; uniform vec3 uMid; uniform vec3 uHigh; uniform vec3 uSnow;")
      // two scales of the same map, so the repeat never reads as a repeat
      .replace("#include <map_fragment>", `
        vec4 t1 = texture2D(map, vMapUv);
        vec4 t2 = texture2D(map, vMapUv * 0.19 + vec2(0.31, 0.57));
        diffuseColor *= t1 * (0.55 + t2 * 0.75);`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          float h = vMix.x, slope = vMix.y;
          vec3 c = mix(uLow, uMid, smoothstep(0.03, 0.3, h));
          c = mix(c, uHigh, smoothstep(0.3, 0.65, h));
          float snow = smoothstep(0.5, 0.78, h) * (1.0 - smoothstep(0.35, 0.75, slope));
          c = mix(c, uSnow, snow);
          c *= 0.75 + 0.45 * (1.0 - slope);
          diffuseColor.rgb *= c * 1.35; // the detail maps average below white; this puts the palette back where it was
        }`);
  };
  return m;
}

function buildGrid(w: number, d: number, nx: number, nz: number): THREE.BufferGeometry {
  const n = (nx + 1) * (nz + 1);
  const pos = new Float32Array(n * 3), mix = new Float32Array(n * 2), uv = new Float32Array(n * 2);
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    const k = iz * (nx + 1) + ix;
    pos[k * 3] = -w / 2 + (ix * w) / nx;
    pos[k * 3 + 2] = -(iz * d) / nz;
  }
  const idx: number[] = [];
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d2 = c + 1;
    idx.push(a, b, c, b, d2, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aMix", new THREE.BufferAttribute(mix, 2));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

const TEX_TILE = 8; // world units per texture repeat
function fillGrid(geo: THREE.BufferGeometry, height: (x: number, z: number) => number, hMax: number, course = 0) {
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setY(i, height(p.getX(i), p.getZ(i)));
    uv.setXY(i, p.getX(i) / TEX_TILE, (course - p.getZ(i)) / TEX_TILE);
  }
  uv.needsUpdate = true;
  finishGrid(geo, hMax);
}
function finishGrid(geo: THREE.BufferGeometry, hMax: number) {
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  p.needsUpdate = true;
  geo.computeVertexNormals();
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute;
  const mix = geo.getAttribute("aMix") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    mix.setXY(i, Math.min(1, Math.max(0, (p.getY(i) + 2) / hMax)), Math.min(1, Math.max(0, 1 - nrm.getY(i)) * 2.2));
  }
  mix.needsUpdate = true;
  geo.computeBoundingSphere();
}

// ---------- floating islands: noise-carved rock with a meadow cap ----------
export interface IslandMats { rock: THREE.Material; grass: THREE.Material; crystal: THREE.Material; tree: THREE.Material }
function buildIsland(seed: number, mats: IslandMats): THREE.Group {
  const g = new THREE.Group();
  const r = 3 + rnd(seed) * 3.5;
  const depth = r * 1.5 + rnd(seed + 1) * 4;
  const under = new THREE.ConeGeometry(r, depth, 16, 6, true).toNonIndexed();
  under.rotateX(Math.PI);
  {
    const p = under.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = fbm(x * 0.35 + seed, z * 0.35 + y * 0.25, 3);
      const k = 1 + n * 0.45;
      p.setXYZ(i, x * k, y + n * 0.6, z * k);
    }
    p.needsUpdate = true;
    under.computeVertexNormals();
  }
  g.add(new THREE.Mesh(under, mats.rock));

  const cap = new THREE.SphereGeometry(r * 1.03, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  cap.scale(1, 0.22, 1);
  {
    const p = cap.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, p.getY(i) + fbm(x * 0.4 + seed * 3, z * 0.4, 3) * 0.45);
    }
    p.needsUpdate = true;
    cap.computeVertexNormals();
  }
  g.add(new THREE.Mesh(cap, mats.grass));

  const trees = 3 + Math.floor(rnd(seed + 5) * 6);
  for (let i = 0; i < trees; i++) {
    const a = rnd(seed + i * 7) * Math.PI * 2, d = rnd(seed + i * 11) * r * 0.7;
    const h = 0.9 + rnd(seed + i * 13) * 1.4;
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.28 + h * 0.12, h, 6), mats.tree);
    t.position.set(Math.cos(a) * d, 0.3 + h / 2, Math.sin(a) * d);
    g.add(t);
  }
  const shards = 1 + Math.floor(rnd(seed + 9) * 3);
  for (let i = 0; i < shards; i++) {
    const a = rnd(seed + i * 17 + 3) * Math.PI * 2, d = rnd(seed + i * 19) * r * 0.5;
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.25 + rnd(seed + i) * 0.2, 1.4 + rnd(seed + i * 23) * 1.6, 5), mats.crystal);
    s.position.set(Math.cos(a) * d, 0.9, Math.sin(a) * d);
    s.rotation.set((rnd(seed + i * 29) - 0.5) * 0.5, 0, (rnd(seed + i * 31) - 0.5) * 0.5);
    g.add(s);
  }
  return g;
}

/** A tileable ripple normal map drawn from noise, so the sea catches the moon. */
function makeRippleNormal(size = 128): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const h = (x: number, y: number) => { // periodic via angle mapping
    const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
    return fbm(Math.cos(a) * 2 + 10, Math.sin(a) * 2 + Math.cos(b) * 2, 3) * 0.5 + fbm(Math.sin(b) * 3 + 20, Math.cos(a) * 3, 2) * 0.5;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * 3, dy = (h(x, y + 1) - h(x, y - 1)) * 3;
    const i = (y * size + x) * 4;
    img.data[i] = 128 + dx * 127; img.data[i + 1] = 128 + dy * 127; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

interface Segment { group: THREE.Group; geo: THREE.BufferGeometry; course: number; islands: THREE.Group[]; monoliths: THREE.InstancedMesh; trees: THREE.InstancedMesh }
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const MONOLITHS = 36, TREES = 420;
/** Slope at (x, c) from finite differences, 0 flat .. 1 steep. */
function slopeAt(x: number, c: number): number {
  const d = 1.5;
  const dx = (groundHeight(x + d, c) - groundHeight(x - d, c)) / (2 * d), dz = (groundHeight(x, c + d) - groundHeight(x, c - d)) / (2 * d);
  return Math.min(1, Math.hypot(dx, dz));
}

export class Terrain {
  readonly segs: Segment[] = [];
  /* Facing. The jet always looks down -z in the scene; a reversal turns the
     world round instead. The terrain lives under a root that is rotated by a
     half turn when facing is -1, so the ground that was behind is now ahead,
     mirrored left to right the way a real turn-around leaves it. Three
     segments (one behind the jet, two ahead) leapfrog in either direction. */
  readonly root = new THREE.Group();
  facing = 1;
  readonly backdrop: THREE.Mesh;
  readonly water: THREE.Mesh;
  readonly waterMat: THREE.MeshStandardMaterial;
  private job: { seg: Segment; next: number; phase: "grid" | "trees" } | null = null;

  constructor(scene: THREE.Scene, mat: THREE.Material, islandMats: IslandMats, monolithMat: THREE.Material) {
    scene.add(this.root);
    for (let s = -1; s < 2; s++) {
      const geo = buildGrid(W, SEG, NX, NZ);
      const mesh = new THREE.Mesh(geo, mat);
      const group = new THREE.Group();
      group.add(mesh);
      const islands: THREE.Group[] = [];
      for (let i = 0; i < 7; i++) { const isl = buildIsland(s * 100 + i * 13 + 1, islandMats); islands.push(isl); group.add(isl); }
      const monoliths = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), monolithMat, MONOLITHS);
      monoliths.frustumCulled = false;
      group.add(monoliths);
      const treeGeo = new THREE.ConeGeometry(1, 1, 5);
      treeGeo.translate(0, 0.5, 0);
      const trees = new THREE.InstancedMesh(treeGeo, islandMats.tree, TREES);
      trees.frustumCulled = false;
      group.add(trees);
      const seg: Segment = { group, geo, course: s * SEG, islands, monoliths, trees };
      this.fill(seg);
      group.position.z = -s * SEG;
      this.root.add(group);
      this.segs.push(seg);
    }
    // far ranges: static, mostly haze, gives the horizon somewhere to be
    const back = buildGrid(1100, 320, 120, 30);
    fillGrid(back, (x, z) => {
      const ax = Math.abs(x);
      const r = ridged(x * 0.0042 + 9.1, z * 0.0042 + 4, 4);
      return -2 + Math.pow(r, 1.5) * 130 * smoothstep(14, 120, ax) * (0.5 + 0.5 * fbm(x * 0.002, z * 0.002, 2) + 0.4);
    }, 130);
    this.backdrop = new THREE.Mesh(back, mat);
    this.backdrop.position.z = -180;
    scene.add(this.backdrop);
    // the sea: a glossy rippled plane that only shows where the ground sinks below it
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x0e1c30, metalness: 0.9, roughness: 0.16, emissive: 0x0a1626, emissiveIntensity: 1, transparent: true, opacity: 0.92, normalMap: makeRippleNormal(), normalScale: new THREE.Vector2(0.3, 0.3) });
    this.waterMat.normalMap!.wrapS = this.waterMat.normalMap!.wrapT = THREE.RepeatWrapping;
    this.waterMat.normalMap!.repeat.set(12, 20);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(W, SEG * 2 + 8), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, WATER_Y, -SEG);
    scene.add(this.water);
  }

  private fill(seg: Segment) {
    fillGrid(seg.geo, (x, z) => groundHeight(x, seg.course - z), H_MAX, seg.course);
    this.placeProps(seg);
    this.placeTrees(seg, 0, TREES);
    seg.trees.instanceMatrix.needsUpdate = true;
  }
  /** Spread a re-carve over several frames; the segment is deep in the fog while it happens. */
  tick(budget = 1400) {
    if (!this.job) return;
    const { seg } = this.job;
    if (this.job.phase === "grid") {
      const p = seg.geo.getAttribute("position") as THREE.BufferAttribute;
      const end = Math.min(p.count, this.job.next + budget);
      for (let i = this.job.next; i < end; i++) p.setY(i, groundHeight(p.getX(i), seg.course - p.getZ(i)));
      this.job.next = end;
      if (end >= p.count) { finishGrid(seg.geo, H_MAX); this.placeProps(seg); this.job = { seg, next: 0, phase: "trees" }; }
    } else {
      const end = Math.min(TREES, this.job.next + 40);
      this.placeTrees(seg, this.job.next, end);
      this.job.next = end;
      seg.trees.instanceMatrix.needsUpdate = true;
      if (end >= TREES) this.job = null;
    }
  }
  /** Forests: trees on the gentler slopes below the snow line, never in the flight lane. */
  private placeTrees(seg: Segment, from: number, to: number) {
    for (let i = from; i < to; i++) {
      const s = seg.course * 0.71 + i * 13;
      const c = seg.course + rnd(s + 2) * SEG;
      const p = regionAt(c);
      const side = rnd(s) > 0.5 ? 1 : -1;
      const x = side * (p.inner + 2 + rnd(s + 1) * 70), z = -(c - seg.course);
      if (i >= TREES * p.forest) { _m.makeScale(0, 0, 0); seg.trees.setMatrixAt(i, _m); continue; }
      const gy = groundHeight(x, c);
      const ok = gy > WATER_Y + 0.5 && gy < 22 && fbm(x * 0.02 + 9, c * 0.02, 2) > -0.15 && slopeAt(x, c) < 0.75;
      if (!ok) { _m.makeScale(0, 0, 0); seg.trees.setMatrixAt(i, _m); continue; }
      const h = 1.6 + rnd(s + 3) * 2.6;
      _q.setFromEuler(_e.set(0, rnd(s + 4) * Math.PI, 0));
      _m.compose(_p.set(x, gy - 0.2, z), _q, _s.set(h * 0.38, h, h * 0.38));
      seg.trees.setMatrixAt(i, _m);
    }
  }
  private placeProps(seg: Segment) {
    const mid = regionAt(seg.course + SEG / 2);
    const islandN = Math.round(mid.islands * 4);
    seg.islands.forEach((isl, i) => {
      const s = seg.course * 0.37 + i * 41;
      const x = (rnd(s) - 0.5) * 90, z = -rnd(s + 2) * SEG;
      const floor = Math.max(groundHeight(x, seg.course - z), WATER_Y);
      isl.visible = i < islandN;
      isl.position.set(x, Math.max(floor + 9, 26 + rnd(s + 4) * 40), z); // high: some ride up into the cloud deck
      isl.rotation.y = rnd(s + 6) * Math.PI * 2;
    });
    for (let i = 0; i < MONOLITHS; i++) {
      const s = seg.course * 0.53 + i * 17;
      const p = regionAt(seg.course + rnd(s + 2) * SEG);
      if (p.monoliths < 0.5 || i >= Math.round(MONOLITHS * p.monoliths)) { _m.makeScale(0, 0, 0); seg.monoliths.setMatrixAt(i, _m); continue; }
      const side = rnd(s) > 0.5 ? 1 : -1, x = side * (p.inner + 2 + rnd(s + 1) * 50), z = -rnd(s + 2) * SEG;
      const h = 8 + rnd(s + 3) * 26, w = 1.5 + rnd(s + 4) * 2.5;
      const gy = groundHeight(x, seg.course - z);
      _q.setFromEuler(_e.set((rnd(s + 5) - 0.5) * 0.25, rnd(s + 6) * Math.PI, (rnd(s + 7) - 0.5) * 0.25));
      _m.compose(new THREE.Vector3(x, gy + h * 0.45, z), _q, _s.set(w, h, w * 0.6));
      seg.monoliths.setMatrixAt(i, _m);
    }
    seg.monoliths.instanceMatrix.needsUpdate = true;
  }

  /** Turn the world round: the root takes a half turn, and scrolling runs the other way through it. */
  setFacing(f: number) { this.facing = f; this.root.rotation.y = f < 0 ? Math.PI : 0; }
  /** Scroll the ground by dz (scene units toward the camera); a segment that passes far enough behind leapfrogs ahead and is re-carved. */
  scroll(dz: number) {
    const d = dz * this.facing; // in the root's own frame
    for (const seg of this.segs) {
      seg.group.position.z += d;
      if (this.facing > 0 && seg.group.position.z >= SEG * 2) { seg.group.position.z -= SEG * 3; seg.course += SEG * 3; this.recarve(seg); }
      else if (this.facing < 0 && seg.group.position.z <= -SEG * 2) { seg.group.position.z += SEG * 3; seg.course -= SEG * 3; this.recarve(seg); }
    }
  }
  private recarve(seg: Segment) { while (this.job) this.tick(1e9); this.job = { seg, next: 0, phase: "grid" }; }

  reset(course0 = 0) {
    this.setFacing(1);
    // already sitting at that course with nothing pending (the first run after load): nothing to re-carve
    if (!this.job && this.segs.every((seg, i) => seg.course === course0 + (i - 1) * SEG && seg.group.position.z === -(i - 1) * SEG)) return;
    this.job = null;
    this.segs.forEach((seg, i) => { seg.course = course0 + (i - 1) * SEG; seg.group.position.z = -(i - 1) * SEG; this.fill(seg); });
  }

  /** Course coordinate at scene z (0 = jet). */
  courseAt(z: number): number {
    const zl = z * this.facing;
    for (const seg of this.segs) {
      const local = zl - seg.group.position.z;
      if (local <= 0 && local >= -SEG) return seg.course - local;
    }
    return this.segs[1].course + this.segs[1].group.position.z - zl;
  }
  /** Collision floor in world space under a point at scene z: terrain, or the sea where it's higher. */
  heightAt(x: number, z: number): number { return Math.max(groundHeight(x * this.facing, this.courseAt(z)), WATER_Y); }
  /** Bare terrain, without the water surface. */
  terrainAt(x: number, z: number): number { return groundHeight(x * this.facing, this.courseAt(z)); }
}

// ---------- landmarks: built once, placed at fixed course positions, loop with the course ----------
export interface Landmark { course: number; x: number; group: THREE.Group; name: string; bonusY?: number }
export function buildLandmarks(scene: THREE.Scene, glow: THREE.Material, dark: THREE.Material, rock: THREE.Material): Landmark[] {
  const out: Landmark[] = [];
  // the Arch — fly under it
  {
    const g = new THREE.Group();
    const arch = new THREE.Mesh(new THREE.TorusGeometry(13, 1.6, 12, 48, Math.PI), rock);
    arch.position.y = 0; g.add(arch);
    for (const s of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 12, 10), rock);
      pillar.position.set(s * 13, -6, 0); g.add(pillar);
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), glow);
      lamp.position.set(Math.cos(a) * 13, Math.sin(a) * 13 + 0.2, 1.7); g.add(lamp);
    }
    g.position.y = 10;
    scene.add(g); out.push({ course: 1500, x: 0, group: g, name: "THE ARCH", bonusY: 22 });
  }
  // the Monolith — a crystal the size of a hill
  {
    const g = new THREE.Group();
    const big = new THREE.Mesh(new THREE.OctahedronGeometry(1, 1), glow);
    big.scale.set(9, 34, 9); big.position.y = 20; big.rotation.y = 0.4; g.add(big);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), glow);
      s.scale.set(2 + rnd(i) * 2, 6 + rnd(i * 3) * 8, 2); s.position.set(Math.cos(i) * 12, 3, Math.sin(i) * 12); s.rotation.set(rnd(i * 5) - 0.5, 0, rnd(i * 7) - 0.5); g.add(s);
    }
    scene.add(g); out.push({ course: 3500, x: 28, group: g, name: "THE MONOLITH" });
  }
  // the Wreck — a derelict skyship on its side
  {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(4, 26, 6, 10), dark);
    hull.rotation.z = Math.PI / 2; hull.rotation.y = 0.5; hull.position.y = 3; g.add(hull);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(5, 9, 6), dark); tower.position.set(4, 8, 0); tower.rotation.z = 0.35; g.add(tower);
    for (let i = 0; i < 3; i++) { const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 16, 6), dark); mast.position.set(-8 + i * 7, 8, 0); mast.rotation.z = 0.5 + i * 0.1; g.add(mast); }
    for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff3a2a })); l.position.set(-10 + i * 5, 5 + (i % 2) * 3, 4); g.add(l); }
    g.rotation.y = -0.6;
    scene.add(g); out.push({ course: 5500, x: -30, group: g, name: "THE WRECK" });
  }
  // the Beacon — a tower with a sweeping light
  {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3, 64, 8), dark); tower.position.y = 32; g.add(tower);
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 10), glow); head.position.y = 65; g.add(head);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(14, 90, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    cone.rotation.z = Math.PI / 2; cone.position.set(45, 65, 0); cone.name = "sweep"; g.add(cone);
    const light = new THREE.PointLight(0xfff1c0, 40, 120, 1.5); light.position.y = 65; g.add(light);
    scene.add(g); out.push({ course: 7500, x: 40, group: g, name: "THE BEACON" });
  }
  out.forEach((l) => { l.group.visible = false; });
  return out;
}

// ---------- runway: appears under the jet for liftoff and again for landing ----------
export const RUNWAY_LEN = 260, RUNWAY_W = 9;
export function buildRunway(asphalt: Surface): THREE.Group {
  const g = new THREE.Group();
  const aMap = asphalt.map.clone(), aNrm = asphalt.normal.clone();
  aMap.repeat.set(1.5, 40); aNrm.repeat.set(1.5, 40);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY_W, RUNWAY_LEN), new THREE.MeshStandardMaterial({ color: 0x23232e, roughness: 0.9, metalness: 0.05, map: aMap, normalMap: aNrm, normalScale: new THREE.Vector2(0.5, 0.5) }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.02, -RUNWAY_LEN / 2);
  g.add(strip);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8d8e0 });
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 3.2), dashMat, 34);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 34; i++) {
    m.makeRotationX(-Math.PI / 2);
    m.setPosition(0, 0.03, -6 - i * 7.5);
    dashes.setMatrixAt(i, m);
  }
  g.add(dashes);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd27d });
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 6), lightMat, 60);
  for (let i = 0; i < 30; i++) for (const s of [-1, 1]) {
    m.makeTranslation(s * (RUNWAY_W / 2 + 0.3), 0.12, -i * 8.7);
    lights.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m);
  }
  g.add(lights);
  const thresholdMat = new THREE.MeshBasicMaterial({ color: 0x7dffd9 });
  const thr = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.03, 4), thresholdMat, 8);
  for (let i = 0; i < 8; i++) { m.makeTranslation(-3.5 + i, 0.03, -RUNWAY_LEN + 4); thr.setMatrixAt(i, m); }
  g.add(thr);
  return g;
}
