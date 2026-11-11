# djwoo — DJ trainer

A browser app for learning to mix with a real DJ controller (Pioneer DDJ-FLX4, Numark Party Mix / Platinum FX, or any MIDI controller). It's focused on **progressive house, EDM, house and rap**.

![screenshot](docs/screenshot.png)

## Run it

**Easiest:** download [`dist/woo-dj-trainer.html`](dist/woo-dj-trainer.html) and double-click it. It's one self-contained file, so no server is needed. Rebuild it after changes with `node build.mjs`.

**For development:** 
It's plain HTML/JS with no build step. Serve the folder over HTTP: ES modules and Web MIDI don't work from `file://`.

```bash
npx serve .
```

Then open the printed `localhost` URL in **Chrome or Edge on desktop**. Safari doesn't support Web MIDI. It can also be hosted on GitHub Pages as-is.

## Gig mode (3D)

Click **Play a gig** (or **Gigs** in the top bar), pick a venue and perform for a 3D crowd that reacts to your mixing:

- **Hype goes up** with smooth, beatmatched blends, landing a drop after a breakdown, fresh tracks, bass-heavy energy, and the hype mic (`M`).
- **Hype goes down** with train wrecks (two tracks audible but not beatmatched), dead air, and playing one track too long.
- **The crowd shows it:** they bounce on the beat, put their hands up as hype climbs, raise phones in breakdowns and go wild on drops. More people pile in when it's going off and drift away when it isn't.
- **Venues** (original, each inspired by a classic kind of place to play): The Basement, Rooftop Block Party, Sunset Terrace, Neon Warehouse, Canyon Amphitheater and Festival Mainstage. Earn stars to unlock bigger stages, or tick *Unlock all venues* to practise anywhere.
- **Cameras:** `V` cycles through DJ view, crowd view and wide shot. **End set** rates you on average hype, blends, drops and wrecks.

## Library (USB / folders)

Click **Library**, then **Open USB / folder** and pick a USB stick or any music folder. rekordbox-exported USBs work, because the library scans every subfolder. You can also add loose files or drag a folder onto the panel. Search, sort by title, artist, BPM or folder, run **Analyse BPM** on everything, and load any track to deck A or B. Files never leave your computer.

## Learn mode

Click **Start learning** (or **Learn** in the top bar) for the course:

1. **Deck basics** (tutorial): play, cue, crossfader, EQ kill, filter
2. **Beatmatching 101** (tutorial): match the tempo with the pitch slider, align the kicks with nudges, hold the lock
3. **Beatmatch: Warm-up** (scored, easy): prog vs house, meter and grid on
4. **The EQ bass swap** (tutorial): the classic house/prog transition
5. **Beatmatch: Main stage** (scored, medium): EDM vs house, phase meter hidden
6. **Beatmatch: Hip-hop doubles** (scored, medium): two copies of a 90 BPM boom-bap beat
7. **Beatmatch: By ear** (scored, hard): no BPM numbers, meter, grid or sync

Tutorials highlight the control to use and move on when you do it. Every step has **Show me**, and every challenge has **Watch demo**, which plays it through for you. Challenges start deck B at a random tempo offset and off the beat. You pass by holding a lock (tempo within 0.1 BPM, kicks within ~3% of a beat) for 8 beats. Scoring out of 1000: speed 600, kick alignment 300, tempo accuracy 100, giving 1–3 stars. Progress and best scores are saved in the browser.

## What's in it

- **Two decks** with play/pause, CDJ-style cue, tempo slider (±8%), pitch-bend nudge, jog wheel (bends while playing, scrubs while stopped), and sync.
- **Mixer** with trim, 3-band EQ (with kills), a one-knob filter (low-pass left, high-pass right), channel faders with meters, and an equal-power crossfader.
- **BPM and beat-grid detection** for any audio file you load (drag-and-drop works too).
- **Beatmatch meter** that shows the BPM difference and the beat-phase offset, and tells you whether you're locked in.
- **Genre demo tracks** synthesised in the browser, so there are no licensing issues. They're built from 8-bar phrases (intro / main / breakdown / drop / outro):
  - Progressive House 128 & 124: rolling 16th basslines, pads, arps
  - EDM 128 & 126: big-room kicks, off-beat supersaws, snare-roll builds
  - House 124 & 122: organ bass, piano stabs
  - Rap: boom bap 90, trap 140 (half-time 808s, hat rolls)
- **MIDI learn**: open *Controller setup*, click **Learn**, then move a control. Mappings are saved in the browser and can be exported or imported as JSON. A live MIDI monitor shows exactly what your controller sends.
- **Keyboard fallback**: Deck A `A` play, `S` cue, `D`/`F` nudge, `E`/`R` tempo. Deck B `J`, `K`, `L`/`;`, `I`/`O`. Crossfader `←`/`→`.

## Layout

```
index.html          UI shell
styles.css
src/main.js         wiring: actions, keyboard, MIDI panel, waveforms, beatmatch meter
src/deck.js         audio graph per deck (playback, EQ, filter, faders)
src/bpm.js          offline tempo + beat-phase detection
src/demo-tracks.js  synthesised genre practice tracks
src/midi.js         Web MIDI input + MIDI learn
src/lessons.js      Learn mode: tutorials, scored challenges, demos
src/gig.js          3D gig mode: venues, crowd, hype (Three.js)
src/library.js      USB / folder music library
vendor/three.min.js Three.js r159 (MIT)
```

## Next up

- Commit default mappings for the DDJ-FLX4 and Numark controllers, recorded from real hardware with the MIDI monitor
- More lessons: phrase-aligned drops, filter transitions, 128 → 90 tempo changes for rap sets
- Hot cues and loops
