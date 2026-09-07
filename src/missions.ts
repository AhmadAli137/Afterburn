/* Missions. Each one is a briefing, a start point on the loop, what the sky
   throws at you, what you must do, how it can fail, and where you land. The
   loop's sectors are the stage: the same terrain, a different job each time. */

export type Objective = "intercept" | "strike" | "escort" | "recovery";
export interface Mission {
  id: string; name: string; tag: string; briefing: string; objectives: string[];
  course: number; waves: number; kind: Objective;
  /** ground targets to kill for a strike */
  targets?: number;
  land: "runway" | "carrier";
  wingman: boolean;
  /** force the sky */
  midnight?: boolean;
  fail: string;
}

export const MISSIONS: Mission[] = [
  { id: "m1", name: "FIRST LIGHT", tag: "SECTOR 01 · THE VALLEY", course: 60, waves: 3, kind: "intercept", land: "runway", wingman: true,
    briefing: "Three waves of bandits are working the valley at low level. Meet them over the forests with Two on your wing, then bring both jets home to the strip.",
    objectives: ["Splash three waves", "Keep Two alive", "Land on the runway"], fail: "Two is lost, or you are." },
  { id: "m2", name: "SHELF STRIKE", tag: "SECTOR 02 · THE SHELF", course: 1020, waves: 2, kind: "strike", targets: 4, land: "runway", wingman: false,
    briefing: "Four SAM sites sit on the terraces of the shelf. They will shoot first. Get under their radar in the folds, put bombs on all four, then fight your way out.",
    objectives: ["Destroy four SAM sites", "Survive the CAP", "Land on the runway"], fail: "Bingo fuel, or a missile finds you." },
  { id: "m3", name: "MIRROR", tag: "SECTOR 04 · THE MIRROR SEA", course: 2980, waves: 2, kind: "recovery", land: "carrier", wingman: true,
    briefing: "The carrier is on the mirror sea. Two waves are inbound on her. Splash them, then come aboard: line up on the ball, hold the slope, catch a wire.",
    objectives: ["Splash two waves", "Trap aboard the carrier"], fail: "A bolter is fine. The water is not." },
  { id: "m4", name: "CANYON ESCORT", tag: "SECTOR 03 · THE CANYON", course: 1980, waves: 4, kind: "escort", land: "runway", wingman: true,
    briefing: "Two is hurt and has to go through the canyon on the deck. Four waves will try to finish the job. Stay on his wing, take the shots he cannot, and get him out the far end.",
    objectives: ["Four waves through the canyon", "Two survives", "Land on the runway"], fail: "Two goes down." },
  { id: "m5", name: "GRAVEYARD", tag: "SECTOR 07 · THE GRAVEYARD", course: 6020, waves: 3, kind: "strike", targets: 3, land: "carrier", wingman: false,
    briefing: "Three radar domes among the monoliths are cueing the interceptors. Kill the domes, weather the head-on passes, then recover aboard the carrier on the sea beyond.",
    objectives: ["Destroy three radar domes", "Survive the interceptors", "Trap aboard the carrier"], fail: "The domes stay up, or you do not." },
  { id: "m6", name: "MIDNIGHT", tag: "SECTOR 08 · THE REACH", course: 7020, waves: 3, kind: "recovery", land: "carrier", wingman: true, midnight: true,
    briefing: "Full moon, cloud deck, the reach. Three waves above the tops, then a night recovery down through the deck to the carrier. Trust the ball.",
    objectives: ["Splash three waves above the deck", "Night trap aboard the carrier"], fail: "Descend blind and you meet the sea." },
];
