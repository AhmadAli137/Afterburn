import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildJet, PLAYER_JET, emitExhaust } from "./jet";
import { AudioFX } from "./audio";
import { Terrain, makeTerrainMaterial, buildRunway, buildLandmarks, groundHeight, regionAt, sectorIndex, RUNWAY_LEN, RUNWAY_W, SECTOR, LOOP, WATER_Y, SEG } from "./terrain";
import { Sky } from "./sky";
import { CloudDeck, DECK_Y, DECK_HALF } from "./clouds";
import { Particles, softSprite, cloudSprite, explode, burn, Debris, Shockwaves, damageTrail, sparkHit } from "./fx";
import { makeAtmoPass, flareTexture } from "./post";
import { Lensflare, LensflareElement } from "three/addons/objects/Lensflare.js";
import { Combat, FINAL_WAVE } from "./combat";
import { rnd } from "./noise";
import { rockSurface, asphaltSurface } from "./textures";
import { Reflector } from "three/addons/objects/Reflector.js";
import type { Jet } from "./jet";
import { Hud, Rwr, RwrContact } from "./hud";
import { buildCockpit } from "./cockpit";
import { Music } from "./music";
import { Radio } from "./radio";

/* AFTERBURN — an endless flight through a dream that never quite resolves.
   The world scrolls +z past a jet that is free to roam a wide envelope;
   the camera chases it. FLIGHT is the endless run; SORTIE adds hostile jets,
   a cannon, missiles, and a landing at the end. */

// ---------- renderer / camera / post ----------
const coarse = matchMedia("(pointer: coarse)").matches;
const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 1200);
const rearCam = new THREE.PerspectiveCamera(72, 2.2, 0.5, 500); // the mirror: looks back over the tail
scene.fog = new THREE.Fog(0x140a24, 50, 340);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.45, 0.92);
if (!coarse) composer.addPass(bloom);
const atmo = makeAtmoPass();
atmo.u.uAspect.value = innerWidth / innerHeight;
composer.addPass(atmo.pass);
composer.addPass(new OutputPass());
/* The sun. The big moon is the light source of this sky, and it moves: a slow
   arc over about six minutes, so the same sector never looks the same twice
   and the light has somewhere to come from. Everything that depends on it —
   the directional light, the dome's glow lobe, the sea glitter, the cloud
   lighting, the flare, the god rays — reads sunDir. */
const sunDir = new THREE.Vector3(-0.27, 0.2, -0.94).normalize();
let sunT = 40;
const sunCol = new THREE.Color(0xffd9f2);
/* Midnight. Around the low point of the sun's cycle a full moon stands high
   over the deck for a minute or so: the palette drops to deep blue, the moon
   lights the cloud tops silver, the stars come up. The reel's last shot forces
   it, so the title always shows it. */
let midnight = 0, midnightForce = 0, midnightCalled = false;
/* Some midnights come up red: every third cycle the full moon is a blood moon
   and the world goes crimson under it. And on alternate cycles, at the sun's
   high point, the small moon crosses it: half a minute of eclipse. */
let blood = 0, eclipse = 0, eclipseCalled = false;
const BLOOD: Palette = { name: "blood moon", sky: 0x0a0206, fog: 0x2a0810, ground: 0x1a0608, peak: 0x3a0e18, peakAlt: 0x5a1a26, island: 0x4a1420, glowA: 0xff8a70, glowB: 0xff3a30 };
const MID: Palette = { name: "midnight", sky: 0x02040c, fog: 0x0b1228, ground: 0x0a0f24, peak: 0x1a2244, peakAlt: 0x2a3660, island: 0x243050, glowA: 0xd0e2ff, glowB: 0x8fb0ff };
const moonLight = new THREE.DirectionalLight(0xcfdcff, 0);
scene.add(moonLight);

const hemi = new THREE.HemisphereLight(0x9a7dff, 0x120826, 1.1);
const ambient = new THREE.AmbientLight(0xffffff, 0.22);
const sun = new THREE.DirectionalLight(0xffd9f2, 1.9);
sun.position.set(-40, 60, -30);
const fill = new THREE.DirectionalLight(0x7dffd9, 0.55); // from behind the camera, so facets near the jet read
fill.position.set(25, 30, 60);
scene.add(hemi, ambient, sun, fill);

// ---------- palettes: the dream keeps re-colouring itself ----------
interface Palette { name: string; sky: number; fog: number; ground: number; peak: number; peakAlt: number; island: number; glowA: number; glowB: number }
const PALETTES: Palette[] = [
  { name: "violet dusk", sky: 0x0a0616, fog: 0x1c1030, ground: 0x171030, peak: 0x2a1a52, peakAlt: 0x3c2670, island: 0x3a2470, glowA: 0x7dffd9, glowB: 0xff7de9 },
  { name: "abyssal teal", sky: 0x051019, fog: 0x0c2a3c, ground: 0x0a2a34, peak: 0x11444e, peakAlt: 0x196068, island: 0x14606b, glowA: 0x7de9ff, glowB: 0xffd97d },
  { name: "ember rose", sky: 0x160608, fog: 0x34101c, ground: 0x2c0e1a, peak: 0x521a2c, peakAlt: 0x6c2238, island: 0x702440, glowA: 0xffb47d, glowB: 0xff7d9e },
  { name: "mint hollow", sky: 0x040f09, fog: 0x0e2c1d, ground: 0x0d261a, peak: 0x1a5234, peakAlt: 0x226a42, island: 0x247048, glowA: 0xd9ff7d, glowB: 0x7dc8ff },
];
let palIdx = 0;
const cur = {
  sky: new THREE.Color(PALETTES[0].sky), fog: new THREE.Color(PALETTES[0].fog),
  ground: new THREE.Color(PALETTES[0].ground), peak: new THREE.Color(PALETTES[0].peak),
  peakAlt: new THREE.Color(PALETTES[0].peakAlt), island: new THREE.Color(PALETTES[0].island),
  glowA: new THREE.Color(PALETTES[0].glowA), glowB: new THREE.Color(PALETTES[0].glowB),
};
const WHITE = new THREE.Color(0xffffff);

// ---------- world ----------
const terrainU = { uLow: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHigh: { value: new THREE.Color() }, uSnow: { value: new THREE.Color() } };
const ROCK = rockSurface(), ASPHALT = asphaltSurface();
const matTerrain = makeTerrainMaterial(terrainU, ROCK);
const islandRockMap = ROCK.map.clone(), islandRockNrm = ROCK.normal.clone();
islandRockMap.repeat.set(3, 2); islandRockNrm.repeat.set(3, 2);
const matRock = new THREE.MeshStandardMaterial({ color: cur.island, flatShading: true, roughness: 0.9, map: islandRockMap, normalMap: islandRockNrm, normalScale: new THREE.Vector2(1.2, 1.2) });
const matGrass = new THREE.MeshStandardMaterial({ color: 0x2f6a3a, flatShading: true, roughness: 0.95 });
const matTree = new THREE.MeshStandardMaterial({ color: 0x0f2a1a, flatShading: true, roughness: 0.95 });
const matRing = new THREE.MeshStandardMaterial({ color: cur.glowA, emissive: cur.glowA, emissiveIntensity: 2.2, metalness: 0.4, roughness: 0.3 });
const matOrb = new THREE.MeshStandardMaterial({ color: cur.glowB, emissive: cur.glowB, emissiveIntensity: 2.6 });
const matSpire = new THREE.MeshStandardMaterial({ color: 0x4a3a7a, flatShading: true, roughness: 0.18, metalness: 0.35, emissive: cur.glowB, emissiveIntensity: 0.16 });
const matWhale = new THREE.MeshStandardMaterial({ color: 0x27204a, flatShading: true, roughness: 0.8, emissive: 0x14104a, emissiveIntensity: 0.4 });
const monoMap = ROCK.map.clone(), monoNrm = ROCK.normal.clone();
monoMap.repeat.set(2, 7); monoNrm.repeat.set(2, 7);
const matMonolith = new THREE.MeshStandardMaterial({ color: 0x1a1824, roughness: 0.55, metalness: 0.3, emissive: 0x1a0f2e, emissiveIntensity: 0.5, map: monoMap, normalMap: monoNrm, normalScale: new THREE.Vector2(0.8, 0.8) });
const terrain = new Terrain(scene, matTerrain, { rock: matRock, grass: matGrass, crystal: matRing, tree: matTree }, matMonolith);
const sky = new Sky(scene);
const landmarks = buildLandmarks(scene, matRing, matMonolith, matRock);

const sprite = softSprite(64, 0), hardSprite = softSprite(64, 0.6);
const deck = new CloudDeck(scene, cloudSprite(128, 3), softSprite(64, 0));
const exhaust = new Particles(scene, 3000, sprite, true);
const sparks = new Particles(scene, 1500, hardSprite, true);
const smoke = new Particles(scene, 1500, sprite, false);
const setFogOn = (near: number, far: number) => { exhaust.setFog(near, far); sparks.setFog(near, far); smoke.setFog(near, far); };
setFogOn(60, 330);
const debris = new Debris(scene, 220);
const waves = new Shockwaves(scene);
const METAL = new THREE.Color(0x2a2530), CRYSTAL = new THREE.Color(0xc07ad8);

// ---------- laser power-up: the pickup, and the beam ----------
const power = new THREE.Group();
const powerCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9ff6ff, emissiveIntensity: 2.5, metalness: 0.2, roughness: 0.2 }));
const powerRing = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.07, 8, 40), new THREE.MeshBasicMaterial({ color: 0xbfffff }));
const powerRing2 = powerRing.clone(); powerRing2.rotation.x = Math.PI / 2;
power.add(powerCore, powerRing, powerRing2);
power.scale.setScalar(1.8);
power.visible = false;
/* The laser is earned, not found: a streak of four kills without a hit in a
   sortie, or eight clean gates in a row in flight, puts the crystal ahead of
   you. Then it is still yours to catch. */
const LASER_KILLS = 4, LASER_GATES = 8;
let laserEarned = false;
function offerLaser(why: string) {
  if (laserT > 0 || power.visible || laserEarned) return;
  laserEarned = true; powerT = 0;
  toast(`${why} · LASER CRYSTAL AHEAD`, "hot"); fx.chime(1500);
}
scene.add(power);
const beam = new THREE.Group();
const beamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
const beamGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
beamCore.rotation.x = Math.PI / 2; beamGlow.rotation.x = Math.PI / 2; // cylinder axis -> +z, so it spans -length..0 when offset
/* Seen from the chase camera the beam runs almost straight away from you, so a
   cylinder alone is a dot; a chain of camera-facing glow sprites reads as the
   bright rod converging to the vanishing point. */
const BEAM_N = 160;
const beamGeo = new THREE.BufferGeometry();
beamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BEAM_N * 3), 3));
beamGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
const beamPts = new THREE.Points(beamGeo, new THREE.PointsMaterial({ map: sprite, size: 1.0, sizeAttenuation: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xe6ffff }));
const beamPts2 = new THREE.Points(beamGeo, new THREE.PointsMaterial({ map: sprite, size: 3.4, sizeAttenuation: true, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, color: 0x7fe8ff }));
beamPts.frustumCulled = beamPts2.frustumCulled = false;
beam.add(beamCore, beamGlow, beamPts, beamPts2);
beam.visible = false;
scene.add(beam);
const beamLight = new THREE.PointLight(0x9ff6ff, 0, 30, 2);
scene.add(beamLight);

function buildWhale(): THREE.Group {
  const w = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 3.4, 6, 12), matWhale);
  body.rotation.x = Math.PI / 2; body.scale.set(1, 0.78, 1); w.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 4), matWhale);
  tail.rotation.x = -Math.PI / 2; tail.position.set(0, 0.1, 2.6); tail.scale.set(2.6, 1, 0.35); w.add(tail);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 3), matWhale);
    fin.position.set(s * 1.15, -0.3, -0.4); fin.rotation.z = s * 1.9; fin.scale.set(0.35, 1, 1.6); w.add(fin);
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
  eye.position.set(0.7, 0.25, -1.6); w.add(eye);
  return w;
}
const whales = [0, 1, 2].map((i) => {
  const w = buildWhale();
  w.scale.setScalar(4 + i * 2.5);
  w.position.set((i - 1) * 55, 22 + i * 9, -140 - i * 60);
  scene.add(w);
  return w;
});

// lens flare on the sun, occluded by whatever gets in front of it: a wing, a ridge, the deck
const flare = new Lensflare();
const flareCol = new THREE.Color();
{
  const disc = flareTexture(256, false, "rgba(255,225,245,.85)"), ring = flareTexture(128, true, "rgba(200,240,255,.5)");
  flare.addElement(new LensflareElement(disc, 240, 0, flareCol));
  void ring;
}
flare.position.copy(sunDir).multiplyScalar(520);
scene.add(flare);
const runway = buildRunway(ASPHALT);
runway.visible = false;
scene.add(runway);

// ---------- player ----------
const jet = buildJet(PLAYER_JET);
scene.add(jet.group, jet.light);
const combat = new Combat(scene, sparks, smoke, exhaust, debris, waves);
/* Views. The chase camera flies its own aeroplane behind you; the cockpit puts
   you in the seat with the canopy frame hung off the camera. Head tracking on
   both: the eye leads into a turn and drifts toward a locked bandit, with lag. */
type View = "chase" | "cockpit";
let view: View = "chase";
try { view = (localStorage.getItem("afterburn-view") as View) === "cockpit" ? "cockpit" : "chase"; } catch {}
const cockpit = buildCockpit();
camera.add(cockpit.group);
scene.add(camera);
const head = { x: 0, y: 0 }; // head-tracking offsets, smoothed
/* The kill camera: on a missile kill the view cuts to the bandit coming apart
   for half a second, slowed, then cuts back. The point it looks at rides the
   world so the wreck stays where it fell. */
let killCamT = 0, killCamCd = 0, killCamSide = 1;
const killCamP = new THREE.Vector3();
/* Photo mode and the replay share a free orbit camera round the jet: drag to
   turn it, wheel to move in and out. The photo freezes the world; the replay
   rewinds the last twenty seconds of the jet's own track — position, attitude,
   throttle, the course under it — and flies it back with the terrain re-carved
   to match. Everything else in the world (bandits, gates) is hidden for it. */
const orbit = { yaw: 0.6, pitch: 0.25, dist: 9 };
let orbitDrag = false, orbitLastX = 0, orbitLastY = 0;
interface Sample { dist: number; x: number; y: number; pitch: number; yaw: number; roll: number; throttle: number; boost: number; speed: number }
const REC_MAX = 20 * 60;
const rec: Sample[] = [];
let replayT = 0, replayPlaying = true, replayFrom: Mode = "pause";
const live = { dist: 0, x: 0, y: 0, rot: new THREE.Euler(), aliveEnemies: [] as boolean[], ringsVisible: true };
/* The first flight: a guided run that asks for one thing at a time and
   watches for it — climb, turn, burner, roll, a gate, the brake — then puts
   the runway ahead and asks you to bring it home. */
let training = false, trainStep = -1, trainHold = 0, trainGates = 0;
const TRAIN: { text: string; say: string; done: () => boolean; hold?: number }[] = [
  { text: "THROTTLE UP · ROTATE", say: "Throttle up. Rotate when she's ready.", done: () => phase === "fly" },
  { text: "PULL UP · CLIMB ABOVE 600 M", say: "Pull up. Climb through six hundred.", done: () => (jet.group.position.y + 1.58) * 30 > 600 },
  { text: "TURN · TAKE THE CURSOR TO THE EDGE", say: "Now turn. Take the cursor out to the edge.", done: () => Math.abs(bankZ) > 0.55, hold: 0.8 },
  { text: "AFTERBURNER · HOLD SPACE", say: "Light the burner. Hold space.", done: () => boosting, hold: 1.2 },
  { text: "ROLL · TAP Q OR E", say: "Roll it. Q or E.", done: () => rollT >= 0 },
  { text: "AIRBRAKE · HOLD SHIFT", say: "Airbrake. Hold shift, feel it bite.", done: () => brake, hold: 0.8 },
  { text: "THREAD A GATE", say: "Thread a gate. Fly through the ring.", done: () => gates > trainGates },
  { text: "RETURN TO BASE · LINE UP AND FLARE", say: "Good. Now bring it home: line up on the runway, ease it down, flare.", done: () => phase === "landed" },
];
/* The landing debrief: the approach is sampled on the way down and the
   touchdown numbers kept, so the end sheet can draw the profile against a
   three-degree glideslope and grade it. */
interface Approach { trace: { d: number; agl: number }[]; sink: number; offset: number; speed: number; grade: string; bonus: number }
let approach: Approach | null = null, approachT = 0;

// ---------- reflections ----------
/* Two kinds. The sky is rendered into a small cube map every few frames from
   the camera's position (sky only: layer 1), and that is what the airframes
   and the sea reflect — moons, aurora, the palette. And in the mirror sea
   the water is a true planar mirror: the scene is re-rendered from below the
   surface each frame and composited through the ripples, so the jet, the
   islands and the gates really do hang upside down in it. */
const envRT = new THREE.WebGLCubeRenderTarget(256, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const envCam = new THREE.CubeCamera(1, 1500, envRT);
envCam.layers.set(1);
scene.add(envCam);
const applyEnv = (j: Jet) => {
  for (const m of [j.mats.body, j.mats.accent]) { m.envMap = envRT.texture; m.envMapIntensity = 2.0; m.needsUpdate = true; }
  j.mats.canopy.envMap = envRT.texture; j.mats.canopy.envMapIntensity = 2.4; j.mats.canopy.needsUpdate = true;
};
applyEnv(jet);
combat.enemies.forEach((e) => applyEnv(e.jet));
terrain.waterMat.envMap = envRT.texture; terrain.waterMat.envMapIntensity = 1.4; terrain.waterMat.needsUpdate = true;
const seaU = {
  color: { value: new THREE.Color(0xffffff) }, tDiffuse: { value: null as THREE.Texture | null }, textureMatrix: { value: null as THREE.Matrix4 | null },
  tNormal: { value: terrain.waterMat.normalMap }, uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x0a1626) }, uGlow: { value: new THREE.Color(0xffffff) }, uSunDir: { value: sunDir },
  ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
};
const sea = new Reflector(terrain.water.geometry, {
  textureWidth: 768, textureHeight: 432, clipBias: 0.02, color: 0xffffff,
  shader: {
    name: "MirrorSea", uniforms: seaU,
    vertexShader: `
      uniform mat4 textureMatrix; uniform float uTime; varying vec4 vUv4; varying vec2 vUv; varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        // a low swell: the plane lies in xy and is rotated flat, so local z is up
        vec3 p = position;
        p.z += sin(p.x * 0.09 + uTime * 0.9) * 0.09 + sin(p.y * 0.07 - uTime * 0.7 + p.x * 0.03) * 0.07;
        vUv4 = textureMatrix * vec4(p, 1.0);
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D tDiffuse, tNormal; uniform vec3 color, uDeep, uGlow, uSunDir; uniform float uTime;
      varying vec4 vUv4; varying vec2 vUv; varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 uvN = vUv * vec2(12.0, 20.0) + vec2(uTime * 0.06, uTime * 0.14);
        vec3 n = texture2D(tNormal, uvN).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(tNormal, uvN * 0.37 + vec2(-uTime * 0.04, uTime * 0.07)).xyz * 2.0 - 1.0;
        vec3 n3 = texture2D(tNormal, vUv * vec2(40.0, 66.0) + vec2(uTime * 0.11, -uTime * 0.19)).xyz * 2.0 - 1.0;
        vec2 ripple = n.xy + n2.xy + n3.xy * 0.5;
        vec4 uv4 = vUv4; uv4.xy += ripple * 0.014 * uv4.w;
        vec3 refl = texture2DProj(tDiffuse, uv4).rgb;
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(viewDir.y, 0.0), 2.5);
        vec3 col = mix(uDeep, refl * color, 0.55 + 0.45 * fresnel);
        vec3 nn = normalize(vec3(ripple.x, 3.5, ripple.y));
        vec3 h = normalize(viewDir + normalize(uSunDir));
        // glitter: the specular breaks up on the fine ripples and twinkles
        float spec = pow(max(dot(nn, h), 0.0), 120.0);
        float sparkle = pow(max(dot(normalize(vec3(n3.x * 1.6, 2.2, n3.y * 1.6)), h), 0.0), 260.0);
        col += uGlow * (spec * 0.5 + sparkle * 0.9);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  },
});
(sea.material as THREE.ShaderMaterial).fog = true;
sea.rotation.copy(terrain.water.rotation); sea.position.copy(terrain.water.position);
sea.visible = false;
scene.add(sea);
let envFrame = 0, seaOn = false;

// ---------- pools: gates, orbs, spires, shards ----------
const RING_R = 3.1; // gate radius; a clean pass is anywhere inside the hoop
const rings = Array.from({ length: 6 }, () => {
  const m = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.22, 12, 56), matRing);
  scene.add(m);
  return { m, passed: false, flash: 0 };
});
const orbs = Array.from({ length: 12 }, () => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), matOrb);
  scene.add(m);
  return m;
});
const spires = Array.from({ length: 6 }, () => {
  const m = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 5), matSpire);
  scene.add(m);
  return { m, h: 10, base: -2, wait: 0 };
});
const shards = Array.from({ length: 4 }, () => {
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + rnd(k) * 0.7, 0), matSpire);
    s.position.set((rnd(k * 3) - 0.5) * 1.6, (rnd(k * 5) - 0.5) * 1.6, (rnd(k * 7) - 0.5) * 1.6);
    s.rotation.set(rnd(k * 11) * 3, rnd(k * 13) * 3, 0);
    g.add(s);
  }
  scene.add(g);
  return g;
});

// ---------- state ----------
type Mode = "title" | "play" | "pause" | "dead" | "photo" | "replay";
type Game = "flight" | "war";
type Phase = "takeoff" | "fly" | "landing" | "landed";
let mode: Mode = "title", game: Game = "flight", phase: Phase = "takeoff";
let speed = 0, dist = 0, score = 0, streak = 0, shield = 3, boost = 0.6, boosting = false, throttle = 0, energy = 0, brake = false;
let iframes = 0, shake = 0, rollT = -1, rollDir = 1, elapsed = 0, palTimer = 0, phaseT = 0, timeScale = 1;
/* rollPhase is where a roll has got to, 0..2pi, so the flight model can fly the
   corkscrew the wings are describing; camRoll is a kick the camera takes on an impact. */
let rollPhase = 0, camRoll = 0, vapour = 0, blinkT = 0;
let flipT = -1, flipCd = 0, wasBehind = 0, alarmT = 0, mouseVX = 0, breakT = 0;
const FLIP_TIME = 1.5;
/* The wider repertoire: a held roll keeps going (a barrel roll, the jet corkscrewing round its lift vector),
   the cobra pitches the nose past the vertical and parks the jet in the air, the split-S rolls inverted and
   pulls through a downward loop for a fast, low exit. */
let cobraT = -1, splitT = -1, rollHeld = false, rollCount = 0, rmbHeld = false, touchRoll = false, gLoad = 0, pushG = 0, speedFx = 0;
const COBRA_TIME = 1.5, SPLIT_TIME = 1.5;
/* Real throttle and rudder on the keyboard: W/S set the throttle, A/D skid the nose (the cannon aims where the
   nose points), B is an Immelmann: pull up through a half loop and roll out on top, fast climb, speed paid for it. */
let throttleSet = 1, rudder = 0, immT = -1;
const IMM_TIME = 1.4;
/* A strike departs the airframe. The impulse goes in at the wingtip, so it is
   mostly roll, some yaw and very little pitch — not a random tumble. What happens
   next is aerodynamics: the wings want to fly again, so the rates run down against
   a restoring moment and the roll settles to the nearest upright, which means a
   hard hit rolls all the way through instead of snapping back. Holding the stick
   against the roll doubles the damping. Until it washes out the jet answers
   slowly, and the bank is real bank — it drags the flight path with it, which low
   down is how a glancing hit turns into a wing in the ground. */
let upsetT = 0, depart = 0;
const TAU = Math.PI * 2;
const upRate = { r: 0, p: 0, y: 0 }, upAng = { r: 0, p: 0, y: 0 };
function knock(dir: number, severity: number, label: string) {
  upsetT = Math.max(upsetT, 0.7 + severity * 0.8);
  // the wing that touched is the wing that stops: roll and yaw away from the contact
  upRate.r += -dir * (4.5 + severity * 6.5) * (0.85 + Math.random() * 0.3);
  upRate.y += dir * (0.7 + severity * 1.0);
  upRate.p += (Math.random() - 0.5) * 1.6 * severity;
  // a shove, not a teleport — the departure itself carries the jet off its line
  vel.x += dir * (4 + severity * 5); vel.y += 1.5 + severity * 3;
  shake = Math.max(shake, 0.6 + severity * 0.6);
  camRoll += dir * (0.16 + severity * 0.2);
  fx.ricochet();
  // metal coming off the wing, streaming back past the camera
  _p.set(dir * 0.8, -0.02, 0.1); jet.group.localToWorld(_p);
  for (let i = 0; i < 5; i++) sparkHit(sparks, _p);
  debris.burst(_p, _c.set(dir * 5, 1, speed * 0.45), 4 + Math.round(severity * 4), 0.13, 5, METAL, 0);
  if (label) toast(label, "bad");
}
let laserT = 0, laserOn = false, powerT = 18, vaporized = 0, deathCause = "", laserCam = 0;
const LASER_TIME = 6;
let runT = 0, gates = 0, maxStreak = 0, orbsGot = 0, topSpeed = 0, bestBeaten = false, kills = 0, maxAlt = 0;
let deadT = 0, hintT = 0, runs = 0, deadDone = false, landingDist = 0, rollsDone = 0;
const RESTART_LOCK = 1.6;
const X_MAX = 42, Y_MAX = 110; // the deck sits around 64; above it is the clear sky
let cloudDens = 0, aboveMix = 0, sectorIdx = -1;
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _p2 = new THREE.Vector3(), _c2 = new THREE.Color();
const vel = new THREE.Vector2(0, 0);
let bankZ = 0, pitchX = 0, yawY = 0;
let lastRingX = 3, lastRingY = 4;
let best: Record<Game, number> = { flight: 0, war: 0 };
try { best = { ...best, ...JSON.parse(localStorage.getItem("afterburn-best2") || "{}") }; } catch {}
try { game = (localStorage.getItem("afterburn-game") as Game) || "flight"; if (game !== "flight" && game !== "war") game = "flight"; } catch {}
/* Settings. Everything a player might want to change lives in one object,
   persisted, applied through applySettings(). Keys are remappable per action;
   the checks in the loop go through key()/held() so a rebinding is honoured
   everywhere at once. */
type Action = "boost" | "brake" | "rollL" | "rollR" | "flip" | "cobra" | "immelmann" | "splitS" | "missile" | "fire" | "thrUp" | "thrDown" | "rudL" | "rudR" | "view" | "hud" | "photo" | "replay" | "gear" | "flare" | "hold";
const KEY_DEFAULTS: Record<Action, string> = { boost: "Space", brake: "ShiftLeft", rollL: "KeyQ", rollR: "KeyE", flip: "KeyC", cobra: "KeyV", immelmann: "KeyB", splitS: "KeyZ", missile: "KeyR", fire: "KeyX", thrUp: "KeyW", thrDown: "KeyS", rudL: "KeyA", rudR: "KeyD", view: "Tab", hud: "KeyH", photo: "KeyO", replay: "KeyI", gear: "KeyG", flare: "KeyT", hold: "KeyL" };
const ACTION_NAMES: Record<Action, string> = { boost: "afterburner", brake: "airbrake", rollL: "roll left", rollR: "roll right", flip: "reversal", cobra: "cobra", immelmann: "immelmann", splitS: "split-S", missile: "missile", fire: "cannon / laser", thrUp: "throttle up", thrDown: "throttle down", rudL: "rudder left", rudR: "rudder right", view: "cockpit / chase", hud: "HUD level", photo: "photo mode", replay: "replay", gear: "landing gear", flare: "flares", hold: "altitude hold" };
interface Settings { music: number; engine: number; fx: number; voice: number; camDist: number; fov: number; quality: "auto" | "high" | "medium" | "low"; motion: "auto" | "on" | "off"; cb: boolean; lefty: boolean; keys: Record<Action, string> }
const settings: Settings = { music: 0.6, engine: 1, fx: 1, voice: 1, camDist: 1, fov: 58, quality: "auto", motion: "auto", cb: false, lefty: false, keys: { ...KEY_DEFAULTS } };
try { const s = JSON.parse(localStorage.getItem("afterburn-settings") || "{}"); Object.assign(settings, s); settings.keys = { ...KEY_DEFAULTS, ...(s.keys || {}) }; } catch {}
const key = (a: Action) => settings.keys[a];
const actionOf = (code: string): Action | null => { for (const a in settings.keys) if (settings.keys[a as Action] === code) return a as Action; return null; };
let motion = (settings.motion === "auto" ? matchMedia("(prefers-reduced-motion: reduce)").matches : settings.motion === "off") ? 0.35 : 1;

/* Control model. Mouse (plus keys, which nudge a virtual cursor) points at
   where in the envelope you want to be; the jet accelerates toward it, so a
   small cursor move is an immediate small correction and a big one is a hard
   turn. Touch is a thumb-stick: drag from where the finger landed commands
   turn rate, release to level off. */
const mouseStick = { x: 0, y: 0 }, keyStick = { x: 0, y: 0 }, touchStick = { x: 0, y: 0 }, smooth = { x: 0, y: 0 };
const V_MAX_X = 50, V_MAX_Y = 36, CURSOR_GAIN = 3.2;
let frameAvg = 1 / 60, quality = 2;
const keys = new Set<string>();
const held = (a: Action) => keys.has(key(a));
let pointerBoost = false, pointerFire = false, steerPointer: number | null = null, touchStart = { x: 0, y: 0 };
const fx = new AudioFX();
const music = new Music();
try { const v = localStorage.getItem("afterburn-music"); if (v !== null) music.volume = Math.min(1, Math.max(0, Number(v))); } catch {}
music.onTrack = (t) => { const el = document.getElementById("nowplaying"); if (el) { el.textContent = `♪ ${t.title} — ${t.artist}`; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 5000); } };
/** The mixer exists only after a gesture; the music waits for it and then for the track the mode wants. */
function musicFor(m: Mode, g: Game) { music.play(m === "title" ? "title" : g === "war" ? "war" : "flight"); }
try { fx.muted = localStorage.getItem("afterburn-muted") === "1"; } catch {}

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, on: boolean) => $(id).classList.toggle("hidden", !on);
const pulse = (id: string, cls: string) => { const el = $(id); el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const fmtBest = () => (best[game] > 0 ? `BEST ${best[game].toLocaleString()}` : "");
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const hud = new Hud($("hud") as HTMLCanvasElement), rwr = new Rwr($("rwr") as HTMLCanvasElement);
const radio = new Radio($("comms"), (o) => fx.squelch(o));
let gpwsT = 0, coverCalled = false;
const hudColor = () => getComputedStyle(document.body).getPropertyValue("--hud").trim() || "#b8ffd8";
const cssVar = (n: string) => getComputedStyle(document.body).getPropertyValue(n).trim();
let rwrCount = 0, rwrTickT = 0;
let dbgShow = false;
/* How much glass. "min" is the default: the flight-path marker, two numbers,
   the heading, and the warnings, so the scenery stays the picture. "full" is
   the whole display, which the cockpit always shows. "off" is the scenery. */
type HudLevel = "off" | "min" | "full";
let hudLevel: HudLevel = "min";
try { const h = localStorage.getItem("afterburn-hud") as HudLevel; if (h === "off" || h === "min" || h === "full") hudLevel = h; } catch {}
function setHudLevel(h: HudLevel) {
  hudLevel = h;
  try { localStorage.setItem("afterburn-hud", h); } catch {}
  document.body.dataset.hud = h;
  if (mode === "play") toast(h === "off" ? "HUD OFF" : h === "min" ? "HUD MINIMAL" : "HUD FULL");
}

let toastT = 0, nearMissT = 0, nearMissFrom = "", dbgFired = 0, dbgNear = 0;
function toast(t: string, cls = "") { const el = $("toast"); el.textContent = t; el.className = cls; el.style.opacity = "1"; toastT = 1.2; }
let biomeT = 0;
function showBiome(name: string) { $("biome").textContent = name; $("biome").classList.add("on"); biomeT = 3; }
function objective(t: string) { $("objective").textContent = t; $("objective").classList.toggle("on", t.length > 0); }

function setMode(m: Mode) {
  mode = m;
  if (m === "title") musicFor("title", game);
  document.body.dataset.mode = m;
  show("title", m === "title");
  show("paused", m === "pause");
  show("photo", m === "photo" || m === "replay");
  $("photoTitle").textContent = m === "replay" ? "REPLAY · drag to scrub · wheel to zoom" : "PHOTO · drag to orbit · wheel to zoom";
  $("replayPlay").style.display = m === "replay" ? "" : "none";
  if (m !== "dead") show("dead", false);
  $("pause").textContent = m === "pause" ? "▶ resume" : "⏸ pause";
  fx.duck(m === "pause");
}
function setGame(g: Game) {
  game = g;
  document.body.dataset.game = g;
  document.querySelectorAll<HTMLButtonElement>(".modes button").forEach((b) => b.classList.toggle("sel", b.dataset.game === g));
  $("titleBest").textContent = fmtBest();
  try { localStorage.setItem("afterburn-game", g); } catch {}
}
function updateShield() { $("shield").querySelectorAll("i").forEach((el, i) => el.classList.toggle("on", i < shield)); }
function saveSettings() { try { localStorage.setItem("afterburn-settings", JSON.stringify(settings)); } catch {} }
function applySettings() {
  music.setVolume(settings.music); fx.setLevels(settings.engine, settings.fx); radio.volume = settings.voice;
  motion = (settings.motion === "auto" ? matchMedia("(prefers-reduced-motion: reduce)").matches : settings.motion === "off") ? 0.35 : 1;
  document.body.classList.toggle("cb", settings.cb);
  document.body.classList.toggle("lefty", settings.lefty);
  document.body.classList.toggle("nomotion", motion < 1);
  if (settings.quality !== "auto") setQuality(settings.quality === "high" ? 2 : settings.quality === "medium" ? 1 : 0);
  saveSettings();
}
function setMuted(m: boolean) {
  $("mute").textContent = m ? "🔇 muted" : "🔊 sound";
  $("mute").setAttribute("aria-pressed", String(m));
  try { localStorage.setItem("afterburn-muted", m ? "1" : "0"); } catch {}
}

// ---------- placement: everything spawns relative to where the jet is flying ----------
const groundAt = (x: number, z: number) => terrain.heightAt(x, z);
function clearOfSpires(x: number, y: number, z: number) {
  for (const s of spires) if (s.m.visible && Math.abs(s.m.position.z - z) < 30 && Math.abs(s.m.position.x - x) < RING_R + 1.5 && y < s.base + s.h + RING_R + 1) return false;
  for (const s of shards) if (s.visible && Math.abs(s.position.z - z) < 26 && Math.hypot(s.position.x - x, s.position.y - y) < 5) return false;
  return true;
}
function placeRing(r: { m: THREE.Mesh; passed: boolean; flash: number }, seed: number, zBase = -240) {
  r.flash = 0; r.m.scale.set(1, 1, 1);
  const px = jet.group.position.x, py = jet.group.position.y;
  for (let k = 0; k < 8; k++) {
    const s = seed + k * 101;
    // slalom: alternate sides of the previous gate, drift toward the pilot's lane
    const x = clamp(lerp(lastRingX, px, 0.35) - Math.sign(lastRingX - px || 1) * (3 + rnd(s) * 7), -X_MAX + 3, X_MAX - 3);
    const z = zBase - rnd(s + 5) * 40;
    let y = clamp(lerp(lastRingY, py, 0.4) + (rnd(s + 3) - 0.5) * 9, RING_R + 0.6, Y_MAX - 4);
    y = Math.max(y, groundAt(x, z) + 3.2);
    let ok = clearOfSpires(x, y, z);
    for (const o of rings) if (ok && o !== r && Math.abs(o.m.position.z - z) < 40) ok = false;
    if (ok || k === 7) { r.m.position.set(x, y, z); r.passed = false; lastRingX = x; lastRingY = y; return; }
  }
}
function placeOrb(o: THREE.Mesh, seed: number) {
  const px = jet.group.position.x, py = jet.group.position.y;
  const x = clamp(px + (rnd(seed) - 0.5) * 30, -X_MAX + 2, X_MAX - 2), z = -200 - rnd(seed + 4) * 70;
  const y = Math.max(clamp(py + (rnd(seed + 2) - 0.5) * 16, 1, Y_MAX - 3), groundAt(x, z) + 2);
  o.position.set(x, y, z); o.visible = true;
}
function placeSpire(sp: { m: THREE.Mesh; h: number; base: number; wait: number }, seed: number) {
  const px = jet.group.position.x;
  const z0 = -300 - rnd(seed + 2) * 120;
  // crystal belongs to the spire forest; elsewhere it's a rare sight
  if (rnd(seed + 9) > regionAt(terrain.courseAt(Math.max(-320, z0))).crystal) { sp.wait = 4 + rnd(seed + 11) * 6; return; }
  for (let k = 0; k < 6; k++) {
    const s = seed + k * 77;
    const x = clamp(px + (rnd(s) - 0.5) * 34, -X_MAX + 2, X_MAX - 2), z = z0 - k * 3;
    const h = 9 + rnd(s + 4) * 16;
    let ok = true;
    for (const r of rings) if (Math.abs(r.m.position.z - z) < 30 && Math.abs(r.m.position.x - x) < 4) ok = false;
    if (ok || k === 5) {
      sp.base = groundAt(x, z); sp.h = h;
      sp.m.scale.set(0.9 + rnd(s + 6) * 0.6, h, 0.9 + rnd(s + 6) * 0.6);
      sp.m.position.set(x, sp.base + h / 2, z);
      sp.m.rotation.y = rnd(s + 8) * Math.PI;
      sp.m.visible = true;
      return;
    }
  }
}
function placeShard(s: THREE.Group, seed: number) {
  const px = jet.group.position.x, py = jet.group.position.y;
  const x = clamp(px + (rnd(seed) - 0.5) * 36, -X_MAX + 2, X_MAX - 2), z = -300 - rnd(seed + 2) * 120;
  if (rnd(seed + 9) > regionAt(terrain.courseAt(Math.max(-320, z))).crystal * 0.8) { s.position.z = z; s.visible = false; return; }
  const y = Math.max(clamp(py + (rnd(seed + 3) - 0.5) * 20, 3, Y_MAX - 2), groundAt(x, z) + 4);
  let ok = true;
  for (const r of rings) if (Math.abs(r.m.position.z - z) < 26 && Math.hypot(r.m.position.x - x, r.m.position.y - y) < 5) ok = false;
  s.position.set(x, y, ok ? z : z - 30); s.visible = true;
}

/** Lay out the gates, orbs, crystal and landmarks fresh around the jet; `near` pulls the first gates in close (the title reel has no runway roll to wait through). */
function placeField(near: boolean) {
  lastRingX = 3; lastRingY = near ? jet.group.position.y : 4;
  const z0 = near ? -110 : -300;
  rings.forEach((r, i) => { r.m.position.set(0, -50, z0 - i * 45); r.passed = true; placeRing(r, i * 7 + 11 + Math.floor(dist), z0 - i * 45); });
  orbs.forEach((o, i) => placeOrb(o, i * 13 + 5 + Math.floor(dist)));
  spires.forEach((s, i) => { s.m.visible = false; s.m.position.z = -320 - i * 40; s.wait = 6 + i * 4; });
  shards.forEach((s, i) => { s.visible = false; s.position.z = -340 - i * 45; });
  landmarks.forEach((l) => { l.group.visible = false; });
  sectorIdx = -1;
}
/** The four landmarks ride the course loop; the Arch pays out when you fly under it. */
function updateLandmarks(scoring: boolean) {
  const g = jet.group;
  for (const l of landmarks) {
    let c = l.course;
    while (c < dist - 220) c += SECTOR * LOOP;
    const z = -(c - dist);
    l.group.visible = z > -420;
    if (!l.group.visible) continue;
    const was = l.group.position.z;
    l.group.position.set(l.x, Math.max(groundHeight(l.x, c), WATER_Y) + (l.bonusY ? 10 : 0), z);
    if (l.name === "THE BEACON") { const sw = l.group.getObjectByName("sweep"); if (sw) { sw.rotation.y = elapsed * 0.7; sw.position.set(Math.cos(elapsed * 0.7) * 45, 65, -Math.sin(elapsed * 0.7) * 45); } }
    if (l.bonusY && was < 0 && z >= 0 && Math.abs(g.position.x - l.x) < 12 && g.position.y < l.group.position.y + 12) {
      waves.fire(g.position, 8);
      if (scoring) { score += 500; pulse("score", "pop"); toast("UNDER THE ARCH +500", "hot"); fx.chime(1000); }
    }
  }
}
/** The gate answers a clean pass: shockwave, a burst of its own light, a pop, a flash at the screen edge. */
function gateBurst(r: { m: THREE.Mesh; flash: number }, size: number) {
  waves.fire(r.m.position, size);
  r.flash = 1;
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    _c.set(Math.cos(a) * 9, Math.sin(a) * 9, speed * 0.5 + 6);
    sparks.emit(_p.set(r.m.position.x + Math.cos(a) * RING_R, r.m.position.y + Math.sin(a) * RING_R, r.m.position.z), _c, { life: 0.5, size0: 0.5, size1: 0.05, c0: WHITE, c1: cur.glowA, drag: 1.5 });
  }
  sparks.emit(r.m.position, _c.set(0, 0, speed * 0.5), { life: 0.16, size0: 6, size1: 12, c0: WHITE, c1: cur.glowA, alpha: 0.6 });
  $("gateflash").style.opacity = "1";
  setTimeout(() => { $("gateflash").style.opacity = "0"; }, 60);
  shake = Math.max(shake, 0.18);
}
/** A dip to black: hold it for `hold` seconds, then fade back up. The cut of the title reel, and the cut into a run. */
let cutT = 0;
function dip(hold: number) {
  const c = $("cut");
  c.style.transition = "none"; c.style.opacity = "1";
  cutT = hold;
}

function resetRun() {
  speed = 0; dist = 0; score = 0; streak = 0; shield = 3; boost = 0.6; iframes = 0; blinkT = 0; rollT = -1; rollPhase = 0; camRoll = 0; vapour = 0; depart = 0; throttle = 0; energy = 0; brake = false; timeScale = 1;
  flipT = -1; flipCd = 0; wasBehind = 0; alarmT = 0; breakT = 0; $("break").classList.remove("on");
  cobraT = -1; splitT = -1; immT = -1; rollCount = 0; gLoad = 0; pushG = 0; speedFx = 0; throttleSet = 1; rudder = 0;
  upsetT = 0; upRate.r = upRate.p = upRate.y = 0; upAng.r = upAng.p = upAng.y = 0;
  laserT = 0; laserOn = false; powerT = 1e9; laserEarned = false; vaporized = 0; power.visible = false; beam.visible = false; beamLight.intensity = 0; fx.laser(false);
  $("threat").classList.remove("on"); $("alert").classList.remove("on"); $("tele").classList.remove("on"); $("laserwrap").classList.remove("on"); $("damage").textContent = "";
  debris.clear();
  runT = 0; gates = 0; maxStreak = 0; orbsGot = 0; topSpeed = 0; bestBeaten = false; deadT = 0; kills = 0; maxAlt = 0; rollsDone = 0; deadDone = false;
  phase = "takeoff"; phaseT = 0;
  vel.set(0, 0); bankZ = pitchX = yawY = 0;
  keyStick.x = keyStick.y = touchStick.x = touchStick.y = 0;
  jet.setDamage(0);
  rec.length = 0; approach = null; approachT = 0;
  trainGates = 0;
  terrain.reset();
  const gy = groundAt(0, 0);
  jet.group.position.set(0, gy + 0.42, 0);
  jet.group.rotation.set(0, 0, 0);
  jet.group.visible = true;
  runway.position.set(0, gy + 0.02, 40);
  runway.visible = true;
  placeField(false);
  rings.forEach((r) => { r.m.visible = game === "flight"; });
  cloudDens = 0; aboveMix = 0;
  exhaust.clear(); sparks.clear(); smoke.clear();
  combat.setActive(game === "war");
  updateShield();
  $("best").className = ""; $("best").textContent = fmtBest();
  $("streak").className = "";
  $("toast").style.opacity = "0";
  objective("");
  hintT = runs < 2 ? 12 : 0;
  $("hint").classList.toggle("on", hintT > 0);
}
function startTraining() {
  training = true; trainStep = -1; trainHold = 0;
  setGame("flight"); startRun();
  try { localStorage.setItem("afterburn-trained", "1"); } catch {}
  document.body.classList.add("trained");
}
function startRun() {
  fx.start(); fx.whoosh();
  { const mi = fx.musicInput(); if (mi) music.attach(mi.ctx, mi.node); }
  musicFor("play", game);
  if (mode === "title") { dip(0.12); show("ctlPanel", false); }
  if (mode !== "title" || !$("titleBest")) { /* keep training as set by the caller */ }
  resetRun();
  runs++;
  pointerBoost = pointerFire = false;
  setMode("play");
  showBiome(PALETTES[palIdx].name);
  toast("THROTTLE UP");
  radio.clear(); coverCalled = false;
  radio.call(game === "war" ? "Cleared for takeoff. Bandits inbound." : "Cleared for takeoff.", 1);
}
function setView(v: View) {
  view = v;
  try { localStorage.setItem("afterburn-view", v); } catch {}
  $("viewBtn").textContent = v === "cockpit" ? "🎥 cockpit" : "🎥 chase";
  document.body.classList.toggle("cockpit", v === "cockpit");
  if (mode === "play") toast(v === "cockpit" ? "COCKPIT VIEW" : "CHASE VIEW");
}
function togglePause() { if (mode === "play") setMode("pause"); else if (mode === "pause") setMode("play"); }
/* The roll is a barrel roll, not a spin on the spot: the lift vector goes round
   with the wings, so the jet flies a corkscrew off its line and comes out
   displaced. That displacement is the evasion — you are untouchable for the pull
   and, by the time it ends, you are somewhere else. */
function doRoll(dir: number) {
  if (mode !== "play" || phase !== "fly" || rollT >= 0 || cobraT >= 0 || splitT >= 0) return;
  rollT = 0; rollDir = dir; rollCount = 0; rollPhase = 0; rollsDone++;
  iframes = Math.max(iframes, ROLL_TIME * 0.85); // most of the roll, not quite all of it: a held roll is not a shield
  vel.x += dir * 5; // the initial bite of aileron; the corkscrew does the rest
  fx.whoosh();
}
const busy = () => rollT >= 0 || flipT >= 0 || cobraT >= 0 || splitT >= 0 || immT >= 0;
/* Immelmann: a half loop up and a half roll out on top. You come out the same way, a lot higher and slower. */
function doImmelmann() {
  if (mode !== "play" || phase !== "fly" || busy()) return;
  const g = jet.group;
  if (g.position.y > Y_MAX - 24) { toast("TOO HIGH · NO ROOM FOR AN IMMELMANN", "bad"); return; }
  immT = 0; iframes = Math.max(iframes, IMM_TIME + 0.2); rollsDone++;
  energy = Math.max(-8, energy - 6); // height costs airspeed
  fx.whoosh();
  toast("IMMELMANN", "hot");
}
/* Pugachev's cobra: the nose comes up past the vertical, the whole airframe becomes an airbrake, and for a
   second and a half you hang there while the world - and anything on your six - goes past underneath. */
function doCobra() {
  if (mode !== "play" || phase !== "fly" || busy()) return;
  cobraT = 0; iframes = Math.max(iframes, COBRA_TIME + 0.2); rollsDone++;
  vel.y += 4;
  fx.whoosh();
  const n = game === "war" ? combat.behind : 0;
  toast(n > 0 ? "COBRA · THEY'LL OVERSHOOT" : "COBRA", n > 0 ? "hot" : "");
}
/* Split-S: roll inverted, pull through a downward loop, roll out fast and low. Trades height for speed;
   needs room underneath. */
function doSplitS() {
  if (mode !== "play" || phase !== "fly" || busy()) return;
  const g = jet.group;
  const floor = Math.max(groundAt(g.position.x, 0), groundAt(g.position.x, -30), groundAt(g.position.x, -60));
  if (g.position.y < floor + 18) { toast("TOO LOW · SPLIT-S NEEDS ROOM", "bad"); return; }
  splitT = 0; iframes = Math.max(iframes, SPLIT_TIME + 0.2); rollsDone++;
  energy = Math.min(16, energy + 9); // the dive pays out as airspeed
  fx.whoosh();
  toast("SPLIT-S", "hot");
}
function fireMissile() {
  if (mode !== "play" || game !== "war") return;
  if (combat.fireMissile(jet.group.position)) { fx.missile(); pulse("missiles", "pop"); shake = Math.max(shake, 0.22); toast("FOX TWO", "hot"); radio.call("Fox two.", 1); }
  else if (combat.ammo <= 0) { const n = combat.rearmKills - combat.killsToRearm; toast(`NO MISSILES · ${n} KILL${n === 1 ? "" : "S"} TO REARM`, "bad"); }
  else if (!combat.lockPos()) toast("NO LOCK", "bad");
}
/* Aileron roll from the mouse: the direction is where the hand is moving, or
   failing that which side of centre the cursor sits. */
function doRollAuto() { doRoll(Math.abs(mouseVX) > 1.5 ? Math.sign(mouseVX) : mouseStick.x < 0 ? -1 : 1); }
/* The reversal: chop the throttle to nothing and pull through a loop. It isn't
   a flip on the spot — you circle back, so for a second and a half the world
   keeps going while you don't, and anything sitting on your six flies straight
   past on its own airspeed. You're untouchable for the pull. */
function doFlip() {
  if (mode !== "play" || phase !== "fly" || flipT >= 0 || flipCd > 0) { if (flipCd > 0 && mode === "play") toast("REVERSAL RECHARGING", "bad"); return; }
  flipT = 0; flipCd = 6; iframes = Math.max(iframes, FLIP_TIME + 0.3); rollsDone++;
  vel.y += 10;
  fx.whoosh();
  const n = game === "war" ? combat.behind : 0;
  toast(n > 0 ? `REVERSAL · ${n === 1 ? "HE'LL OVERSHOOT" : "THEY'LL OVERSHOOT"}` : "REVERSAL", n > 0 ? "hot" : "");
}
const canRestart = () => mode === "title" || (mode === "dead" && deadT > RESTART_LOCK);

/* Taking a hit is physical: the airframe gets jolted, pieces come off, and
   the damage shows — smoke, then fire, then sluggish controls. */
function hurt(reason: string, jolt = 1) {
  if (iframes > 0 || mode !== "play") return;
  shield--; iframes = 2.2; blinkT = 2.2; shake = 0.8 + jolt * 0.5; fx.crash();
  vel.x += (Math.random() - 0.5) * 12 * jolt; vel.y -= 2.5 * jolt;
  const g = jet.group;
  sparkHit(sparks, g.position);
  debris.burst(g.position, _p.set(0, 0, speed * 0.3), 3 + Math.round(jolt * 2), 0.14, 6, METAL, 0);
  updateShield(); pulse("shield", "hit");
  $("damage").textContent = shield === 2 ? "DAMAGED" : shield === 1 ? "CRITICAL" : "";
  $("damage").className = shield === 1 ? "dmg1" : "dmg2";
  $("vignette").style.opacity = "1";
  setTimeout(() => { $("vignette").style.opacity = "0"; }, 240);
  jet.setDamage((3 - shield) / 3);
  if (game === "war" && streak > 0) { streak = 0; toast("KILL STREAK LOST", "bad"); }
  if (shield <= 0) { deathCause = reason; die(); return; }
  toast(shield === 1 ? `${reason} · LAST SHIELD` : reason, "bad");
  radio.call(shield === 1 ? "Critical. Get it home." : "We're hit!", 2);
}
const REGION_NAMES = Array.from({ length: LOOP }, (_, i) => regionAt(i * SECTOR + 10).name);
const CAUSES: Record<string, string> = {
  SPLASHDOWN: "went into the sea",
  HIT: "shot down", "MIDAIR COLLISION": "mid-air collision", CRYSTAL: "flew into the crystal", "GROUND SCRAPE": "ground contact",
  "HARD LANDING": "hard landing", GROUND: "ground contact", TERRAIN: "controlled flight into terrain",
};
function shatterSpire(sp: { m: THREE.Mesh; h: number; base: number }, atY: number, bonus: boolean) {
  _p.set(sp.m.position.x, clamp(atY, sp.base, sp.base + sp.h), sp.m.position.z);
  debris.burst(_p, _c.set(0, 0, speed * 0.4), 14, 0.32, 11, CRYSTAL, 0);
  sparkHit(sparks, _p); waves.fire(_p, 5);
  sp.m.visible = false;
  if (bonus) { score += 50; vaporized++; pulse("score", "pop"); }
}
function shatterShard(s: THREE.Group, bonus: boolean) {
  debris.burst(s.position, _c.set(0, 0, speed * 0.4), 12, 0.3, 10, CRYSTAL, 0);
  sparkHit(sparks, s.position); waves.fire(s.position, 5);
  s.visible = false;
  if (bonus) { score += 50; vaporized++; pulse("score", "pop"); }
}

function finishRun(title: string, victory: boolean) {
  const final = Math.floor(score);
  const prevBest = best[game];
  const record = prevBest > 0 && final > prevBest;
  best[game] = Math.max(best[game], final);
  try { localStorage.setItem("afterburn-best2", JSON.stringify(best)); } catch {}
  $("deadTitle").textContent = title;
  $("deadSub").textContent = victory ? (game === "war" ? `${kills} kills · wheels down · welcome home` : "") : (CAUSES[deathCause] || "flamed out") + (game === "war" ? ` · wave ${Math.max(1, combat.wave)}` : "");
  $("finalScore").textContent = final.toLocaleString();
  $("finalBest").textContent = record ? `previous best ${prevBest.toLocaleString()}` : fmtBest();
  show("record", record);
  $("sDist").textContent = (dist * 14 / 3600).toFixed(1);
  $("sGates").textContent = game === "war" ? String(kills) : String(gates);
  $("sGatesL").textContent = game === "war" ? "kills" : "gates";
  $("sStreak").textContent = game === "war" ? `${combat.wave}${victory ? " ✓" : ""}` : (maxStreak > 0 ? `×${maxStreak}` : "0");
  $("sStreakL").textContent = game === "war" ? "waves" : "best streak";
  $("sOrbs").textContent = String(rollsDone);
  $("sVap").textContent = String(vaporized);
  $("sSpeed").textContent = String(Math.round(topSpeed * 14));
  $("sAlt").textContent = String(Math.round(maxAlt * 30));
  $("sTime").textContent = `${Math.floor(runT / 60)}:${String(Math.floor(runT % 60)).padStart(2, "0")}`;
  $("deadGo").classList.remove("on");
  $("titleBest").textContent = fmtBest();
  drawDebrief(victory && approach && approach.grade ? approach : null);
  $("dead").classList.toggle("victory", victory);
}
/** The approach profile against a three-degree slope, and the numbers that graded it. */
function drawDebrief(a: Approach | null) {
  show("debrief", !!a);
  if (!a) return;
  const c = $("debriefChart") as HTMLCanvasElement, x = c.getContext("2d")!;
  const W = c.width, H = c.height, pad = 26;
  x.clearRect(0, 0, W, H);
  x.fillStyle = "rgba(4,8,10,.5)"; x.fillRect(0, 0, W, H);
  const dMax = 760 * 3.9, hMax = Math.max(120, ...a.trace.map((p) => p.agl)) * 1.1;
  const px = (d: number) => pad + (1 - d / dMax) * (W - pad * 2), py = (h: number) => H - pad - h / hMax * (H - pad * 2);
  x.strokeStyle = "rgba(234,246,255,.25)"; x.lineWidth = 1;
  x.beginPath(); x.moveTo(pad, py(0)); x.lineTo(W - pad, py(0)); x.stroke();
  // the three-degree slope
  x.strokeStyle = "rgba(255,210,125,.6)"; x.setLineDash([5, 4]); x.beginPath(); x.moveTo(px(dMax), py(dMax * Math.tan(3 * Math.PI / 180))); x.lineTo(px(0), py(0)); x.stroke(); x.setLineDash([]);
  x.strokeStyle = "#7dffd9"; x.lineWidth = 2; x.beginPath();
  a.trace.forEach((p, i) => { const X = px(p.d * 3.9), Y = py(p.agl); if (i === 0) x.moveTo(X, Y); else x.lineTo(X, Y); });
  x.stroke();
  x.fillStyle = "rgba(234,246,255,.6)"; x.font = "10px monospace"; x.textAlign = "left";
  x.fillText("3° slope", px(dMax) + 4, py(dMax * Math.tan(3 * Math.PI / 180)) - 6);
  x.fillText("threshold", px(0) - 54, py(0) + 14); x.fillText(`${Math.round(hMax)} m`, 2, pad);
  $("dbGrade").textContent = a.grade;
  $("dbSink").textContent = `${a.sink.toFixed(1)} m/s`;
  $("dbOffset").textContent = `${a.offset >= 0 ? "R" : "L"} ${Math.abs(a.offset).toFixed(1)} m`;
  $("dbSpeed").textContent = `${Math.round(a.speed)} km/h`;
}
function die() {
  setMode("dead"); deadT = 0; fx.crash(); shake = 1.6; pointerBoost = pointerFire = false;
  laserOn = false; beam.visible = false; beamLight.intensity = 0; fx.laser(false);
  timeScale = 0.45;
  vel.y = Math.min(vel.y, 2);
  $("hint").classList.remove("on");
  objective("");
  finishRun("FLAMEOUT", false);
}

// ---------- the title reel ----------
/* While the menu is up the jet flies itself. A reel of shots cuts between
   sectors: each one drops the world at a course position, plants the jet,
   and drives the camera — a fixed camera the world streams past, a wing
   cam, a head-on, a climb through the deck. The autopilot threads gates
   where the shot wants them and lights the burner on cue. */
interface Shot {
  name: string; tag: string; course: number; dur: number; x0?: number; y0: number; alt: number; lane: number; gates: boolean; boost?: [number, number]; fov: number;
  setup?(): void;
  /** Drives `camera.position`, `look` and `fovT` for progress u (0..1). */
  cam(u: number): void;
  /** Optional override of the autopilot's target point. */
  steer?(u: number, out: { x: number; y: number }): void;
}
const J = jet.group;
const camW = new THREE.Vector3(); // a camera planted in the world: it streams past with everything else
const look = new THREE.Vector3(), lookS = new THREE.Vector3();
let shotIdx = -1, shotT = 0, shotFlag = false, fovT = 55;
const sm01 = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wander = (t: number, amp: number) => Math.sin(t * 0.31) * amp + Math.sin(t * 0.77 + 1.3) * amp * 0.35;
const camAt = (dx: number, dy: number, dz: number) => camera.position.set(J.position.x + dx, J.position.y + dy, J.position.z + dz);
const lookAt = (dx: number, dy: number, dz: number) => look.set(J.position.x + dx, J.position.y + dy, J.position.z + dz);
const SHOTS: Shot[] = [
  { name: "THE VALLEY", tag: "SECTOR 01 · FLYBY", course: 90, dur: 7.5, y0: 9, alt: 9, lane: 10, gates: true, boost: [0.4, 1], fov: 55,
    setup() { camW.set(8, Math.max(groundAt(8, -110), WATER_Y) + 3.2, -112); },
    cam(u) { camera.position.copy(camW); look.copy(J.position); fovT = lerp(55, 28, sm01(0.5, 1, u)); } },
  { name: "THE ARCH", tag: "SECTOR 02 · LANDMARK", course: 1500 - 140, dur: 7.5, y0: 13, alt: 14, lane: 0, gates: false, boost: [0.6, 1], fov: 50,
    steer(_u, o) { const a = landmarks[0].group.position; o.x = 0; o.y = a.y + 5; },
    cam(u) { const a = landmarks[0].group.position; camera.position.set(a.x + 6, a.y - 4, a.z - 36); look.copy(J.position); fovT = lerp(50, 34, sm01(0.72, 1, u)); } },
  { name: "THE REACH", tag: "SECTOR 08 · WING CAM", course: 7020, dur: 8, y0: 12, alt: 12, lane: 6, gates: true, boost: [0.72, 1], fov: 48,
    cam(u) { camAt(-4.6 + u * 0.8, 0.9, 3.4 - u * 2.6); lookAt(0.6, 0, -3); fovT = 48; if (u > 0.5 && !shotFlag) { shotFlag = true; rollT = 0; rollDir = 1; } } },
  { name: "THE MIRROR SEA", tag: "SECTOR 04 · ON THE DECK", course: 3080, dur: 8, y0: 0.9, alt: 0.9, lane: 10, gates: true, boost: [0.5, 1], fov: 60,
    cam(u) { camAt(-2.4, -0.7 + u * 0.3, 3.6); lookAt(0.8, 0.3, -7); fovT = 60; } },
  { name: "SPIRE FOREST", tag: "SECTOR 05 · LEVIATHAN", course: 4080, dur: 9, y0: 22, alt: 22, lane: 6, gates: false, fov: 64,
    setup() { whales[2].position.set(14, 30, -85); whales[1].position.set(-26, 38, -150); whales[0].position.set(40, 26, -190); },
    cam(u) { camAt(3.2, -1.6, 4.6 + u * 0.6); lookAt(-0.5, 1.4, -5); fovT = 64; } },
  { name: "THE RIDGE", tag: "SECTOR 06 · HEAD-ON", course: 5080, dur: 8, y0: 14, alt: 14, lane: 14, gates: true, boost: [0.55, 1], fov: 42,
    cam(u) { camAt(1.2 - u * 2.4, 0.35, -5.2 - u * 1.8); lookAt(0, 0.05, 0); fovT = 42; } },
  { name: "THE GRAVEYARD", tag: "SECTOR 07 · GATE RUN", course: 6080, dur: 9, y0: 10, alt: 12, lane: 16, gates: true, boost: [0.7, 1], fov: 56,
    cam(u) { camAt(Math.sin(u * 3.1) * 3 - 1.5, 2.0 - u * 0.8, 10 - u * 3); lookAt(-2.2, -1.2, -12); fovT = 56; } },
  { name: "MIDNIGHT", tag: "SECTOR 08 · ABOVE THE DECK", course: 7500 - 270, dur: 11, y0: 52, alt: 92, lane: 8, gates: false, boost: [0.12, 0.62], fov: 52,
    // low behind the jet, looking up past it at the full moon; the deck fills the bottom of the frame
    cam(u) { camAt(3 - u * 1.5, -1.2 + u * 0.6, 8 + u * 3); lookAt(0.5, 9 + u * 3, -22); fovT = 56; } },
];
function cutTo(i: number) {
  shotIdx = i; shotT = 0; shotFlag = false;
  midnightForce = i === SHOTS.length - 1 ? 1 : 0;
  if (mode === "title" && midnightForce === 0) midnight = Math.min(midnight, 0.3);
  const s = SHOTS[i];
  dist = s.course; terrain.reset(dist);
  speed = 38; boosting = false; throttle = 0.8; rollT = -1; flipT = -1;
  vel.set(0, 0); bankZ = pitchX = yawY = 0;
  J.position.set(s.x0 ?? 0, s.y0, 0); J.rotation.set(0, 0, 0); J.visible = true;
  runway.visible = false; power.visible = false; beam.visible = false;
  placeField(true);
  rings.forEach((r) => { r.m.visible = s.gates; });
  exhaust.clear(); sparks.clear(); smoke.clear();
  updateLandmarks(false);
  s.setup?.();
  s.cam(0); lookS.copy(look); camera.fov = fovT; camera.updateProjectionMatrix();
  $("shotNum").textContent = `${String(i + 1).padStart(2, "0")} / ${String(SHOTS.length).padStart(2, "0")}`;
  $("shotName").textContent = s.name; $("shotTag").textContent = s.tag;
  pulse("slate", "in");
  dip(0.14);
}
/** One frame of the reel: autopilot, world scroll, gates, then the cut when the shot runs out. */
function attract(dt: number, scroll: number) {
  const s = SHOTS[shotIdx];
  shotT += dt;
  const u = Math.min(1, shotT / s.dur);
  $("shotBar").style.width = `${u * 100}%`;
  boosting = !!s.boost && u >= s.boost[0] && u < s.boost[1];
  speed += ((38 + (boosting ? 28 : 0)) - speed) * (1 - Math.pow(0.12, dt));
  throttle = lerp(throttle, 0.6 + Math.min(1, speed / 70) * 0.4, 1 - Math.pow(0.05, dt));
  dist += scroll;
  updateLandmarks(false);

  // where to fly: the shot's lane, or the next gate, then kept clear of the ground
  const o = { x: wander(elapsed, s.lane), y: s.alt };
  if (s.gates) {
    let best: typeof rings[number] | null = null;
    for (const r of rings) if (r.m.visible && !r.passed && r.m.position.z < -4 && r.m.position.z > -170 && (!best || r.m.position.z > best.m.position.z)) best = r;
    if (best) { o.x = best.m.position.x; o.y = best.m.position.y; }
  }
  s.steer?.(u, o);
  const clear = Math.max(groundAt(J.position.x, 0), groundAt(o.x, -25), groundAt(o.x, -50));
  o.y = clamp(Math.max(o.y, clear + 3.4), 0.6, Y_MAX);
  const vxT = clamp((o.x - J.position.x) * 1.8, -30, 30), vyT = clamp((o.y - J.position.y) * 1.8, -22, 22);
  const resp = 1 - Math.pow(0.0004, dt);
  vel.x += (vxT - vel.x) * resp; vel.y += (vyT - vel.y) * resp;
  J.position.x = clamp(J.position.x + vel.x * dt, -X_MAX, X_MAX);
  J.position.y = clamp(J.position.y + vel.y * dt, Math.max(0.5, groundAt(J.position.x, 0) + 0.6), Y_MAX);
  bankZ = lerp(bankZ, clamp(-vxT * 0.016 - vel.x * 0.016, -1.3, 1.3), 1 - Math.pow(0.008, dt));
  pitchX = lerp(pitchX, clamp(vyT * 0.016 + vel.y * 0.018, -0.7, 0.8), 1 - Math.pow(0.008, dt));
  yawY = lerp(yawY, -vel.x * 0.012, 1 - Math.pow(0.01, dt));
  J.rotation.set(pitchX, yawY, bankZ + rollStep(dt), "YXZ");
  jet.update(dt, elapsed, throttle, boosting ? 1 : 0);
  emitExhaust(jet, exhaust, dt, throttle, boosting ? 1 : 0, speed);

  scrollWorld(scroll);
  rings.forEach((r, i) => {
    r.m.rotation.z += dt * 0.8;
    if (r.flash > 0) { r.flash = Math.max(0, r.flash - dt * 3); const sc = 1 + r.flash * 0.35; r.m.scale.set(sc, sc, sc); }
    if (!r.passed && r.m.position.z > -0.3) {
      r.passed = true;
      if (Math.hypot(r.m.position.x - J.position.x, r.m.position.y - J.position.y) < RING_R - 0.2) gateBurst(r, 6);
    }
    if (r.m.position.z > 8) placeRing(r, i * 7 + Math.floor(dist));
  });
  orbs.forEach((o2, i) => { o2.rotation.x += dt * 2; o2.rotation.y += dt * 3; if (o2.position.z > 8) placeOrb(o2, i * 13 + Math.floor(dist)); });
  if (shotT >= s.dur) cutTo((shotIdx + 1) % SHOTS.length);
}
/* Advance a roll and return the angle to layer on the attitude, never accumulating.
   The rate is nearly constant with a short bite in and out, the way ailerons
   actually behave, and `rollPhase` carries the same angle to the flight model so
   the jet flies the corkscrew instead of pirouetting on its axis. */
const ROLL_TIME = 0.82, ROLL_HOLD_TIME = 0.74;
function rollStep(dt: number): number {
  if (rollT < 0) { rollPhase = 0; return 0; }
  rollT += dt / (rollCount > 0 ? ROLL_HOLD_TIME : ROLL_TIME);
  const t = Math.min(1, rollT);
  // a soft bite in and out with a steady rate through the middle; a held roll is already rolling
  const e = rollCount > 0 ? t : t - Math.sin(t * Math.PI * 2) * 0.055;
  rollPhase = Math.PI * 2 * e;
  if (rollT >= 1) {
    if (mode === "play" && phase === "fly" && rollHeld && cobraT < 0 && splitT < 0 && flipT < 0) {
      rollT = 0; rollCount++;
      iframes = Math.max(iframes, ROLL_HOLD_TIME * 0.85);
      if (game === "flight") { score += 50; pulse("score", "pop"); }
      toast(`BARREL ROLL ×${rollCount + 1}${game === "flight" ? " +50" : ""}`);
    } else { rollT = -1; rollCount = 0; rollPhase = 0; }
  }
  // rotation.z is right-hand about +z, and the camera looks down -z: a roll to the
  // right (dir +1) has to drop the right wing, which is a negative angle
  return -rollDir * rollPhase;
}

// ---------- input ----------
function mouseAt(e: PointerEvent) {
  mouseStick.x = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
  mouseStick.y = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
}
addEventListener("pointermove", (e) => {
  if ((mode === "photo" || mode === "replay") && orbitDrag) {
    if (mode === "replay") { replayT = clamp(replayT + (e.clientX - orbitLastX) / innerWidth * rec.length / 60 * 1.5, 0, Math.max(0, rec.length - 1) / 60); replayPlaying = false; }
    else { orbit.yaw -= (e.clientX - orbitLastX) * 0.006; orbit.pitch = clamp(orbit.pitch + (e.clientY - orbitLastY) * 0.004, -0.6, 1.2); }
    orbitLastX = e.clientX; orbitLastY = e.clientY; return;
  }
  if (e.pointerType === "mouse") { mouseAt(e); keyStick.x *= 0.9; keyStick.y *= 0.9; mouseVX = mouseVX * 0.5 + e.movementX * 0.5; }
  else if (e.pointerId === steerPointer) {
    const r = Math.min(innerWidth, innerHeight) * 0.22;
    touchStick.x = clamp((e.clientX - touchStart.x) / r, -1, 1);
    touchStick.y = clamp((e.clientY - touchStart.y) / r, -1, 1);
  }
});
addEventListener("pointerdown", (e) => {
  fx.resume();
  if (mode === "title") { fx.start(); const mi = fx.musicInput(); if (mi) music.attach(mi.ctx, mi.node); musicFor("title", game); }
  music.resume();
  if ((e.target as HTMLElement).closest("button")) return;
  if (mode === "title" && !$("ctlPanel").classList.contains("hidden")) { show("ctlPanel", false); return; }
  if (e.pointerType !== "mouse") { steerPointer = e.pointerId; touchStart = { x: e.clientX, y: e.clientY }; touchStick.x = touchStick.y = 0; }
  if (mode === "photo" || mode === "replay") { orbitDrag = true; orbitLastX = e.clientX; orbitLastY = e.clientY; return; }
  if (canRestart()) { training = false; startRun(); return; }
  if (mode === "pause") { setMode("play"); return; }
  if (mode === "play" && e.pointerType === "mouse") {
    if (e.button === 0) { if (game === "war" || laserT > 0) pointerFire = true; else pointerBoost = true; }
    else if (e.button === 2) { rmbHeld = true; if (keys.has("ShiftLeft") || keys.has("ShiftRight")) doFlip(); else doRollAuto(); }
    else if (e.button === 1) { e.preventDefault(); if (game === "war") fireMissile(); else doRollAuto(); }
  }
});
addEventListener("wheel", (e) => { if (mode === "photo" || mode === "replay") orbit.dist = clamp(orbit.dist * (1 + Math.sign(e.deltaY) * 0.12), 3, 40); }, { passive: true });
const releasePointer = (e: PointerEvent) => {
  orbitDrag = false;
  if (e.pointerType === "mouse") { pointerBoost = false; pointerFire = false; if (e.button === 2 || e.type === "pointercancel") rmbHeld = false; }
  if (e.pointerId === steerPointer) { steerPointer = null; touchStick.x = touchStick.y = 0; }
};
addEventListener("pointerup", releasePointer);
addEventListener("pointercancel", releasePointer);
addEventListener("contextmenu", (e) => e.preventDefault());

addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  fx.resume();
  if (mode === "title") { fx.start(); const mi = fx.musicInput(); if (mi) music.attach(mi.ctx, mi.node); musicFor("title", game); }
  music.resume();
  if (rebinding) { e.preventDefault(); finishRebind(e.code); return; }
  if (!$("settings").classList.contains("hidden")) { if (e.code === "Escape") showSettings(false); return; }
  switch (e.code) {
    case "Enter": if (canRestart()) startRun(); else if (mode === "pause") setMode("play"); break;
    case "Digit1": if (mode === "title") setGame("flight"); break;
    case "Digit2": if (mode === "title") setGame("war"); break;
    case "KeyP": case "Escape": if (mode === "photo" || mode === "replay") leaveStill(); else togglePause(); break;
    case "ControlLeft": case "ControlRight": fireMissile(); break;
    case "KeyM": setMuted(fx.toggle()); break;
    case "KeyF":
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
      break;
    case "F3": e.preventDefault(); perfOn = !perfOn; $("perf").classList.toggle("on", perfOn); break;
  }
  switch (actionOf(e.code)) {
    case "boost": if (canRestart()) { training = false; startRun(); } else if (mode === "pause") setMode("play"); else if (mode === "replay") replayPlaying = !replayPlaying; break;
    case "photo": if (mode === "play" || mode === "pause") enterPhoto(); else if (mode === "photo") leaveStill(); break;
    case "replay": if ((mode === "play" || mode === "pause") && rec.length > 30) enterReplay(); else if (mode === "replay") leaveStill(); break;
    case "rollL": doRoll(-1); break;
    case "rollR": doRoll(1); break;
    case "missile": fireMissile(); break;
    case "flip": doFlip(); break;
    case "cobra": doCobra(); break;
    case "immelmann": doImmelmann(); break;
    case "splitS": doSplitS(); break;
    case "view": e.preventDefault(); setView(view === "chase" ? "cockpit" : "chase"); break;
    case "hud":
      if (mode === "title") show("ctlPanel", $("ctlPanel").classList.contains("hidden"));
      else if (mode === "play" || mode === "pause") setHudLevel(hudLevel === "off" ? "min" : hudLevel === "min" ? "full" : "off");
      break;
  }
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => { keys.clear(); pointerBoost = pointerFire = false; if (mode === "play") setMode("pause"); });
document.addEventListener("visibilitychange", () => { if (document.hidden && mode === "play") setMode("pause"); });
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  atmo.u.uAspect.value = innerWidth / innerHeight;
  hud.resize();
});

$("mute").addEventListener("click", () => { setMuted(fx.toggle()); $("mute").blur(); });
$("pause").addEventListener("click", () => { togglePause(); $("pause").blur(); });
$("viewBtn").addEventListener("click", () => { setView(view === "chase" ? "cockpit" : "chase"); $("viewBtn").blur(); });
setView(view);
document.body.dataset.hud = hudLevel;
for (const id of ["ctlToggle", "ctlToggleMob"]) $(id).addEventListener("click", () => { show("ctlPanel", $("ctlPanel").classList.contains("hidden")); $(id).blur(); });
document.querySelectorAll<HTMLButtonElement>(".modes button").forEach((b) => {
  b.addEventListener("click", () => { if (b.dataset.game === "train") startTraining(); else { training = false; setGame(b.dataset.game as Game); startRun(); } b.blur(); });
});
try { if (localStorage.getItem("afterburn-trained") === "1") document.body.classList.add("trained"); } catch {}
// ---------- photo mode and the replay ----------
function enterPhoto() { replayFrom = mode === "play" ? "play" : "pause"; setMode("photo"); }
function enterReplay() {
  replayFrom = mode === "play" ? "play" : "pause";
  live.dist = dist; live.x = jet.group.position.x; live.y = jet.group.position.y; live.rot.copy(jet.group.rotation);
  live.aliveEnemies = combat.enemies.map((e) => e.jet.group.visible); combat.enemies.forEach((e) => { e.jet.group.visible = false; });
  live.ringsVisible = rings[0].m.visible; rings.forEach((r) => { r.m.visible = false; }); orbs.forEach((o) => { o.visible = false; });
  exhaust.clear(); sparks.clear(); smoke.clear();
  replayT = 0; replayPlaying = true;
  setMode("replay");
}
function leaveStill() {
  if (mode === "replay") {
    dist = live.dist; terrain.reset(dist);
    jet.group.position.x = live.x; jet.group.position.y = live.y; jet.group.rotation.copy(live.rot);
    combat.enemies.forEach((e, i) => { e.jet.group.visible = live.aliveEnemies[i]; });
    rings.forEach((r) => { r.m.visible = live.ringsVisible; }); orbs.forEach((o) => { o.visible = true; });
    exhaust.clear(); sparks.clear(); smoke.clear();
  }
  setMode(replayFrom === "play" ? "pause" : "pause");
}
$("photoBtn").addEventListener("click", () => { enterPhoto(); $("photoBtn").blur(); });
$("replayBtn").addEventListener("click", () => { if (rec.length > 30) enterReplay(); else toast("NOTHING TO REPLAY YET"); $("replayBtn").blur(); });
$("photoBack").addEventListener("click", () => leaveStill());
$("replayPlay").addEventListener("click", () => { replayPlaying = !replayPlaying; });
$("photoSave").addEventListener("click", () => {
  // render one frame and hand it over; the viewer's browser decides where it goes
  composer.render();
  canvas.toBlob((b) => {
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = `afterburn-${Date.now()}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
});
$("photo").addEventListener("pointerdown", (e) => e.stopPropagation());
{
  const hold = (id: string, on: () => void, off: () => void) => {
    const el = $(id);
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); on(); });
    el.addEventListener("pointerup", off); el.addEventListener("pointercancel", off);
  };
  hold("tBoost", () => { pointerBoost = true; }, () => { pointerBoost = false; });
  hold("tFire", () => { pointerFire = true; }, () => { pointerFire = false; });
  hold("tBrake", () => { keys.add(key("brake")); }, () => { keys.delete(key("brake")); });
  hold("tRoll", () => { doRoll(touchStick.x < 0 ? -1 : 1); touchRoll = true; }, () => { touchRoll = false; });
  $("tMissile").addEventListener("pointerdown", (e) => { e.preventDefault(); fireMissile(); });
  $("tFlip").addEventListener("pointerdown", (e) => { e.preventDefault(); doFlip(); });
}
// ---------- settings panel ----------
let rebinding: Action | null = null;
function showSettings(on: boolean) { show("settings", on); if (on) renderSettings(); }
function finishRebind(code: string) {
  if (!rebinding) return;
  if (code !== "Escape") { for (const a in settings.keys) if (settings.keys[a as Action] === code) settings.keys[a as Action] = ""; settings.keys[rebinding] = code; }
  rebinding = null; applySettings(); renderSettings();
}
const keyLabel = (code: string) => !code ? "—" : code.replace(/^Key|^Digit/, "").replace("ShiftLeft", "L SHIFT").replace("ShiftRight", "R SHIFT").replace("Space", "SPACE").toUpperCase();
function renderSettings() {
  const rows = $("keyrows");
  rows.innerHTML = "";
  for (const a of Object.keys(KEY_DEFAULTS) as Action[]) {
    const row = document.createElement("div"); row.className = "krow";
    const name = document.createElement("span"); name.textContent = ACTION_NAMES[a];
    const b = document.createElement("button"); b.className = "kbtn" + (rebinding === a ? " wait" : ""); b.textContent = rebinding === a ? "press a key…" : keyLabel(settings.keys[a]);
    b.addEventListener("click", () => { rebinding = a; renderSettings(); });
    row.append(name, b); rows.appendChild(row);
  }
  ($("sMusic") as HTMLInputElement).value = String(Math.round(settings.music * 100));
  ($("sEngine") as HTMLInputElement).value = String(Math.round(settings.engine * 100));
  ($("sFx") as HTMLInputElement).value = String(Math.round(settings.fx * 100));
  ($("sVoice") as HTMLInputElement).value = String(Math.round(settings.voice * 100));
  ($("sCam") as HTMLInputElement).value = String(Math.round(settings.camDist * 100));
  ($("sFov") as HTMLInputElement).value = String(settings.fov);
  ($("sQuality") as HTMLSelectElement).value = settings.quality;
  ($("sMotion") as HTMLSelectElement).value = settings.motion;
  ($("sCb") as HTMLInputElement).checked = settings.cb;
  ($("sLefty") as HTMLInputElement).checked = settings.lefty;
  ($("sHud") as HTMLSelectElement).value = hudLevel;
}
{
  const num = (id: string, f: (v: number) => void) => $(id).addEventListener("input", () => { f(Number(($(id) as HTMLInputElement).value)); applySettings(); });
  num("sMusic", (v) => { settings.music = v / 100; });
  num("sEngine", (v) => { settings.engine = v / 100; });
  num("sFx", (v) => { settings.fx = v / 100; });
  num("sVoice", (v) => { settings.voice = v / 100; });
  num("sCam", (v) => { settings.camDist = v / 100; });
  num("sFov", (v) => { settings.fov = v; });
  $("sQuality").addEventListener("change", () => { settings.quality = ($("sQuality") as HTMLSelectElement).value as Settings["quality"]; if (settings.quality === "auto") setQuality(2); applySettings(); });
  $("sMotion").addEventListener("change", () => { settings.motion = ($("sMotion") as HTMLSelectElement).value as Settings["motion"]; applySettings(); });
  $("sCb").addEventListener("change", () => { settings.cb = ($("sCb") as HTMLInputElement).checked; applySettings(); });
  $("sLefty").addEventListener("change", () => { settings.lefty = ($("sLefty") as HTMLInputElement).checked; applySettings(); });
  $("sHud").addEventListener("change", () => { setHudLevel(($("sHud") as HTMLSelectElement).value as HudLevel); });
  $("sReset").addEventListener("click", () => { settings.keys = { ...KEY_DEFAULTS }; applySettings(); renderSettings(); });
  $("sClose").addEventListener("click", () => showSettings(false));
  for (const id of ["settingsBtn", "settingsBtnPause"]) $(id).addEventListener("click", () => { showSettings(true); $(id).blur(); });
  $("settings").addEventListener("pointerdown", (e) => e.stopPropagation());
}
// ---------- frame-time graph (F3) ----------
let perfOn = false;
const perfTimes = new Float32Array(160); let perfHead = 0;
const perfC = $("perf") as HTMLCanvasElement, perfCtx = perfC.getContext("2d")!;
function drawPerf(ms: number) {
  perfTimes[perfHead] = ms; perfHead = (perfHead + 1) % perfTimes.length;
  const W = perfC.width, H = perfC.height;
  perfCtx.clearRect(0, 0, W, H);
  perfCtx.fillStyle = "rgba(4,8,10,.7)"; perfCtx.fillRect(0, 0, W, H);
  perfCtx.strokeStyle = "rgba(234,246,255,.25)"; perfCtx.beginPath(); perfCtx.moveTo(0, H - 16.7 * 2); perfCtx.lineTo(W, H - 16.7 * 2); perfCtx.stroke();
  let sum = 0, max = 0;
  for (let i = 0; i < perfTimes.length; i++) {
    const v = perfTimes[(perfHead + i) % perfTimes.length]; sum += v; max = Math.max(max, v);
    perfCtx.fillStyle = v > 33 ? "#ff7d9e" : v > 20 ? "#ffb35c" : "#7dffd9";
    perfCtx.fillRect(i * (W / perfTimes.length), H - Math.min(H, v * 2), W / perfTimes.length - 0.5, Math.min(H, v * 2));
  }
  perfCtx.fillStyle = "#eaf6ff"; perfCtx.font = "11px monospace"; perfCtx.fillText(`${(sum / perfTimes.length).toFixed(1)} ms avg · ${max.toFixed(0)} max · q${quality}`, 6, 12);
}
document.body.classList.toggle("coarse", coarse);
applySettings();
matchMedia("(pointer: coarse)").addEventListener("change", (e) => document.body.classList.toggle("coarse", e.matches));
setMuted(fx.muted);
setGame(game);
setMode("title");
cutTo(0);
if (import.meta.env.DEV) (window as any).__knock = (sev = 0.6) => knock(1, sev, "TEST KNOCK");
// dev: stage a wingtip strike without having to find a crystal to clip
if (import.meta.env.DEV) (window as any).__knock = (d = 1, s = 1) => knock(d, s, "TEST STRIKE");
if (import.meta.env.DEV) (window as any).__showDebrief = () => { // dev: the end sheet with a made-up approach, to look at the chart
  approach = { trace: Array.from({ length: 60 }, (_, i) => ({ d: 760 - i * 12.7, agl: Math.max(0, (760 - i * 12.7) * 3.9 * Math.tan(3.2 * Math.PI / 180) + Math.sin(i * 0.5) * 12) })), sink: 1.4, offset: 0.8, speed: 380, grade: "OK-3 · GREASED", bonus: 3600 };
  score = 4218; kills = 7; finishRun("INTERCEPT COMPLETE", true); setMode("dead"); show("dead", true); $("deadGo").classList.add("on");
};
if (import.meta.env.DEV) (window as any).__afterburn = () => ({ mode, phase, shotIdx, shotT, speed, dist, thr: throttleSet, y: yawY.toFixed(2), fps: Math.round(1 / frameAvg), inc: combat.incoming, from: combat.incomingFrom, fired: dbgFired, near: dbgNear, rounds: combat.roundsInFlight(), queued: combat.queued, spawnT: +combat.spawnT.toFixed(1), clearT: +combat.clearT.toFixed(1), cross: combat.lastCross, wave: combat.wave, alive: combat.aliveCount(), up: +upsetT.toFixed(2), dep: +depart.toFixed(2), upr: +upRate.r.toFixed(2), upa: +upAng.r.toFixed(2), ammo: combat.ammo, msl: combat.missilesInFlight(), lock: !!combat.lockPos(), lockT: +combat.lockT.toFixed(2), roll: +rollPhase.toFixed(2), shield, killCam: +killCamT.toFixed(2), kills, view, boosting, boost: +boost.toFixed(2), keys: [...keys], train: trainStep, brake, trainHold: +trainHold.toFixed(2), dt: +(elapsed).toFixed(1), sky: { sunT: +sunT.toFixed(1), midnight: +midnight.toFixed(2), force: midnightForce, blood: +blood.toFixed(2), eclipse: +eclipse.toFixed(2), sunY: +sunDir.y.toFixed(2) }, hudShow: dbgShow, hudDbg: { ...hud.dbg }, banner: $("alertText").textContent, jet: J.position.toArray().map((v) => +v.toFixed(1)), ldist: +landingDist.toFixed(1), gy: +groundAt(J.position.x, 0).toFixed(2), vy: +vel.y.toFixed(2), bank: +bankZ.toFixed(2), cam: camera.position.toArray().map((v) => +v.toFixed(1)), fov: Math.round(camera.fov) });
{ // warm the shaders on the title screen: everything that can appear mid-run gets compiled now, not on its first frame — in slices, with the bar moving
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  const items = scene.children.slice();
  let i = 0;
  const fill = $("loaderFill"), label = $("loaderText");
  const step = () => {
    const t0 = performance.now();
    while (i < items.length && performance.now() - t0 < 24) { renderer.compile(items[i], camera, scene); i++; }
    fill.style.width = `${Math.round(i / items.length * 100)}%`;
    label.textContent = i < items.length ? `COMPILING ${Math.round(i / items.length * 100)}%` : "READY";
    if (i < items.length) requestAnimationFrame(step);
    else { for (const o of hidden) o.visible = false; $("loader").classList.add("gone"); startLoop(); }
  };
  requestAnimationFrame(step);
}
{
  const q = new URLSearchParams(location.search);
  if (q.has("shot")) cutTo(clamp(Number(q.get("shot")) || 0, 0, SHOTS.length - 1)); // jump the title reel to a shot
  if (q.has("midnight")) { sunT = 339 - 20; midnightForce = 0; }
  if (q.has("blood")) { sunT = 360 + 339 - 20; midnightForce = 0; }
  if (q.has("eclipse")) { sunT = 159 - 24; midnightForce = 0; }
  if (q.has("rtb")) { setGame("war"); startRun(); combat.skipToRTB(); }
  else if (q.has("fly")) startRun();
  if (q.has("laser")) { if (document.body.dataset.mode !== "play") startRun(); laserEarned = true; powerT = 0; laserT = LASER_TIME; $("laserwrap").classList.add("on"); }
  if (q.has("at")) { // start partway round the course, e.g. ?fly&at=3500
    if (document.body.dataset.mode !== "play") startRun();
    dist = Number(q.get("at")) || 0; terrain.reset(dist);
    const gy0 = groundAt(0, 0); jet.group.position.y = gy0 + 0.42; runway.position.y = gy0 + 0.02;
  }}

// ---------- radar: you at the centre, ahead is up, bandits red, the locked one ringed ----------
const THREAT_MARKS = 10;
const threatEls = Array.from({ length: THREAT_MARKS }, () => { const el = document.createElement("div"); el.className = "rnd"; $("hudmarks").appendChild(el); return el; });
const radar = $("radar") as HTMLCanvasElement;
const rctx = radar.getContext("2d")!;
function drawRadar() {
  const S = radar.width, c = S / 2, R = c - 4, range = 150;
  rctx.clearRect(0, 0, S, S);
  rctx.fillStyle = "rgba(5,3,12,.55)";
  rctx.beginPath(); rctx.arc(c, c, R, 0, Math.PI * 2); rctx.fill();
  rctx.strokeStyle = "rgba(234,246,255,.18)"; rctx.lineWidth = 1;
  for (const f of [0.33, 0.66, 1]) { rctx.beginPath(); rctx.arc(c, c, R * f, 0, Math.PI * 2); rctx.stroke(); }
  rctx.beginPath(); rctx.moveTo(c, 4); rctx.lineTo(c, S - 4); rctx.moveTo(4, c); rctx.lineTo(S - 4, c); rctx.stroke();
  // sweep
  const a = (elapsed * 1.6) % (Math.PI * 2);
  const grad = rctx.createConicGradient(a, c, c);
  grad.addColorStop(0, "rgba(125,255,217,.35)"); grad.addColorStop(0.15, "rgba(125,255,217,0)"); grad.addColorStop(1, "rgba(125,255,217,0)");
  rctx.fillStyle = grad; rctx.beginPath(); rctx.arc(c, c, R, 0, Math.PI * 2); rctx.fill();
  const px = jet.group.position.x, pz = jet.group.position.z;
  const plot = (x: number, z: number) => {
    let dx = (x - px) / range * R, dz = (z - pz) / range * R;
    const d = Math.hypot(dx, dz);
    if (d > R - 3) { dx *= (R - 3) / d; dz *= (R - 3) / d; }
    return { x: c + dx, y: c + dz, clamped: d > R - 3 };
  };
  if (power.visible) { const p = plot(power.position.x, power.position.z); rctx.fillStyle = "#bfffff"; rctx.beginPath(); rctx.moveTo(p.x, p.y - 4); rctx.lineTo(p.x + 4, p.y); rctx.lineTo(p.x, p.y + 4); rctx.lineTo(p.x - 4, p.y); rctx.fill(); }
  if (runway.visible && phase === "landing") { const p = plot(0, runway.position.z - RUNWAY_LEN / 2); rctx.fillStyle = "rgba(255,210,125,.9)"; rctx.fillRect(p.x - 2, p.y - 6, 4, 12); }
  for (const k of combat.contacts()) {
    const p = plot(k.x, k.z);
    rctx.fillStyle = k.tele ? "#fff0d0" : k.head ? "#ffb35c" : "#ff4a5a";
    rctx.beginPath(); rctx.arc(p.x, p.y, p.clamped ? 2.5 : 3.5, 0, Math.PI * 2); rctx.fill();
    if (k.locked) { rctx.strokeStyle = "#ff7d9e"; rctx.lineWidth = 1.5; rctx.beginPath(); rctx.arc(p.x, p.y, 7, 0, Math.PI * 2); rctx.stroke(); }
    if (k.z > 3) { rctx.strokeStyle = "rgba(255,74,90,.6)"; rctx.beginPath(); rctx.moveTo(c, c); rctx.lineTo(p.x, p.y); rctx.stroke(); }
  }
  rctx.fillStyle = "#eaf6ff";
  rctx.beginPath(); rctx.moveTo(c, c - 6); rctx.lineTo(c + 4.5, c + 5); rctx.lineTo(c, c + 2.5); rctx.lineTo(c - 4.5, c + 5); rctx.closePath(); rctx.fill();
}

// ---------- helpers for the loop ----------
function project(p: THREE.Vector3): { x: number; y: number; on: boolean } {
  _c.copy(p).project(camera);
  return { x: (_c.x + 1) / 2 * innerWidth, y: (1 - _c.y) / 2 * innerHeight, on: _c.z < 1 && Math.abs(_c.x) < 1.2 && Math.abs(_c.y) < 1.2 };
}
function scrollWorld(dz: number) {
  terrain.scroll(dz);
  rings.forEach((r) => { r.m.position.z += dz; });
  orbs.forEach((o) => { o.position.z += dz; });
  spires.forEach((s) => { s.m.position.z += dz; });
  shards.forEach((s) => { s.position.z += dz; });
  runway.position.z += dz;
  if (runway.visible && runway.position.z > RUNWAY_LEN + 80 && phase !== "landed") runway.visible = false;
}
const combatEvents = {
  onPlayerHit: () => hurt("HIT", 0.8),
  onCollision: (p2: THREE.Vector3) => { hurt("MIDAIR COLLISION", 1.8); knock(Math.sign(jet.group.position.x - p2.x || 1), 1, ""); shake = Math.max(shake, 1.6); fx.boom(0.7); },
  onNearMiss: (p: THREE.Vector3, fromBehind: boolean) => {
    // the crack of a round going past: louder the closer it was, a jolt, and the red edge for a moment
    const d = Math.hypot(p.x - jet.group.position.x, p.y - jet.group.position.y); dbgNear++;
    fx.crack(clamp(1.4 - d * 0.25, 0.3, 1)); shake = Math.max(shake, 0.22);
    nearMissT = 0.35; nearMissFrom = fromBehind ? "BEHIND" : "AHEAD";
  },
  onKill: (p: THREE.Vector3, byMissile: boolean) => {
    kills++; streak++; maxStreak = Math.max(maxStreak, streak);
    if (streak === LASER_KILLS) offerLaser("4 KILL STREAK");
    if (byMissile && killCamCd <= 0 && phase === "fly" && mode === "play") { killCamT = 0.6; killCamCd = 5; killCamP.copy(p); killCamSide = p.x > jet.group.position.x ? -1 : 1; }
    const gain = (byMissile ? 200 : 300) * Math.min(streak, 5);
    score += gain; boost = Math.min(1, boost + 0.15);
    fx.boom(0.5); shake = Math.max(shake, 0.4);
    toast(`SPLASH ${kills === 1 ? "ONE" : String(kills)} +${gain}`);
    radio.call(`Splash ${["one", "two", "three", "four", "five", "six", "seven", "eight"][Math.min(kills, 8) - 1] || kills}.`, 1);
    pulse("score", "pop");
    void p;
  },
  onWaveClear: (w: number) => { toast(`WAVE ${w} CLEAR`, "hot"); fx.chime(1100); objective(w < FINAL_WAVE ? "STAND BY FOR NEXT WAVE" : ""); radio.call(w < FINAL_WAVE ? "Picture clean. Stand by." : "Picture clean. Come home.", 1); },
  onRearm: () => { pulse("missiles", "pop"); fx.chime(1250); setTimeout(() => { if (mode === "play") toast("MISSILE ON THE RAIL", "hot"); }, 900); },
  onEnemyFire: (_p: THREE.Vector3, fromBehind: boolean) => { dbgFired++; fx.enemyGun(fromBehind ? 1 : 0.6); if (fromBehind) breakT = 1.2; },
  onRearTelegraph: () => { fx.alarm(); setTimeout(() => fx.alarm(), 330); setTimeout(() => fx.alarm(), 660); breakT = 1.6; },
  onRTB: () => {
    phase = "landing"; phaseT = 0; landingDist = 760;
    runway.position.set(0, groundAt(0, -landingDist) + 0.02, -landingDist);
    runway.visible = true;
    toast("RETURN TO BASE", "hot"); fx.chime(900);
    radio.call("Return to base. Runway ahead, call the ball.", 1);
    objective("RTB · LINE UP ON THE RUNWAY AND FLARE");
  },
  toast,
};

// ---------- the loop ----------
const clock = new THREE.Clock();
function setQuality(q: number) {
  quality = q;
  const hasBloom = composer.passes.includes(bloom);
  if (q >= 2) { if (!hasBloom && !coarse) composer.insertPass(bloom, 1); renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2)); }
  else { if (hasBloom) composer.removePass(bloom); sea.visible = false; terrain.water.visible = true; seaOn = false; renderer.setPixelRatio(q === 1 ? 1 : 0.75); }
  composer.setSize(innerWidth, innerHeight);
}
function stepQualityDown() {
  if (settings.quality !== "auto") return;
  setQuality(quality - 1);
  toast("PERFORMANCE MODE", "hot");
}
if (new URLSearchParams(location.search).has("low")) { quality = 2; stepQualityDown(); }

let loopStarted = false;
function startLoop() { if (loopStarted) return; loopStarted = true; clock.getDelta(); renderer.setAnimationLoop(frame); }
function frame() {
  const rawFrame = clock.getDelta();
  if (perfOn) drawPerf(rawFrame * 1000);
  const raw = Math.min(rawFrame, 0.05);
  let dt = raw * timeScale;
  elapsed += dt;
  // if the machine can't hold ~40 fps in play, drop bloom then resolution; input lag reads as sluggish controls
  frameAvg += (Math.min(rawFrame, 0.1) - frameAvg) * 0.02; // slow average so a single hitch doesn't trip it
  if (mode === "play" && runT > 6 && quality > 0 && frameAvg > 0.03) { stepQualityDown(); frameAvg = 1 / 60; }

  // palette drift (frozen while paused so the dream waits for you)
  if (mode !== "pause") palTimer += dt;
  if (palTimer > 28) {
    palTimer = 0; palIdx = (palIdx + 1) % PALETTES.length;
    if (mode === "play") showBiome(PALETTES[palIdx].name);
  }
  const P = PALETTES[palIdx];
  const L = 1 - Math.pow(0.3, dt);
  {
    const ph = sunT * TAU / 360 - 1.2;
    const natural = clamp((-Math.sin(ph) - 0.62) / 0.3, 0, 1);
    midnight = lerp(midnight, Math.max(natural, midnightForce), 1 - Math.pow(0.5, raw));
    const cycle = Math.floor((sunT + 21) / 360);
    blood = lerp(blood, midnightForce > 0 ? 0 : cycle % 3 === 1 ? 1 : 0, 1 - Math.pow(0.5, raw));
    // eclipse: a smooth bump 18 s either side of the sun's high point, on even cycles
    const high = ((sunT % 360) + 360) % 360, dHigh = Math.abs(high - 159);
    const eNat = cycle % 2 === 0 ? sm01(20, 6, dHigh) : 0;
    eclipse = lerp(eclipse, eNat, 1 - Math.pow(0.3, raw));
    sky.setEclipse(eclipse);
    if (mode === "play" && eclipse > 0.5 && !eclipseCalled) { eclipseCalled = true; toast("SOLAR ECLIPSE", "hot"); radio.call("The sun's going out.", 0); }
    if (eclipse < 0.2) eclipseCalled = false;
    if (mode === "play" && midnight > 0.6 && !midnightCalled) { midnightCalled = true; toast(blood > 0.5 ? "MIDNIGHT · BLOOD MOON" : "MIDNIGHT · FULL MOON", "hot"); radio.call(blood > 0.5 ? "That moon is red." : "Look at that moon.", 0); }
    if (midnight < 0.2) midnightCalled = false;
  }
  const tone = (a: number, b: number, c: number) => new THREE.Color(a).lerp(new THREE.Color(b).lerp(new THREE.Color(c), blood), midnight * 0.9).multiplyScalar(1 - eclipse * 0.45);
  cur.sky.lerp(tone(P.sky, MID.sky, BLOOD.sky), L); cur.fog.lerp(tone(P.fog, MID.fog, BLOOD.fog), L);
  cur.ground.lerp(tone(P.ground, MID.ground, BLOOD.ground), L); cur.peak.lerp(tone(P.peak, MID.peak, BLOOD.peak), L);
  cur.peakAlt.lerp(tone(P.peakAlt, MID.peakAlt, BLOOD.peakAlt), L); cur.island.lerp(tone(P.island, MID.island, BLOOD.island), L);
  cur.glowA.lerp(tone(settings.cb ? 0x6fc3ff : P.glowA, MID.glowA, BLOOD.glowA), L); cur.glowB.lerp(tone(settings.cb ? 0xffb35c : P.glowB, MID.glowB, BLOOD.glowB), L);
  sky.setMidnight(midnight, blood);
  moonLight.position.copy(sky.moonDir).multiplyScalar(80);
  moonLight.intensity = 1.8 * midnight;
  moonLight.color.set(0xcfdcff).lerp(new THREE.Color(0xff5a3a), blood);
  (scene.fog as THREE.Fog).color.copy(cur.fog);
  terrainU.uLow.value.copy(cur.ground); terrainU.uMid.value.copy(cur.peak); terrainU.uHigh.value.copy(cur.peakAlt);
  terrainU.uSnow.value.copy(cur.glowA).lerp(WHITE, 0.7).multiplyScalar(0.95);
  matRock.color.copy(cur.island);
  matGrass.color.copy(cur.island).lerp(new THREE.Color(0x3f8a48), 0.55);
  matRing.color.copy(cur.glowA); matRing.emissive.copy(cur.glowA);
  matOrb.color.copy(cur.glowB); matOrb.emissive.copy(cur.glowB);
  matSpire.emissive.copy(cur.glowB);
  hemi.color.copy(cur.glowB).lerp(WHITE, 0.4); hemi.groundColor.copy(cur.ground);
  fill.color.copy(cur.glowA).lerp(WHITE, 0.5);
  terrain.tick();
  // the sky probe: refreshed every few frames so the skin follows the palette; the mirror sea only where there is a sea
  if (envFrame++ % 6 === 0) { envCam.position.copy(camera.position); envCam.update(renderer, scene); }
  {
    const wantSea = quality >= 2 && !coarse && regionAt(terrain.courseAt(-60)).lake > 0.08;
    if (wantSea !== seaOn) { seaOn = wantSea; sea.visible = wantSea; terrain.water.visible = !wantSea; }
    seaU.uTime.value = elapsed;
    seaU.uDeep.value.copy(cur.sky).lerp(cur.glowA, 0.12).multiplyScalar(0.9);
    seaU.uGlow.value.copy(cur.glowB).lerp(WHITE, 0.4);
  }

  const g = jet.group;
  const playing = mode === "play";
  const still = mode === "photo" || mode === "replay";
  const scroll = (playing || mode === "dead" || mode === "title") ? speed * dt : 0;
  if (still) { dt = 0; }
  if (mode === "replay" && rec.length > 1) {
    if (replayPlaying) replayT += raw;
    const tMax = (rec.length - 1) / 60;
    if (replayT > tMax) { replayT = tMax; replayPlaying = false; }
    const fi = replayT * 60, i0 = Math.floor(fi), i1 = Math.min(rec.length - 1, i0 + 1), f = fi - i0;
    const a = rec[i0], b = rec[i1];
    const nd = lerp(a.dist, b.dist, f);
    terrain.scroll(nd - dist); dist = nd;
    g.position.set(lerp(a.x, b.x, f), lerp(a.y, b.y, f), 0);
    g.rotation.set(lerp(a.pitch, b.pitch, f), lerp(a.yaw, b.yaw, f), lerp(a.roll, b.roll, f), "YXZ");
    jet.update(raw, elapsed, lerp(a.throttle, b.throttle, f), lerp(a.boost, b.boost, f));
    emitExhaust(jet, exhaust, raw, lerp(a.throttle, b.throttle, f), lerp(a.boost, b.boost, f), lerp(a.speed, b.speed, f));
    exhaust.update(raw, 0);
    $("replayBar").style.width = `${(replayT / tMax) * 100}%`;
    $("replayPlay").textContent = replayPlaying ? "⏸" : "▶";
  }

  // the sun's slow arc: elevation breathes over six minutes, azimuth drifts over nine
  if (mode !== "pause") sunT += raw;
  {
    const el = 0.1 + 0.42 * (0.5 + 0.5 * Math.sin(sunT * TAU / 360 - 1.2));
    const az = -0.32 + 0.5 * Math.sin(sunT * TAU / 540);
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    sky.setSun(sunDir); deck.sunDir.copy(sunDir);
    sun.position.copy(sunDir).multiplyScalar(80);
    flare.position.copy(sunDir).multiplyScalar(520);
    // low sun: warmer, dimmer; high sun: cleaner, brighter
    sunCol.copy(cur.glowB).lerp(WHITE, 0.55 + el * 0.6).lerp(new THREE.Color(0xffb070), Math.max(0, 0.3 - el) * 1.5).lerp(new THREE.Color(0xdfe8ff), midnight * 0.9);
    sun.color.copy(sunCol);
    flareCol.copy(sunCol).multiplyScalar(0.55);
  }
  // ambient life; the cloud deck, and what altitude does to the light
  sky.update(dt, elapsed, scroll, cur);
  deck.update(scroll, dist, camera.position.y, cur.fog, cur.glowB, sunCol);
  deck.castShadow(g.position.x, g.position.y, g.position.z, dist);
  cloudDens = deck.density(g.position.x, g.position.y, dist);
  aboveMix = lerp(aboveMix, camera.position.y > DECK_Y + DECK_HALF - 2 ? 1 : 0, 1 - Math.pow(0.1, raw));
  sky.above(aboveMix);
  sun.intensity = (1.5 + sunDir.y * 1.4 + aboveMix * 1.1) * (1 - midnight * 0.55) * (1 - eclipse * 0.88);
  hemi.intensity = (1.0 + sunDir.y * 0.4) * (1 - midnight * 0.35) * (1 - eclipse * 0.6);
  ambient.intensity = 0.22 * (1 - eclipse * 0.6);
  flare.visible = eclipse < 0.5;
  deck.sunDir.lerp(sky.moonDir, midnight * 0.8).normalize();
  renderer.toneMappingExposure = (1.0 + sunDir.y * 0.18 + aboveMix * 0.12) * (1 - eclipse * 0.3);
  {
    const f = scene.fog as THREE.Fog;
    f.near = lerp(f.near, lerp(50, 3, cloudDens), 1 - Math.pow(0.02, raw));
    f.far = lerp(f.far, lerp(340 + aboveMix * 120, 45, cloudDens), 1 - Math.pow(0.02, raw));
    setFogOn(f.near + 10, f.far);
    $("cloudfx").style.opacity = String(Math.min(0.85, cloudDens * 0.95));
    $("cloudfx").style.background = `#${cur.fog.clone().lerp(WHITE, 0.55).getHexString()}`;
  }
  terrain.waterMat.color.copy(cur.sky).lerp(cur.glowA, 0.18);
  terrain.waterMat.emissive.copy(cur.fog).lerp(cur.glowB, 0.15).multiplyScalar(0.35);
  if (terrain.waterMat.normalMap) { terrain.waterMat.normalMap.offset.y -= scroll / (SEG * 2 + 8) * 20 + raw * 0.05; terrain.waterMat.normalMap.offset.x += raw * 0.08; }
  whales.forEach((w, i) => {
    w.position.z += scroll * 0.25 + dt * 2;
    w.position.y += Math.sin(elapsed * 0.5 + i * 2) * dt * 1.6;
    w.rotation.x = Math.sin(elapsed * 0.5 + i * 2) * 0.08;
    if (w.position.z > 60) { w.position.z = -300 - rnd(i + elapsed) * 80; w.position.x = (rnd(elapsed * 7 + i) - 0.5) * 160; w.position.y = 16 + rnd(elapsed + i * 3) * 30; }
  });

  if (playing) {
    // the recorder: the jet's own track, a sample a frame, twenty seconds deep
    rec.push({ dist, x: g.position.x, y: g.position.y, pitch: g.rotation.x, yaw: g.rotation.y, roll: g.rotation.z, throttle, boost: boosting ? 1 : 0, speed });
    if (rec.length > REC_MAX) rec.splice(0, rec.length - REC_MAX);
  }
  if (killCamCd > 0) killCamCd -= raw;
  if (killCamT > 0) { killCamT -= raw; killCamP.z += scroll; if (mode === "play") timeScale = killCamT <= 0 ? 1 : 0.38; }
  if (playing) {
    runT += dt; phaseT += dt;

    // ---- stick / cursor ----
    const kx = (keys.has("ArrowLeft") ? -1 : 0) + (keys.has("ArrowRight") ? 1 : 0);
    const ky = (keys.has("ArrowUp") ? -1 : 0) + (keys.has("ArrowDown") ? 1 : 0);
    // W/S walk the throttle, A/D are rudder: the nose skids and the jet slides that way without banking
    const thr = (held("thrUp") ? 1 : 0) - (held("thrDown") ? 1 : 0);
    if (thr) throttleSet = clamp(throttleSet + thr * dt * 0.7, 0.4, 1);
    const rud = (held("rudR") ? 1 : 0) - (held("rudL") ? 1 : 0);
    rudder = lerp(rudder, phase === "fly" ? rud : 0, 1 - Math.pow(0.01, dt));
    if (kx) keyStick.x = clamp(keyStick.x + kx * dt * 1.6, -1, 1);
    if (ky) keyStick.y = clamp(keyStick.y + ky * dt * 1.6, -1, 1);
    // a little smoothing on the cursor so hand jitter doesn't become airframe wobble
    const sm = 1 - Math.pow(0.0001, dt);
    smooth.x += (clamp(mouseStick.x + keyStick.x, -1, 1) - smooth.x) * sm;
    smooth.y += (clamp(mouseStick.y + keyStick.y, -1, 1) - smooth.y) * sm;
    const cur2 = smooth;

    // ---- throttle, boost, airbrake, energy ----
    if (flipCd > 0) flipCd -= dt;
    brake = phase === "fly" && (held("brake") || keys.has("ShiftRight") || flipT >= 0 || cobraT >= 0);
    rollHeld = held("rollL") || held("rollR") || rmbHeld || touchRoll;
    boosting = phase !== "landed" && !brake && (held("boost") || pointerBoost) && boost > 0.02;
    // FLIGHT is the joyride: the burner never runs dry. In a sortie the meter is real.
    if (game === "flight") boost = 1;
    else if (boosting) boost = Math.max(0, boost - dt * 0.34);
    else boost = Math.min(1, boost + dt * 0.055);
    // height is airspeed you have not spent yet: a dive pays it out, a climb buys it back
    energy = clamp((energy - vel.y * dt * 0.085) * Math.max(0, 1 - dt * 0.42), -10, 22);
    const ramp = Math.min(24, dist / 900);
    let target = (28 + ramp) * (0.55 + 0.45 * throttleSet) + energy + (boosting ? 36 : 0);
    if (immT >= 0) target *= 0.7;
    if (brake) target *= 0.42;
    if (flipT >= 0) target = 2; // the circle-back: you stop going forward, the world doesn't
    if (cobraT >= 0) target = Math.min(target, 9); // hung on the nose: nearly all the airspeed goes
    if (splitT >= 0) target += 16;
    if (phase === "takeoff") target = 34;
    if (phase === "landed") target = 0;
    const k = flipT >= 0 ? 1 - Math.pow(0.02, dt) : brake ? 1 - Math.pow(0.08, dt) : phase === "landed" ? 1 - Math.pow(0.35, dt) : 1 - Math.pow(0.12, dt);
    // reversal gesture: airbrake plus a hard pull-up
    if (brake && flipT < 0 && flipCd <= 0 && phase === "fly" && (coarse ? touchStick.y < -0.6 : cur2.y < -0.55)) doFlip();
    // airbrake plus a hard push-down: split-S
    if (brake && !busy() && phase === "fly" && !coarse && cur2.y > 0.78) doSplitS();
    mouseVX *= Math.pow(0.001, dt);
    speed += (target - speed) * k;
    throttle = lerp(throttle, phase === "landed" ? 0 : brake ? 0.25 : 0.55 + Math.min(1, speed / 60) * 0.45, 1 - Math.pow(0.05, dt));
    dist += speed * dt;
    if (phase === "fly" || phase === "landing") score += speed * dt * 0.8;
    topSpeed = Math.max(topSpeed, speed);
    maxAlt = Math.max(maxAlt, g.position.y + 1.58);
    fx.setEngine(speed, boosting ? 1 : 0);
    fx.setWind(speed, clamp(-vel.y / V_MAX_Y, 0, 1));

    // ---- flight model: stick commands turn rate; velocity integrates ----
    const rollAngle = rollStep(dt);
    const gy = groundAt(g.position.x, 0);
    if (phase === "takeoff") {
      // roll down the runway, rotate, climb out
      g.position.y = gy + 0.42;
      vel.set(0, 0);
      if (speed > 24) { pitchX = lerp(pitchX, 0.22, 1 - Math.pow(0.1, dt)); }
      if (speed > 27 && phaseT > 2.2) { phase = "fly"; phaseT = 0; vel.y = 7; toast("ROTATE"); fx.whoosh(); }
      if (phaseT > 1.2 && phaseT - dt <= 1.2) toast("V1");
    } else {
      // faster = wider turns, like a real jet; brake tightens them; a shot-up jet answers slower
      const agility = (1 - (boosting ? 0.08 : 0) - (brake ? 0.2 : 0)) * (shield === 1 ? 0.82 : 1) * (1 - depart * 0.65);
      let vxT: number, vyT: number;
      if (coarse) { // thumb-stick: rate control
        vxT = touchStick.x * V_MAX_X * agility; vyT = -touchStick.y * V_MAX_Y * agility;
      } else {      // cursor: fly toward the pointed-at spot in the envelope
        // full-down is a real dive; the curve keeps fine control low down, where landings and valleys live
        const u = (1 - cur2.y) / 2;
        const tx = cur2.x * X_MAX, ty = gy - 2 + (Y_MAX - 3 - (gy - 2)) * Math.pow(u, 1.7);
        vxT = clamp((tx - g.position.x) * CURSOR_GAIN, -V_MAX_X, V_MAX_X) * agility;
        vyT = clamp((ty - g.position.y) * CURSOR_GAIN, -V_MAX_Y, V_MAX_Y) * agility;
      }
      if (phase === "fly" && phaseT < 1.2) vyT = Math.max(vyT, 5); // climb-out
      /* The corkscrew. Through a roll the lift vector goes round with the wings, so
         the commanded acceleration swings from up, to the side, to down and back —
         which is what turns a roll into a barrel roll and carries the jet bodily off
         its line. The sin(phase/2) term is the pull you hold through it; without it
         the jet would sag out the bottom, because half the roll has no lift under it. */
      if (rollT >= 0) {
        const a = rollPhase, blend = rollCount > 0 ? 1 : Math.min(1, rollT * 4);
        vxT += Math.sin(a) * rollDir * 34 * blend;
        vyT += ((Math.cos(a) - 1) * 15 + Math.sin(a * 0.5) * 20) * blend;
      }
      // a departure is real bank: the lift vector is over on its side and drags the flight path with it
      if (depart > 0.01) { vxT += -Math.sin(upAng.r) * 17 * depart; vyT += (Math.cos(upAng.r) - 1) * 9 * depart; }
      if (cobraT >= 0) { vxT *= 0.25; vyT = vyT * 0.25 + 2.5; }
      if (splitT >= 0) { const e = splitT; vyT = e < 0.15 ? vyT * 0.3 : e < 0.68 ? -15 : 11; vxT *= 0.35; }
      if (immT >= 0) { const e = immT; vyT = e < 0.7 ? 24 : 6; vxT *= 0.35; }
      vxT += rudder * 9; // the skid
      // soft walls at the edge of the envelope
      if (Math.abs(g.position.x) > X_MAX - 8) vxT -= (Math.abs(g.position.x) - (X_MAX - 8)) * 3 * Math.sign(g.position.x);
      if (g.position.y > Y_MAX - 8) vyT -= (g.position.y - (Y_MAX - 8)) * 3;
      const resp = 1 - Math.pow(0.00025, dt); // ~0.12 s response
      vel.x += (vxT - vel.x) * resp;
      vel.y += (vyT - vel.y) * resp;
      g.position.x += vel.x * dt;
      g.position.y += vel.y * dt;
      g.position.x = clamp(g.position.x, -X_MAX, X_MAX);
      g.position.y = Math.min(g.position.y, Y_MAX);

      // ground
      const floor = gy + 0.42;
      if (g.position.y < floor) {
        const onRunway = runway.visible && Math.abs(g.position.x) < RUNWAY_W / 2 && runway.position.z > 0 && runway.position.z - RUNWAY_LEN < 0;
        if (phase === "landing" && onRunway && vel.y > -7 && Math.abs(bankZ) < 0.5) {
          phase = "landed"; phaseT = 0; g.position.y = floor;
          const smooth = vel.y > -2.5 ? "GREASED IT" : "TOUCHDOWN";
          const bonus = 1500 + Math.round(Math.max(0, 7 + vel.y) * 300);
          const sinkAtTouch = vel.y; vel.set(0, 0); vel.y = sinkAtTouch; // keep the sink for the record below, zero the rest
          score += bonus; toast(`${smooth} +${bonus}`, "hot"); fx.touchdown(); shake = 0.5;
          approach ??= { trace: [], sink: 0, offset: 0, speed: 0, grade: "", bonus: 0 };
          approach.sink = -vel.y * 3.9; approach.offset = g.position.x * 3.9; approach.speed = speed * 14; approach.bonus = bonus;
          approach.grade = vel.y > -2.5 && Math.abs(g.position.x) < 2 ? "OK-3 · GREASED" : vel.y > -5 ? "FAIR" : "HARD";
          vel.set(0, 0);
          radio.call(vel.y > -2.5 ? "Greased it. Welcome home." : "Wheels down. Welcome home.", 1);
          objective("");
        } else if (phase === "landed") {
          g.position.y = floor;
        // a wing down means the wrapped bank, not the raw one: a departure that has rolled
        // all the way through and settled is wings-level, whatever the angle has wound up to
        } else if (vel.y < -13 || Math.abs(bankZ + upAng.r - Math.round(upAng.r / TAU) * TAU) > 1.0) {
          // nose-first or wing-first into the ground: nothing survives that
          g.position.y = floor + 0.2; iframes = 0; deathCause = "TERRAIN";
          toast("TERRAIN", "bad"); die();
        } else {
          // belly scrape (or a splash): skip off it, bleed energy, lose a shield
          const wet = terrain.terrainAt(g.position.x, 0) < WATER_Y - 0.1;
          g.position.y = floor + 0.05; vel.y = Math.max(-vel.y * 0.35, 4); energy = Math.max(-8, energy - (wet ? 9 : 6));
          _p.set(g.position.x, g.position.y - 0.3, g.position.z);
          for (let k = 0; k < 4; k++) sparkHit(sparks, _p);
          if (wet) for (let k = 0; k < 30; k++) smoke.emit(_p, _c.set((Math.random() - 0.5) * 10, 3 + Math.random() * 8, speed * 0.3), { life: 0.9, size0: 0.6, size1: 2.5, c0: WHITE, c1: cur.fog, drag: 1.5, alpha: 0.6 });
          hurt(onRunway ? "HARD LANDING" : wet ? "SPLASHDOWN" : "GROUND SCRAPE", 0.7);
          if (!onRunway) { upsetT = Math.max(upsetT, 0.7); upRate.r += (Math.random() - 0.5) * 5; upRate.y += (Math.random() - 0.5) * 1.5; }
        }
      }
      // ground proximity: sinking fast into terrain that is close gets the two-tone and the call
      if (phase === "fly") {
        const aglU = g.position.y - floor, sinking = vel.y < -6 && aglU / Math.max(1, -vel.y) < 1.4;
        if (sinking && aglU < 14) { gpwsT -= dt; if (gpwsT <= 0) { gpwsT = 1.1; fx.gpws(); radio.call("Pull up!", 2); } } else gpwsT = Math.min(gpwsT, 0.2);
      }
      /* Low and fast, the aeroplane disturbs whatever it is over: dust off dry
         ground, spray off the sea, a plume of snow off the high ridges. */
      if ((phase === "fly" || phase === "landing") && speed > 16 && phaseT > 1.5) {
        const agl = g.position.y - floor;
        if (agl < 2.6) {
          const k = (1 - agl / 2.6) * Math.min(1, speed / 30);
          const wet = terrain.terrainAt(g.position.x, 0) < WATER_Y - 0.1, snow = gy > 21;
          if (Math.random() < k * dt * 22) {
            _p.set(g.position.x + (Math.random() - 0.5) * 2.4, gy + 0.2, g.position.z + 0.8 + Math.random() * 1.5);
            if (wet) smoke.emit(_p, _c.set((Math.random() - 0.5) * 8, 2 + Math.random() * 4 * k, speed * 0.25 + 2), { life: 0.4 + Math.random() * 0.35, size0: 0.25, size1: 1.3, c0: WHITE, c1: WHITE, drag: 2.4, alpha: 0.14 * k });
            else if (snow) smoke.emit(_p, _c.set((Math.random() - 0.5) * 5, 1 + Math.random() * 2.5, speed * 0.22 + 1), { life: 0.7 + Math.random() * 0.5, size0: 0.3, size1: 1.8, c0: WHITE, c1: cur.fog, drag: 1.8, alpha: 0.12 * k });
            else smoke.emit(_p, _c.set((Math.random() - 0.5) * 6, 0.8 + Math.random() * 2, speed * 0.26 + 1), { life: 0.9 + Math.random() * 0.6, size0: 0.35, size1: 2.2, c0: _c2.copy(cur.ground).lerp(WHITE, 0.35), c1: cur.fog, drag: 1.6, alpha: 0.1 * k });
          }
        }
      }
      if (phase === "landed") {
        // wheels down: the stick no longer flies anything, so the camera, g haze and wind must not read a climb it keeps asking for
        g.position.y = floor; vel.set(0, 0);
        pitchX = lerp(pitchX, -0.02, 1 - Math.pow(0.1, dt));
        if (speed < 1.5 && !deadDone) { deadDone = true; setMode("dead"); deadT = 0; finishRun(training || game === "flight" ? "FIRST FLIGHT COMPLETE" : "INTERCEPT COMPLETE", true); fx.chime(1300); training = false; }
      } else {
        /* Attitude. The nose sits on the flight path plus the angle of attack the
           wing is carrying, so the same climb rate is a steep attitude when slow and
           a shallow one when fast — dive and the nose comes down and stays down,
           pull and the jet stands on its tail. Bank still answers the hand at once. */
        const fpa = Math.atan2(vel.y, Math.max(20, speed));
        const aoa = clamp(vyT * 0.0072 + (brake ? 0.12 : 0), -0.24, 0.36);
        bankZ = lerp(bankZ, clamp(-vxT * 0.019 - vel.x * 0.017, -1.5, 1.5), 1 - Math.pow(0.006, dt));
        pitchX = lerp(pitchX, clamp(fpa + aoa, -1.05, 1.15) + (brake && cobraT < 0 ? 0.3 : 0), 1 - Math.pow(0.004, dt));
        yawY = lerp(yawY, -vel.x * 0.012 - rudder * 0.42, 1 - Math.pow(0.01, dt));
      }
    }
    /* The departure runs itself down. Rates decay against an aerodynamic restoring
       moment whose target for roll is the nearest upright, so a hard hit rolls all
       the way through and settles wings-level the short way round instead of
       winding back. Stick against the roll doubles the damping; once the rates are
       small the wings bite again and it stiffens up. */
    {
      const level = Math.round(upAng.r / TAU) * TAU;
      if (upsetT > 0) upsetT -= dt;
      const counter = Math.sign(-upRate.r) === Math.sign(cur2.x) && Math.abs(cur2.x) > 0.22 ? 1 : 0;
      const damp = 3.2 + counter * 2.8 + (upsetT > 0 ? 0 : 1.6);
      const stiff = upsetT > 0 ? 3.6 : 8;
      upRate.r += (-(upAng.r - level) * stiff - upRate.r * damp) * dt;
      upRate.p += (-upAng.p * (stiff + 4) - upRate.p * (damp + 1.5)) * dt;
      upRate.y += (-upAng.y * (stiff + 3) - upRate.y * (damp + 1.2)) * dt;
      upAng.r += upRate.r * dt; upAng.p += upRate.p * dt; upAng.y += upRate.y * dt;
      // how far out of shape it still is, 0..1: what costs control authority and shows on the HUD
      depart = clamp(Math.abs(upRate.r) / 5 + Math.abs(upAng.r - level) / 2.4 + Math.abs(upAng.p) * 0.5, 0, 1);
      // once it has settled, fold the whole turns back out so the angle never runs away
      if (depart < 0.02 && level !== 0) { upAng.r -= level; upRate.r = 0; }
    }
    // reversal / cobra / split-S: full rotations layered on top of the attitude, never accumulating
    let loopAngle = 0, cobraPitch = 0, splitRoll = 0;
    if (flipT >= 0) {
      flipT += dt / FLIP_TIME;
      const e = flipT < 1 ? flipT * flipT * (3 - 2 * flipT) : 1;
      loopAngle = Math.PI * 2 * e;
      if (flipT >= 1) flipT = -1;
    }
    if (cobraT >= 0) {
      cobraT += dt / COBRA_TIME;
      cobraPitch = Math.pow(Math.sin(Math.PI * Math.min(1, cobraT)), 0.8) * 1.4;
      if (cobraT >= 1) cobraT = -1;
    }
    if (immT >= 0) {
      immT += dt / IMM_TIME;
      const e = Math.min(1, immT);
      loopAngle = Math.PI * sm01(0, 0.62, e);                 // the pull up and over
      splitRoll = Math.PI * sm01(0.5, 1, e);                  // roll out upright on top
      if (immT >= 1) immT = -1;
    }
    if (splitT >= 0) {
      splitT += dt / SPLIT_TIME;
      const e = Math.min(1, splitT);
      splitRoll = Math.PI * (sm01(0, 0.28, e) + sm01(0.72, 1, e)); // roll inverted, and roll out at the end
      loopAngle = -Math.PI * 2 * sm01(0.2, 0.85, e);               // the pull-through, downward
      if (splitT >= 1) splitT = -1;
    }
    g.rotation.set(pitchX + loopAngle + cobraPitch + upAng.p, yawY + upAng.y, bankZ + rollAngle + splitRoll + upAng.r, "YXZ");
    const sputter = shield === 1 ? 0.75 + Math.random() * 0.25 : 1; // a critical jet's burner stutters
    jet.update(dt, elapsed, throttle * sputter, boosting ? sputter : 0);
    emitExhaust(jet, exhaust, dt, throttle, boosting ? 1 : 0, speed);
    if (shield < 3 && phase !== "takeoff") { _p.set(0, 0.05, 0.7); g.localToWorld(_p); damageTrail(sparks, smoke, _p, scroll, (3 - shield) / 2); }
    /* What a hard manoeuvre looks like from outside. A loaded wing drags the air
       round its tip until the pressure drops far enough for it to condense, so a
       pull or a roll streams vapour off both tips — thick down low where the air is
       wet, gone in the thin air up top. Above the deck the engines leave contrails
       instead, which is what makes a climb into the clear read as a climb. */
    if (phase !== "takeoff") {
      const load = Math.max(gLoad, rollT >= 0 ? 0.6 : 0, cobraT >= 0 || immT >= 0 || splitT >= 0 || flipT >= 0 ? 0.5 : 0);
      const humid = clamp(1.15 - g.position.y / 70, 0.1, 1);
      vapour = lerp(vapour, load * humid, 1 - Math.pow(0.015, dt));
      if (vapour > 0.2) for (const s of [-1, 1]) {
        _p.set(s * 0.86, -0.03, 0.24); g.localToWorld(_p);
        smoke.emit(_p, _c.set(-s * 1.4, -0.5, speed * 0.1 + 2), { life: 0.2 + vapour * 0.45, size0: 0.1, size1: 0.7 + vapour * 1.1, c0: WHITE, c1: WHITE, drag: 1.7, alpha: 0.08 + vapour * 0.32 });
      }
      if (g.position.y > DECK_Y + 8 && Math.random() < dt * 16) for (const nz of jet.nozzles) {
        _p.copy(nz); g.localToWorld(_p);
        smoke.emit(_p, _c.set(0, 0.15, 3), { life: 3 + Math.random() * 1.5, size0: 0.14, size1: 2.6, c0: WHITE, c1: WHITE, drag: 0.5, alpha: 0.22 });
      }
    }

    // ---- laser power-up ----
    if (powerT <= 0 && laserEarned && !power.visible && phase === "fly") {
      laserEarned = false;
      const px = g.position.x, py = g.position.y;
      const x = clamp(px + (rnd(dist) - 0.5) * 16, -X_MAX + 3, X_MAX - 3), z = -200;
      power.position.set(x, Math.max(clamp(py + (rnd(dist + 2) - 0.5) * 8, 2, Y_MAX - 4), groundAt(x, z) + 3), z);
      power.visible = true; powerT = 1e9;
    }
    if (power.visible) {
      power.rotation.y += dt * 1.6; powerRing.rotation.x += dt * 2.4; powerRing2.rotation.z += dt * 1.8;
      power.scale.setScalar(1.8 + Math.sin(elapsed * 5) * 0.12);
      if (Math.abs(power.position.z) < 2.6 && Math.hypot(power.position.x - g.position.x, power.position.y - g.position.y) < 3.4) {
        power.visible = false; laserT = LASER_TIME; fx.pickup(); waves.fire(g.position, 4);
        toast(`LASER ONLINE · HOLD ${coarse ? "FIRE" : "CLICK"}`, "hot"); radio.call("Laser online.", 1);
        $("laserwrap").classList.add("on");
      } else if (power.position.z > 8) power.visible = false;
    }
    const fireHeld = pointerFire || held("fire");
    const wantLaser = laserT > 0 && fireHeld && phase === "fly";
    if (wantLaser !== laserOn) { laserOn = wantLaser; fx.laser(laserOn); }
    if (laserT > 0 && phase === "fly") { laserT -= dt; $("laserfill").style.width = `${Math.round(laserT / LASER_TIME * 100)}%`; if (laserT <= 0) { $("laserwrap").classList.remove("on"); toast("LASER SPENT"); pointerFire = false; } }
    let laserZ = -320;
    if (laserOn) {
      // crystal in the beam vaporizes for bonus
      for (const sp of spires) {
        if (!sp.m.visible || sp.m.position.z > -1 || Math.abs(sp.m.position.x - g.position.x) > 1.4) continue;
        if (g.position.y > sp.base - 0.5 && g.position.y < sp.base + sp.h + 0.5) { laserZ = Math.max(laserZ, sp.m.position.z); shatterSpire(sp, g.position.y, true); }
      }
      for (const s of shards) {
        if (s.visible && s.position.z < -1 && Math.hypot(s.position.x - g.position.x, s.position.y - g.position.y) < 2.2) { laserZ = Math.max(laserZ, s.position.z); shatterShard(s, true); }
      }
    }

    // ---- laser beam ----
    beam.visible = laserOn;
    if (laserOn) {
      const end = Math.max(laserZ, game === "war" ? combat.laserHitZ : -320);
      const len = -end + 0.9;
      beam.position.set(g.position.x, g.position.y - 0.1, g.position.z - 0.9);
      beamCore.scale.set(1 + Math.sin(elapsed * 70) * 0.25, len, 1 + Math.cos(elapsed * 55) * 0.25);
      beamGlow.scale.set(1 + Math.sin(elapsed * 40) * 0.15, len, 1 + Math.sin(elapsed * 40) * 0.15);
      beamCore.position.z = beamGlow.position.z = -len / 2;
      (beamGlow.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.random() * 0.12;
      const pa = beamGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < BEAM_N; i++) {
        const t = Math.pow(i / (BEAM_N - 1), 1.25);
        pa.setXYZ(i, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, -1.5 - t * (len - 1.5));
      }
      pa.needsUpdate = true;
      (beamPts.material as THREE.PointsMaterial).size = 0.6 + Math.random() * 0.2;
      beamLight.position.set(g.position.x, g.position.y, g.position.z - 6);
      beamLight.intensity = 30 + Math.random() * 10;
      if (end > -319) { _p.set(g.position.x, g.position.y - 0.1, end); sparkHit(sparks, _p); }
      shake = Math.max(shake, 0.12);
    } else beamLight.intensity = 0;

    // ---- world scroll ----
    scrollWorld(scroll);

    // ---- gates (flight only), orbs, spires, shards ----
    if (game === "flight" || phase !== "landing") {
      if (game === "flight") rings.forEach((r, i) => {
        r.m.rotation.z += dt * 0.8;
        if (r.flash > 0) { r.flash = Math.max(0, r.flash - dt * 3); const s = 1 + r.flash * 0.35; r.m.scale.set(s, s, s); }
        if (!r.passed && r.m.position.z > -0.3) {
          r.passed = true;
          const dx = r.m.position.x - g.position.x, dy = r.m.position.y - g.position.y;
          if (Math.hypot(dx, dy) < RING_R - 0.2) {
            streak++; gates++; maxStreak = Math.max(maxStreak, streak);
            if (streak === LASER_GATES) offerLaser("8 GATE STREAK");
            const gain = 100 * streak;
            score += gain; boost = Math.min(1, boost + 0.3);
            fx.chime(700 + streak * 90);
            toast(`GATE +${gain}${streak > 1 ? `  ×${streak}` : ""}`);
            pulse("score", "pop");
            if (streak > 1) pulse("streak", "pop");
            gateBurst(r, 4 + Math.min(streak, 6));
          } else if (streak > 0 && game === "flight") { streak = 0; toast("STREAK LOST", "bad"); }
        }
        if (r.m.position.z > 8) placeRing(r, i * 7 + Math.floor(dist));
      });
      orbs.forEach((o, i) => {
        o.rotation.x += dt * 2; o.rotation.y += dt * 3;
        if (o.visible && Math.abs(o.position.z) < 1.2 && Math.hypot(o.position.x - g.position.x, o.position.y - g.position.y) < 1.2) {
          o.visible = false; score += 25; orbsGot++; boost = Math.min(1, boost + 0.06); fx.chime(1400);
        }
        if (o.position.z > 8) placeOrb(o, i * 13 + Math.floor(dist));
      });
    }
    const activeSpires = phase === "landing" || training ? 0 : Math.min(spires.length, (game === "war" ? 1 : 2) + Math.floor(dist / 1500));
    spires.forEach((sp, i) => {
      if (i >= activeSpires) { sp.m.visible = false; return; }
      if (!sp.m.visible) { sp.wait -= dt; if (sp.wait <= 0) placeSpire(sp, i * 31 + Math.floor(dist)); return; }
      const dxs = sp.m.position.x - g.position.x;
      if (Math.abs(sp.m.position.z) < 1.3 && Math.abs(dxs) < 1.6 && g.position.y < sp.base + sp.h + 0.3 && g.position.y > sp.base - 0.5) {
        const away = Math.sign(-dxs || 1);
        if (Math.abs(dxs) < 0.9) {
          // dead on: the crystal shatters, you lose energy and a shield, and you come out of it tumbling
          shatterSpire(sp, g.position.y, false); energy = Math.max(-8, energy - 5);
          hurt("CRYSTAL", 1.2); knock(away, 1, "");
        } else if (iframes <= 0) {
          // a wingtip: chips fly, you ricochet off it and depart, but the shield holds
          _p.set(sp.m.position.x, g.position.y, sp.m.position.z);
          debris.burst(_p, _c.set(0, 0, speed * 0.4), 5, 0.2, 8, CRYSTAL, 0); sparkHit(sparks, _p);
          energy = Math.max(-8, energy - 3); iframes = 0.6;
          knock(away, 0.6, "GLANCING HIT · RECOVER");
        }
      }
      if (sp.m.position.z > 10) placeSpire(sp, i * 31 + Math.floor(dist) + 7);
    });
    const activeShards = phase === "landing" || training ? 0 : Math.min(shards.length, Math.floor(dist / 2000));
    shards.forEach((s, i) => {
      if (i >= activeShards) { s.visible = false; return; }
      if (!s.visible) { s.position.z += scroll; if (s.position.z > 10) placeShard(s, i * 53 + Math.floor(dist)); return; }
      s.rotation.y += dt * 0.4;
      const dsh = Math.hypot(s.position.x - g.position.x, s.position.y - g.position.y);
      if (Math.abs(s.position.z) < 1.6 && dsh < 2.6) {
        const away = Math.sign(g.position.x - s.position.x || 1);
        if (dsh < 1.7) { shatterShard(s, false); energy = Math.max(-8, energy - 5); hurt("CRYSTAL", 1.2); knock(away, 1, ""); }
        else if (iframes <= 0) {
          debris.burst(s.position, _c.set(0, 0, speed * 0.4), 5, 0.2, 8, CRYSTAL, 0); sparkHit(sparks, s.position);
          energy = Math.max(-8, energy - 3); iframes = 0.6;
          knock(away, 0.6, "GLANCING HIT · RECOVER");
        }
      }
      if (s.position.z > 10) placeShard(s, i * 53 + Math.floor(dist) + 9);
    });

    // ---- the course: sectors and landmarks ----
    const si = sectorIndex(dist);
    if (si !== sectorIdx) {
      sectorIdx = si;
      const name = REGION_NAMES[si];
      if (dist > 50) { toast(`ENTERING ${name.toUpperCase()}`, "hot"); fx.chime(760); radio.call(`Entering ${name}.`, 0); }
      $("sector").textContent = `SECTOR ${si + 1}/${LOOP} · ${name.toUpperCase()}`;
    }
    updateLandmarks(true);

    // ---- combat ----
    if (game === "war") {
      combat.update({ dt, t: elapsed, speed, player: g.position, aimX: -Math.sin(yawY) * 0.9, fire: fireHeld && !laserOn && phase !== "landed", laser: laserOn, canHit: iframes <= 0, scroll, cover: cloudDens > 0.45, cloudAt: (x, y, z) => deck.density(x, y, dist - z) }, combatEvents);
      if (fireHeld && !laserOn && combat.fireT > 1 / 13 - 0.001) fx.gun();
    }
    if (phase === "landing") {
      landingDist = runway.position.z < 0 ? -runway.position.z : 0;
      if (runway.position.z - RUNWAY_LEN > 5 && phase === "landing") { // overflew it
        objective("MISSED APPROACH · GO AROUND");
        landingDist = 760; runway.position.z = -landingDist;
        if (approach) approach.trace.length = 0;
        radio.call("Missed approach. Go around.", 1);
      } else if (landingDist > 0) objective(`RUNWAY ${(landingDist * 14 / 3600).toFixed(1)} km · ${Math.abs(g.position.x) < RUNWAY_W / 2 ? "LINED UP" : "LINE UP"} · ALT ${Math.round((g.position.y - gy) * 30)}`);
      else objective("FLARE · TOUCH DOWN GENTLY");
      approach ??= { trace: [], sink: 0, offset: 0, speed: 0, grade: "", bonus: 0 };
      approachT -= dt;
      if (approachT <= 0) { approachT = 0.25; approach.trace.push({ d: landingDist, agl: Math.max(0, (g.position.y - gy) * 30) }); if (approach.trace.length > 400) approach.trace.shift(); }
    }
    // ---- the first flight: one ask at a time ----
    if (training) {
      if (trainStep < 0) { trainStep = 0; objective(TRAIN[0].text); radio.call(TRAIN[0].say, 1); }
      const st = TRAIN[trainStep];
      if (st && st.done()) {
        trainHold += dt;
        if (trainHold >= (st.hold ?? 0)) {
          trainHold = 0; trainStep++;
          fx.chime(1200); toast("✓ " + st.text.split(" · ")[0], "hot");
          const nx = TRAIN[trainStep];
          if (nx) {
            objective(nx.text); radio.call(nx.say, 1);
            if (nx.done === TRAIN[7].done) { // the last ask: put the runway ahead and clear the sky
              phase = "landing"; landingDist = 760;
              runway.position.set(0, groundAt(0, -landingDist) + 0.02, -landingDist); runway.visible = true;
              rings.forEach((r) => { r.m.visible = false; });
            }
          } else { training = false; }
        }
      } else trainHold = 0;
      if (trainStep === 6) trainGates = Math.min(trainGates, gates - 1 < 0 ? 0 : trainGates);
    }

    if (iframes > 0) iframes -= dt;
    // only a hit strobes the airframe; the invulnerability of a manoeuvre is silent
    if (blinkT > 0) blinkT -= dt;
    g.visible = (blinkT <= 0 || Math.floor(elapsed * 14) % 2 === 0) && !(view === "cockpit" && killCamT <= 0);

    // ---- HUD ----
    if (!bestBeaten && best[game] > 0 && score > best[game]) {
      bestBeaten = true; toast("NEW BEST", "hot"); fx.chime(1200); $("best").classList.add("beaten");
    }
    $("score").textContent = Math.floor(score).toLocaleString();
    $("best").textContent = bestBeaten ? `BEST ${Math.floor(score).toLocaleString()}` : fmtBest();
    $("speed").textContent = boosting ? "BURNER" : brake ? "AIRBRAKE" : "";
    $("thr").textContent = "";
    $("alt").textContent = cloudDens > 0.45 ? "IN CLOUD" : aboveMix > 0.5 ? "ABOVE THE DECK" : "";
    $("dist").textContent = `${(dist * 14 / 3600).toFixed(1)} km`;
    $("streak").textContent = game === "war" ? `×${Math.min(streak, 5)} KILL` : `×${streak}`;
    $("streak").classList.toggle("on", streak > 1);
    $("boostfill").style.width = `${Math.round(boost * 100)}%`;
    const bar = $("boostbar").classList;
    bar.toggle("full", boost > 0.98); bar.toggle("empty", boost < 0.05); bar.toggle("active", boosting);
    if (hintT > 0) { hintT -= dt; if (hintT <= 0) $("hint").classList.remove("on"); }
    /* The body under load. A hard pull greys the edges in; pushing over into a
       dive is negative g and pushes the blood the other way, which is a warm haze,
       not a grey one. The frame streaks on the burner and again in a real dive,
       because that is when the airspeed is going somewhere. */
    const pull = clamp(vel.y / V_MAX_Y, -1, 1);
    gLoad = lerp(gLoad, Math.pow(Math.max(0, pull), 2) * 0.75 + (busy() && rollT < 0 ? 0.35 : 0) + (rollT >= 0 ? 0.22 : 0), 1 - Math.pow(0.02, dt));
    pushG = lerp(pushG, Math.pow(Math.max(0, -pull), 2.2) * 0.6, 1 - Math.pow(0.02, dt));
    speedFx = lerp(speedFx, Math.max(boosting ? 1 : 0, splitT >= 0 ? 0.7 : 0, Math.pow(Math.max(0, -pull), 1.6) * 0.8), 1 - Math.pow(0.05, dt));
    if (depart > 0.12) $("damage").textContent = "UPSET · RECOVER"; else if ($("damage").textContent === "UPSET · RECOVER") $("damage").textContent = shield === 2 ? "DAMAGED" : shield === 1 ? "CRITICAL" : "";
    $("gforce").style.opacity = String(Math.min(1, gLoad + depart * 0.45) * motion);
    $("gpush").style.opacity = String(pushG * motion);
    $("speedlines").style.opacity = String(speedFx * 0.55 * motion);
    if (game === "war") {
      $("wave").textContent = combat.rtb ? "RTB" : combat.wave > 0 ? `WAVE ${combat.wave} / ${FINAL_WAVE} · ${combat.aliveCount() + combat.queued} HOSTILE` : "INBOUND";
      $("missiles").textContent = "▮".repeat(combat.ammo) + "▯".repeat(combat.maxAmmo - combat.ammo);
      const toGo = combat.rearmKills - combat.killsToRearm;
      $("mslnext").textContent = combat.ammo >= combat.maxAmmo ? "RACK FULL" : `+1 IN ${toGo} KILL${toGo === 1 ? "" : "S"}`;
      const cross = project(_p.set(g.position.x - Math.sin(yawY) * 0.9 * 70, g.position.y - 0.1, g.position.z - 70));
      $("reticle").style.transform = `translate(${cross.x}px, ${cross.y}px)`;
      $("reticle").classList.toggle("on", phase === "fly" && !combat.rtb);
      const lp = combat.lockPos();
      if (lp) {
        const s = project(lp);
        $("lockbox").style.transform = `translate(${s.x}px, ${s.y}px)`;
        $("lockbox").classList.toggle("on", s.on && combat.lockT < 0.35);
        if (combat.lockT >= 0.35 && combat.lockT - dt < 0.35) fx.lock();
      } else $("lockbox").classList.remove("on");
      // threat cues: a jet on your six, an attack winding up, rounds about to pass through you
      if (combat.behind > 0 && wasBehind === 0) { toast("BANDIT ON YOUR SIX · C TO REVERSE", "bad"); fx.alarm(); alarmT = 1.5; radio.call("Bandit, six o'clock. Break!", 2); }
      if (cloudDens > 0.45 && !coverCalled) { coverCalled = true; radio.call("In the weather. They've lost us.", 0); } else if (cloudDens < 0.2) coverCalled = false;
      wasBehind = combat.behind;
      $("threat").classList.toggle("on", combat.behind > 0);
      if (combat.behind > 0) { alarmT -= dt; if (alarmT <= 0) { fx.alarm(); alarmT = 1.5; } }
      if (nearMissT > 0) nearMissT -= dt;
      const firedAt = combat.incoming || nearMissT > 0;
      $("alert").classList.remove("on"); // red is for being hit; inbound fire is the amber banner and the rings
      $("alertText").textContent = firedAt ? `▲ TAKING FIRE · ${combat.incomingFrom || nearMissFrom} ▲` : "";
      if (combat.incomingBehind) breakT = Math.max(breakT, 0.6);
      if (breakT > 0) breakT -= dt;
      $("break").classList.toggle("on", breakT > 0);
      // inbound rounds: a thin ring rides each one on screen and grows as it closes
      for (let i = 0; i < THREAT_MARKS; i++) {
        const el = threatEls[i], t = combat.threats[i];
        if (!t) { el.classList.remove("on"); continue; }
        const s = project(t);
        const dz = Math.max(4, Math.abs(t.z - g.position.z));
        el.style.transform = `translate(${s.x}px, ${s.y}px) scale(${clamp(60 / dz, 0.6, 3)})`;
        el.classList.toggle("on", s.on);
      }
      if (combat.telegraph) {
        const s = project(combat.telegraph);
        $("tele").style.transform = `translate(${s.x}px, ${s.y}px)`;
        $("tele").classList.toggle("on", s.on);
      } else $("tele").classList.remove("on");
      $("range").textContent = combat.nearest < 200 ? `${Math.round(combat.nearest * 14)} m` : "";
      $("range").style.transform = $("reticle").style.transform;
      $("mirror").classList.toggle("threat", combat.behind > 0);
      drawRadar();
      {
        const cs: RwrContact[] = [];
        for (const k of combat.contacts()) cs.push({ bearing: Math.atan2(k.x - g.position.x, -(k.z - g.position.z)), range: Math.hypot(k.x - g.position.x, k.z - g.position.z) / 220, kind: k.head ? "interceptor" : "chaser", locked: k.locked, tele: k.tele });
        for (const t of combat.threats) cs.push({ bearing: Math.atan2(t.x - g.position.x, -(t.z - g.position.z)), range: Math.hypot(t.x - g.position.x, t.z - g.position.z) / 220, kind: "round", locked: false, tele: false });
        for (const m of combat.hostileMissiles()) cs.push({ bearing: Math.atan2(m.x - g.position.x, -(m.z - g.position.z)), range: Math.hypot(m.x - g.position.x, m.z - g.position.z) / 220, kind: "missile", locked: false, tele: false });
        const n = combat.aliveCount();
        if (n > rwrCount) fx.rwrNew(); rwrCount = n;
        if (combat.threats.length > 0) { rwrTickT -= dt; if (rwrTickT <= 0) { fx.rwrTick(); rwrTickT = 0.18; } }
        rwr.draw(cs, dt, hudColor(), cssVar("--bad"), cssVar("--warn"), hud.font);
      }
    }
  } else if (mode === "dead" && !deadDone) {
    // flameout: burning, tumbling, falling — then the fireball on the ground
    deadT += raw;
    timeScale = lerp(timeScale, deadT > 0.8 ? 1 : 0.45, 1 - Math.pow(0.2, raw));
    speed = lerp(speed, 12, 1 - Math.pow(0.5, dt));
    scrollWorld(scroll);
    vel.y -= 22 * dt;
    g.position.y += vel.y * dt;
    g.position.x += vel.x * dt * 0.3;
    bankZ += dt * 6 * motion; pitchX -= dt * 2.2 * motion;
    g.rotation.set(pitchX, yawY, bankZ, "YXZ");
    jet.update(dt, elapsed, 0.3, 0);
    burn(sparks, smoke, g.position, speed * 0.3);
    const gy = groundAt(g.position.x, 0);
    if (g.position.y < gy + 0.3) {
      deadDone = true; g.visible = false; timeScale = 1;
      explode(sparks, smoke, _p.set(g.position.x, gy + 0.5, g.position.z), 2.2, debris, waves, _c.set(vel.x * 0.3, 0, speed * 0.4));
      fx.boom(1); shake = 2.2;
      $("flash").style.opacity = "0.9";
      requestAnimationFrame(() => requestAnimationFrame(() => { $("flash").style.opacity = "0"; }));
    }
  } else if (mode === "dead") {
    deadT += raw;
    scrollWorld(scroll);
    speed = lerp(speed, 0, 1 - Math.pow(0.4, dt));
    if (deadT > 1.0 && $("dead").classList.contains("hidden")) show("dead", true);
    if (deadT > RESTART_LOCK) $("deadGo").classList.add("on");
  } else if (mode === "title") {
    attract(dt, scroll);
  }
  if (cutT > 0) { cutT -= raw; if (cutT <= 0) { const c = $("cut"); c.style.transition = "opacity .55s ease-out"; c.style.opacity = "0"; } }

  music.update(raw);
  exhaust.update(dt, scroll); sparks.update(dt, scroll); smoke.update(dt, scroll);
  debris.update(dt, scroll, groundAt, sparks, smoke); waves.update(dt, scroll);
  if (toastT > 0) { toastT -= raw; if (toastT <= 0) $("toast").style.opacity = "0"; }
  if (biomeT > 0) { biomeT -= raw; if (biomeT <= 0) $("biome").classList.remove("on"); }

  // ---- camera: chase, lead into turns, widen with speed, shake on impact ----
  // while the laser fires the camera lifts above the beam line, so the beam reads as a rod to the horizon instead of a dot behind the jet
  laserCam = lerp(laserCam, laserOn ? 1 : 0, 1 - Math.pow(0.02, raw));
  if (mode === "title") {
    // the reel drives the camera; the world-planted camera streams past with everything else
    camW.z += scroll;
    const s = SHOTS[shotIdx];
    s.cam(Math.min(1, shotT / s.dur));
    lookS.lerp(look, 1 - Math.pow(0.0005, raw));
    if (shake > 0) {
      shake -= raw * 2.2;
      camera.position.x += (Math.random() - 0.5) * shake * 0.3 * motion;
      camera.position.y += (Math.random() - 0.5) * shake * 0.3 * motion;
    }
    camera.lookAt(lookS);
    camera.fov += (fovT - camera.fov) * (1 - Math.pow(0.02, raw));
    camera.updateProjectionMatrix();
  } else if (still) {
    const cy = Math.sin(orbit.pitch), ch = Math.cos(orbit.pitch);
    camera.position.set(g.position.x + Math.sin(orbit.yaw) * ch * orbit.dist, g.position.y + cy * orbit.dist + 0.3, g.position.z + Math.cos(orbit.yaw) * ch * orbit.dist);
    camera.lookAt(g.position.x, g.position.y, g.position.z);
    camera.fov += (settings.fov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
    cockpit.group.visible = false;
  } else if (killCamT > 0) {
    // the cut: a fixed camera near the wreck, looking at it, with the airframe's own tumble as the only motion
    camera.position.set(killCamP.x + killCamSide * 6, killCamP.y + 2.4, killCamP.z + 7);
    camera.lookAt(killCamP);
    camera.fov += (44 - camera.fov) * 0.5;
    camera.updateProjectionMatrix();
    cockpit.group.visible = false;
  } else if (view === "cockpit" && mode !== "dead") {
    /* The seat. The eye sits under the canopy and turns with the airframe, every
       degree of pitch, bank, roll and departure, so the world rolls and the glass
       stays put. The head leads into the turn and finds the locked bandit. */
    _p.set(0, 0.17, -0.2); g.localToWorld(_p);
    camera.position.copy(_p);
    camera.quaternion.copy(g.quaternion);
    const lp = game === "war" ? combat.lockPos() : null;
    let hx = -vel.x * 0.0035, hy = vel.y * 0.002;
    if (lp) { _c.copy(lp).sub(g.position); hx += -Math.atan2(_c.x, -_c.z) * 0.3; hy += Math.atan2(_c.y, Math.hypot(_c.x, _c.z)) * 0.3; }
    const hk = 1 - Math.pow(0.03, raw);
    head.x = lerp(head.x, clamp(hx, -0.55, 0.55), hk); head.y = lerp(head.y, clamp(hy, -0.35, 0.35), hk);
    camera.rotateY(head.x); camera.rotateX(head.y);
    if (shake > 0) {
      shake -= raw * 2.2;
      camera.rotateX((Math.random() - 0.5) * shake * 0.02 * motion); camera.rotateZ((Math.random() - 0.5) * shake * 0.02 * motion);
    }
    camRoll *= Math.pow(0.03, raw);
    camera.rotateZ(-camRoll * 0.3 * motion);
    const fovTarget = 72 + (boosting ? 5 * motion : 0) - (brake ? 3 : 0);
    camera.fov += (fovTarget - camera.fov) * (1 - Math.pow(0.02, raw));
    camera.updateProjectionMatrix();
    cockpit.group.visible = true;
    cockpit.update(elapsed, throttle);
  } else {
    cockpit.group.visible = false;
    /* The camera flies its own aeroplane. In a dive it stays high and looks down
       over the nose, so the ground fills the frame and comes up at you; in a climb
       it drops and lets the jet stand against the sky. It pulls back on both, and
       it takes a roll kick from an impact. */
    const climbT = clamp(vel.y / V_MAX_Y, -1, 1);
    const back = (6.4 + (boosting ? 0.9 : 0) - (brake ? 0.6 : 0) + laserCam * 1.2 + Math.abs(climbT) * 1.3) * settings.camDist;
    const camT = g.visible || mode !== "dead" ? g.position : _p.set(g.position.x, Math.max(g.position.y, groundAt(g.position.x, 0) + 2), g.position.z);
    const cx = camT.x - Math.sin(bankZ) * 0.9 + vel.x * 0.02, cy = camT.y + 1.7 + vel.y * 0.006 - climbT * 1.7 + laserCam * 2.0, cz = camT.z + back;
    const cf = 1 - Math.pow(mode === "dead" ? 0.3 : 0.0003, dt);
    camera.position.x = lerp(camera.position.x, cx, cf);
    camera.position.y = lerp(camera.position.y, cy, cf);
    camera.position.z = lerp(camera.position.z, cz, cf);
    if (shake > 0) {
      shake -= raw * 2.2;
      camera.position.x += (Math.random() - 0.5) * shake * 0.5 * motion;
      camera.position.y += (Math.random() - 0.5) * shake * 0.5 * motion;
    }
    {
      const lp = game === "war" && mode === "play" ? combat.lockPos() : null;
      let hx = vel.x * 0.05, hy = 0;
      if (lp) { _c.copy(lp).sub(g.position); const d = Math.max(20, _c.length()); hx += _c.x / d * 5; hy += _c.y / d * 3; }
      const hk = 1 - Math.pow(0.04, raw);
      head.x = lerp(head.x, clamp(hx, -6, 6), hk); head.y = lerp(head.y, clamp(hy, -3, 3), hk);
    }
    camera.lookAt(camT.x + vel.x * 0.06 + head.x, camT.y + 0.35 + vel.y * 0.045 + climbT * 0.7 - laserCam * 0.2 + head.y, camT.z - 18 - laserCam * 22);
    camRoll *= Math.pow(0.03, raw);
    camera.rotateZ((-bankZ * 0.11 - camRoll * 0.6 + Math.sin(rollT >= 0 ? -rollDir * rollPhase : 0) * 0.08) * motion);
    const fovTarget = playing ? settings.fov + (boosting ? 7 * motion : 0) + speed * 0.05 - (brake ? 5 : 0) + Math.max(0, -climbT) * 5 * motion : settings.fov + 2;
    camera.fov += (fovTarget - camera.fov) * (1 - Math.pow(0.02, raw));
    camera.updateProjectionMatrix();
  }

  // ---- what the air does to the picture: shafts off the sun, the streaking frame, the plumes' heat ----
  {
    atmo.u.uTime.value = elapsed;
    _p.copy(sunDir).multiplyScalar(500).add(camera.position).project(camera);
    if (_p.z < 1) atmo.u.uSun.value.set((_p.x + 1) / 2, (_p.y + 1) / 2); else atmo.u.uSun.value.set(-9, -9);
    atmo.u.uRays.value = (0.45 + sunDir.y * 0.4) * (1 - cloudDens * 0.8) * (1 - eclipse * 0.7);
    atmo.u.uRayColor.value.copy(sunCol).lerp(WHITE, 0.3);
    atmo.u.uBlur.value = speedFx * 0.6 * motion;
    atmo.u.uChroma.value = (speedFx * 0.5 + (boosting ? 0.25 : 0)) * motion;
    atmo.u.uGrain.value = 0.012 * motion;
    const heat = view === "cockpit" || killCamT > 0 || !g.visible ? 0 : (0.3 * throttle + (boosting ? 0.9 : 0)) * (mode === "title" || playing ? 1 : 0);
    atmo.u.uHeatAmp.value.set(heat, heat, 0);
    // the laser: the air along the whole beam boils, and the frame fringes while it fires
    if (laserOn && beam.visible && killCamT <= 0) {
      const v = atmo.u.uHeat.value[2];
      _p.copy(beam.position).project(camera);
      _c.copy(beam.position).add(_p2.set(0, 0, -beamCore.scale.y)).project(camera);
      if (_p.z < 1 && _c.z < 1) { v.set((_p.x + 1) / 2, (_p.y + 1) / 2, (_c.x + 1) / 2, (_c.y + 1) / 2); atmo.u.uHeatAmp.value.z = 1.2; atmo.u.uHeatW.value.z = 0.022; }
      atmo.u.uChroma.value = Math.max(atmo.u.uChroma.value, 0.45 * motion);
    }
    if (heat > 0) jet.nozzles.forEach((nz, i) => {
      const v = atmo.u.uHeat.value[i];
      _p.copy(nz); g.localToWorld(_p); _c.copy(_p);
      _p.project(camera);
      _c.add(_p2.set(0, 0, 1.6 + (boosting ? 1.8 : 0)).applyQuaternion(g.quaternion)).project(camera);
      if (_p.z < 1 && _c.z < 1) {
        v.set((_p.x + 1) / 2, (_p.y + 1) / 2, (_c.x + 1) / 2, (_c.y + 1) / 2);
        // the shimmer is as wide as the plume looks: a fifth of its on-screen length, never a smear
        const w = clamp(Math.hypot((v.z - v.x) * atmo.u.uAspect.value, v.w - v.y) * 0.2, 0.006, 0.03);
        if (i === 0) atmo.u.uHeatW.value.x = w; else atmo.u.uHeatW.value.y = w;
      } else v.set(-9, -9, -9, -9);
    });
  }
  composer.render();

  // ---- the glass: drawn from the camera that just rendered, so it is never a frame behind ----
  if (playing || mode === "pause") {
    const hl = project(_p.set(g.position.x - 400, g.position.y, g.position.z - 900)), hr = project(_p.set(g.position.x + 400, g.position.y, g.position.z - 900));
    const lp = game === "war" ? combat.lockPos() : null;
    const ls = lp ? project(lp) : null;
    const fpa = Math.atan2(vel.y, Math.max(20, speed));
    hud.draw({
      camera, pos: g.position, velX: vel.x, velY: vel.y, speed, bank: bankZ + upAng.r + (rollT >= 0 ? -rollDir * rollPhase : 0), pitch: pitchX, yaw: yawY,
      heading: ((dist / (SECTOR * LOOP)) * 360 + Math.atan2(vel.x, Math.max(20, speed)) * 57.3 + 3600) % 360,
      alt: (g.position.y + 1.58) * 30, agl: (g.position.y - groundAt(g.position.x, 0)) * 30, vs: vel.y * 3.9, kmh: speed * 14,
      g: 1 + gLoad * 5 - pushG * 2.5, aoa: (pitchX - fpa) * 57.3, throttle: throttleSet, boosting, brake,
      gearDown: false, landing: phase === "landing", stall: 0, fuel: boost,
      lock: ls && lp ? { x: ls.x, y: ls.y, on: ls.on && combat.lockT >= 0.35 } : null,
      cockpit: view === "cockpit", motion, color: hudColor(), warn: cssVar("--warn"), bad: cssVar("--bad"),
      horizonY: (hl.y + hr.y) / 2, horizonAngle: Math.atan2(hr.y - hl.y, hr.x - hl.x), ppd: innerHeight / camera.fov, flash: 1,
      topY: game === "war" ? $("mirror").getBoundingClientRect().bottom + 12 : $("mute").getBoundingClientRect().bottom + 26,
      show: (dbgShow = (phase !== "takeoff" || phaseT > 1.2) && killCamT <= 0 && hudLevel !== "off"),
      level: view === "cockpit" || hudLevel === "full" ? "full" : "min",
    }, raw);
  } else hud.clear();

  // rear-view mirror (sortie): a second, cheap render looking back over the tail
  if (game === "war" && (playing || mode === "pause")) {
    const w = Math.round(Math.min(300, innerWidth * 0.24)), h = Math.round(w / 2.2);
    const x = Math.round((innerWidth - w) / 2), yTop = Math.round(parseFloat(getComputedStyle($("mirror")).top));
    const y = innerHeight - yTop - h;
    rearCam.aspect = w / h; rearCam.updateProjectionMatrix();
    rearCam.position.set(g.position.x, g.position.y + 1.1, g.position.z + 1.2);
    rearCam.lookAt(g.position.x, g.position.y + 0.6, g.position.z + 60);
    renderer.autoClear = false;
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.setScissorTest(true);
    renderer.clearDepth();
    beam.visible = false; const seaWas = sea.visible; sea.visible = false; terrain.water.visible = true;
    renderer.render(scene, rearCam);
    beam.visible = laserOn; sea.visible = seaWas; terrain.water.visible = !seaWas;
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.autoClear = true;
  }
}
