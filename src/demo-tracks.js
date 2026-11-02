// Synthesised practice tracks in the genres the trainer focuses on: progressive house, EDM, house, rap.
// Rendered in the browser, so the app works with no audio files (and no licensing issues).
// Every track is built from 8-bar phrases (intro / main / breakdown / main / outro) so lessons
// can teach phrase-aligned mixing.

export const DEMO_TRACKS = [
  { id: 'prog128', genre: 'Progressive House', name: 'Demo: Midnight Drive', bpm: 128, root: 45, bars: 40, style: 'prog' },
  { id: 'prog124', genre: 'Progressive House', name: 'Demo: Slow Horizon', bpm: 124, root: 50, bars: 40, style: 'prog' },
  { id: 'edm128', genre: 'EDM', name: 'Demo: Main Stage', bpm: 128, root: 41, bars: 40, style: 'edm' },
  { id: 'edm126', genre: 'EDM', name: 'Demo: Festival Lights', bpm: 126, root: 43, bars: 40, style: 'edm' },
  { id: 'house124', genre: 'House', name: 'Demo: Warehouse Piano', bpm: 124, root: 48, bars: 40, style: 'house' },
  { id: 'house122', genre: 'House', name: 'Demo: Deep Groove', bpm: 122, root: 45, bars: 40, style: 'house' },
  { id: 'rap90', genre: 'Rap', name: 'Demo: Boom Bap Cypher', bpm: 90, root: 40, bars: 32, style: 'boombap' },
  { id: 'rap140', genre: 'Rap', name: 'Demo: Trap Run (140)', bpm: 140, root: 42, bars: 32, style: 'trap' },
];

const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

function noiseBuffer(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

function instruments(ctx, master) {
  const noise = noiseBuffer(ctx, 1);
  const env = (g, t, peak, attack, decay) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const noiseHit = (t, { type, freq, q = 0.8, peak, decay, offset = 0 }) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, 0.002, decay);
    s.connect(f).connect(g).connect(master);
    s.start(t, offset, decay + 0.05);
  };
  const tone = (t, { type, note, peak, attack = 0.005, decay, cutoff = 20000, q = 0.7, detune = 0 }) => {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = midiHz(note); o.detune.value = detune;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, attack, decay);
    o.connect(f).connect(g).connect(master);
    o.start(t); o.stop(t + attack + decay + 0.05);
  };

  return {
    kick(t, { peak = 1, from = 150, to = 45, decay = 0.35 } = {}) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + 0.12);
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + decay + 0.05);
    },
    hat: (t, open = false, peak = 0.15) =>
      noiseHit(t, { type: 'highpass', freq: 7500, peak: open ? peak * 1.4 : peak, decay: open ? 0.18 : 0.04, offset: Math.random() * 0.5 }),
    clap: (t, peak = 0.35) => noiseHit(t, { type: 'bandpass', freq: 1500, peak, decay: 0.16, offset: 0.3 }),
    snare(t, peak = 0.4) {
      noiseHit(t, { type: 'bandpass', freq: 2200, q: 0.6, peak, decay: 0.2, offset: 0.1 });
      tone(t, { type: 'triangle', note: 55, peak: peak * 0.6, decay: 0.09 });
    },
    sub808(t, note, dur) {
      tone(t, { type: 'sine', note, peak: 0.6, attack: 0.004, decay: dur });
      tone(t, { type: 'triangle', note: note + 12, peak: 0.08, attack: 0.004, decay: dur * 0.5 });
    },
    bass: (t, note, dur, cutoff = 420, peak = 0.28) =>
      tone(t, { type: 'sawtooth', note, peak, attack: 0.008, decay: dur, cutoff, q: 4 }),
    pluck: (t, note, peak = 0.07, cutoff = 2600) =>
      tone(t, { type: 'sawtooth', note, peak, attack: 0.003, decay: 0.18, cutoff, q: 2 }),
    supersaw(t, notes, dur, peak = 0.035) {
      for (const n of notes) for (const d of [-14, 0, 14]) tone(t, { type: 'sawtooth', note: n, peak, attack: 0.01, decay: dur, cutoff: 5000, detune: d });
    },
    pad(t, notes, dur, peak = 0.03) {
      for (const n of notes) for (const d of [-8, 8]) tone(t, { type: 'sawtooth', note: n, peak, attack: dur * 0.4, decay: dur * 0.6, cutoff: 1400, detune: d });
    },
    piano(t, notes, peak = 0.09) {
      for (const n of notes) {
        tone(t, { type: 'triangle', note: n, peak, attack: 0.003, decay: 0.45 });
        tone(t, { type: 'square', note: n, peak: peak * 0.25, attack: 0.003, decay: 0.12, cutoff: 3000 });
      }
    },
    keys: (t, notes, dur, peak = 0.05) => {
      for (const n of notes) tone(t, { type: 'triangle', note: n, peak, attack: 0.01, decay: dur, cutoff: 2000 });
    },
    riser(t, dur) {
      const s = ctx.createBufferSource();
      s.buffer = noise; s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 1.5;
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(9000, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
      s.connect(f).connect(g).connect(master);
      s.start(t); s.stop(t + dur + 0.1);
    },
  };
}

// minor-key progressions as semitone offsets from the root, one chord per bar
const PROG_CHORDS = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]]; // i – VI – VII – v
const POP_CHORDS = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];   // i – VI – III – VII

/** Section for a given bar in a 40-bar dance arrangement. */
function danceSection(bar) {
  if (bar < 8) return 'intro';
  if (bar < 16) return 'main';
  if (bar < 24) return 'break';
  if (bar < 32) return 'drop';
  return 'outro';
}

function scheduleProg(I, spec, beat, lead) {
  const r = spec.root;
  for (let b = 0; b < spec.bars * 4; b++) {
    const t = lead + b * beat, bar = Math.floor(b / 4), inBar = b % 4;
    const sec = danceSection(bar);
    const chord = PROG_CHORDS[Math.floor(bar / 2) % 4];
    if (sec !== 'break') I.kick(t);
    if (sec !== 'break') I.hat(t + beat / 2, sec === 'drop');
    if (sec === 'main' || sec === 'drop') { if (inBar % 2 === 1) I.clap(t, 0.25); I.hat(t + beat * 0.75, false, 0.07); }
    // rolling 16th bassline (the prog signature), muted on the downbeat to leave room for the kick
    if (sec !== 'intro' || bar >= 4) {
      for (let s = 1; s < 4; s++) I.bass(t + (s * beat) / 4, r - 12 + chord[0], beat * 0.2, sec === 'drop' ? 700 : 450, 0.2);
    }
    if (inBar === 0 && bar % 2 === 0 && sec !== 'intro') I.pad(t, chord.map((n) => r + 12 + n), beat * 8);
    // arpeggiated pluck
    if (sec === 'drop' || sec === 'break') {
      const arp = [0, 1, 2, 1];
      for (let s = 0; s < 4; s++) I.pluck(t + (s * beat) / 4, r + 24 + chord[arp[s]], 0.05, sec === 'break' ? 1400 : 3200);
    }
    if (bar === 20 && inBar === 0) I.riser(t, beat * 16);
  }
}

function scheduleEdm(I, spec, beat, lead) {
  const r = spec.root;
  for (let b = 0; b < spec.bars * 4; b++) {
    const t = lead + b * beat, bar = Math.floor(b / 4), inBar = b % 4;
    const sec = danceSection(bar);
    const chord = POP_CHORDS[bar % 4];
    if (sec !== 'break') I.kick(t, { peak: 1.1, from: 180, to: 48, decay: 0.42 });
    if (sec !== 'break') I.hat(t + beat / 2, true, 0.16);
    if (sec !== 'intro' && sec !== 'break' && inBar % 2 === 1) I.clap(t, 0.4);
    if (sec === 'main' || sec === 'drop') I.bass(t + beat / 2, r - 12 + chord[0], beat * 0.35, 900, 0.22);
    // off-beat supersaw stabs on the drop, held chords in the breakdown
    if (sec === 'drop') I.supersaw(t + beat / 2, chord.map((n) => r + 24 + n), beat * 0.3);
    if (sec === 'break' && inBar === 0) I.supersaw(t, chord.map((n) => r + 24 + n), beat * 3.6, 0.025);
    // build: accelerating snare roll in the last 4 bars of the break
    if (sec === 'break' && bar >= 20) {
      const div = bar < 22 ? 2 : bar < 23 ? 4 : 8;
      for (let s = 0; s < div; s++) I.snare(t + (s * beat) / div, 0.12 + (bar - 20) * 0.06);
    }
    if (bar === 16 && inBar === 0) I.riser(t, beat * 32);
  }
}

function scheduleHouse(I, spec, beat, lead) {
  const r = spec.root;
  const organ = [0, 0, 12, 0, 10, 0, 7, 0]; // 8th-note organ bass pattern
  for (let b = 0; b < spec.bars * 4; b++) {
    const t = lead + b * beat, bar = Math.floor(b / 4), inBar = b % 4;
    const sec = danceSection(bar);
    const chord = PROG_CHORDS[bar % 4];
    if (sec !== 'break' || bar >= 20) I.kick(t);
    I.hat(t + beat / 2, sec === 'main' || sec === 'drop', 0.13);
    if (sec !== 'intro' && inBar % 2 === 1) I.clap(t, 0.3);
    if (sec !== 'intro' || bar >= 4) {
      for (let s = 0; s < 2; s++) {
        const n = organ[(inBar * 2 + s) % 8];
        if (n || s) I.bass(t + (s * beat) / 2, r - 12 + chord[0] + n, beat * 0.3, 600, 0.2);
      }
    }
    // classic piano chord stabs: on the "and" of 1 and on 3
    if (sec === 'main' || sec === 'drop' || sec === 'break') {
      if (inBar === 0) I.piano(t + beat / 2, chord.map((n) => r + 24 + n));
      if (inBar === 2) I.piano(t + beat * 0.75, chord.map((n) => r + 24 + n), 0.07);
    }
  }
}

function scheduleBoomBap(I, spec, beat, lead) {
  const r = spec.root;
  const swing = beat * 0.08; // late 16ths give the head-nod feel
  const loop = [[0, 3, 7, 10], [-4, 0, 3, 7]];
  for (let b = 0; b < spec.bars * 4; b++) {
    const t = lead + b * beat, bar = Math.floor(b / 4), inBar = b % 4;
    const intro = bar < 4;
    // kick on 1, the "and" of 2 and on 3 (classic boom-bap)
    if (!intro) {
      if (inBar === 0) I.kick(t, { decay: 0.4, to: 50 });
      if (inBar === 1) I.kick(t + beat / 2 + swing, { peak: 0.7, decay: 0.3, to: 50 });
      if (inBar === 2) I.kick(t, { decay: 0.4, to: 50 });
      if (inBar % 2 === 1) I.snare(t, 0.45);
    }
    I.hat(t, false, 0.09);
    I.hat(t + beat / 2 + swing, false, 0.06);
    // dusty jazz keys loop, two bars
    if (inBar === 0) I.keys(t, loop[bar % 2].map((n) => r + 24 + n), beat * 3.6);
    if (!intro && (inBar === 0 || inBar === 2)) I.bass(t, r - 12 + loop[bar % 2][0], beat * 0.8, 300, 0.25);
  }
}

function scheduleTrap(I, spec, beat, lead) {
  const r = spec.root;
  for (let b = 0; b < spec.bars * 4; b++) {
    const t = lead + b * beat, bar = Math.floor(b / 4), inBar = b % 4;
    const intro = bar < 4;
    // half-time: snare/clap on beat 3, 808 follows the kick
    if (!intro) {
      if (inBar === 0) { I.kick(t, { decay: 0.2 }); I.sub808(t, r - 12, beat * 1.4); }
      if (inBar === 1 && bar % 2 === 1) { I.kick(t + beat / 2, { decay: 0.2 }); I.sub808(t + beat / 2, r - 12 + 3, beat * 0.9); }
      if (inBar === 2) { I.snare(t, 0.4); I.clap(t, 0.25); }
    }
    // hi-hat 8ths with 16th/triplet rolls at the end of every other bar
    const roll = inBar === 3 && bar % 2 === 1;
    const div = roll ? 6 : 2;
    for (let s = 0; s < div; s++) I.hat(t + (s * beat) / div, false, roll ? 0.08 : 0.11);
    if (inBar === 0 && bar % 2 === 0) I.pad(t, [r + 24, r + 27, r + 31], beat * 8, 0.022);
    if (!intro && inBar === 0 && bar % 4 === 2) {
      for (let s = 0; s < 4; s++) I.pluck(t + s * beat * 0.75, r + 36 + [0, 3, 7, 3][s], 0.05, 2000);
    }
  }
}

const SCHEDULERS = { prog: scheduleProg, edm: scheduleEdm, house: scheduleHouse, boombap: scheduleBoomBap, trap: scheduleTrap };

// How long each one-shot sound needs to ring out (seconds), from its arguments.
const SOUND_LENGTH = {
  kick: () => 0.5, hat: () => 0.25, clap: () => 0.25, snare: () => 0.3, piano: () => 0.6, pluck: () => 0.3,
  sub808: (a) => a[1] + 0.1, bass: (a) => a[1] + 0.1, supersaw: (a) => a[1] + 0.1,
  pad: (a) => a[1] + 0.1, keys: (a) => a[1] + 0.1, riser: (a) => a[0] + 0.2,
};

async function renderSound(name, args, sampleRate) {
  const len = Math.ceil(SOUND_LENGTH[name](args) * sampleRate);
  const ctx = new OfflineAudioContext(1, len, sampleRate);
  const out = ctx.createGain();
  out.gain.value = 0.6;
  out.connect(ctx.destination);
  instruments(ctx, out)[name](0, ...args);
  return (await ctx.startRendering()).getChannelData(0);
}

/**
 * Scheduling thousands of live nodes in one OfflineAudioContext is very slow, so instead each
 * distinct sound (instrument + arguments) is rendered once and then mixed onto the timeline in JS.
 */
export async function renderDemo(spec, sampleRate = 44100) {
  const beat = 60 / spec.bpm;
  const lead = 0.05; // tiny lead-in so beat 1 isn't at sample 0
  const events = [];
  const recorder = new Proxy({}, { get: (_, name) => (t, ...args) => events.push([name, t, args]) });
  SCHEDULERS[spec.style](recorder, spec, beat, lead);

  const keyOf = (name, args) => name + JSON.stringify(args);
  const pending = new Map();
  for (const [name, , args] of events) {
    const key = keyOf(name, args);
    if (!pending.has(key)) pending.set(key, renderSound(name, args, sampleRate));
  }
  const sounds = new Map();
  for (const [key, p] of pending) sounds.set(key, await p);

  const len = Math.ceil((lead + spec.bars * 4 * beat + 1.5) * sampleRate);
  const mix = new Float32Array(len);
  for (const [name, t, args] of events) {
    const snd = sounds.get(keyOf(name, args));
    const start = Math.round(t * sampleRate);
    const n = Math.min(snd.length, len - start);
    for (let i = 0; i < n; i++) mix[start + i] += snd[i];
  }
  // gentle soft-clip in place of a bus compressor
  for (let i = 0; i < len; i++) mix[i] = Math.tanh(mix[i] * 1.2) / 1.2;

  const out = new AudioBuffer({ length: len, sampleRate, numberOfChannels: 2 });
  out.copyToChannel(mix, 0);
  out.copyToChannel(mix, 1);
  return out;
}
