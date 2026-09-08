/* The radio. Three people on the net: Magic, the controller, who has the
   picture and gives the orders; Hook, in the back seat, who sees what is
   happening to the aeroplane and says so; and Two, on the wing. Short calls,
   queued, one at a time, with a squelch click either side, each printed on
   the comms line under the speaker's callsign so nothing is missed with the
   sound off. Priorities: a warning interrupts chatter; chatter waits; a reply
   is a call that answers the one before it and is the first thing dropped
   when the net gets busy. */

import { CLIP_FOR, VOICE_VARIANTS, VOICE_WHO, Speaker } from "./voicelines";
export type Priority = 0 | 1 | 2; // 0 chatter, 1 call, 2 warning
export const CALLSIGN: Record<Speaker, string> = { control: "MAGIC", copilot: "HOOK", wingman: "TWO" };

interface Call { text: string; say: string; pri: Priority; t: number; who: Speaker; reply: boolean }

export class Radio {
  private queue: Call[] = [];
  private busy = false;
  private lastText = ""; private lastAt = 0; private lastSpokeAt = -99;
  private voices: Partial<Record<Speaker, SpeechSynthesisVoice | null>> = {};
  volume = 1;
  enabled = true;
  /** the mixer, once it exists: clips go through a headset band-pass into it */
  private ctx: AudioContext | null = null; private bus: GainNode | null = null;
  private readonly clips = new Map<string, HTMLAudioElement>();
  private playing: HTMLAudioElement | null = null;
  /** debug: the last clip that actually started, and how many have */
  lastClip = ""; clipsPlayed = 0;
  attach(ctx: AudioContext, into: AudioNode) {
    if (this.ctx) return;
    this.ctx = ctx;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 320;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3600;
    const shaper = ctx.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); } shaper.curve = curve;
    this.bus = ctx.createGain(); this.bus.gain.value = this.volume;
    hp.connect(lp).connect(shaper).connect(this.bus).connect(into);
    this.filterIn = hp;
    for (const el of this.clips.values()) this.wire(el);
  }
  private filterIn: AudioNode | null = null;
  private wire(el: HTMLAudioElement) {
    if (!this.ctx || !this.filterIn || (el as HTMLAudioElement & { wired?: boolean }).wired) return;
    this.ctx.createMediaElementSource(el).connect(this.filterIn);
    (el as HTMLAudioElement & { wired?: boolean }).wired = true;
  }
  private clip(id: string): HTMLAudioElement {
    let el = this.clips.get(id);
    if (!el) { el = new Audio(import.meta.env.BASE_URL + `voice/${id}.mp3`); el.preload = "auto"; this.clips.set(id, el); this.wire(el); }
    return el;
  }
  /** Fetch the clips that matter early, so the first warning is not late. */
  warm(ids: string[]) { for (const id of ids) this.clip(id).load(); }
  setVolume(v: number) { this.volume = v; if (this.bus && this.ctx) this.bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  private readonly line: HTMLElement;
  private lineT = 0;
  private lineTimer: number | null = null;

  constructor(line: HTMLElement, private squelch: (open: boolean) => void) {
    this.line = line;
    if ("speechSynthesis" in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        // clear English voices, one male for the jet and one female for the controller; headset, not storyteller
        const en = vs.filter((v) => /en[-_]/.test(v.lang));
        const male = en.find((v) => /Google UK English Male|Daniel|Microsoft (Ryan|Guy|George)/.test(v.name)) || en.find((v) => !/female|Zira|Samantha|Aria|Jenny|Sonia/i.test(v.name)) || en[0] || null;
        const female = en.find((v) => /Google UK English Female|Samantha|Microsoft (Aria|Jenny|Sonia|Zira)/.test(v.name)) || en.find((v) => /female/i.test(v.name)) || male;
        this.voices = { copilot: male, wingman: male, control: female };
      };
      pick();
      speechSynthesis.addEventListener("voiceschanged", pick);
    }
  }

  private lastVariant = new Map<string, number>();
  /* One line at a time. Every playback carries a token; a completion callback
     that arrives with an old token (the line a warning cut off, a cancelled
     utterance) is ignored, so it can never free the queue under the line that
     is actually on the air. */
  private token = 0;
  /** Say an event by key: a random variant of its line, never the one used last time. */
  say(key: string, pri: Priority = 1, reply = false) {
    const vs = VOICE_VARIANTS[key];
    if (!vs || !vs.length) { this.call(key, pri, key, "copilot", reply); return; }
    let i = Math.floor(Math.random() * vs.length);
    const last = this.lastVariant.get(key);
    if (vs.length > 1 && i === last) i = (i + 1) % vs.length;
    this.lastVariant.set(key, i);
    this.call(vs[i], pri, vs[i], VOICE_WHO[key] || "copilot", reply);
  }
  /** Someone answers the last call: queued behind it, some of the time, and the first thing dropped if the net is busy. */
  reply(key: string, chance = 1) { if (Math.random() < chance) this.say(key, 1, true); }
  /** Queue a call. Same text within four seconds is dropped; a warning jumps the queue. */
  call(text: string, pri: Priority = 1, say = text, who: Speaker = "copilot", reply = false) {
    const now = performance.now() / 1000;
    if (text === this.lastText && now - this.lastAt < 4) return;
    this.lastText = text; this.lastAt = now;
    const c: Call = { text, say, pri, t: now, who, reply };
    if (pri === 2) { this.queue = this.queue.filter((q) => q.pri === 2); this.queue.unshift(c); if (this.busy) { this.token++; if ("speechSynthesis" in window) speechSynthesis.cancel(); if (this.playing) { this.playing.pause(); this.playing = null; } } this.busy = false; }
    else {
      // chatter is dropped if the radio has been busy lately; calls wait, but not in a crowd, and a reply gives way to a call
      if (pri === 0 && now - this.lastSpokeAt < 8) return;
      if (this.queue.length > 2) { const r = this.queue.findIndex((q) => q.reply); if (r >= 0) this.queue.splice(r, 1); else this.queue.shift(); }
      this.queue.push(c);
    }
    this.pump();
  }

  private pump() {
    if (this.busy) return;
    const c = this.queue.shift();
    if (!c) return;
    // stale chatter is not worth the air
    if (c.pri === 0 && performance.now() / 1000 - c.t > 5) { this.pump(); return; }
    this.busy = true; this.lastSpokeAt = performance.now() / 1000;
    const tok = ++this.token;
    this.show(c);
    this.squelch(true);
    let spoke = false;
    // the rendered voice, if this line has one
    const id = CLIP_FOR[c.say];
    if (id && this.enabled && this.volume > 0.02) {
      const el = this.clip(id);
      try {
        el.currentTime = 0; el.volume = this.ctx ? 1 : Math.min(1, this.volume);
        this.playing = el;
        el.onended = el.onerror = () => { if (this.playing === el) this.playing = null; this.done(tok); };
        el.play().then(() => { spoke = true; this.lastClip = id; this.clipsPlayed++; }).catch(() => { this.playing = null; this.done(tok); });
        // a clip that stalls loading must not hold the queue
        setTimeout(() => { if (this.playing === el && el.paused) { this.playing = null; this.done(tok); } }, 6000);
        return;
      } catch { /* fall through to the browser voice */ }
    }
    if (this.enabled && this.volume > 0.02 && "speechSynthesis" in window) {
      try {
        const u = new SpeechSynthesisUtterance(c.say);
        const v = this.voices[c.who]; if (v) u.voice = v;
        u.rate = c.who === "control" ? 1.02 : 1.12; u.pitch = c.who === "control" ? 1.0 : 0.85; u.volume = Math.min(1, this.volume);
        u.onend = u.onerror = () => { this.done(tok); };
        speechSynthesis.speak(u);
        spoke = true;
        // a voice that never starts (no voices loaded, tab muted) must not hold the queue
        setTimeout(() => { if (this.busy && speechSynthesis.speaking === false) this.done(tok); }, 3500);
      } catch { spoke = false; }
    }
    if (!spoke) setTimeout(() => this.done(tok), 900);
  }
  private done(tok: number) {
    if (tok !== this.token || !this.busy) return;
    this.busy = false;
    this.squelch(false);
    setTimeout(() => this.pump(), 900);
  }
  private show(c: Call) {
    this.line.textContent = "";
    const who = document.createElement("b"); who.className = `who ${c.who}`; who.textContent = CALLSIGN[c.who];
    this.line.append(who, document.createTextNode(" " + c.text));
    this.line.classList.toggle("warn", c.pri === 2);
    this.line.dataset.who = c.who;
    this.line.classList.add("on");
    this.lineT = 3;
    if (this.lineTimer) clearTimeout(this.lineTimer);
    this.lineTimer = window.setTimeout(() => { this.line.classList.remove("on"); }, this.lineT * 1000);
  }
  clear() { this.token++; this.queue.length = 0; if ("speechSynthesis" in window) speechSynthesis.cancel(); if (this.playing) { this.playing.pause(); this.playing = null; } this.busy = false; this.line.classList.remove("on"); }
}
