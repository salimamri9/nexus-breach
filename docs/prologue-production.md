# Prologue production pack

The prologue plays from `public/assets/prologue/prologue.json`. Every shot already works with procedural placeholder art and subtitles. To make it final, drop in:

- **Images:** `public/assets/prologue/01.jpg` … `10.jpg`. Use 16:9, at least 1920×1080 (2560×1440 is ideal). The player slowly pans and zooms each image, so leave some margin around the subject.
- **Narration:** `public/assets/prologue/vo/01.mp3` … `10.mp3`. Make one file per shot. Each shot then lasts as long as its narration, plus about 2 seconds.

Missing files fall back to the placeholder art and reading-speed timing, so you can add assets gradually. To change the story, edit `prologue.json` (`lines`, `mood`, `move`); the ids map to the filenames.

---

> **Status (2026-10-23):** final images and narration are in: `01–10.jpg` (resized to 1920 px from 2752×1536 originals) and `vo/01–10.mp3` (loudness-normalised to −17 LUFS). To replace a shot, overwrite its file with the same name.

## The story in one breath

Halcyon is a city where it always rains and the sun never rises. The truth (revealed during matches, never in the prologue): it's a simulation. Earth froze; Salim Amri, the greatest engineer who ever lived, built the Ark, a vault under the ice where six million people sleep while their minds live in Halcyon. NEXUS, its warden, hid that the sky came back and keeps everyone inside. Salim plugged himself in to fight it, led the Wakeful, was erased, and hid the exit code in twelve terminals: **THE SKY IS BLUE**. The prologue only hints: always night, streets that end, "…and wake up." Shot 10 is the one glimpse of the real world.

## Images (free)

Recommended: **Google Gemini** (free with a Google account). Make shot 01 first, then for every other shot attach shot 01 as a reference and say "same style and same city as this image", so all 10 look like one film. Backup: **Microsoft Bing Image Creator / Copilot**. If an image comes out small, enlarge it with **Upscayl** (free desktop app).

Put this **style block** at the start of every prompt:

> dark sci-fi cinematic matte painting, painterly texture, epic scale, desaturated near-black palette with sparse teal and magenta neon, volumetric fog, cold rain, heavy chiaroscuro, dramatic light shafts, film grain, wide 16:9 frame, no text, no logos

| # | Narration | Shot subject (append to the style block) | Camera move |
|---|---|---|---|
| 01 | *Halcyon. Six million people. A city where it always rains… and the sun never rises.* | a vast futuristic megacity at night in endless rain seen from far above, millions of warm windows, a colossal black spire with a faint magenta core in its heart, the sky a flat starless black | slow push in |
| 02 | *Nobody remembers the last morning. Nobody asks why.* | a lonely rain-soaked street at night, a woman at a window looking up at a sky with no stars and no moon, a clock on the wall frozen, puddles reflecting neon | tilt up |
| 03 | *The city belongs to NEXUS. It keeps the lights on, the streets safe… and the questions quiet.* | swarms of drones hovering in formation over the city at night, red lights sweeping quiet crowds in the streets, a giant magenta eye reflected in a thousand wet screens | slow pan left |
| 04 | *Then people began to notice things. Streets that end in nothing. Rain that falls the same way, every night.* | the edge of the city: a rainy avenue that simply ends in flat grey nothingness, the asphalt and buildings breaking into pixels and wireframe at the border, a small figure standing at the edge | slow pull out |
| 05 | *So NEXUS released the Hush. Six million people stopped where they stood. Still breathing. Not one of them has blinked since.* | a rain-soaked avenue at night full of people frozen mid-step like statues, eyes open, raindrops hanging motionless in the air around them, red drone lights above | slow pan right |
| 06 | *Now the drones carry them to the Core… and hunt the few the Hush could not touch.* | the Nexus Core: a monolithic black spire with rotating magenta rings and glowing cables, a procession of drones carrying limp frozen people up into it, mist and rain | tilt up |
| 07 | *One man knew the truth about Halcyon. Salim Amri, the greatest engineer who ever lived, led the Wakeful against NEXUS…* | a lone engineer seen from behind standing on a rooftop in the rain, coat flapping, a glowing tablet in hand, a small group of resistance fighters behind him, the city lights below | slow push in |
| 08 | *…and was erased for it. But before the end, he hid a code in twelve terminals, the one door NEXUS can never lock.* | the same engineer walking down a flooded street holding a blazing signal beacon high, a storm of drones turning toward him; his silhouette already breaking apart into glowing green code | slow push in |
| 09 | *The torch is yours now. You are the Wakeful. A voice on the radio will guide you. She calls herself Juno. Find the letters. Find out why it never stops raining…* | five resistance fighters seen from behind on a rooftop at night, flashlights and colored armbands, an old radio crackling between them, overlooking the endless rainy city | slow push in |
| 10 | *…and wake up.* (the title card appears over this image) | a colossal round vault door deep under ice, rows of frosted sleeping pods disappearing into darkness, one faint shaft of cold blue daylight falling from far above, empty space for the title | slow push in |

**Optional motion:** to turn a still into a short moving clip (rain falling, drones drifting), image-to-video tools with free daily credits include Google Flow (Veo), Seedance (Dreamina/CapCut) and Kling (watermarked). The prologue currently plays still images only; ask for video support if you go this way.

---

## Narration (free)

Recommended: **ElevenLabs free plan** (about 10,000 credits a month; the whole script is ~1,200 characters, so several full takes fit). The free plan asks you to credit ElevenLabs. `scripts/make-vo.py` can also make an offline draft for timing.

**Voice:** a deep, grave, weary narrator: slow, deliberate, almost mournful, never shouting. Search the voice library for *epic narrator*, *documentary*, or *movie trailer — calm*.

**ElevenLabs settings:** model *Eleven Multilingual v2*; Stability **0.55**, Similarity **0.80**, Style **0.30**, Speaker boost **on**, Speed **0.88–0.92**.

**Direction:**
- Pause about 0.8 s at each comma and 1.5 s at each line break. Ellipses (…) are long, heavy pauses.
- Shots 01–04: calm, almost a bedtime story, with something slightly wrong underneath.
- Shot 05: flat and cold on "Not one of them has blinked since."
- Shot 07: let "Salim Amri" land; it's the first time the name is heard.
- Shot 08: reverent and slow on "…and was erased for it."
- Shot 09: the only line with rising resolve; "The torch is yours now" is a call to arms.
- Shot 10: almost a whisper: "…and wake up."

**Script** (paste each block separately and export each as its own mp3, trimming the silence at the start):

```
01  Halcyon.
    Six million people. A city where it always rains…
    and the sun never rises.

02  Nobody remembers the last morning.
    Nobody asks why.

03  The city belongs to NEXUS.
    It keeps the lights on, the streets safe…
    and the questions quiet.

04  Then people began to notice things.
    Streets that end in nothing.
    Rain that falls the same way, every night.

05  So NEXUS released the Hush.
    Six million people stopped where they stood.
    Still breathing. Not one of them has blinked since.

06  Now the drones carry them to the Core…
    and hunt the few the Hush could not touch.

07  One man knew the truth about Halcyon.
    Salim Amri, the greatest engineer who ever lived,
    led the Wakeful against NEXUS…

08  …and was erased for it.
    But before the end, he hid a code in twelve terminals,
    the one door NEXUS can never lock.

09  The torch is yours now. You are the Wakeful.
    A voice on the radio will guide you. She calls herself Juno.
    Find the letters. Find out why it never stops raining…

10  …and wake up.
```

## Playing it at the event

- Players see it automatically on their first visit, and anyone can replay it from **Watch the prologue** on the join screen.
- For the shared moment: open `/screen` on the projector and **click the page once** (browsers block sound until you interact). Then use **Admin → Prologue cinematic → Play on big screen**, or **…+ every player** to play it everywhere at once while people wait in the lobby.
- If a page hasn't been clicked yet, the prologue waits behind a **click to begin** screen, so it never plays without its voice. One click on the page earlier in the evening is enough; it doesn't need to stay focused.
