// One playback deck: source -> trim -> 3-band EQ -> filter -> channel fader -> crossfader gain.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const PITCH_RANGE = 0.08; // ±8%, like most controllers' default

export class Deck {
  constructor(ctx, output, id) {
    this.ctx = ctx;
    this.id = id;

    this.trim = ctx.createGain();
    this.low = ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 220;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 0.8;
    this.high = ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 3500;
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 10;
    this.hp.Q.value = 0.9;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 22000;
    this.lp.Q.value = 0.9;
    this.fader = ctx.createGain();
    this.xfade = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this._meterBuf = new Float32Array(this.analyser.fftSize);

    this.trim.connect(this.low).connect(this.mid).connect(this.high)
      .connect(this.hp).connect(this.lp).connect(this.fader).connect(this.xfade).connect(output);
    this.fader.connect(this.analyser);

    this.buffer = null;
    this.name = '';
    this.source = null;
    this.playing = false;
    this.offset = 0;      // track position (s) at startedAt
    this.startedAt = 0;   // ctx time playback (re)started
    this.pitch = 0;       // -PITCH_RANGE..PITCH_RANGE
    this.bend = 0;        // temporary jog / nudge bend
    this.cuePoint = 0;
    this.bpm = null;
    this.firstBeat = 0;
    this._bendTimer = null;

    this.setVolume(0.8);
  }

  get duration() { return this.buffer ? this.buffer.duration : 0; }
  get rate() { return (1 + this.pitch) * (1 + this.bend); }
  get effectiveBpm() { return this.bpm ? this.bpm * (1 + this.pitch) : null; }

  get position() {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.offset + (this.ctx.currentTime - this.startedAt) * this.rate);
  }

  /** Fraction (0..1) of the way through the current beat. */
  get beatPhase() {
    if (!this.bpm) return null;
    const beatLen = 60 / this.bpm;
    const b = (this.position - this.firstBeat) / beatLen;
    return b - Math.floor(b);
  }

  load(buffer, name) {
    this.pause();
    this.buffer = buffer;
    this.name = name;
    this.offset = 0;
    this.cuePoint = 0;
    this.bpm = null;
    this.firstBeat = 0;
  }

  play() {
    if (!this.buffer || this.playing) return;
    if (this.offset >= this.duration - 0.01) this.offset = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.trim);
    src.start(0, this.offset);
    src.onended = () => {
      if (this.source === src && this.playing) {
        this.playing = false;
        this.offset = this.duration;
        this.source = null;
      }
    };
    this.source = src;
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position;
    this.playing = false;
    const src = this.source;
    this.source = null;
    try { src.stop(); } catch { /* already stopped */ }
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    const wasPlaying = this.playing;
    this.pause();
    this.offset = clamp(t, 0, this.duration);
    if (wasPlaying) this.play();
  }

  /** CDJ-style cue: while playing, jump back to cue and stop; while stopped, set cue here. */
  cue() {
    if (!this.buffer) return;
    if (this.playing) {
      this.pause();
      this.offset = this.cuePoint;
    } else {
      this.cuePoint = this.offset;
    }
  }

  _rebase() {
    if (this.playing) {
      this.offset = this.position;
      this.startedAt = this.ctx.currentTime;
    }
  }

  _applyRate() {
    if (this.source) this.source.playbackRate.setValueAtTime(this.rate, this.ctx.currentTime);
  }

  setPitch(p) {
    this._rebase();
    this.pitch = clamp(p, -PITCH_RANGE, PITCH_RANGE);
    this._applyRate();
  }

  setBend(b) {
    this._rebase();
    this.bend = clamp(b, -0.3, 0.3);
    this._applyRate();
  }

  /** Temporary speed-up / slow-down, auto-released. */
  pitchBend(amount, ms = 120) {
    this.setBend(amount);
    clearTimeout(this._bendTimer);
    this._bendTimer = setTimeout(() => this.setBend(0), ms);
  }

  /** Jog wheel: bend while playing, scrub while stopped. delta = ticks (+/-). */
  jog(delta) {
    if (!this.buffer) return;
    if (this.playing) this.pitchBend(delta * 0.01, 100);
    else this.seek(this.position + delta * 0.01);
  }

  // ---- mixer parameters, all take 0..1 with 0.5 as neutral where applicable ----
  _smooth(param, value) { param.setTargetAtTime(value, this.ctx.currentTime, 0.015); }

  setVolume(v) { this._smooth(this.fader.gain, v * v); }
  setTrim(v) { this._smooth(this.trim.gain, Math.pow(10, ((v - 0.5) * 24) / 20)); } // ±12 dB

  setEq(band, v) {
    // 0 → -26 dB (near kill), 0.5 → 0 dB, 1 → +6 dB
    const db = v < 0.5 ? -26 * (1 - v / 0.5) : 6 * ((v - 0.5) / 0.5);
    this._smooth(this[band].gain, db);
  }

  setFilter(v) {
    const lpF = v < 0.5 ? 200 * Math.pow(110, v / 0.5) : 22000;
    const hpF = v > 0.5 ? 10 * Math.pow(800, (v - 0.5) / 0.5) : 10;
    this._smooth(this.lp.frequency, lpF);
    this._smooth(this.hp.frequency, hpF);
  }

  /** RMS level of the post-fader signal, 0..~1. */
  level() {
    this.analyser.getFloatTimeDomainData(this._meterBuf);
    let sum = 0;
    for (const s of this._meterBuf) sum += s * s;
    return Math.sqrt(sum / this._meterBuf.length);
  }
}
