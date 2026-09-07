/* Synthesized audio — no assets. Engine drone tracks speed, an afterburner
   roar layer rises with boost; blips, whooshes, cannon, missiles and crashes
   are shaped noise/oscillators. Starts on the first user gesture. */

export class AudioFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** two buses under the master: the aeroplane (engine, burner, wind) and everything else */
  private busEngine: GainNode | null = null; private busFx: GainNode | null = null;
  engineVol = 1; fxVol = 1;
  private engineOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private burnerGain: GainNode | null = null;
  private burnerFilter: BiquadFilterNode | null = null;
  private ducked = false;
  muted = false;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.targetGain();
    this.master.connect(ctx.destination);
    this.busEngine = ctx.createGain(); this.busEngine.gain.value = this.engineVol; this.busEngine.connect(this.master);
    this.busFx = ctx.createGain(); this.busFx.gain.value = this.fxVol; this.busFx.connect(this.master);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 46;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 320;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.045;
    this.engineOsc.connect(this.engineFilter).connect(engineGain).connect(this.busEngine);
    this.engineOsc.start();

    // afterburner: looping noise through a bandpass, gained by boost
    const src = this.noise(2);
    src.loop = true;
    this.burnerFilter = ctx.createBiquadFilter();
    this.burnerFilter.type = "bandpass";
    this.burnerFilter.frequency.value = 420;
    this.burnerFilter.Q.value = 0.7;
    this.burnerGain = ctx.createGain();
    this.burnerGain.gain.value = 0;
    src.connect(this.burnerFilter).connect(this.burnerGain).connect(this.busEngine);
    src.start();
  }
  /** The music plugs in under the master, so it ducks and mutes with everything else. */
  musicInput(): { ctx: AudioContext; node: AudioNode } | null { return this.ctx && this.master ? { ctx: this.ctx, node: this.master } : null; }
  /** Mix levels, 0..1 each. */
  setLevels(engine: number, fx: number) {
    this.engineVol = engine; this.fxVol = fx;
    if (this.ctx && this.busEngine && this.busFx) { this.busEngine.gain.setTargetAtTime(engine, this.ctx.currentTime, 0.05); this.busFx.gain.setTargetAtTime(fx, this.ctx.currentTime, 0.05); }
  }

  /** Browsers suspend contexts created without a gesture (the ?fly shortcut); nudge it awake. */
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  setEngine(v: number, boost: number) {
    if (!this.ctx || !this.engineOsc || !this.engineFilter || !this.burnerGain || !this.burnerFilter) return;
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(34 + v * 1.1, t, 0.1);
    this.engineFilter.frequency.setTargetAtTime(200 + v * 24 + boost * 300, t, 0.1);
    this.burnerGain.gain.setTargetAtTime(0.02 + Math.min(1, v / 60) * 0.03 + boost * 0.12, t, 0.15);
    this.burnerFilter.frequency.setTargetAtTime(380 + v * 6 + boost * 500, t, 0.2);
  }

  /* Airflow over the airframe, separate from the engines: it rises with speed and
     hard with a dive, so pointing the nose down is something you hear before you
     read it on the gauge. `dive` is 0..1. */
  setWind(v: number, dive: number) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.windGain) {
      const src = this.noise(2); src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 700; f.Q.value = 0.5;
      this.windFilter = f;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      src.connect(f).connect(this.windGain).connect(this.busEngine!);
      src.start();
    }
    this.windGain.gain.setTargetAtTime(Math.min(1, v / 90) * 0.03 + dive * 0.075, t, 0.18);
    this.windFilter!.frequency.setTargetAtTime(500 + v * 8 + dive * 900, t, 0.2);
  }
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private noise(dur: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private burst(dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, gain: number, decay = dur) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noise(dur);
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(gain, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(gn).connect(this.busFx!);
    src.start(t);
  }

  chime(freq = 880) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.12);
    gn.gain.setValueAtTime(0.16, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(gn).connect(this.busFx!);
    o.start(t); o.stop(t + 0.32);
  }
  /** The radio keying: a short click of filtered noise, brighter opening than closing. */
  squelch(open: boolean) { this.burst(0.05, "bandpass", open ? 2400 : 1600, open ? 1800 : 900, 2, 0.16, 0.05); }
  /** Ground proximity: the descending two-tone that means pull up. */
  gpws() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(i ? 520 : 780, t + i * 0.16);
      gn.gain.setValueAtTime(0.0001, t + i * 0.16);
      gn.gain.exponentialRampToValueAtTime(0.09, t + i * 0.16 + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.14);
      o.connect(gn).connect(this.busFx!);
      o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.15);
    }
  }

  lock() { this.chime(1500); setTimeout(() => this.chime(1500), 90); }
  pickup() { this.chime(900); setTimeout(() => this.chime(1350), 90); setTimeout(() => this.chime(1800), 180); }

  private laserGain: GainNode | null = null;
  /** Continuous beam hum: two detuned saws through a resonant lowpass, faded in and out. */
  laser(on: boolean) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    if (!this.laserGain) {
      this.laserGain = ctx.createGain(); this.laserGain.gain.value = 0;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1400; f.Q.value = 6;
      for (const fr of [118, 121.5]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = fr; o.connect(f); o.start(); }
      const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
      const lfoG = ctx.createGain(); lfoG.gain.value = 500;
      lfo.connect(lfoG).connect(f.frequency); lfo.start();
      f.connect(this.laserGain).connect(this.busFx!);
    }
    this.laserGain.gain.setTargetAtTime(on ? 0.14 : 0, ctx.currentTime, on ? 0.03 : 0.12);
  }
  whoosh() { this.burst(0.5, "bandpass", 300, 3200, 1.1, 0.22); }
  /** A round going past the canopy: a sharp, short crack. */
  crack(gain = 1) { this.burst(0.07, "highpass", 2500, 900, 0.8, 0.4 * gain, 0.06); }
  /** Metal on rock: a bright ping falling away, and a scrape under it. */
  ricochet() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(2600 + Math.random() * 800, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.28);
    gn.gain.setValueAtTime(0.16, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(gn).connect(this.busFx!); o.start(t); o.stop(t + 0.32);
    this.burst(0.35, "bandpass", 1800, 500, 1.5, 0.25);
  }
  /* A missile leaving the rail: the clunk of the launcher, then the motor lighting
     a beat later and running away from you — a hiss that climbs as it goes. */
  missile() {
    this.burst(0.09, "lowpass", 900, 160, 1.2, 0.35, 0.09); // the rail
    setTimeout(() => {
      this.burst(0.22, "lowpass", 2600, 300, 0.6, 0.5, 0.2); // ignition
      this.burst(1.5, "bandpass", 420, 2800, 0.7, 0.34, 1.4); // the motor, doppler-ing away
    }, 190);
  }
  gun() { this.burst(0.07, "lowpass", 1800, 500, 0.5, 0.22, 0.07); }
  /** Hostile cannon: heavier, lower, and louder when it's coming from behind. */
  enemyGun(gain = 0.6) { this.burst(0.12, "lowpass", 900, 200, 0.7, 0.32 * gain, 0.12); }
  alarm() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(i ? 620 : 880, t + i * 0.12);
      gn.gain.setValueAtTime(0.0001, t + i * 0.12);
      gn.gain.exponentialRampToValueAtTime(0.07, t + i * 0.12 + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.1);
      o.connect(gn).connect(this.busFx!);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.11);
    }
  }
  /** A new emitter on the receiver: a two-tone chirp. */
  rwrNew() { this.chime(1100); setTimeout(() => this.chime(1500), 70); }
  /** Rounds inbound: a dry tick. */
  rwrTick() { this.burst(0.03, "bandpass", 3200, 2400, 4, 0.12, 0.03); }
  touchdown() { this.burst(0.5, "bandpass", 1200, 700, 3, 0.25); this.burst(0.3, "lowpass", 400, 80, 0.5, 0.4); }
  crash() { this.burst(0.9, "lowpass", 3000, 120, 0.5, 0.5); }
  boom(scale = 1) { this.burst(1.4 * scale, "lowpass", 2200, 60, 0.4, Math.min(0.9, 0.55 * scale + 0.2)); }

  private targetGain() { return this.muted ? 0 : this.ducked ? 0.12 : 1; }
  private applyGain() {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, 0.08);
  }
  /** Pull the mix down while paused so the drone doesn't nag. */
  duck(on: boolean) { this.ducked = on; this.applyGain(); }
  toggle(): boolean { this.muted = !this.muted; this.applyGain(); return this.muted; }
}
