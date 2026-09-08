# AFTERBURN 🛩️

An endless flight through a dream that never quite resolves. Vanilla Three.js + Vite, no assets — the terrain is a ridged-noise heightfield, the sky is a shader dome, the afterburner plumes are shader cones with shock diamonds, and every sound is synthesized.

## The world

The course is a loop of eight sectors, each with its own ground: the valley, the shelf (terraced mesas), the canyon, the mirror sea, spire forest, the ridge (the floor climbs to a pass), the graveyard (a monolith field) and the reach. Forests grow on the slopes, islands hang high, and four landmarks sit at fixed points — fly under the Arch for a bonus. The HUD tells you which sector you're in and how far you've flown.

A broken cloud deck hangs at around 1,900 m. Fly into it and the world goes white and nobody can see you, which makes it cover in a intercept. Climb out above it for the moonlit tops and the long view down.

## Two ways to fly

- **FLIGHT** — the endless run. Roll down the runway, rotate, and go. Thread the neon gates for streak multipliers, dodge the crystal, fly over the ranges or through the valleys. ## Awe and dread

The palette cycle alternates two moods. **Awe** is luminous: the fog opens out, colour is pushed, the ground is lifted so nothing is a silhouette. **Dread** closes the fog in, drains the colour, drops the exposure and puts real shadow back under everything, and turns the sun red. Violet dusk and mint hollow are the awe palettes; the forge and the drowned are the dread ones. Midnight leans toward dread, and the blood moon and the eclipse take it all the way.

The sun is a burning disc with a darkened limb and granulation crawling over it, so when the small moon crosses it you get a black disc ringed by the corona and the light goes out of the world. On the mirror sea the water is a true planar mirror: your own jet, the islands, the spires and the clouds all hang upside down in it, with the sun laying a path across the ripples.

The world re-colours itself every ~28 seconds — violet dusk, abyssal teal, ember rose, mint hollow.
- **INTERCEPT** — five waves of hostile jets with real airspeed. Light the burner to close to knife range, brake to let them pull ahead. From wave 4 some will throttle back and drop onto your six (the first three waves stay in front of you); the reversal or a cobra makes them overshoot. Attacks are telegraphed — a jet lights its burner and flashes red before it fires — and when rounds are inbound an amber TAKING FIRE banner says where from and an amber ring rides each round on screen, growing as it closes; a round that misses cracks past the canopy. Red on screen means one thing only: you were hit. Cannon for the close ones, missiles for the rest — but there are only ever three on the rails. One comes back every third kill and one at the end of a wave, so a missile is a decision. It needs a lock, then it drops off the rail, lights its motor a beat later and flies out and up clear of you before it turns onto the target, trailing a smoke column you can follow all the way in. It can miss. Clear the last wave and you're ordered home: line up, flare, and land it.

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
| **SHIFT + push down** (or Z) | split-S — roll inverted and pull down through half a loop; comes out reversed, fast and low, needs room underneath |
| **B** (or **C**) | immelmann — pull up through half a loop and the world turns round you at the top: what was on your six is on your nose. Three seconds, and you are open for the second half |
| **Click / X** · **R / Ctrl / middle click** | INTERCEPT: cannon · missile when the lock box turns solid (three of them, and the rack refills slowly) |
| **ESC / P** | pause (auto-pauses when the tab loses focus) |
| **M** · **F** | mute · fullscreen |

Touch screens: drag anywhere to steer (release to level off) and use the on-screen BOOST / ROLL / BRAKE buttons, plus FIRE / MSL in a intercept.

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

`?fly` skips the title screen. `?rtb` starts a intercept at the return-to-base leg, for practising landings. `?shot=N` jumps the title reel to shot N (0–7).

## Music

Three tracks, all free to use, credited in [CREDITS.md](CREDITS.md):

- **Newer Wave** and **Neon Laser Horizon** by Kevin MacLeod ([incompetech.com](https://incompetech.com)), licensed under [Creative Commons: By Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Title screen and INTERCEPT.
- **Calm Ambient 2 (Synthwave 15k)** by The Cynic Project ([cynicmusic.com](https://cynicmusic.com)), released CC0 via [OpenGameArt](https://opengameart.org/content/calm-ambient-2-synthwave-15k). FLIGHT.

The music has its own volume in settings and ducks with the rest of the mix when you pause.

## The sortie, grown up

**INTERCEPT** is waves of bandits and a landing, and now the landing might be a trap aboard the carrier if the sea is ahead. Interceptors shoot missiles from wave two; SAM sites on the shelf and the ridge shoot first. Answer a missile three ways: flares (**T**, four per sortie, only close in), the notch (a hard sideways beam holds the bearing still and the seeker loses it), or the cloud deck. Tracers and missile plumes are colour-coded so you can read a furball at a glance: cyan-white is yours, blue is Two, red is theirs. The radar warning receiver beside the shield shows every emitter by bearing: A for a chaser, I for an interceptor, M for a missile, dots for rounds inbound.

Bombs (**N**, six) fall ballistically; the CCIP pipper on the glass is where one released now lands. Radar domes, SAM sites and depots die to bombs or the cannon, which now has 300 rounds. **Two** flies your left wing (Settings can leave him at home; the escort missions keep him), calls what he sees, and takes a shot when you drag a bandit across his nose; he can be hit, and losing him costs more than any kill earns.

The aeroplane is a set of systems. Fuel burns (the burner five times faster) and only a landing puts it back; bingo is called at a quarter, and empty is a glider. Under the stall speed the wing gives up in proportion: the nose drops, the controls go soft, and a pull drops a wing. Hits take systems: a wing halves the roll, an engine caps the thrust, hydraulics put lag in the stick. Landing gear (**G**) has to be down or the runway is a belly scrape, and the horn tells you. **L** holds altitude until the hand moves. A sustained pull past the limit greys out, then goes black.

**Missions** (title screen): six briefings on the loop, each a different job: an intercept with Two, a shelf strike on four SAM sites, a carrier recovery on the mirror sea, an escort through the canyon, radar domes in the graveyard, and a night trap under the full moon. **Daily**: the endless flight from a start the date picks, with the ghost of your best run of the day flying beside you and a board on this device. **Loadout**: XP from every run unlocks a longer-burning missile motor, an extended gun, drop tanks, and the Viper airframe.

Every sector has its own business: treetop runs in the valley, gusts in the canyon and a bonus for staying below the rim, sea-skimming gates over the mirror sea, chain-shattering crystal in the spire forest, lift and sink over the ridge with a bonus for crossing the pass low, the interceptor nest in the graveyard, and the long head-on intercepts of the reach. A knife-edge pass through a gate scores double; near misses chain; a burner pass through a gate tops the meter up and locks the throttle for two seconds.

Settings has a flight-model switch: arcade keeps the soft edges of the envelope and the auto-level; realistic removes the walls, brings the stall earlier, and lets hits take systems in every mode.

## The voice

The copilot on the radio is an ElevenLabs voice ("Adam", deep, American, and not entirely respectful) and Two is "Chris". Every event has several lines and he never repeats the one he just used; only one line is ever on the air at a time, and a warning cuts through whatever he was saying. Every line is rendered once by `scripts/voice.mjs` from `scripts/voicelines.json` into `public/voice`, played through a headset band-pass with a squelch click either side, and printed on the comms line. Lines without a clip fall back to the browser's own speech. To re-render after editing the script, set `ELEVENLABS_API_KEY` and run `node scripts/voice.mjs`.
