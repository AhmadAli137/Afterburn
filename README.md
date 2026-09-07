# AFTERBURN 🛩️

An endless flight through a dream that never quite resolves. Vanilla Three.js + Vite, no assets — the terrain is a ridged-noise heightfield, the sky is a shader dome, the afterburner plumes are shader cones with shock diamonds, and every sound is synthesized.

## The world

The course is a loop of eight sectors, each with its own ground: the valley, the shelf (terraced mesas), the canyon, the mirror sea, spire forest, the ridge (the floor climbs to a pass), the graveyard (a monolith field) and the reach. Forests grow on the slopes, islands hang high, and four landmarks sit at fixed points — fly under the Arch for a bonus. The HUD tells you which sector you're in and how far you've flown.

A broken cloud deck hangs at around 1,900 m. Fly into it and the world goes white and nobody can see you, which makes it cover in a sortie. Climb out above it for the moonlit tops and the long view down.

## Two ways to fly

- **FLIGHT** — the endless run. Roll down the runway, rotate, and go. Thread the neon gates for streak multipliers, dodge the crystal, fly over the ranges or through the valleys. The world re-colours itself every ~28 seconds — violet dusk, abyssal teal, ember rose, mint hollow.
- **SORTIE** — five waves of hostile jets with real airspeed. Light the burner to close to knife range, brake to let them pull ahead. From wave 4 some will throttle back and drop onto your six (the first three waves stay in front of you); the reversal or a cobra makes them overshoot. Attacks are telegraphed — a jet lights its burner and flashes red before it fires — and when rounds are inbound an amber TAKING FIRE banner says where from and an amber ring rides each round on screen, growing as it closes; a round that misses cracks past the canopy. Red on screen means one thing only: you were hit. Cannon for the close ones, missiles for the rest — but there are only ever three on the rails. One comes back every third kill and one at the end of a wave, so a missile is a decision. It needs a lock, then it drops off the rail, lights its motor a beat later and flies out and up clear of you before it turns onto the target, trailing a smoke column you can follow all the way in. It can miss. Clear the last wave and you're ordered home: line up, flare, and land it.

## Controls

| | |
|---|---|
| **Mouse** (or arrows) | the jet flies toward your cursor — small moves are small corrections, the edges are hard turns |
| **W / S** · **A / D** | throttle up / down · rudder: skid the nose without banking, and the cannon aims where the nose points |
| **SPACE** (or hold click in FLIGHT) | afterburner — the meter refills, gates top it up |
| **Right click** (or Q / E) | tap: a barrel roll the way the mouse is moving. The lift vector goes round with the wings, so the jet flies a corkscrew and comes out several lengths off its old line — which is the point, because you are untouchable through most of it. Hold: it keeps rolling for as long as you hold it (+50 per turn in FLIGHT) |
| **SHIFT** | airbrake — bleed speed, tighten the turn |
| **SHIFT + pull up** (or SHIFT + right click, or C) | reversal — chop the throttle and circle back; anything on your six flies straight past |
| **V** | cobra — the nose comes up past the vertical, the airframe becomes an airbrake, and everything behind you overshoots |
| **SHIFT + push down** (or Z) | split-S — roll inverted and pull through a downward loop; trades height for a fast, low exit, needs room underneath |
| **B** | immelmann — half loop up and roll out on top; a fast climb that costs airspeed |
| **Click / X** · **R / Ctrl / middle click** | SORTIE: cannon · missile when the lock box turns solid (three of them, and the rack refills slowly) |
| **ESC / P** | pause (auto-pauses when the tab loses focus) |
| **M** · **F** | mute · fullscreen |

Touch screens: drag anywhere to steer (release to level off) and use the on-screen BOOST / ROLL / BRAKE buttons, plus FIRE / MSL in a sortie.

Dive to gain speed, climb to lose it, and the nose sits where the aeroplane is actually going: the same rate of climb is a steep attitude when you are slow and a shallow one when you are fast. Point it down and the camera stays high and looks out over the nose while the ground fills the frame and the airflow rises to a roar; pull up and the camera drops and lets the jet stand on its tail against the sky. A hard pull streams vapour off both wingtips — thick down low where the air is wet, gone in the thin air on top, where the engines leave contrails instead.

A belly scrape on the ground costs a shield and a lot of energy; a nose-first dive is fatal. Punch through crystal and it shatters — so does your shield. Clip it with a wingtip instead and you ricochet off it: chips fly, the shield holds, but the wing that touched is the wing that stops, and the jet departs — rolled hard over and dragged off its line by its own bank. Any hard impact does that — crystal, a bandit, the ground. Recovery is aerodynamics: the rates run down against the wings wanting to fly again and the roll settles the short way to the nearest upright, so a bad one rolls all the way through rather than winding back. Push the stick against the roll and it settles in half the time. Until it does the jet answers slowly, and a wing in the ground is still a wing in the ground. Ram a bandit and you both pay. Damage shows: a hurt jet trails smoke, then fire, and answers the stick slower on its last shield.

Every so often a white crystal appears ahead. Grab it for six seconds of **laser**: hold fire and the beam vaporizes anything on the line — bandits, their rounds, and crystal spires for bonus points.

Best scores per mode and the sound setting persist on-device; every run ends with a stats sheet.

## The look

The title screen is an attract reel: while the menu is up the jet flies itself and a cut-together sequence of eight shots plays under letterbox bars — a fly-by in the valley, under the Arch, a wing cam, skimming the mirror sea, a whale pass, a head-on over the ridge, a gate run through the graveyard, and a climb up through the cloud deck to the Beacon. `H` shows the controls.

Surfaces are textured, still with no assets: rock striations on the ranges and islands, panel seams and rivets on the airframes, aggregate on the runway, all drawn on canvases at startup with normal maps baked from their own height fields. Reflections are real: a small cube map of the sky is refreshed every few frames and the airframes, canopies and water reflect it, and in the mirror sea the water is a planar mirror — the scene is re-rendered from below the surface and composited through the ripples, so the jet, the islands and the gates hang upside down in it. The mirror is switched off in performance mode and on touch devices.

```bash
npm install
npm run dev      # local
npm run build    # dist/
```

**Performance.** On a discrete GPU the game runs far above refresh rate. On an integrated GPU it hovers around 40–60 fps and will switch itself into performance mode (bloom off, lower resolution) if it can't hold ~33 fps. On a hybrid laptop, make sure your browser is set to the high-performance GPU in Windows *Graphics settings*, otherwise it quietly runs on the integrated chip. `?low` forces performance mode.

`?fly` skips the title screen. `?rtb` starts a sortie at the return-to-base leg, for practising landings. `?shot=N` jumps the title reel to shot N (0–7).
