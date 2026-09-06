/* Synthesized audio — no assets. Engine drone tracks speed; blips, whooshes and
   crashes are shaped noise/oscillators. Starts on the first user gesture. */

export class AudioFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  muted = false;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 46;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 320;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.045;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  setSpeed(v: number) {
    if (!this.ctx || !this.engineOsc || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(38 + v * 1.15, t, 0.1);
    this.engineFilter.frequency.setTargetAtTime(220 + v * 26, t, 0.1);
  }

  private noise(dur: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  chime(freq = 880) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.12);
    gn.gain.setValueAtTime(0.16, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(gn).connect(this.master);
    o.start(t); o.stop(t + 0.32);
  }

  whoosh() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noise(0.5);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.Q.value = 1.1;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.35);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.22, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(f).connect(gn).connect(this.master);
    src.start(t);
  }

  crash() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noise(0.9);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.8);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.5, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(f).connect(gn).connect(this.master);
    src.start(t);
  }

  toggle(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}
