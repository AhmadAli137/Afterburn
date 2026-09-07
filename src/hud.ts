import * as THREE from "three";

/* The glass. A single full-screen 2D canvas carries everything a real head-up
   display carries: the flight-path marker (where the jet is actually going),
   a pitch ladder banked with the wings, a heading tape, airspeed and altitude
   tapes with a vertical-speed caret, a bank scale, and the small readouts —
   g, angle of attack, throttle. It is drawn from the same numbers the flight
   model integrates, so it is never wrong about the aeroplane. The radar
   warning receiver lives in its own small canvas: threat bearings, typed. */

export interface HudState {
  camera: THREE.PerspectiveCamera;
  pos: THREE.Vector3;           // jet position (scene)
  velX: number; velY: number; speed: number;
  bank: number; pitch: number; yaw: number;
  heading: number;              // degrees 0..360
  alt: number;                  // metres
  agl: number;                  // metres above the ground
  vs: number;                   // metres per second, vertical
  kmh: number;
  g: number; aoa: number; throttle: number; boosting: boolean; brake: boolean;
  gearDown: boolean; landing: boolean; stall: number; fuel: number;
  lock: { x: number; y: number; on: boolean } | null;
  cockpit: boolean;
  motion: number;
  color: string; warn: string; bad: string;
  /** where the world's horizon line crosses the centre column, in screen px */
  horizonY: number;
  /** on-screen tilt of the horizon line, radians */
  horizonAngle: number;
  /** screen pixels per degree of pitch */
  ppd: number;
  flash: number;                // 0..1 master brightness/pulse
  /** "min": the marker, the numbers and the warnings, and the scenery. "full": the whole glass. */
  level: "min" | "full";
  /** screen y the heading tape hangs from (below whatever the top of the screen is busy with) */
  topY: number;
  show: boolean;
}

export interface RwrContact { bearing: number; range: number; kind: "chaser" | "interceptor" | "missile" | "round"; locked: boolean; tele: boolean }

const TAU = Math.PI * 2;
const _p = new THREE.Vector3();

export class Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  /** displayed numbers tick toward the truth instead of jumping */
  private shownSpeed = 0; private shownAlt = 0; private shownHdg = 0;
  private fpmX = 0; private fpmY = 0;
  private t = 0;
  font = "'B612 Mono', 'Consolas', monospace";

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth; this.h = innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
  }

  clear() {
    this.dbg.clears++;
    const c = this.ctx as CanvasRenderingContext2D & { reset?: () => void };
    if (c.reset) c.reset();
    else { for (let i = 0; i < 8; i++) c.restore(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  }

  /** Screen position of a scene point, plus whether it is in front of the camera. */
  private project(cam: THREE.PerspectiveCamera, x: number, y: number, z: number) {
    _p.set(x, y, z).project(cam);
    return { x: (_p.x + 1) / 2 * this.w, y: (1 - _p.y) / 2 * this.h, on: _p.z < 1 };
  }

  dbg = { calls: 0, lastShow: true, clears: 0 };
  draw(s: HudState, dt: number) {
    const c = this.ctx;
    this.dbg.calls++; this.dbg.lastShow = s.show;
    this.clear();
    if (!s.show) return;
    this.t += dt;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.w, H = this.h, cx = W / 2;
    const k = 1 - Math.pow(0.001, dt);
    this.shownSpeed += (s.kmh - this.shownSpeed) * k;
    this.shownAlt += (s.alt - this.shownAlt) * k;
    let dh = ((s.heading - this.shownHdg + 540) % 360) - 180; this.shownHdg = (this.shownHdg + dh * k + 360) % 360;
    const col = s.color, dim = hexA(col, 0.62);
    c.lineCap = "round"; c.lineJoin = "round";
    c.font = `11px ${this.font}`;
    c.shadowColor = hexA(col, 0.6); c.shadowBlur = 6;

    // ---- flight-path marker: where the velocity vector points ----
    const vlen = Math.hypot(s.velX, s.velY, s.speed) || 1;
    const D = 60;
    const fp = this.project(s.camera, s.pos.x + s.velX / vlen * D, s.pos.y + s.velY / vlen * D, s.pos.z - s.speed / vlen * D);
    const kf = 1 - Math.pow(0.0005, dt);
    this.fpmX += (fp.x - this.fpmX) * kf; this.fpmY += (fp.y - this.fpmY) * kf;
    const fx = clamp(this.fpmX, 40, W - 40), fy = clamp(this.fpmY, 40, H - 40);
    if (fp.on) {
      c.strokeStyle = col; c.lineWidth = 1.6;
      c.beginPath(); c.arc(fx, fy, 7, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(fx - 7, fy); c.lineTo(fx - 18, fy); c.moveTo(fx + 7, fy); c.lineTo(fx + 18, fy); c.moveTo(fx, fy - 7); c.lineTo(fx, fy - 15); c.stroke();
      if (s.stall > 0.05) { c.strokeStyle = s.bad; c.beginPath(); c.moveTo(fx - 10, fy + 12); c.lineTo(fx + 10, fy + 12); c.stroke(); }
    }

    const full = s.level === "full";
    // ---- pitch ladder, banked with the wings, hung off the horizon ----
    if (full) {
      c.save();
      c.beginPath(); c.rect(cx - W * 0.2, H * 0.17, W * 0.4, H * 0.66); c.clip();
      c.shadowBlur = 0;
      c.translate(cx, s.horizonY);
      c.rotate(s.horizonAngle);
      c.strokeStyle = dim; c.fillStyle = dim; c.lineWidth = 1.2;
      c.textAlign = "right"; c.textBaseline = "middle";
      // horizon
      c.lineWidth = 1.6; c.beginPath(); c.moveTo(-W, 0); c.lineTo(-52, 0); c.moveTo(52, 0); c.lineTo(W, 0); c.stroke(); c.lineWidth = 1.2;
      for (let a = -60; a <= 60; a += 5) {
        if (a === 0) continue;
        const y = -a * s.ppd;
        if (Math.abs(y) > H * 0.6) continue;
        const half = a % 10 === 0 ? 46 : 26, gap = 30, tick = a > 0 ? 6 : -6;
        c.setLineDash(a < 0 ? [6, 5] : []);
        c.beginPath();
        c.moveTo(-gap - half, y); c.lineTo(-gap, y); c.lineTo(-gap, y + tick);
        c.moveTo(gap + half, y); c.lineTo(gap, y); c.lineTo(gap, y + tick);
        c.stroke();
        if (a % 10 === 0) { c.fillText(String(Math.abs(a)), -gap - half - 6, y); c.textAlign = "left"; c.fillText(String(Math.abs(a)), gap + half + 6, y); c.textAlign = "right"; }
      }
      c.setLineDash([]);
      c.restore();
    }

    // ---- bank scale: an arc under the boresight with a wings-level pointer ----
    if (full) {
      const r = H * 0.3, by = H * 0.36;
      c.save(); c.translate(cx, by); c.shadowBlur = 0;
      c.strokeStyle = dim; c.lineWidth = 1.2;
      for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const rad = a * Math.PI / 180, l = a === 0 ? 12 : Math.abs(a) % 30 === 0 ? 9 : 5;
        c.beginPath(); c.moveTo(Math.sin(rad) * r, Math.cos(rad) * r); c.lineTo(Math.sin(rad) * (r + l), Math.cos(rad) * (r + l)); c.stroke();
      }
      const b = clamp(-s.bank, -1.2, 1.2);
      c.fillStyle = col;
      c.beginPath(); c.moveTo(Math.sin(b) * (r - 3), Math.cos(b) * (r - 3)); c.lineTo(Math.sin(b - 0.05) * (r - 12), Math.cos(b - 0.05) * (r - 12)); c.lineTo(Math.sin(b + 0.05) * (r - 12), Math.cos(b + 0.05) * (r - 12)); c.closePath(); c.fill();
      c.restore();
    }

    // ---- heading tape, top centre ----
    {
      const ty = s.topY, tw = Math.min(360, W * 0.36);
      c.save(); c.translate(cx, ty); c.shadowBlur = 0;
      c.strokeStyle = dim; c.fillStyle = dim; c.lineWidth = 1.2; c.textAlign = "center"; c.textBaseline = "top";
      if (full) { c.beginPath(); c.moveTo(-tw / 2, 0); c.lineTo(tw / 2, 0); c.stroke(); }
      const pxPerDeg = tw / 60;
      c.save(); c.beginPath(); c.rect(-tw / 2, -20, tw, 40); c.clip();
      if (full) for (let d = -40; d <= 40; d += 5) {
        const hd = Math.round((this.shownHdg + d) / 5) * 5;
        const x = (hd - this.shownHdg) * pxPerDeg; const off = ((hd - this.shownHdg + 540) % 360) - 180; const xx = off * pxPerDeg;
        void x;
        c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx, hd % 10 === 0 ? 9 : 5); c.stroke();
        if (hd % 10 === 0) c.fillText(String(((hd % 360) + 360) % 360).padStart(3, "0"), xx, 12);
      }
      c.restore();
      c.fillStyle = col; c.beginPath(); c.moveTo(0, -2); c.lineTo(-5, -9); c.lineTo(5, -9); c.closePath(); c.fill();
      c.font = `bold 13px ${this.font}`; c.textBaseline = "bottom"; c.fillText(String(Math.round(this.shownHdg) % 360).padStart(3, "0"), 0, -11);
      c.font = `12px ${this.font}`;
      c.restore();
    }

    // ---- airspeed (left) and altitude (right) tapes ----
    const tapeH = Math.min(260, H * 0.4), mid = H * 0.5;
    const tape = (x: number, value: number, step: number, label: string, right: boolean, caret?: number) => {
      c.save(); c.translate(x, mid); c.shadowBlur = 0;
      c.strokeStyle = dim; c.fillStyle = dim; c.lineWidth = 1.2; c.textBaseline = "middle"; c.textAlign = right ? "left" : "right";
      if (full) { c.beginPath(); c.moveTo(0, -tapeH / 2); c.lineTo(0, tapeH / 2); c.stroke(); }
      c.save(); c.beginPath(); c.rect(right ? -2 : -70, -tapeH / 2, 72, tapeH); c.clip();
      const ppu = tapeH / (step * 8);
      const base = Math.floor(value / step) * step;
      if (full) for (let v = base - step * 5; v <= base + step * 5; v += step) {
        if (v < 0) continue;
        const y = (value - v) * ppu;
        const major = (v / step) % 2 === 0;
        c.beginPath(); c.moveTo(0, y); c.lineTo(right ? (major ? 9 : 5) : -(major ? 9 : 5), y); c.stroke();
        if (major) c.fillText(String(v), right ? 13 : -13, y);
      }
      c.restore();
      // the box with the live value
      c.fillStyle = "rgba(4,8,10,.72)"; c.strokeStyle = col; c.lineWidth = 1.4;
      const bw = 58, bh = 22, bx = right ? 6 : -6 - bw;
      c.beginPath(); c.rect(bx, -bh / 2, bw, bh); c.fill(); c.stroke();
      c.fillStyle = col; c.font = `bold 15px ${this.font}`; c.textAlign = "center"; c.fillText(String(Math.round(value)), bx + bw / 2, 0);
      c.font = `10px ${this.font}`; c.fillStyle = dim; c.textAlign = right ? "left" : "right"; c.fillText(label, right ? 6 : -6, full ? -tapeH / 2 - 12 : -bh / 2 - 8);
      if (caret !== undefined && full) { // vertical speed caret beside the altitude tape
        const cy = clamp(-caret * 6, -tapeH / 2, tapeH / 2);
        c.fillStyle = col; c.beginPath(); c.moveTo(right ? 66 : -66, cy); c.lineTo(right ? 72 : -72, cy - 4); c.lineTo(right ? 72 : -72, cy + 4); c.closePath(); c.fill();
        c.fillStyle = dim; c.textAlign = right ? "left" : "right"; c.fillText(`${caret > 0 ? "+" : ""}${Math.round(caret)} m/s`, right ? 76 : -76, cy);
      }
      c.font = `12px ${this.font}`;
      c.restore();
    };
    const tapeX = Math.min(190, W * 0.2);
    tape(cx - tapeX, this.shownSpeed, 50, "KM/H", false);
    tape(cx + tapeX, Math.max(0, this.shownAlt), 100, "ALT M", true, s.vs);

    // ---- small readouts under the airspeed tape ----
    if (full) {
      c.save(); c.translate(cx - tapeX - 60, mid + tapeH / 2 + 18); c.shadowBlur = 0;
      c.textAlign = "left"; c.textBaseline = "top"; c.fillStyle = dim;
      const rows = [`G  ${s.g.toFixed(1)}`, `AOA ${s.aoa.toFixed(1)}°`, `THR ${Math.round(s.throttle * 100)}%${s.boosting ? " AB" : s.brake ? " BRK" : ""}`, `FUEL ${Math.round(s.fuel * 100)}%`];
      rows.forEach((r, i) => c.fillText(r, 0, i * 15));
      if (s.gearDown) { c.fillStyle = col; c.fillText("GEAR ▼", 0, rows.length * 15 + 3); }
      if (s.stall > 0.05 && Math.floor(this.t * 4) % 2 === 0) { c.fillStyle = s.bad; c.font = `bold 14px ${this.font}`; c.fillText("STALL", 0, -tapeH - 36); }
      c.restore();
    }
    // radar altitude under the altitude tape when low
    if (s.agl < 300) {
      c.save(); c.translate(cx + tapeX + 6, full ? mid + tapeH / 2 + 18 : mid + 18); c.shadowBlur = 0;
      c.textAlign = "left"; c.textBaseline = "top"; c.fillStyle = s.agl < 60 && !s.landing ? s.warn : dim;
      c.fillText(`RALT ${Math.max(0, Math.round(s.agl))}`, 0, 0);
      c.restore();
    }

    // ---- attitude indicator (cockpit): sky over ground, rolled and pitched with the airframe ----
    if (s.cockpit && full) {
      const ax = cx - tapeX - 30, ay = mid - tapeH / 2 - 44, r = 30;
      c.save(); c.translate(ax, ay); c.shadowBlur = 0;
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.clip();
      c.rotate(-s.bank);
      const py = clamp(s.pitch * 57.3 * 1.3, -r, r);
      c.fillStyle = "rgba(70,130,200,.75)"; c.fillRect(-r * 2, -r * 2, r * 4, r * 2 + py);
      c.fillStyle = "rgba(120,80,40,.8)"; c.fillRect(-r * 2, py, r * 4, r * 2);
      c.strokeStyle = "rgba(255,255,255,.8)"; c.lineWidth = 1; c.beginPath(); c.moveTo(-r, py); c.lineTo(r, py); c.stroke();
      for (const d of [-20, -10, 10, 20]) { const y = py - d * 1.3; c.beginPath(); c.moveTo(-8, y); c.lineTo(8, y); c.stroke(); }
      c.restore();
      c.save(); c.translate(ax, ay); c.shadowBlur = 0;
      c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
      c.strokeStyle = "#ffd27d"; c.lineWidth = 2; c.beginPath(); c.moveTo(-14, 0); c.lineTo(-5, 0); c.lineTo(0, 4); c.lineTo(5, 0); c.lineTo(14, 0); c.stroke();
      c.fillStyle = dim; c.font = `9px ${this.font}`; c.textAlign = "center"; c.textBaseline = "top"; c.fillText("ADI", 0, r + 4);
      c.restore();
    }

    // ---- lock box: bracket corners round the locked bandit ----
    if (s.lock && s.lock.on) {
      const { x, y } = s.lock; const r = 20;
      c.strokeStyle = s.bad; c.lineWidth = 1.6;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        c.beginPath(); c.moveTo(x + sx * r, y + sy * (r - 8)); c.lineTo(x + sx * r, y + sy * r); c.lineTo(x + sx * (r - 8), y + sy * r); c.stroke();
      }
      c.fillStyle = s.bad; c.font = `bold 11px ${this.font}`; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("LOCK", x + r + 6, y - r + 4);
    }
    c.shadowBlur = 0;
  }
}

/** The radar warning receiver: a small azimuth ring with typed threat symbols. */
export class Rwr {
  private readonly ctx: CanvasRenderingContext2D;
  private t = 0;
  constructor(readonly canvas: HTMLCanvasElement) { this.ctx = canvas.getContext("2d")!; }
  draw(contacts: RwrContact[], dt: number, color: string, bad: string, warn: string, font: string) {
    const c = this.ctx, S = this.canvas.width, m = S / 2, R = m - 6;
    this.t += dt;
    c.clearRect(0, 0, S, S);
    c.fillStyle = "rgba(4,8,10,.6)"; c.beginPath(); c.arc(m, m, R, 0, TAU); c.fill();
    c.strokeStyle = hexA(color, 0.35); c.lineWidth = 1;
    c.beginPath(); c.arc(m, m, R, 0, TAU); c.stroke();
    c.beginPath(); c.arc(m, m, R * 0.5, 0, TAU); c.stroke();
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; const l = i % 3 === 0 ? 6 : 3; c.beginPath(); c.moveTo(m + Math.sin(a) * (R - l), m - Math.cos(a) * (R - l)); c.lineTo(m + Math.sin(a) * R, m - Math.cos(a) * R); c.stroke(); }
    c.fillStyle = color; c.beginPath(); c.moveTo(m, m - 4); c.lineTo(m + 3, m + 3); c.lineTo(m - 3, m + 3); c.closePath(); c.fill();
    c.font = `bold 10px ${font}`; c.textAlign = "center"; c.textBaseline = "middle";
    for (const k of contacts) {
      const rr = R * (0.28 + 0.62 * clamp(k.range, 0, 1));
      const x = m + Math.sin(k.bearing) * rr, y = m - Math.cos(k.bearing) * rr;
      const blink = k.tele || k.kind === "missile" ? Math.floor(this.t * 6) % 2 === 0 : true;
      if (!blink) continue;
      const colr = k.kind === "missile" ? bad : k.tele ? warn : k.locked ? color : k.kind === "round" ? warn : "#ff8a8a";
      c.fillStyle = colr; c.strokeStyle = colr;
      if (k.kind === "round") { c.beginPath(); c.arc(x, y, 2, 0, TAU); c.fill(); continue; }
      const sym = k.kind === "missile" ? "M" : k.kind === "interceptor" ? "I" : "A";
      c.fillText(sym, x, y);
      if (k.kind === "missile" || k.tele) { c.beginPath(); c.arc(x, y, 7, 0, TAU); c.stroke(); }
      if (k.locked) { c.beginPath(); c.rect(x - 6, y - 6, 12, 12); c.stroke(); }
    }
  }
}

function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
/** "#rrggbb" plus alpha to an rgba() string. */
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
