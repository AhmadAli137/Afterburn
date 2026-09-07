/* The radio. Short calls, queued, with a squelch click either side, spoken
   by the browser's own speech synthesis where it has one (still no assets),
   and always printed on the comms line so the call is never missed with the
   sound off. Priorities: a warning interrupts chatter; chatter waits. */

export type Priority = 0 | 1 | 2; // 0 chatter, 1 call, 2 warning

interface Call { text: string; say: string; pri: Priority; t: number }

export class Radio {
  private queue: Call[] = [];
  private busy = false;
  private lastText = ""; private lastAt = 0;
  private voice: SpeechSynthesisVoice | null = null;
  volume = 1;
  enabled = true;
  private readonly line: HTMLElement;
  private lineT = 0;
  private lineTimer: number | null = null;

  constructor(line: HTMLElement, private squelch: (open: boolean) => void) {
    this.line = line;
    if ("speechSynthesis" in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        // a clear English voice; prefer the ones that sound like a headset and not a storyteller
        this.voice = vs.find((v) => /en[-_]/.test(v.lang) && /Google UK English Male|Daniel|Microsoft (Ryan|Guy|George)/.test(v.name))
          || vs.find((v) => /en[-_]/.test(v.lang) && !/female|Zira|Samantha/i.test(v.name)) || vs.find((v) => /en/.test(v.lang)) || null;
      };
      pick();
      speechSynthesis.addEventListener("voiceschanged", pick);
    }
  }

  /** Queue a call. Same text within four seconds is dropped; a warning jumps the queue. */
  call(text: string, pri: Priority = 1, say = text) {
    const now = performance.now() / 1000;
    if (text === this.lastText && now - this.lastAt < 4) return;
    this.lastText = text; this.lastAt = now;
    const c: Call = { text, say, pri, t: now };
    if (pri === 2) { this.queue = this.queue.filter((q) => q.pri === 2); this.queue.unshift(c); if (this.busy && "speechSynthesis" in window) speechSynthesis.cancel(); this.busy = false; }
    else { if (this.queue.length > 4) this.queue.shift(); this.queue.push(c); }
    this.pump();
  }

  private pump() {
    if (this.busy) return;
    const c = this.queue.shift();
    if (!c) return;
    // stale chatter is not worth the air
    if (c.pri === 0 && performance.now() / 1000 - c.t > 5) { this.pump(); return; }
    this.busy = true;
    this.show(c);
    this.squelch(true);
    let spoke = false;
    if (this.enabled && this.volume > 0.02 && "speechSynthesis" in window) {
      try {
        const u = new SpeechSynthesisUtterance(c.say);
        if (this.voice) u.voice = this.voice;
        u.rate = 1.12; u.pitch = 0.85; u.volume = Math.min(1, this.volume);
        u.onend = u.onerror = () => { this.done(); };
        speechSynthesis.speak(u);
        spoke = true;
        // a voice that never starts (no voices loaded, tab muted) must not hold the queue
        setTimeout(() => { if (this.busy && speechSynthesis.speaking === false) this.done(); }, 3500);
      } catch { spoke = false; }
    }
    if (!spoke) setTimeout(() => this.done(), 900);
  }
  private done() {
    if (!this.busy) return;
    this.busy = false;
    this.squelch(false);
    setTimeout(() => this.pump(), 180);
  }
  private show(c: Call) {
    this.line.textContent = c.text;
    this.line.classList.toggle("warn", c.pri === 2);
    this.line.classList.add("on");
    this.lineT = 3;
    if (this.lineTimer) clearTimeout(this.lineTimer);
    this.lineTimer = window.setTimeout(() => { this.line.classList.remove("on"); }, this.lineT * 1000);
  }
  clear() { this.queue.length = 0; if ("speechSynthesis" in window) speechSynthesis.cancel(); this.busy = false; this.line.classList.remove("on"); }
}
