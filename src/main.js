import { Deck, PITCH_RANGE } from './deck.js';
import { analyzeTempo } from './bpm.js';
import { DEMO_TRACKS, renderDemo } from './demo-tracks.js';
import { MidiInput, relativeDelta } from './midi.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- actions
const DECK_ACTIONS = [
  ['play', 'Play / Pause', 'button'],
  ['cue', 'Cue', 'button'],
  ['sync', 'Sync', 'button'],
  ['nudgeDown', 'Nudge back', 'button'],
  ['nudgeUp', 'Nudge forward', 'button'],
  ['jog', 'Jog wheel', 'rel'],
  ['pitch', 'Tempo slider', 'abs'],
  ['volume', 'Channel fader', 'abs'],
  ['trim', 'Trim / gain', 'abs'],
  ['eqHigh', 'EQ High', 'abs'],
  ['eqMid', 'EQ Mid', 'abs'],
  ['eqLow', 'EQ Low', 'abs'],
  ['filter', 'Filter / CFX', 'abs'],
];
const ACTIONS = [
  ...['A', 'B'].flatMap((d) => DECK_ACTIONS.map(([id, label, kind]) => ({ id: `${d}.${id}`, label: `Deck ${d} · ${label}`, kind }))),
  { id: 'crossfader', label: 'Crossfader', kind: 'abs' },
];
const ACTION_KIND = Object.fromEntries(ACTIONS.map((a) => [a.id, a.kind]));

// ---------------------------------------------------------------- state
let ctx, master;
const decks = {};
const demoCache = new Map();
let midi;

function deckEl(id) { return $(`.deck[data-deck="${id}"]`); }
function otherDeck(id) { return decks[id === 'A' ? 'B' : 'A']; }

function setSlider(deckId, action, v) {
  const root = deckId ? document : null;
  const el = deckId
    ? $(`[data-deck="${deckId}"] [data-action="${action}"]`, root)
    : $(`[data-global="${action}"]`);
  if (el) el.value = v;
}

function setCrossfader(v) {
  const a = Math.cos((v * Math.PI) / 2);
  const b = Math.sin((v * Math.PI) / 2);
  decks.A.xfade.gain.setTargetAtTime(a, ctx.currentTime, 0.01);
  decks.B.xfade.gain.setTargetAtTime(b, ctx.currentTime, 0.01);
}

/** Single entry point for UI, keyboard and MIDI. value: boolean (button), 0..1 (abs), ticks (rel). */
function dispatch(actionId, value, { fromUi = false } = {}) {
  if (!ctx) return;
  if (actionId === 'crossfader') {
    setCrossfader(value);
    if (!fromUi) setSlider(null, 'crossfader', value);
    return;
  }
  const [deckId, action] = actionId.split('.');
  const deck = decks[deckId];
  switch (action) {
    case 'play': if (value) deck.togglePlay(); break;
    case 'cue': if (value) deck.cue(); break;
    case 'sync': if (value) sync(deckId); break;
    case 'nudgeDown': deck.setBend(value ? -0.04 : 0); break;
    case 'nudgeUp': deck.setBend(value ? 0.04 : 0); break;
    case 'jog': deck.jog(value); break;
    case 'pitch': deck.setPitch((value - 0.5) * 2 * PITCH_RANGE); break;
    case 'volume': deck.setVolume(value); break;
    case 'trim': deck.setTrim(value); break;
    case 'eqHigh': deck.setEq('high', value); break;
    case 'eqMid': deck.setEq('mid', value); break;
    case 'eqLow': deck.setEq('low', value); break;
    case 'filter': deck.setFilter(value); break;
  }
  if (!fromUi && ACTION_KIND[actionId] === 'abs') setSlider(deckId, action, value);
}

function sync(deckId) {
  const deck = decks[deckId];
  const master = otherDeck(deckId);
  if (!deck.bpm || !master.effectiveBpm) return;
  const p = master.effectiveBpm / deck.bpm - 1;
  deck.setPitch(p);
  setSlider(deckId, 'pitch', clamp(p / (2 * PITCH_RANGE) + 0.5, 0, 1));
  if (deck.playing && master.playing) {
    let d = master.beatPhase - deck.beatPhase;
    d -= Math.round(d);
    deck.seek(deck.position + d * (60 / deck.bpm));
  }
}

// ---------------------------------------------------------------- loading
async function loadIntoDeck(deckId, buffer, name) {
  const deck = decks[deckId];
  deck.load(buffer, name);
  deck._peaks = null;
  const el = deckEl(deckId);
  $('.track-name', el).textContent = name;
  $('.bpm', el).textContent = '…';
  try {
    const { bpm, firstBeat } = await analyzeTempo(buffer);
    if (deck.buffer !== buffer) return; // a newer track was loaded meanwhile
    deck.bpm = bpm;
    deck.firstBeat = firstBeat;
  } catch (err) {
    console.error('Tempo analysis failed', err);
    $('.bpm', el).textContent = '?';
  }
}

async function loadDemo(deckId, demoId) {
  const spec = DEMO_TRACKS.find((t) => t.id === demoId);
  if (!spec) return;
  let buf = demoCache.get(demoId);
  if (!buf) {
    $('.track-name', deckEl(deckId)).textContent = 'Rendering demo…';
    buf = await renderDemo(spec, ctx.sampleRate);
    demoCache.set(demoId, buf);
  }
  await loadIntoDeck(deckId, buf, spec.name);
}

async function loadFile(deckId, file) {
  $('.track-name', deckEl(deckId)).textContent = 'Decoding…';
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    await loadIntoDeck(deckId, buf, file.name.replace(/\.[^.]+$/, ''));
  } catch (err) {
    $('.track-name', deckEl(deckId)).textContent = 'Could not decode that file';
    console.error(err);
  }
}

// ---------------------------------------------------------------- UI wiring
function wireDecks() {
  for (const id of ['A', 'B']) {
    for (const scope of $$(`[data-deck="${id}"]`)) {
      for (const el of $$('[data-action]', scope)) {
        const actionId = `${id}.${el.dataset.action}`;
        if (el.tagName === 'BUTTON') {
          const hold = ACTION_KIND[actionId] === 'button' && el.dataset.action.startsWith('nudge');
          el.addEventListener('pointerdown', () => dispatch(actionId, true));
          if (hold) {
            for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
              el.addEventListener(ev, () => dispatch(actionId, false));
            }
          }
        } else {
          el.addEventListener('input', () => dispatch(actionId, Number(el.value), { fromUi: true }));
          el.addEventListener('dblclick', () => {
            const reset = el.dataset.action === 'volume' ? 0.8 : 0.5;
            el.value = reset;
            dispatch(actionId, reset, { fromUi: true });
          });
        }
      }
    }
    const el = deckEl(id);
    const sel = $('.demo-select', el);
    const groups = {};
    for (const t of DEMO_TRACKS) {
      if (!groups[t.genre]) sel.append(groups[t.genre] = Object.assign(document.createElement('optgroup'), { label: t.genre }));
      groups[t.genre].append(new Option(`${t.name.replace('Demo: ', '')} · ${t.bpm}`, t.id));
    }
    sel.addEventListener('change', () => { if (sel.value) loadDemo(id, sel.value); sel.value = ''; });
    $('input[type=file]', el).addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) loadFile(id, f);
      e.target.value = '';
    });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop');
      const f = e.dataTransfer.files[0];
      if (f) loadFile(id, f);
    });

    const overview = $(`.wave-row[data-deck="${id}"] .wave-overview`);
    overview.addEventListener('pointerdown', (e) => {
      const deck = decks[id];
      if (!deck.buffer) return;
      const r = overview.getBoundingClientRect();
      deck.seek(((e.clientX - r.left) / r.width) * deck.duration);
    });
  }
  const xf = $('#crossfader');
  xf.addEventListener('input', () => dispatch('crossfader', Number(xf.value), { fromUi: true }));
  xf.addEventListener('dblclick', () => { xf.value = 0.5; dispatch('crossfader', 0.5); });
}

const KEYS = {
  a: ['A.play', 'button'], s: ['A.cue', 'button'], d: ['A.nudgeDown', 'hold'], f: ['A.nudgeUp', 'hold'],
  e: ['A.pitch', -1], r: ['A.pitch', 1],
  j: ['B.play', 'button'], k: ['B.cue', 'button'], l: ['B.nudgeDown', 'hold'], ';': ['B.nudgeUp', 'hold'],
  i: ['B.pitch', -1], o: ['B.pitch', 1],
};

function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (!ctx || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches('input[type=text], textarea, select')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (e.target.matches('input[type=range]')) return;
      const xf = $('#crossfader');
      const v = clamp(Number(xf.value) + (e.key === 'ArrowRight' ? 0.05 : -0.05), 0, 1);
      dispatch('crossfader', v);
      e.preventDefault();
      return;
    }
    const k = KEYS[e.key.toLowerCase()];
    if (!k) return;
    const [actionId, mode] = k;
    if (typeof mode === 'number') {
      const [deckId] = actionId.split('.');
      const el = $(`.deck[data-deck="${deckId}"] [data-action="pitch"]`);
      const v = clamp(Number(el.value) + mode * 0.00625, 0, 1); // 0.1% steps at ±8%
      dispatch(actionId, v);
    } else if (!e.repeat) {
      dispatch(actionId, true);
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYS[e.key.toLowerCase()];
    if (k && k[1] === 'hold') dispatch(k[0], false);
  });
}

// ---------------------------------------------------------------- MIDI panel
function renderMapRows() {
  const tbody = $('#map-rows');
  tbody.replaceChildren(...ACTIONS.map((a) => {
    const tr = document.createElement('tr');
    const key = midi.keyFor(a.id);
    const learning = midi.learning === a.id;
    tr.innerHTML = `<td>${a.label}</td><td class="mono">${learning ? 'move a control…' : key || '—'}</td>
      <td><button class="ghost learn${learning ? ' active' : ''}">${learning ? 'Cancel' : 'Learn'}</button></td>
      <td>${key ? '<button class="ghost unmap" aria-label="Remove mapping">×</button>' : ''}</td>`;
    $('.learn', tr).addEventListener('click', () => {
      learning ? midi.cancelLearn() : midi.learn(a.id);
      renderMapRows();
    });
    $('.unmap', tr)?.addEventListener('click', () => { midi.unmap(a.id); renderMapRows(); });
    return tr;
  }));
}

function logMidi(msg, device) {
  const log = $('#midi-log');
  const li = document.createElement('li');
  const mapped = midi.map[msg.key];
  li.innerHTML = `<span class="mono">${msg.key}</span> <b>${msg.value}</b> <span class="dim">${device}${mapped ? ' → ' + mapped : ''}</span>`;
  log.prepend(li);
  while (log.children.length > 40) log.lastChild.remove();
}

function handleMidiAction({ action, msg, learned }) {
  if (learned) { renderMapRows(); return; }
  const kind = ACTION_KIND[action];
  if (kind === 'button') {
    const pressed = msg.value > 0;
    // nudge buttons are momentary; everything else fires on press
    if (action.endsWith('nudgeDown') || action.endsWith('nudgeUp')) dispatch(action, pressed);
    else if (pressed) dispatch(action, true);
  } else if (kind === 'rel') {
    dispatch(action, relativeDelta(msg.value));
  } else {
    const v = msg.type === 'pitchbend' ? msg.value / 16383 : msg.value / 127;
    dispatch(action, v);
  }
}

function wireMidiPanel() {
  const panel = $('#midi-panel');
  $('#toggle-midi-panel').addEventListener('click', () => { panel.hidden = !panel.hidden; renderMapRows(); });
  $('#close-midi-panel').addEventListener('click', () => { panel.hidden = true; midi.cancelLearn(); });
  $('#export-map').addEventListener('click', () => {
    const blob = new Blob([midi.exportJson()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'woo-mapping.json' });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#import-map').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { midi.importJson(await f.text()); renderMapRows(); } catch (err) { alert(err.message); }
    e.target.value = '';
  });
  $('#clear-map').addEventListener('click', () => {
    if (confirm('Remove all controller mappings?')) { midi.clear(); renderMapRows(); }
  });
}

// ---------------------------------------------------------------- drawing
function sizeCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return true; }
  return false;
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function overviewPeaks(deck, n) {
  if (deck._peaks && deck._peaks.length === n) return deck._peaks;
  const data = deck.buffer.getChannelData(0);
  const per = Math.floor(data.length / n);
  const peaks = new Float32Array(n);
  const stride = Math.max(1, Math.floor(per / 64));
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * per; j < (i + 1) * per; j += stride) { const v = Math.abs(data[j]); if (v > m) m = v; }
    peaks[i] = m;
  }
  return (deck._peaks = peaks);
}

function drawDeck(id, colors) {
  const deck = decks[id];
  const row = $(`.wave-row[data-deck="${id}"]`);
  const zoom = $('.wave-zoom', row), over = $('.wave-overview', row);
  sizeCanvas(zoom); sizeCanvas(over);
  const zc = zoom.getContext('2d'), oc = over.getContext('2d');
  zc.clearRect(0, 0, zoom.width, zoom.height);
  oc.clearRect(0, 0, over.width, over.height);
  if (!deck.buffer) return;

  const color = id === 'A' ? colors.a : colors.b;
  const pos = deck.position;

  // overview
  const n = over.width;
  const peaks = overviewPeaks(deck, n);
  const playedX = (pos / deck.duration) * n;
  const mid = over.height / 2;
  for (let x = 0; x < n; x++) {
    oc.fillStyle = x < playedX ? colors.dim : color;
    const h = peaks[x] * mid;
    oc.fillRect(x, mid - h, 1, h * 2 || 1);
  }
  oc.fillStyle = colors.cue;
  oc.fillRect((deck.cuePoint / deck.duration) * n - 1, 0, 2, over.height);
  oc.fillStyle = colors.fg;
  oc.fillRect(playedX - 1, 0, 2, over.height);

  // zoomed, centred on the playhead; window scales with rate so matched tempos line up visually
  const half = 3 * deck.rate;
  const data = deck.buffer.getChannelData(0);
  const sr = deck.buffer.sampleRate;
  const W = zoom.width, H = zoom.height, zm = H / 2;
  const secPerPx = (half * 2) / W;
  const per = secPerPx * sr;
  const stride = Math.max(1, Math.floor(per / 24));
  zc.fillStyle = color;
  for (let x = 0; x < W; x++) {
    const t0 = pos - half + x * secPerPx;
    if (t0 < 0 || t0 > deck.duration) continue;
    const s0 = Math.floor(t0 * sr), s1 = Math.min(data.length, s0 + per);
    let m = 0;
    for (let j = s0; j < s1; j += stride) { const v = Math.abs(data[j]); if (v > m) m = v; }
    const h = m * zm * 0.95;
    zc.fillRect(x, zm - h, 1, h * 2 || 1);
  }
  if (deck.bpm) {
    const beatLen = 60 / deck.bpm;
    let k = Math.ceil((pos - half - deck.firstBeat) / beatLen);
    for (let t = deck.firstBeat + k * beatLen; t < pos + half; t += beatLen, k++) {
      const x = (t - (pos - half)) / secPerPx;
      const downbeat = ((k % 4) + 4) % 4 === 0;
      zc.fillStyle = downbeat ? colors.fg : colors.grid;
      zc.fillRect(Math.round(x), 0, downbeat ? 2 : 1, H);
    }
  }
  zc.fillStyle = colors.fg;
  zc.fillRect(W / 2 - 1, 0, 2, H);
}

function updateReadouts() {
  for (const id of ['A', 'B']) {
    const deck = decks[id];
    const el = deckEl(id);
    if (deck.bpm) $('.bpm', el).textContent = deck.effectiveBpm.toFixed(2);
    $('.pitch-readout', el).textContent = `${deck.pitch >= 0 ? '+' : ''}${(deck.pitch * 100).toFixed(2)}%`;
    $('.time', el).textContent = deck.buffer ? `${fmtTime(deck.position)} / ${fmtTime(deck.duration)}` : '0:00';
    $('.play', el).classList.toggle('on', deck.playing);
    const lvl = clamp(deck.level() * 2.5, 0, 1);
    $(`.channel[data-deck="${id}"] .meter-fill`).style.transform = `scaleY(${lvl})`;
  }

  const { A, B } = decks;
  const verdict = $('#match-verdict');
  const dot = $('#phase-dot');
  if (!A.bpm || !B.bpm) {
    $('#bpm-diff').textContent = '–';
    verdict.textContent = 'Load two tracks';
    verdict.className = 'verdict';
    dot.style.left = '50%';
    return;
  }
  const diff = A.effectiveBpm - B.effectiveBpm;
  $('#bpm-diff').textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`;
  if (!A.playing || !B.playing) {
    verdict.textContent = 'Play both decks';
    verdict.className = 'verdict';
    dot.style.left = '50%';
    return;
  }
  let ph = A.beatPhase - B.beatPhase;
  ph -= Math.round(ph); // -0.5..0.5 beats
  dot.style.left = `${50 + ph * 100}%`;
  const tempoOk = Math.abs(diff) < 0.05;
  const phaseOk = Math.abs(ph) < 0.03;
  dot.classList.toggle('good', tempoOk && phaseOk);
  if (tempoOk && phaseOk) { verdict.textContent = 'Locked in'; verdict.className = 'verdict good'; }
  else if (tempoOk) { verdict.textContent = `Tempo matched — nudge ${ph > 0 ? 'A back or B forward' : 'A forward or B back'}`; verdict.className = 'verdict warn'; }
  else { verdict.textContent = `Deck ${diff > 0 ? 'A' : 'B'} is faster — adjust tempo`; verdict.className = 'verdict bad'; }
}

function frame() {
  const colors = {
    a: cssVar('--deck-a'), b: cssVar('--deck-b'), fg: cssVar('--fg'),
    dim: cssVar('--wave-played'), grid: cssVar('--grid'), cue: cssVar('--cue'),
  };
  drawDeck('A', colors);
  drawDeck('B', colors);
  updateReadouts();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
async function start() {
  ctx = new AudioContext({ latencyHint: 'interactive' });
  master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.ratio.value = 12;
  master.connect(limiter).connect(ctx.destination);
  decks.A = new Deck(ctx, master, 'A');
  decks.B = new Deck(ctx, master, 'B');
  setCrossfader(0.5);

  $('#start-overlay').hidden = true;
  requestAnimationFrame(frame);

  // preload demos so there's something to mix right away
  loadDemo('A', 'prog128');
  loadDemo('B', 'house124');

  const status = $('#midi-status');
  try {
    await midi.init();
  } catch (err) {
    status.textContent = 'MIDI: unavailable';
    status.title = err.message;
    status.classList.add('bad');
  }
}

midi = new MidiInput({
  onAction: handleMidiAction,
  onMessage: logMidi,
  onDevices: (names) => {
    const status = $('#midi-status');
    status.textContent = names.length ? `MIDI: ${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}` : 'MIDI: no device';
    status.classList.toggle('good', names.length > 0);
    $('#midi-devices').textContent = names.length ? names.join(', ') : 'No controller detected — plug one in.';
  },
});

wireDecks();
wireKeyboard();
wireMidiPanel();
$('#start-btn').addEventListener('click', start, { once: true });
