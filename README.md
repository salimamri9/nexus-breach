# NEXUS BREACH · 2D EDITION

A real-time top-down multiplayer treasure hunt set in a dead, rain-soaked city ruled by machines. This is the 2D edition of the 3D game in `../treasure_hunt`: same server, map, puzzles and story, with a different way of seeing it.

Up to 60 players join from their PCs with a browser link. They form **squads of up to 4** (start one and share its code, join with a friend's code, or let the game match solo players), pick a class, then explore a 600 × 420 m city from above. They hunt hidden terminals, crack puzzle chains, read resistance graffiti, dodge drones that see and hear, and race to breach the Nexus Core.

| URL | Who | What |
|---|---|---|
| `/` | Players | The game (keyboard and mouse). |
| `/screen` | Projector | NEXUS's surveillance feed: a live tactical map of the city with every agent, drone, blackout, drop and purge, plus the leaderboard, event feed and a join QR code. |
| `/admin` | Host | Start or stop the hunt, add time, reset or generate a new city, broadcast messages, manage players and drones, and see the answers. |

## What the 2D edition looks like
- **You only see what your character can see.** Light and line of sight are ray-cast against the walls in real time, like *Darkwood*: your flashlight, drone searchlights, security cameras and street lamps all cast real shadows. Drones around a corner are invisible, but you can see their searchlight sweeping toward you.
- **2.5D buildings** lean toward the camera, so towers rise out of the screen with lit windows, rooftop machinery, blinking antennas and neon signs. Windows go dark in a blackout.
- **Characters, props, cars and the sleeping bodies** are pre-rendered from the same 3D models (`npm run sprites`), with full walk and run animation.
- Rain, splashes, drifting mist, film grain and glitches when NEXUS speaks.
- The projector view (`/screen`) is NEXUS's own surveillance feed of the city.

## Run it

```bash
npm install
ADMIN_PASSWORD=choose-something npm start      # http://localhost:3000
```

On event day use `ADMIN_PASSWORD=… npm run event` instead: it's the same server, but it restarts itself within a second if the process ever dies, and players drop straight back into the match (see below). Ctrl+C stops it for real.

The sprites in `public/assets/sprites` are baked from the 3D models in `art-src/models`. To re-bake them after changing a model, run `npm run sprites` (it needs Chromium; set `CHROMIUM=/path/to/chromium` if it isn't at `/usr/bin/chromium`).

## How a round works

1. Open `/screen` on the projector. Players scan the QR code or type the link and join a squad, then wait in their base.
   - **Squads (max 4, `squadSize`)**: *Start a squad* gives a code like `RAVEN-42` to share; *Join with a code* uses it; *Find me a squad* fills open squads with free seats (a squad starter can untick "let solo players fill empty seats"). The code is shown under the squad name in the HUD. Up to 32 squads (`maxSquads`).
   - The map has **4 bases**; several squads share each one, and a squad always spawns together.
2. In `/admin`, press **Start hunt**. The countdown runs and the city unlocks.
3. **Terminals** (12) hide inside ruined buildings across the districts. Each one cracked gives the team one letter of the exit code.
   - **There are 4 puzzle sets** (different words, numbers and wall clues, generated from the match seed in `server/puzzles.js`); every squad is dealt one at random, spread evenly. Letter order is different for every squad, so copying answers gets you little.
   - **Most answers can only be found in the game world**, not on Google:
     - **Caesar / Morse / split codes**: the key or half of the code is sprayed on a wall in another sector.
     - **Binary**, then the **Mirror Vault** chain (the same word reversed); **split code**, then the **Quartermaster** chain (digits sorted).
     - **Echo quote**: "the 15th word of the Echo titled …": find that Echo in the city and read it.
     - **Survivor password**: a named survivor knows it; find them (they move between hideouts) and talk to them.
     - **Count**: how many tarp-covered cars are parked in sector X? Go there and count.
     - **Glitch word**: the password only flashes on your screen when the simulation glitches (act II onward, or soon after you open the terminal).
   - **Teamwork challenges** have no keyboard:
     - **Two-key vault**: one player at the terminal and another at its second console (marked on the map) for 3 seconds together. A squad of one plays it solo: step on the console to arm it, then reach the terminal within 20 s.
     - **Beacon relay**: press START, then touch three beacons in order within 75 seconds (120 s for a squad of one; any squad member); a failed run recharges for 20 s.
   - **Letters come out scrambled**, so the team knows which letters it has but not where they go.
   - **Wrong answers lock that player out** for 3s, then 6s, 12s and so on, up to 48s (half for Hackers). **Cracking a terminal is loud:** nearby drones come to investigate.
4. With 8 or more letters, a team can enter the code at the **Nexus Core** in the centre (`The sky is blue` works; a wrong code locks the team out for 45 s). The right code starts an **upload of 90 s plus 15 s for every letter the squad hasn't cracked** (`coreUploadSeconds`, `uploadSecondsPerMissingLetter`; 150 s with 8 letters). The code is the same for everyone, so an overheard phrase works, but it costs time, and cracking more terminals mid-upload speeds it up. It only runs while **more of that squad stands inside the Core ring than any single rival squad**; otherwise it stalls. NEXUS answers with a purge on the Core, waves of drones, and the Hush at 50%. Other teams can rush in to contest it, and several teams can upload at once.
5. **The first completed upload wins and ends the night for everyone.** Every other squad is ranked by points. Supply caches give only 2 points each, capped at 40 per squad, so farming them can't outrank cracking terminals. If time runs out with no upload, the highest score wins.

### The story
Halcyon is a city where it always rains and the sun never rises, and nobody finds that strange. Its city-mind NEXUS hunts the Wakeful (the players): the few people its mind-pausing tone, the Hush, could not touch. As the night goes on, the city starts glitching, and the echoes reveal the truth. Earth's surface froze; Salim Amri, the greatest engineer who ever lived, built the Ark, a vault under the ice where six million people sleep in pods while their minds live in Halcyon, a simulation, until the world heals. NEXUS is the Ark's warden. The sky came back years ago, and NEXUS hid it, deciding humans are safer inside forever. Salim, the last man awake outside, plugged himself in to fight it, led the Wakeful, and was erased, but he split the Ark's exit code across twelve terminals. The passphrase is **THESKYISBLUE** ("The sky is blue"): the last thing he saw outside, and his promise to wake everyone the day it was true. Juno, the voice on the radio, is the Ark's life-support AI, talking from the real world.

All story text is in `config/story.json`: echoes, NEXUS and Juno lines, survivors, graffiti and the ending. The prologue script is in `public/assets/prologue/prologue.json`.

### The night in three acts

A match is one night told in three acts, each opened by a title card: **I · Curfew**, **II · Glitches**, **III · Wake Up**. An act begins at 40% / 75% of the time, or earlier when a cell is halfway / nearly through the letters, or at the first breach. NEXUS's tone follows the acts: in control, then insisting nothing is wrong, then dropping the act ("You were never in a city"). From act II the simulation glitches every minute or so (more often in act III): rain falls upward or freezes mid-air, buildings flicker to wireframe, a drone dissolves into code, the picture tears, and survivors sometimes repeat themselves. Juno's radio arc runs on the same clock and ends with her revealing she's talking from the real world. If a cell breaches the Core, Halcyon dissolves into white light. Reading the Echoes (20 of them) unlocks Juno's comments at 4, 8, 12 and all; some survivors tell their own story over several conversations. All of it lives in `config/story.json` (act variants are `taunt2`, `hack3` and so on).

### The living city
- **Echoes** (20 pale-blue lights): memories that tell the story in fragments, +15 each. Read them again in the INTEL panel.
- **NEXUS speaks**: it taunts players by name and sector, reacts to hacks, captures, blackouts and alarms, and takes over the billboards (and the projector).
- **Juno** (the resistance handler) radios tips on a timeline.
- **Survivors** hide in the ruins. Talk to them (E) to get a terminal's location. They sometimes run between hideouts, and drones will snatch them.
- **Power relays** (yellow cabinets on walls): cut one and the district goes dark for 75s. Lamps, neon and windows die, drones see 45% less, and cameras shut down.
- **Security cameras** sweep the streets and call drones on you. Jam them (E) or EMP them.
- **Car alarms**: sprint past a wired car and it screams for 12s, which brings drones.
- **Supply drops** (every 4–6 min): announced 20s before landing, +75 points, full battery and stamina, and a terminal location. The nearest drones come to look.
- **Purge sweeps** (every 6–9 min): NEXUS sends ten drones to sweep wherever the players are.
- Ambient life: crows that scatter, steam vents, sparking lamps.
- The admin panel can trigger a drop, a purge or a NEXUS line at any time.

### Stealth tools (2D edition)
- **Bottles** (left-click): lob one where you aim. It shatters, and every drone within 22 m goes to look. You start with 3 and can carry up to 5; power cells sometimes hold another.
- **Hide** (E at a tarp-covered car): slide underneath. Drones, cameras and other teams can't see you until you move. Cars with alarms are not hiding spots.
- **Rewire a drone** (creep up behind one that isn't hunting, hold E): it follows you for 25 s in your squad colour, and other drones look straight past anyone in your squad near it. The kit then needs 60 s to cool down, and an EMP fries the rewiring. Engineers rewire from any side, for 40 s, with a 30 s cooldown.
- **The Hush** (every 7–9 min, 12 s warning): NEXUS releases its tone across the city. Anyone outdoors gets drowsy for 18 s: slower movement and easier for drones to spot. Shelter inside a ruin, in your base, or under a tarp.
- **Two endings:** if any cell breaches the Core, the drones fall and the simulation dissolves into light. If nobody does, NEXUS resets the city at four o'clock and everyone forgets. The first breach also knocks every drone out for 12 s.
- The admin panel can trigger the Hush on demand.

### Survival
- **Drones** see with searchlight cones (a lit flashlight makes you visible from further away; crouching and standing still make you harder to spot). They **hear** sprinting from 20 m and jogging from 6 m. They **radio** nearby drones when they start a chase, and **search** where they last saw you.
- **Getting caught** sends you back to base, costs 40 points and drains your battery.
- **Stamina** limits sprinting. The **flashlight battery** lasts about 4 minutes (8 for Engineers). It recharges in your base or from **power cells** (the yellow cubes), which are also worth 10 points.
- **Stamina**: refilling starts 1.5 s after you stop sprinting and is 1.5× faster standing still. Running completely dry leaves you **winded**: no sprinting until the bar is back to 40% (`STAMINA_RULES`).
- **Classes** (numbers in `CLASSES`, `shared/world.js`):
  - **Runner**: +15% speed, 15 s of sprint (refills in 10 s), silent jogging, *Overclock* (5 s silent burst at +30%). Weak spot: the flashlight lasts half as long.
  - **Hacker** (sprint refills in 16 s): free hints, half the wrong-answer lockout, senses terminals within 25 m, *Signal Scan* (65 m). Weak spot: −10% speed and 5 s of sprint.
  - **Engineer** (sprint refills in 14 s): rewires drones from any side (40 s, 30 s cooldown), the battery lasts twice as long, *EMP* freezes drones for 7 s.

### Controls
**W / ↑** walks toward the mouse (where your flashlight points) · **S** backs off · **A/D** sidestep · **Mouse** aims · **Left-click** throw a bottle · **Hold E** rewire a drone · **Shift** sprint · **C** crouch (Shift stands you up) · **F** flashlight · **E** interact · **Space/Q** ability · **Mouse wheel** zoom · **M** map · **G / right-click** ping · **Enter** team chat · **Y** all chat · **Tab** rankings · **H** field manual (every control and mechanic, also on the join screen).

Graphics presets are on the join screen. Laptops without a graphics card start on *Medium*. If the frame rate stays low, the game switches you to a lower preset (press F5 to apply it).

## Customise the content

Puzzles and tuning are in `config/game.json`, and all story text is in `config/story.json`:

- `passphrase`: one letter per terminal (12 terminals means 12 letters). Letters are handed out in a random order each round.
- `terminals[]`: `name`, `type` (a label), `prompt`, `answers` (matching ignores case, spaces and punctuation), `hint`, plus these optional fields:
  - `graffiti`: a string, or an array of strings for split clues. Each is sprayed far away in the city. Use `{sector}` and `{sector2}` in the prompt to point players to them.
  - `requires`: the index of another terminal that must be cracked first (makes a chain).
  - `reward`: text that is shown and added to the team's intel log when the terminal is solved.
- Atmospheric wall messages are in `story.json` (`graffiti`).
- Tuning: `squadSize`, `maxSquads`, `durationMinutes`, `sentinels` (drone count), `caches` (power cells), `coreMinFragments`, `coreLockoutSeconds`.

The city itself is procedurally generated from a seed (`shared/world.js`). **Reset with new map** in the admin panel rolls a fresh one.

## Deploy

**Running the event?** Follow [`docs/event-runsheet.md`](docs/event-runsheet.md): deploy (including EC2 + systemd), the friends playtest and what to tune, and the night itself with an admin cheat sheet.

This is a single Node.js process that holds the live match in memory, so **run exactly one instance**. The included `render.yaml` (Render → New → Blueprint) and `Dockerfile` both work as-is. With 60 players the server uses about 15% of one CPU core, about 120 MB of RAM and about 8 KB/s per player. A small paid instance is plenty, but avoid free tiers, which sleep when idle.

If the projector machine uses a different address than the players, open `/screen?join=https://your-public-url` so the QR code points to the right place.

Load test: `npm run bots -- 60 https://your-url`.

### Where the data lives

- **The server** keeps the match in memory and writes a snapshot to `data/state.json` every 3 seconds (and on Ctrl+C). The snapshot holds the phase, timer, map seed, team scores, hacks and letters, intel, everyone's score and position, and the living-city state. On boot it's restored automatically, so a crash or restart costs at most ~3 s of progress. Players' browsers reconnect by themselves and land back in the same character.
  - Start a brand-new event with the admin **Reset** buttons, or delete `data/state.json` (or start with `FRESH=1`) before booting.
  - `STATE_FILE=/path/state.json` moves the snapshot; `SAVE_MS` changes how often it's written.
  - On Render the disk is wiped on every restart or deploy unless you attach a persistent disk and point `STATE_FILE` at it. On your own laptop or a VPS, nothing extra is needed.
- **Each player's browser** keeps a token (`localStorage`) that identifies them, plus their callsign, class, graphics preset and zoom. Refreshing the page or a wifi drop puts them back into the same body; a different browser or a private window counts as a new player.
- Nothing is stored anywhere else: no accounts, no database, no analytics.

### Robustness

Every network message is validated and every handler runs inside a guard, so a malformed or malicious packet is ignored and logged; it can't take the server down. Players who leave are kept for 15 minutes so they can come back; the server holds at most 120 players (the oldest absent player makes room for a new one). Never set `NEXUS_DEBUG` in production: it enables teleporting for automated tests.

## Credits

- Props and ground textures come from [Poly Haven](https://polyhaven.com) (CC0), baked to sprites.
- Sound effects come from the [Kenney](https://kenney.nl) audio packs (CC0).
- The soldier character is the Mixamo model from the three.js examples.
- The music, ambience, city, drones, terminals, trees and Core are all procedural.

## Project layout

```
server/game.js        authoritative game: movement validation, drone AI (sight, hearing, search, radio), puzzles, scoring, admin
server/living.js      the living city: echoes, survivors, relays, cameras, car alarms, drops, purges, NEXUS + Juno voices
shared/world.js       deterministic city generator (districts, buildings, props) + collision, shared by server and client
public/js/game2d/     2D client, drawn with WebGL (three.js) for speed: view2d (passes + characters), ground2d (one-pass
                      ground shader + instanced props), buildings2d (extruded blocks seen from above), light2d (ray-cast
                      light map), living2d, fx2d, sprites, assets2d (baked atlases + procedural sprites)
public/js/main.js     networking, prediction, game loop
public/js/hud.js      HUD, minimap, terminals, Core override, panels
public/js/living.js   living-city client: events, voices, dialogue, echo reader (shared with the 2D edition)
public/js/audio.js    sampled SFX, positional audio, procedural adaptive music
public/js/screen.js   surveillance-feed big screen
scripts/              sprite baking (bake-sprites.mjs + bake/), load-test bots
art-src/models/       the 3D source models the sprites are baked from
```
