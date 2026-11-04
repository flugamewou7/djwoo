// Learn mode: a course of guided tutorials and scored challenges, plus "watch demo" playthroughs.
// Talks to the app only through the `api` object built in main.js.

import { PITCH_RANGE } from './deck.js';

const STORE_KEY = 'woo.progress.v1';
const DEFAULTS = { pitch: 0.5, trim: 0.5, eqHigh: 0.5, eqMid: 0.5, eqLow: 0.5, filter: 0.5, volume: 0.8 };
// 0.1 BPM: reachable with a 7-bit MIDI tempo fader (~0.16 BPM per step), and drifts < 1/100 beat over 8 beats
export const TEMPO_OK = 0.1; // BPM
const now = () => performance.now();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function loadProgress() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
function saveProgress(p) { try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } }

/** Tempo difference (BPM) and beat-phase offset (beats, -0.5..0.5; positive = A ahead). */
export function matchState(decks) {
  const { A, B } = decks;
  if (!A.bpm || !B.bpm) return null;
  const diff = A.effectiveBpm - B.effectiveBpm;
  const bothPlaying = A.playing && B.playing;
  let phase = null;
  if (bothPlaying) { phase = A.beatPhase - B.beatPhase; phase -= Math.round(phase); }
  return { diff, phase, bothPlaying };
}

const pitchSliderFor = (deck, targetBpm) =>
  clamp((targetBpm / deck.bpm - 1) / (2 * PITCH_RANGE) + 0.5, 0, 1);

// ------------------------------------------------------------------ playthrough helpers

/** Smoothly move a control, the way a hand would. */
async function tween(api, deckId, action, to, ms, run) {
  const from = api.control(deckId, action);
  const t0 = now();
  for (;;) {
    if (run?.cancelled) return;
    const k = Math.min(1, (now() - t0) / ms);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    api.setControl(deckId, action, from + (to - from) * e);
    if (k >= 1) return;
    await nextFrame();
  }
}

/** Auto-pilot beatmatch of `deckId` to the other deck: tempo slider, then nudges. */
async function autoBeatmatch(api, run, deckId = 'B', say = () => {}) {
  const deck = api.decks[deckId];
  const master = api.decks[deckId === 'A' ? 'B' : 'A'];
  if (!deck.playing) { api.press(`${deckId}.play`); await wait(600); }
  say(`Ride deck ${deckId}'s tempo slider until the BPMs match…`);
  api.highlight(`.deck[data-deck="${deckId}"] [data-action="pitch"]`);
  await tween(api, deckId, 'pitch', pitchSliderFor(deck, master.effectiveBpm), 2200, run);
  await wait(500);
  say('Tempo matched. Now nudge until the kicks land together…');
  api.highlight(`.deck[data-deck="${deckId}"] .nudge`);
  const t0 = now();
  while (!run.cancelled && now() - t0 < 10000) {
    const s = matchState(api.decks);
    if (!s?.phase && s?.phase !== 0) break;
    const ph = deckId === 'B' ? s.phase : -s.phase; // >0: this deck is behind
    if (Math.abs(ph) < 0.008) break;
    deck.setBend(Math.sign(ph) * Math.min(0.06, Math.abs(ph) * 1.2 + 0.008));
    await nextFrame();
  }
  deck.setBend(0);
  api.highlight(null);
}

// ------------------------------------------------------------------ curriculum

const TUTORIALS = {
  'basics': {
    title: 'Deck basics',
    blurb: 'Play, cue, crossfader, EQ and filter: the controls you use in every mix.',
    tracks: ['prog128', 'house124'],
    setup: (api) => api.setControl(null, 'crossfader', 0),
    steps: [
      { text: 'Press <b>PLAY</b> on deck A. (Keyboard: <kbd>A</kbd>.)', target: '.deck[data-deck="A"] .play',
        check: (api) => api.decks.A.playing, demo: (api) => api.press('A.play') },
      { text: 'Press <b>CUE</b> while it plays: the track jumps back to the cue point and stops. That\'s how DJs prepare the exact spot to start a track.',
        target: '.deck[data-deck="A"] .cue', onAction: (id) => id === 'A.cue', demo: (api) => api.press('A.cue') },
      { text: 'Press <b>PLAY</b> on deck A again, and on deck B too.', target: '.deck .play',
        check: (api) => api.decks.A.playing && api.decks.B.playing,
        demo: async (api) => { if (!api.decks.A.playing) api.press('A.play'); await wait(400); if (!api.decks.B.playing) api.press('B.play'); } },
      { text: 'You only hear deck A, because the <b>crossfader</b> is all the way left. Sweep it all the way right to hear deck B.',
        target: '#crossfader', check: (api) => api.control(null, 'crossfader') > 0.95,
        demo: (api, run) => tween(api, null, 'crossfader', 1, 2000, run) },
      { text: 'Bring the crossfader back to the <b>middle</b>. Now you hear both, and the kicks are clashing. Fixing that is <i>beatmatching</i>, next lesson.',
        target: '#crossfader', check: (api) => Math.abs(api.control(null, 'crossfader') - 0.5) < 0.08,
        demo: (api, run) => tween(api, null, 'crossfader', 0.5, 1200, run) },
      { text: 'Turn deck B\'s <b>LOW</b> EQ all the way down. The kick and bass disappear: this is the most-used move in house and EDM mixing.',
        target: '.channel[data-deck="B"] [data-action="eqLow"]', check: (api) => api.control('B', 'eqLow') < 0.08,
        demo: (api, run) => tween(api, 'B', 'eqLow', 0, 1200, run) },
      { text: 'Now sweep deck B\'s <b>FILTER</b>. Left is low-pass (muffled), right is high-pass (thin). Push it past either side.',
        target: '.channel[data-deck="B"] [data-action="filter"]', check: (api) => Math.abs(api.control('B', 'filter') - 0.5) > 0.3,
        demo: async (api, run) => { await tween(api, 'B', 'filter', 0.1, 1200, run); await tween(api, 'B', 'filter', 0.9, 1600, run); } },
      { text: 'Reset deck B\'s <b>LOW</b> and <b>FILTER</b> to the middle. (Double-click a knob to snap it back.)',
        target: ['.channel[data-deck="B"] [data-action="eqLow"]', '.channel[data-deck="B"] [data-action="filter"]'],
        check: (api) => Math.abs(api.control('B', 'eqLow') - 0.5) < 0.08 && Math.abs(api.control('B', 'filter') - 0.5) < 0.08,
        demo: async (api, run) => { await tween(api, 'B', 'eqLow', 0.5, 800, run); await tween(api, 'B', 'filter', 0.5, 800, run); } },
    ],
  },

  'beatmatch': {
    title: 'Beatmatching 101',
    blurb: 'Match the tempo with the pitch slider, then line up the kicks with nudges.',
    tracks: ['prog128', 'house124'],
    setup: (api) => api.press('A.play'),
    steps: [
      { text: 'Deck A plays progressive house at <b>128 BPM</b>. Deck B is house at <b>124 BPM</b>. Mixed as-is, the kicks drift apart and "gallop". Beatmatching makes them one beat.', next: true },
      { text: 'Press <b>PLAY</b> on deck B and listen to the kicks flam against each other.', target: '.deck[data-deck="B"] .play',
        check: (api) => api.decks.B.playing, demo: (api) => api.press('B.play') },
      { text: 'Deck B is slower. Push deck B\'s <b>TEMPO</b> slider right until the <b>BPM diff</b> reads <b>0.00</b>. (Keyboard: <kbd>I</kbd>/<kbd>O</kbd>.)',
        target: ['.deck[data-deck="B"] [data-action="pitch"]', '.match-bpm'],
        check: (api) => { const s = matchState(api.decks); return s && Math.abs(s.diff) < TEMPO_OK; }, hold: 1,
        demo: (api, run) => tween(api, 'B', 'pitch', pitchSliderFor(api.decks.B, api.decks.A.effectiveBpm), 2200, run) },
      { text: 'Same tempo, but the kicks may still be offset. Watch the <b>phase dot</b> and use deck B\'s <b>nudge</b> buttons (« ») or jog wheel to bring it to the centre. (Keyboard: <kbd>L</kbd>/<kbd>;</kbd>.)',
        target: ['.deck[data-deck="B"] .nudge', '.phase'],
        check: (api) => { const s = matchState(api.decks); return s?.bothPlaying && Math.abs(s.phase) < 0.03 && Math.abs(s.diff) < TEMPO_OK; }, hold: 1,
        demo: (api, run) => autoBeatmatch(api, run, 'B') },
      { text: '<b>Locked in!</b> Hold it for 4 bars. If it drifts, nudge again. Real tracks drift, so this is a skill you use all night.',
        target: '.phase',
        check: (api) => { const s = matchState(api.decks); return s?.bothPlaying && Math.abs(s.phase) < 0.04 && Math.abs(s.diff) < TEMPO_OK; },
        hold: (api) => 16 * 60 / api.decks.A.effectiveBpm,
        demo: (api, run) => autoBeatmatch(api, run, 'B') },
    ],
  },

  'bassswap': {
    title: 'The EQ bass swap',
    blurb: 'The classic house and prog transition: never let two basslines play at once.',
    tracks: ['prog128', 'house124'],
    setup: async (api) => {
      api.setControl('B', 'volume', 0);
      api.setControl('B', 'eqLow', 0);
      api.press('A.play'); api.press('B.play');
      await wait(300);
      api.sync('B');
    },
    steps: [
      { text: 'Both decks are playing and synced. Deck B\'s fader is down and its <b>LOW</b> is cut, so it\'s ready to sneak in.', next: true },
      { text: 'Bring deck B\'s <b>channel fader</b> up. With no bass, it layers under deck A without clashing.',
        target: '.channel[data-deck="B"] .vfader', check: (api) => api.control('B', 'volume') > 0.72,
        demo: (api, run) => tween(api, 'B', 'volume', 0.8, 2500, run) },
      { text: 'Now the swap: turn deck A\'s <b>LOW</b> down and deck B\'s <b>LOW</b> up <i>together</i>, ideally right on a downbeat (the bright grid line).',
        target: ['.channel[data-deck="A"] [data-action="eqLow"]', '.channel[data-deck="B"] [data-action="eqLow"]'],
        check: (api) => api.control('A', 'eqLow') < 0.12 && api.control('B', 'eqLow') > 0.4,
        demo: (api, run) => Promise.all([tween(api, 'A', 'eqLow', 0, 900, run), tween(api, 'B', 'eqLow', 0.5, 900, run)]) },
      { text: 'Deck B now carries the groove. Fade deck A out with its <b>channel fader</b>.',
        target: '.channel[data-deck="A"] .vfader', check: (api) => api.control('A', 'volume') < 0.05,
        demo: (api, run) => tween(api, 'A', 'volume', 0, 3000, run) },
      { text: 'Clean mix. Reset deck A\'s <b>LOW</b> to the middle so it\'s ready for the next track.',
        target: '.channel[data-deck="A"] [data-action="eqLow"]', check: (api) => Math.abs(api.control('A', 'eqLow') - 0.5) < 0.08,
        demo: (api, run) => tween(api, 'A', 'eqLow', 0.5, 800, run) },
    ],
  },
};

const CHALLENGES = {
  'bm-easy': {
    title: 'Beatmatch: Warm-up', level: 'Easy',
    blurb: 'Prog vs house, 2–4 BPM apart. Meter and beat grid on.',
    tracks: ['prog128', 'house124'], offset: [2, 4], tolerance: 0.03, limit: 90,
  },
  'bm-medium': {
    title: 'Beatmatch: Main stage', level: 'Medium',
    blurb: 'EDM vs house with a random offset. The phase meter is hidden, so use the waveforms.',
    tracks: ['edm128', 'house122'], offset: [2, 6], tolerance: 0.03, limit: 90, hideMeter: true,
  },
  'bm-doubles': {
    title: 'Beatmatch: Hip-hop doubles', level: 'Medium',
    blurb: 'Two copies of the same boom-bap beat, knocked off tempo. Slow tempos make phase errors easy to hear.',
    tracks: ['rap90', 'rap90'], offset: [1.5, 3.5], tolerance: 0.025, limit: 90, hideMeter: true,
  },
  'bm-ear': {
    title: 'Beatmatch: By ear', level: 'Hard',
    blurb: 'No BPM numbers, no meter, no beat grid, no sync. Just your ears, like a real club booth.',
    tracks: ['prog124', 'edm126'], offset: [1, 5], tolerance: 0.035, limit: 120, hideMeter: true, hideBpm: true, hideGrid: true,
  },
};

const COURSE = [
  { id: 'basics', kind: 'tutorial' },
  { id: 'beatmatch', kind: 'tutorial' },
  { id: 'bm-easy', kind: 'challenge' },
  { id: 'bassswap', kind: 'tutorial' },
  { id: 'bm-medium', kind: 'challenge' },
  { id: 'bm-doubles', kind: 'challenge' },
  { id: 'bm-ear', kind: 'challenge' },
];
const lessonDef = (item) => (item.kind === 'tutorial' ? TUTORIALS : CHALLENGES)[item.id];

// ------------------------------------------------------------------ scoring

/** Pure scoring function: time to lock, plus how tight the lock was. Max 1000. */
export function scoreBeatmatch({ seconds, avgPhase, avgDiff, tolerance }) {
  const time = Math.round(clamp(600 - Math.max(0, seconds - 10) * 6, 0, 600));
  const phase = Math.round(300 * clamp(1 - avgPhase / tolerance, 0, 1));
  const tempo = Math.round(100 * clamp(1 - avgDiff / TEMPO_OK, 0, 1));
  const total = time + phase + tempo;
  const stars = total >= 850 ? 3 : total >= 650 ? 2 : 1;
  return { time, phase, tempo, total, stars };
}

// ------------------------------------------------------------------ engine

export function createLessons(api) {
  let progress = loadProgress();
  let active = null; // { item, def, run, ... }
  const coach = document.getElementById('coach');
  const panel = document.getElementById('learn-panel');

  // ---------- course panel
  function renderPanel() {
    const list = document.getElementById('course-list');
    const nextIdx = COURSE.findIndex((c) => !progress[c.id]?.done);
    list.replaceChildren(...COURSE.map((item, i) => {
      const def = lessonDef(item);
      const p = progress[item.id];
      const li = document.createElement('li');
      li.className = `course-item${p?.done ? ' done' : ''}${i === nextIdx ? ' next' : ''}`;
      const stars = item.kind === 'challenge' && p?.stars ? '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars) : '';
      li.innerHTML = `
        <span class="course-num">${p?.done ? '✓' : i + 1}</span>
        <div class="course-body">
          <div class="course-title">${def.title} <span class="tag ${item.kind}">${item.kind === 'tutorial' ? 'Tutorial' : def.level}</span></div>
          <div class="course-blurb">${def.blurb}</div>
          ${p?.best ? `<div class="course-best">Best ${p.best} <span class="stars">${stars}</span></div>` : ''}
        </div>
        <button class="${i === nextIdx ? 'primary' : 'ghost'}">${p?.done ? 'Replay' : 'Start'}</button>`;
      li.querySelector('button').addEventListener('click', () => begin(item));
      return li;
    }));
    const cont = document.getElementById('course-continue');
    cont.textContent = nextIdx === -1 ? 'Course complete, replay any lesson' : nextIdx === 0 ? 'Start the course' : 'Continue course';
    cont.disabled = nextIdx === -1;
  }

  function openPanel() { renderPanel(); panel.hidden = false; }
  function closePanel() { panel.hidden = true; }

  document.getElementById('course-continue').addEventListener('click', () => {
    const next = COURSE.find((c) => !progress[c.id]?.done);
    if (next) begin(next);
  });
  document.getElementById('close-learn').addEventListener('click', closePanel);
  document.getElementById('reset-progress').addEventListener('click', () => {
    if (confirm('Reset all lesson progress and best scores?')) { progress = {}; saveProgress(progress); renderPanel(); }
  });

  // ---------- lifecycle
  function setFlags({ hideMeter = false, hideBpm = false, hideGrid = false, noSync = false } = {}) {
    document.body.classList.toggle('hide-meter', hideMeter);
    document.body.classList.toggle('hide-bpm', hideBpm);
    api.flags.hideGrid = hideGrid;
    api.flags.noSync = noSync;
    for (const b of document.querySelectorAll('.transport .sync')) b.disabled = noSync;
  }

  async function resetMixer() {
    for (const d of ['A', 'B']) {
      api.decks[d].pause();
      api.decks[d].setBend(0);
      for (const [k, v] of Object.entries(DEFAULTS)) api.setControl(d, k, v);
    }
    api.setControl(null, 'crossfader', 0.5);
  }

  function stop() {
    if (!active) return;
    active.run.cancelled = true;
    active = null;
    api.highlight(null);
    setFlags();
    coach.hidden = true;
    document.body.classList.remove('in-lesson');
  }

  async function begin(item) {
    stop();
    closePanel();
    await api.ready();
    const def = lessonDef(item);
    const run = { cancelled: false };
    active = { item, def, run, loading: true };
    document.body.classList.add('in-lesson');
    coach.hidden = false;
    coach.innerHTML = `<div class="coach-head"><span class="coach-kicker">${item.kind === 'tutorial' ? 'Tutorial' : `Challenge · ${def.level}`}</span><h2>${def.title}</h2></div><p class="coach-text">Loading tracks…</p>`;

    await resetMixer();
    setFlags(item.kind === 'challenge' ? { hideMeter: def.hideMeter, hideBpm: def.hideBpm, hideGrid: def.hideGrid, noSync: true } : {});
    await Promise.all([api.loadDemo('A', def.tracks[0]), api.loadDemo('B', def.tracks[1])]);
    if (run.cancelled) return;

    if (item.kind === 'tutorial') {
      await def.setup?.(api);
      Object.assign(active, { step: 0, held: 0, demoing: false, loading: false });
      renderTutorial();
    } else {
      // knock deck B off tempo by a random amount, either direction
      const [lo, hi] = def.offset;
      const delta = (lo + Math.random() * (hi - lo)) * (Math.random() < 0.5 ? -1 : 1);
      api.setControl('B', 'pitch', pitchSliderFor(api.decks.B, api.decks.A.bpm + delta));
      // cue deck B a few bars in and deliberately off the beat, so the kicks never start aligned
      const B = api.decks.B;
      const beatLen = 60 / B.bpm;
      const offBeat = 0.2 + Math.random() * 0.6;
      B.seek(B.firstBeat + (16 + Math.floor(Math.random() * 16) + offBeat) * beatLen);
      B.cuePoint = B.position;
      api.press('A.play');
      Object.assign(active, {
        loading: false, startedAt: now(), held: 0, sumPhase: 0, sumDiff: 0, samples: 0,
        nudges: 0, demoing: false, finished: false,
      });
      renderChallenge();
    }
  }

  function complete(result) {
    const { item } = active;
    const prev = progress[item.id] || {};
    const isBest = result.total != null && result.total > (prev.best || 0);
    progress[item.id] = {
      done: true,
      best: result.total != null ? Math.max(prev.best || 0, result.total) : prev.best,
      stars: result.stars ? Math.max(prev.stars || 0, result.stars) : prev.stars,
    };
    saveProgress(progress);
    return isBest;
  }

  function nextItem() {
    const i = COURSE.findIndex((c) => c.id === active?.item.id);
    return COURSE.slice(i + 1).find((c) => !progress[c.id]?.done) || COURSE[i + 1] || null;
  }

  // ---------- coach card rendering
  function coachHeader() {
    const { item, def } = active;
    return `<div class="coach-head">
      <span class="coach-kicker">${item.kind === 'tutorial' ? 'Tutorial' : `Challenge · ${def.level}`}</span>
      <h2>${def.title}</h2>
      <button class="ghost coach-close" aria-label="Quit lesson">×</button>
    </div>`;
  }

  function wireCommon() {
    coach.querySelector('.coach-close')?.addEventListener('click', stop);
  }

  function renderTutorial() {
    const { def, step } = active;
    const s = def.steps[step];
    const dots = def.steps.map((_, i) => `<span class="dot${i < step ? ' done' : i === step ? ' on' : ''}"></span>`).join('');
    coach.innerHTML = `${coachHeader()}
      <p class="coach-text">${s.text}</p>
      <div class="coach-hold" ${s.hold ? '' : 'hidden'}><div class="coach-hold-fill"></div></div>
      <div class="coach-foot">
        <div class="dots">${dots}</div>
        <div class="coach-btns">
          ${s.demo ? '<button class="ghost demo-btn">Show me</button>' : ''}
          ${s.next ? '<button class="primary next-btn">Next</button>' : '<button class="ghost skip-btn">Skip</button>'}
        </div>
      </div>`;
    wireCommon();
    api.highlight(s.target || null);
    coach.querySelector('.next-btn')?.addEventListener('click', advance);
    coach.querySelector('.skip-btn')?.addEventListener('click', advance);
    coach.querySelector('.demo-btn')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      active.demoing = true;
      const run = active.run;
      await s.demo(api, run);
      if (active?.run === run) { active.demoing = false; api.highlight(s.target || null); }
    });
  }

  function advance() {
    if (!active) return;
    active.step++;
    active.held = 0;
    if (active.step >= active.def.steps.length) {
      complete({});
      renderDone(`<p class="coach-text">Tutorial complete. Nice work.</p>`);
    } else {
      renderTutorial();
    }
  }

  function renderChallenge() {
    const { def } = active;
    coach.innerHTML = `${coachHeader()}
      <p class="coach-text">Deck A is playing. Start deck B, match its tempo, line up the kicks, and <b>hold the lock for 8 beats</b>.
      ${def.hideBpm ? 'BPM readouts are hidden, so listen for the kicks drifting apart.' : ''} Sync is disabled.</p>
      <div class="coach-stats">
        <div><span class="stat-val" id="ch-time">0.0s</span><small>time</small></div>
        <div><span class="stat-val" id="ch-status">Not locked</span><small>status</small></div>
        <div><span class="stat-val" id="ch-limit">${def.limit}s</span><small>limit</small></div>
      </div>
      <div class="coach-hold"><div class="coach-hold-fill"></div></div>
      <div class="coach-foot">
        <small class="dim">Lock = tempo within ${TEMPO_OK} BPM, kicks within ${Math.round(def.tolerance * 100)}% of a beat</small>
        <div class="coach-btns">
          <button class="ghost demo-btn">Watch demo</button>
          <button class="ghost restart-btn">Restart</button>
        </div>
      </div>`;
    wireCommon();
    api.highlight(null);
    coach.querySelector('.restart-btn').addEventListener('click', () => begin(active.item));
    coach.querySelector('.demo-btn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      active.demoing = true;
      const text = coach.querySelector('.coach-text');
      const run = active.run;
      await autoBeatmatch(api, run, 'B', (msg) => { text.innerHTML = `<b>Demo:</b> ${msg} <i>(Demo runs aren't scored. Hit Restart to try it yourself.)</i>`; });
    });
  }

  function renderResult(result, { failed = false, isBest = false } = {}) {
    if (failed) {
      renderDone(`<p class="coach-text"><b>Time's up.</b> You didn't hold a lock within ${active.def.limit}s. Tip: get the BPM diff to 0.00 first, <i>then</i> worry about the kicks.</p>`, true);
      return;
    }
    const stars = '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
    renderDone(`
      <div class="result">
        <div class="result-score"><span class="stars big">${stars}</span><span class="total">${result.total}</span><small>${isBest ? 'New best!' : `Best ${progress[active.item.id].best}`}</small></div>
        <table class="breakdown">
          <tr><td>Speed (${result.seconds.toFixed(1)}s)</td><td>${result.time}<small>/600</small></td></tr>
          <tr><td>Kick alignment</td><td>${result.phase}<small>/300</small></td></tr>
          <tr><td>Tempo accuracy</td><td>${result.tempo}<small>/100</small></td></tr>
          <tr><td>Nudges used</td><td>${result.nudges}</td></tr>
        </table>
      </div>`, true);
  }

  function renderDone(bodyHtml, retry = false) {
    const next = nextItem();
    coach.innerHTML = `${coachHeader()}${bodyHtml}
      <div class="coach-foot"><span></span><div class="coach-btns">
        ${retry ? '<button class="ghost retry-btn">Retry</button>' : ''}
        <button class="ghost course-btn">Course</button>
        ${next ? `<button class="primary next-lesson-btn">Next: ${lessonDef(next).title}</button>` : ''}
      </div></div>`;
    wireCommon();
    api.highlight(null);
    active.finished = true;
    const item = active.item;
    coach.querySelector('.retry-btn')?.addEventListener('click', () => begin(item));
    coach.querySelector('.course-btn').addEventListener('click', () => { stop(); openPanel(); });
    coach.querySelector('.next-lesson-btn')?.addEventListener('click', () => begin(next));
  }

  // ---------- per-frame + action hooks
  let last = now();
  function tick() {
    const t = now();
    const dt = (t - last) / 1000;
    last = t;
    if (!active || active.loading || active.finished) return;
    const fill = coach.querySelector('.coach-hold-fill');

    if (active.item.kind === 'tutorial') {
      const s = active.def.steps[active.step];
      if (!s.check) return;
      if (s.check(api)) {
        active.held += dt;
        const need = typeof s.hold === 'function' ? s.hold(api) : s.hold || 0;
        if (fill) fill.style.transform = `scaleX(${need ? Math.min(1, active.held / need) : 1})`;
        if (active.held >= need) advance();
      } else {
        active.held = 0;
        if (fill) fill.style.transform = 'scaleX(0)';
      }
      return;
    }

    // challenge
    const def = active.def;
    const elapsed = (t - active.startedAt) / 1000;
    const timeEl = document.getElementById('ch-time');
    const statusEl = document.getElementById('ch-status');
    if (timeEl) timeEl.textContent = `${elapsed.toFixed(1)}s`;
    const s = matchState(api.decks);
    const locked = s?.bothPlaying && Math.abs(s.diff) < TEMPO_OK && Math.abs(s.phase) < def.tolerance;
    const need = 8 * 60 / api.decks.A.effectiveBpm;
    if (locked) {
      active.held += dt;
      active.sumPhase += Math.abs(s.phase) * dt;
      active.sumDiff += Math.abs(s.diff) * dt;
    } else {
      active.held = active.sumPhase = active.sumDiff = 0;
    }
    if (fill) fill.style.transform = `scaleX(${Math.min(1, active.held / need)})`;
    if (statusEl) {
      statusEl.textContent = locked ? 'Locked' : !s?.bothPlaying ? 'Waiting' : Math.abs(s.diff) < TEMPO_OK ? 'Tempo ✓' : 'Drifting';
      statusEl.className = `stat-val ${locked ? 'good' : ''}`;
    }

    if (active.held >= need) {
      if (active.demoing) {
        renderDone('<p class="coach-text"><b>That\'s the lock.</b> Demo complete (not scored). Now try it yourself.</p>', true);
        return;
      }
      const seconds = elapsed - active.held; // time to first achieve the lock that stuck
      const result = {
        ...scoreBeatmatch({ seconds, avgPhase: active.sumPhase / active.held, avgDiff: active.sumDiff / active.held, tolerance: def.tolerance }),
        seconds, nudges: active.nudges,
      };
      const isBest = complete(result);
      renderResult(result, { isBest });
    } else if (elapsed > def.limit && !active.demoing) {
      renderResult(null, { failed: true });
    }
  }

  function onAction(actionId, value) {
    if (!active || active.loading || active.finished) return;
    if (active.item.kind === 'challenge') {
      if (value && /nudge|jog/.test(actionId)) active.nudges++;
      return;
    }
    const s = active.def.steps[active.step];
    if (s.onAction?.(actionId, value, api)) setTimeout(advance, 150);
  }

  return { openPanel, tick, onAction, stop, get active() { return active; } };
}
