import * as THREE from "three";
import { buildJet } from "./jet";
import { AudioFX } from "./audio";

/* AFTERBURN — an endless flight through a dream that never quite resolves.
   Vanilla Three.js. The world scrolls +z past a jet held near the origin;
   palettes drift between dusk biomes; whales mind their own business. */

// ---------- boilerplate ----------
const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400);
scene.fog = new THREE.Fog(0x140a24, 30, 190);
scene.background = new THREE.Color(0x0a0616);

const hemi = new THREE.HemisphereLight(0x9a7dff, 0x120826, 1.5);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd9f2, 1.7);
sun.position.set(6, 14, -8);
scene.add(sun);

// ---------- palettes: the dream keeps re-colouring itself ----------
interface Palette { sky: number; fog: number; ground: number; peak: number; peakAlt: number; island: number; glowA: number; glowB: number }
const PALETTES: Palette[] = [
  { sky: 0x0a0616, fog: 0x140a24, ground: 0x120b26, peak: 0x241448, peakAlt: 0x2f1a5e, island: 0x3a2470, glowA: 0x7dffd9, glowB: 0xff7de9 }, // violet dusk
  { sky: 0x051019, fog: 0x082032, ground: 0x06202a, peak: 0x0d3a44, peakAlt: 0x11505a, island: 0x14606b, glowA: 0x7de9ff, glowB: 0xffd97d }, // abyssal teal
  { sky: 0x160608, fog: 0x2a0c14, ground: 0x260a14, peak: 0x481424, peakAlt: 0x5e1a2f, island: 0x702440, glowA: 0xffb47d, glowB: 0xff7d9e }, // ember rose
  { sky: 0x040f09, fog: 0x0a2417, ground: 0x0a2014, peak: 0x14482c, peakAlt: 0x1a5e38, island: 0x247048, glowA: 0xd9ff7d, glowB: 0x7dc8ff }, // mint hollow
];
let palIdx = 0;
const cur = { // live colours, lerped toward the active palette every frame
  sky: new THREE.Color(PALETTES[0].sky), fog: new THREE.Color(PALETTES[0].fog),
  ground: new THREE.Color(PALETTES[0].ground), peak: new THREE.Color(PALETTES[0].peak),
  peakAlt: new THREE.Color(PALETTES[0].peakAlt), island: new THREE.Color(PALETTES[0].island),
  glowA: new THREE.Color(PALETTES[0].glowA), glowB: new THREE.Color(PALETTES[0].glowB),
};

const matGround = new THREE.MeshStandardMaterial({ color: cur.ground, metalness: 0.3, roughness: 0.9 });
const matPeak = new THREE.MeshStandardMaterial({ color: cur.peak, flatShading: true, roughness: 0.9, emissive: cur.peak, emissiveIntensity: 0.35 });
const matPeakAlt = new THREE.MeshStandardMaterial({ color: cur.peakAlt, flatShading: true, roughness: 0.9, emissive: cur.peakAlt, emissiveIntensity: 0.35 });
const matIsland = new THREE.MeshStandardMaterial({ color: cur.island, flatShading: true, roughness: 0.85 });
const matRing = new THREE.MeshStandardMaterial({ color: cur.glowA, emissive: cur.glowA, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.3 });
const matOrb = new THREE.MeshStandardMaterial({ color: cur.glowB, emissive: cur.glowB, emissiveIntensity: 2.2 });
const matSpire = new THREE.MeshStandardMaterial({ color: 0x1a1030, flatShading: true, roughness: 0.4, metalness: 0.6, emissive: cur.glowB, emissiveIntensity: 0.35 });
const matWhale = new THREE.MeshStandardMaterial({ color: 0x27204a, flatShading: true, roughness: 0.8, emissive: 0x14104a, emissiveIntensity: 0.4 });

const rnd = (i: number) => Math.abs((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1);

// ---------- terrain: two leapfrogging segments ----------
const SEG = 160;
function buildSegment(seed: number): THREE.Group {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, SEG + 8), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -2, -SEG / 2);
  g.add(ground);
  for (let i = 0; i < 46; i++) {
    const side = rnd(seed + i * 3) > 0.5 ? 1 : -1;
    const x = side * (5 + rnd(seed + i) * 40);
    const h = 2 + rnd(seed + i * 7 + 2) * 14;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(1.2 + rnd(seed + i * 13) * 4, h, 5), i % 2 ? matPeak : matPeakAlt);
    peak.position.set(x, -2 + h / 2, -rnd(seed + i * 29 + 4) * SEG);
    peak.rotation.y = rnd(seed + i * 31) * Math.PI;
    g.add(peak);
  }
  // floating islands, upside-down mountains with a meadow cap
  for (let i = 0; i < 7; i++) {
    const isl = new THREE.Group();
    const root = new THREE.Mesh(new THREE.ConeGeometry(2 + rnd(seed + i * 17) * 2.4, 4 + rnd(seed + i * 19) * 4, 6), matIsland);
    root.rotation.x = Math.PI;
    isl.add(root);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.1 + rnd(seed + i * 17) * 2.4, 2.3 + rnd(seed + i * 17) * 2.4, 0.5, 6), matPeakAlt);
    cap.position.y = 2.1;
    isl.add(cap);
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 4), matRing);
    shard.position.set(0.9, 3.1, 0);
    isl.add(shard);
    isl.position.set((rnd(seed + i * 41) - 0.5) * 60, 9 + rnd(seed + i * 43) * 9, -rnd(seed + i * 47) * SEG);
    g.add(isl);
  }
  return g;
}
const segA = buildSegment(1); scene.add(segA);
const segB = buildSegment(99); segB.position.z = -SEG; scene.add(segB);

// ---------- sky: stars, moons, auroras, whales ----------
{
  const pos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    pos[i * 3] = (rnd(i) - 0.5) * 380;
    pos[i * 3 + 1] = rnd(i * 3 + 1) * 130 - 6;
    pos[i * 3 + 2] = -rnd(i * 7 + 2) * 360;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcdd8ff, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.8 })));
}
const moonMatA = new THREE.MeshBasicMaterial({ color: cur.glowB });
const moonA = new THREE.Mesh(new THREE.SphereGeometry(11, 24, 24), moonMatA);
moonA.position.set(-60, 46, -240); scene.add(moonA);
const moonMatB = new THREE.MeshBasicMaterial({ color: cur.glowA });
const moonB = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 20), moonMatB);
moonB.position.set(70, 30, -260); scene.add(moonB);

const auroraMat = new THREE.MeshBasicMaterial({ color: cur.glowA, transparent: true, opacity: 0.07, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
const auroras: THREE.Mesh[] = [];
for (let i = 0; i < 3; i++) {
  const a = new THREE.Mesh(new THREE.PlaneGeometry(240, 26, 1, 1), auroraMat);
  a.position.set((i - 1) * 50, 55 + i * 9, -200 - i * 20);
  a.rotation.set(0.4, 0, 0.12 * (i - 1));
  auroras.push(a); scene.add(a);
}

function buildWhale(): THREE.Group {
  const w = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 3.4, 6, 12), matWhale);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 0.78, 1);
  w.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 4), matWhale);
  tail.rotation.x = -Math.PI / 2;
  tail.position.set(0, 0.1, 2.6);
  tail.scale.set(2.6, 1, 0.35);
  w.add(tail);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 3), matWhale);
    fin.position.set(s * 1.15, -0.3, -0.4);
    fin.rotation.z = s * 1.9;
    fin.scale.set(0.35, 1, 1.6);
    w.add(fin);
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
  eye.position.set(0.7, 0.25, -1.6);
  w.add(eye);
  return w;
}
const whales = [0, 1, 2].map((i) => {
  const w = buildWhale();
  w.scale.setScalar(4 + i * 2.5);
  w.position.set((i - 1) * 55, 18 + i * 8, -120 - i * 60);
  w.rotation.y = 0.15 * (i - 1);
  scene.add(w);
  return w;
});

// ---------- player ----------
const jet = buildJet();
jet.group.position.set(0, 2, 0);
scene.add(jet.group);

// ---------- pools: gates, orbs, spires ----------
const rings = Array.from({ length: 6 }, (_, i) => {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.14, 10, 40), matRing);
  m.position.set((rnd(i * 7) - 0.5) * 14, 1.8 + rnd(i * 11) * 6, -60 - i * 45);
  scene.add(m);
  return { m, passed: false };
});
const orbs = Array.from({ length: 10 }, (_, i) => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), matOrb);
  m.position.set((rnd(i * 13 + 5) - 0.5) * 16, 1 + rnd(i * 17 + 2) * 7, -30 - i * 26);
  scene.add(m);
  return m;
});
const spires = Array.from({ length: 12 }, (_, i) => {
  const fromSky = i % 3 === 2;
  const h = 7 + rnd(i * 23) * 11;
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.9, h, 5), matSpire);
  if (fromSky) { m.rotation.x = Math.PI; m.position.y = 12 - h / 2; }
  else m.position.y = -2 + h / 2;
  m.position.x = (rnd(i * 31 + 4) - 0.5) * 18;
  m.position.z = -80 - i * 34;
  scene.add(m);
  return { m, h, fromSky };
});

// ---------- speed lines + trail ----------
const lineCount = 260;
const linePos = new Float32Array(lineCount * 3);
for (let i = 0; i < lineCount; i++) {
  linePos[i * 3] = (Math.random() - 0.5) * 26;
  linePos[i * 3 + 1] = Math.random() * 12 - 1;
  linePos[i * 3 + 2] = -Math.random() * 90;
}
const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
const lineMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
scene.add(new THREE.Points(lineGeo, lineMat));

// ---------- state ----------
type Mode = "title" | "play" | "dead";
let mode: Mode = "title";
let speed = 26, dist = 0, score = 0, streak = 0, shield = 3, boost = 0.6, boosting = false;
let iframes = 0, shake = 0, rollT = -1, elapsed = 0, palTimer = 0;
let best = 0;
try { best = Number(localStorage.getItem("afterburn-best")) || 0; } catch {}

const mouse = { x: 0, y: 0 };
const keys = new Set<string>();
const fx = new AudioFX();

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, on: boolean) => $(id).classList.toggle("hidden", !on);
let toastT = 0;
function toast(t: string) { $("toast").textContent = t; $("toast").style.opacity = "1"; toastT = 1.1; }

function resetRun() {
  speed = 26; dist = 0; score = 0; streak = 0; shield = 3; boost = 0.6; iframes = 0; rollT = -1;
  jet.group.position.set(0, 2, 0);
  rings.forEach((r, i) => { r.m.position.z = -60 - i * 45; r.passed = false; });
  orbs.forEach((o, i) => { o.position.z = -30 - i * 26; o.visible = true; });
  spires.forEach((s, i) => { s.m.position.z = -80 - i * 34; });
}
function startRun() {
  fx.start(); fx.whoosh();
  resetRun();
  mode = "play";
  show("title", false); show("dead", false);
}
function die() {
  mode = "dead"; fx.crash(); shake = 1.4;
  best = Math.max(best, Math.floor(score));
  try { localStorage.setItem("afterburn-best", String(best)); } catch {}
  $("finalScore").textContent = `SCORE ${Math.floor(score).toLocaleString()}`;
  $("finalBest").textContent = `BEST ${best.toLocaleString()}`;
  show("dead", true);
}

addEventListener("mousemove", (e) => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = (e.clientY / innerHeight) * 2 - 1;
});
addEventListener("mousedown", () => { if (mode !== "play") startRun(); });
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (mode !== "play" && (e.code === "Space" || e.code === "Enter")) startRun();
  if (mode === "play" && (e.code === "KeyQ" || e.code === "KeyE") && rollT < 0) { rollT = 0; iframes = Math.max(iframes, 0.6); fx.whoosh(); }
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
$("mute").addEventListener("click", (e) => {
  e.stopPropagation();
  const muted = fx.toggle();
  $("mute").textContent = muted ? "🔇 muted" : "🔊 sound";
});
$("best").textContent = best > 0 ? `BEST ${best.toLocaleString()}` : "";
if (new URLSearchParams(location.search).has("fly")) startRun();

// ---------- the loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  // palette drift
  palTimer += dt;
  if (palTimer > 26) { palTimer = 0; palIdx = (palIdx + 1) % PALETTES.length; }
  const P = PALETTES[palIdx];
  const L = 1 - Math.pow(0.25, dt); // frame-rate independent lerp
  cur.sky.lerp(new THREE.Color(P.sky), L); cur.fog.lerp(new THREE.Color(P.fog), L);
  cur.ground.lerp(new THREE.Color(P.ground), L); cur.peak.lerp(new THREE.Color(P.peak), L);
  cur.peakAlt.lerp(new THREE.Color(P.peakAlt), L); cur.island.lerp(new THREE.Color(P.island), L);
  cur.glowA.lerp(new THREE.Color(P.glowA), L); cur.glowB.lerp(new THREE.Color(P.glowB), L);
  (scene.background as THREE.Color).copy(cur.sky);
  (scene.fog as THREE.Fog).color.copy(cur.fog);
  matGround.color.copy(cur.ground); matPeak.color.copy(cur.peak); matPeak.emissive.copy(cur.peak); matPeakAlt.color.copy(cur.peakAlt); matPeakAlt.emissive.copy(cur.peakAlt);
  matIsland.color.copy(cur.island);
  matRing.color.copy(cur.glowA); matRing.emissive.copy(cur.glowA);
  matOrb.color.copy(cur.glowB); matOrb.emissive.copy(cur.glowB);
  matSpire.emissive.copy(cur.glowB);
  moonMatA.color.copy(cur.glowB); moonMatB.color.copy(cur.glowA);
  auroraMat.color.copy(cur.glowA);

  // ambient life
  const blink = (Math.sin(elapsed * 6) + 1) / 2;
  jet.navL.emissiveIntensity = 0.6 + blink * 3;
  jet.navR.emissiveIntensity = 0.6 + (1 - blink) * 3;
  auroras.forEach((a, i) => { a.rotation.z += dt * 0.008 * (i - 1 || 1); (a.material as THREE.MeshBasicMaterial).opacity = 0.05 + Math.sin(elapsed * 0.4 + i) * 0.025; });
  whales.forEach((w, i) => {
    w.position.z += dt * (mode === "play" ? speed * 0.24 : 2);
    w.position.y += Math.sin(elapsed * 0.5 + i * 2) * dt * 1.6;
    w.rotation.x = Math.sin(elapsed * 0.5 + i * 2) * 0.08;
    if (w.position.z > 40) { w.position.z = -260 - rnd(i + elapsed) * 80; w.position.x = (rnd(elapsed * 7 + i) - 0.5) * 130; }
  });

  if (mode === "play") {
    // speed, boost, distance
    boosting = keys.has("Space") && boost > 0.02;
    if (boosting) boost = Math.max(0, boost - dt * 0.38);
    else boost = Math.min(1, boost + dt * 0.05);
    const ramp = Math.min(22, dist / 700);
    const target = 26 + ramp + (boosting ? 34 : 0);
    speed += (target - speed) * (1 - Math.pow(0.1, dt));
    dist += speed * dt;
    score += speed * dt * 0.8;
    fx.setSpeed(speed);

    // steer
    const g = jet.group;
    const tx = THREE.MathUtils.clamp(mouse.x * 9 + (keys.has("KeyA") || keys.has("ArrowLeft") ? -3 : 0) + (keys.has("KeyD") || keys.has("ArrowRight") ? 3 : 0), -9, 9);
    const ty = THREE.MathUtils.clamp(2.6 - mouse.y * 3.6 + (keys.has("KeyW") || keys.has("ArrowUp") ? 1.5 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1.5 : 0), 0.3, 9.5);
    const bank = (tx - g.position.x);
    g.position.x = THREE.MathUtils.lerp(g.position.x, tx, 1 - Math.pow(0.03, dt));
    g.position.y = THREE.MathUtils.lerp(g.position.y, ty, 1 - Math.pow(0.03, dt));
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, THREE.MathUtils.clamp(-bank * 0.22, -0.9, 0.9), 1 - Math.pow(0.02, dt));
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, (ty - g.position.y) * 0.25, 1 - Math.pow(0.02, dt));
    if (rollT >= 0) {
      rollT += dt * 2.2;
      g.rotation.z += Math.sin(Math.min(rollT, 1) * Math.PI) * Math.PI * 1.05;
      if (rollT >= 1) rollT = -1;
    }
    const flameLen = boosting ? 2.6 : 1;
    jet.burnL.emissiveIntensity = jet.burnR.emissiveIntensity = 2 + (boosting ? 4 : 0) + blink;
    g.scale.z = 1; // keep model stable; flame conveys boost
    void flameLen;

    // world scroll
    for (const seg of [segA, segB]) {
      seg.position.z += dt * speed;
      if (seg.position.z > SEG) seg.position.z -= SEG * 2;
    }

    // gates
    rings.forEach((r, i) => {
      r.m.position.z += dt * speed;
      r.m.rotation.z += dt * 0.8;
      if (!r.passed && r.m.position.z > -0.2) {
        r.passed = true;
        const dx = r.m.position.x - g.position.x, dy = r.m.position.y - g.position.y;
        if (Math.hypot(dx, dy) < 1.55) {
          streak++;
          const gain = 100 * streak;
          score += gain;
          boost = Math.min(1, boost + 0.3);
          fx.chime(700 + streak * 90);
          toast(`GATE +${gain}${streak > 1 ? `  ×${streak}` : ""}`);
        } else if (streak > 0) { streak = 0; toast("streak lost"); }
      }
      if (r.m.position.z > 6) {
        const s = i * 7 + Math.floor(dist);
        r.m.position.set((rnd(s) - 0.5) * 15, 1.6 + rnd(s + 3) * 6.5, -230 - rnd(s + 5) * 40);
        r.passed = false;
      }
    });

    // orbs
    orbs.forEach((o, i) => {
      o.position.z += dt * speed;
      o.rotation.x += dt * 2; o.rotation.y += dt * 3;
      if (o.visible && Math.abs(o.position.z) < 1 &&
          Math.hypot(o.position.x - g.position.x, o.position.y - g.position.y) < 1.05) {
        o.visible = false; score += 25; fx.chime(1400);
      }
      if (o.position.z > 6) {
        const s = i * 13 + Math.floor(dist);
        o.position.set((rnd(s) - 0.5) * 17, 0.8 + rnd(s + 2) * 7.5, -200 - rnd(s + 4) * 60);
        o.visible = true;
      }
    });

    // spires (the crystal bites back)
    const active = Math.min(spires.length, 4 + Math.floor(dist / 450));
    spires.forEach((sp, i) => {
      sp.m.position.z += dt * speed;
      sp.m.visible = i < active;
      if (sp.m.visible && iframes <= 0 && Math.abs(sp.m.position.z) < 1.1 && Math.abs(sp.m.position.x - g.position.x) < 1.15) {
        const spikeLow = sp.fromSky ? 12 - sp.h : -2, spikeHigh = sp.fromSky ? 12 : -2 + sp.h;
        if (g.position.y > spikeLow - 0.35 && g.position.y < spikeHigh + 0.35) {
          shield--; iframes = 1.6; shake = 1; fx.crash();
          $("vignette").style.opacity = "1";
          setTimeout(() => { $("vignette").style.opacity = "0"; }, 240);
          if (shield <= 0) { die(); return; }
          toast("SHIELD HIT");
        }
      }
      if (sp.m.position.z > 8) {
        const s = i * 31 + Math.floor(dist);
        sp.m.position.x = (rnd(s) - 0.5) * 18;
        sp.m.position.z = -240 - rnd(s + 2) * 80;
      }
    });

    if (iframes > 0) iframes -= dt;
    jet.group.visible = iframes <= 0 || Math.floor(elapsed * 14) % 2 === 0;

    // speed lines rush past
    const lp = lineGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < lineCount; i++) {
      let z = lp.getZ(i) + dt * speed * (boosting ? 2.4 : 1.35);
      if (z > 8) z = -90;
      lp.setZ(i, z);
    }
    lp.needsUpdate = true;
    lineMat.opacity = boosting ? 0.5 : 0.12 + speed / 300;

    // HUD
    $("score").textContent = Math.floor(score).toLocaleString();
    $("speed").textContent = `${Math.round(speed * 14)} km/h`;
    $("streak").textContent = streak > 1 ? `gate streak ×${streak}` : "";
    $("shield").textContent = "🛡".repeat(Math.max(0, shield));
    $("boostfill").style.width = `${Math.round(boost * 100)}%`;
  }

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("toast").style.opacity = "0"; }

  // camera: chase with lag, widen with speed, shake on impact
  const g = jet.group;
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, g.position.x * 0.42, 1 - Math.pow(0.05, dt));
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, 1.6 + g.position.y * 0.3, 1 - Math.pow(0.05, dt));
  camera.position.z = 6.5;
  if (shake > 0) {
    shake -= dt * 2.4;
    camera.position.x += (Math.random() - 0.5) * shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * shake * 0.5;
  }
  camera.lookAt(g.position.x * 0.75, g.position.y * 0.8 + 0.4, -14);
  const fovTarget = mode === "play" ? 55 + (boosting ? 17 : 0) + speed * 0.08 : 58;
  camera.fov += (fovTarget - camera.fov) * (1 - Math.pow(0.02, dt));
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
});
