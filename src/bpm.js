// Offline tempo + beat-grid estimation.
// 1. Low-pass the track (kick/bass carry the beat), 2. build an onset-strength envelope,
// 3. score candidate tempos with a comb over the envelope, 4. find the beat phase.

const TARGET_FPS = 200; // envelope frames per second (~5 ms resolution)

/** Renders two mono bands: lows (kick/808/bass) and highs (hats/snare transients). */
async function splitBands(buffer, startSec, durSec) {
  const sr = buffer.sampleRate;
  const len = Math.floor(durSec * sr);
  const off = new OfflineAudioContext(2, len, sr);
  const src = off.createBufferSource();
  src.buffer = buffer;
  const lp = off.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 150;
  const hp = off.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;
  const merge = off.createChannelMerger(2);
  src.connect(lp).connect(merge, 0, 0);
  src.connect(hp).connect(merge, 0, 1);
  merge.connect(off.destination);
  src.start(0, startSec, durSec);
  const rendered = await off.startRendering();
  return [rendered.getChannelData(0), rendered.getChannelData(1)];
}

function normalize(a) {
  let m = 0;
  for (const v of a) if (v > m) m = v;
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] /= m;
  return a;
}

function onsetEnvelope(samples, hop) {
  const n = Math.floor(samples.length / hop);
  const energy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    const base = i * hop;
    for (let j = 0; j < hop; j++) { const s = samples[base + j]; e += s * s; }
    energy[i] = Math.sqrt(e / hop);
  }
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  return onset;
}

function sampleAt(arr, x) {
  const i = Math.floor(x);
  if (i + 1 >= arr.length) return 0;
  const f = x - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

function combScore(onset, lag) {
  // correlate the envelope with itself at 1, 2 and 4 beats
  let s = 0;
  for (const mult of [1, 2, 4]) {
    const L = lag * mult;
    let acc = 0;
    for (let i = 0; i + L + 1 < onset.length; i += 2) acc += onset[i] * sampleAt(onset, i + L);
    s += acc / mult;
  }
  return s;
}

export async function analyzeTempo(buffer) {
  // analyse up to 60 s from the middle-ish of the track (skips quiet intros)
  const dur = Math.min(60, buffer.duration);
  const start = Math.max(0, Math.min(buffer.duration - dur, buffer.duration * 0.25));
  const hop = Math.round(buffer.sampleRate / TARGET_FPS);
  const FPS = buffer.sampleRate / hop; // exact frame rate, so the BPM isn't skewed by rounding
  const [lows, highs] = await splitBands(buffer, start, dur);
  const lowOnset = normalize(onsetEnvelope(lows, hop));
  const highOnset = normalize(onsetEnvelope(highs, hop));
  // tempo uses both bands (hats carry the pulse in half-time rap/trap); phase uses the kick
  const onset = lowOnset.map((v, i) => v + 0.6 * highOnset[i]);

  let best = { bpm: 120, score: -1 };
  for (let bpm = 80; bpm < 160; bpm += 0.25) {
    const score = combScore(onset, (60 * FPS) / bpm);
    if (score > best.score) best = { bpm, score };
  }
  // refine
  for (let bpm = best.bpm - 0.3; bpm <= best.bpm + 0.3; bpm += 0.02) {
    const score = combScore(onset, (60 * FPS) / bpm);
    if (score > best.score) best = { bpm, score };
  }
  const bpm = Math.round(best.bpm * 100) / 100;

  // beat phase: which offset within one beat lines up with the most onset energy
  const beatFrames = (60 * FPS) / bpm;
  let bestPhase = 0, bestPhaseScore = -1;
  for (let p = 0; p < beatFrames; p += 0.5) {
    let s = 0;
    for (let x = p; x < lowOnset.length; x += beatFrames) s += sampleAt(lowOnset, x);
    if (s > bestPhaseScore) { bestPhaseScore = s; bestPhase = p; }
  }
  const beatLen = 60 / bpm;
  let firstBeat = (start + bestPhase / FPS) % beatLen;
  if (firstBeat < 0) firstBeat += beatLen;
  return { bpm, firstBeat };
}
