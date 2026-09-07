/* The music bed. Three tracks, all free to use and credited (see CREDITS.md):
   one for the title reel, one for the endless flight, one for the sortie.
   Each is an <audio> element routed through the mixer so it obeys the volume
   and the pause duck, and switching tracks is a crossfade, never a cut. */

export interface Track { key: string; file: string; title: string; artist: string; credit: string }
export const TRACKS: Track[] = [
  { key: "title", file: "music/newer-wave.mp3", title: "Newer Wave", artist: "Kevin MacLeod", credit: "Newer Wave — Kevin MacLeod (incompetech.com) · CC BY 4.0" },
  { key: "flight", file: "music/calm-ambient-2.mp3", title: "Calm Ambient 2", artist: "The Cynic Project", credit: "Calm Ambient 2 — The Cynic Project (cynicmusic.com) · CC0" },
  { key: "war", file: "music/neon-laser-horizon.mp3", title: "Neon Laser Horizon", artist: "Kevin MacLeod", credit: "Neon Laser Horizon — Kevin MacLeod (incompetech.com) · CC BY 4.0" },
];

interface Slot { track: Track; el: HTMLAudioElement; gain: GainNode | null; level: number; target: number }

export class Music {
  private slots = new Map<string, Slot>();
  private current: string | null = null;
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private wantKey: string | null = null;
  volume = 0.6;
  private ready = false;
  onTrack: ((t: Track) => void) | null = null;

  /** Hand over the mixer once it exists (after the first gesture). */
  attach(ctx: AudioContext, into: AudioNode) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = this.volume; this.bus.connect(into);
    for (const s of this.slots.values()) this.wire(s);
    this.ready = true;
    if (this.wantKey) this.play(this.wantKey);
  }
  private slot(key: string): Slot {
    let s = this.slots.get(key);
    if (s) return s;
    const track = TRACKS.find((t) => t.key === key) || TRACKS[0];
    const el = new Audio();
    el.src = import.meta.env.BASE_URL + track.file;
    el.loop = true; el.preload = "none"; el.crossOrigin = "anonymous";
    s = { track, el, gain: null, level: 0, target: 0 };
    this.slots.set(key, s);
    if (this.ctx) this.wire(s);
    return s;
  }
  private wire(s: Slot) {
    if (!this.ctx || !this.bus || s.gain) return;
    const src = this.ctx.createMediaElementSource(s.el);
    s.gain = this.ctx.createGain(); s.gain.gain.value = 0;
    src.connect(s.gain).connect(this.bus);
  }
  /** Crossfade to a track; safe to call before the mixer exists (it plays when it can). */
  play(key: string) {
    this.wantKey = key;
    if (!this.ready) return;
    if (this.current === key) return;
    const s = this.slot(key);
    if (this.current) { const old = this.slots.get(this.current); if (old) old.target = 0; }
    this.current = key;
    s.target = 1;
    s.el.play().then(() => { if (this.onTrack) this.onTrack(s.track); }).catch(() => { /* no gesture yet: resume() will try again */ });
  }
  /** After a user gesture: kick whatever should be playing. */
  resume() {
    if (this.wantKey && this.ready) {
      const s = this.slots.get(this.wantKey);
      if (s && s.el.paused) s.el.play().then(() => { if (this.onTrack) this.onTrack(s.track); }).catch(() => {});
    }
  }
  setVolume(v: number) {
    this.volume = v;
    if (this.bus && this.ctx) this.bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  /** Per frame: run the crossfades, park tracks that have faded out. */
  update(dt: number) {
    if (!this.ctx) return;
    for (const s of this.slots.values()) {
      if (Math.abs(s.level - s.target) < 0.002) { if (s.target === 0 && !s.el.paused) s.el.pause(); continue; }
      s.level += (s.target - s.level) * (1 - Math.pow(0.15, dt));
      if (s.gain) s.gain.gain.setTargetAtTime(s.level * s.level, this.ctx.currentTime, 0.05);
    }
  }
  nowPlaying(): Track | null { return this.current ? this.slot(this.current).track : null; }
}
