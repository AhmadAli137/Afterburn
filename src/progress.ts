/* Progression, the daily seed, the local board and the ghost. All on the
   device. A leaderboard provider interface stands where a server would go:
   the local one is real, the remote one is a stub that says so. */

export interface Loadout { missileRange: boolean; gunRounds: boolean; dropTank: boolean; airframe: "hawk" | "viper" }
export interface Progress {
  xp: number; missions: Record<string, number>; unlocks: string[]; loadout: Loadout;
  daily: { date: string; best: number; ghost: number[] | null }; board: { name: string; score: number; mode: string; date: string }[];
}
export const UNLOCKS: { id: string; name: string; desc: string; xp: number }[] = [
  { id: "missileRange", name: "LONG-BURN MOTOR", desc: "missiles reach 40% further and turn harder", xp: 1500 },
  { id: "gunRounds", name: "EXTENDED GUN", desc: "500 rounds instead of 300", xp: 3000 },
  { id: "dropTank", name: "DROP TANKS", desc: "40% more fuel, a little less agility", xp: 5000 },
  { id: "viper", name: "VIPER AIRFRAME", desc: "faster and slipperier; turns wider, brakes harder", xp: 9000 },
];
const KEY = "afterburn-progress";
export const progress: Progress = { xp: 0, missions: {}, unlocks: [], loadout: { missileRange: false, gunRounds: false, dropTank: false, airframe: "hawk" }, daily: { date: "", best: 0, ghost: null }, board: [] };
try { Object.assign(progress, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
export function saveProgress() { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch {} }
/** XP in; anything newly affordable is unlocked and reported. */
export function grantXp(n: number): string[] {
  progress.xp += Math.max(0, Math.round(n));
  const fresh: string[] = [];
  for (const u of UNLOCKS) if (progress.xp >= u.xp && !progress.unlocks.includes(u.id)) { progress.unlocks.push(u.id); fresh.push(u.name); }
  saveProgress();
  return fresh;
}
export const todayKey = () => new Date().toISOString().slice(0, 10);
/** A day's seed: the same for everyone on that date. */
export function dailySeed(): number { const d = todayKey(); let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 100000; }
/** A tiny seeded generator for anything that must match across players on a day. */
export function seeded(seed: number): () => number { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export interface Board { submit(name: string, score: number, mode: string): Promise<void>; top(mode: string, n: number): Promise<{ name: string; score: number; date: string }[]>; readonly kind: string }
export const localBoard: Board = {
  kind: "this device",
  async submit(name, score, mode) { progress.board.push({ name, score, mode, date: todayKey() }); progress.board.sort((a, b) => b.score - a.score); progress.board = progress.board.slice(0, 50); saveProgress(); },
  async top(mode, n) { return progress.board.filter((b) => b.mode === mode).slice(0, n); },
};
/** Where a shared board would go. It needs a server; until one exists it reports honestly. */
export const remoteBoard: Board = {
  kind: "global (not connected)",
  async submit() { /* no server configured */ },
  async top() { return []; },
};
