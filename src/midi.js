// Web MIDI input with MIDI-learn. Mapping key: "cc:<ch>:<num>" or "note:<ch>:<num>".

const STORE_KEY = 'woo.midiMap.v1';

export function parseMessage(data) {
  const [status, d1 = 0, d2 = 0] = data;
  const cmd = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  if (cmd === 0x90 || cmd === 0x80) {
    return { type: 'note', ch, num: d1, value: cmd === 0x90 ? d2 : 0, key: `note:${ch}:${d1}` };
  }
  if (cmd === 0xb0) return { type: 'cc', ch, num: d1, value: d2, key: `cc:${ch}:${d1}` };
  if (cmd === 0xe0) return { type: 'pitchbend', ch, num: 0, value: (d2 << 7) | d1, key: `pb:${ch}` };
  return null;
}

/** Relative encoders: Pioneer-style centres on 64 (65 = +1), Numark-style is two's complement (127 = -1). */
export function relativeDelta(v) {
  if (v >= 40 && v <= 88) return v - 64;
  return v >= 64 ? v - 128 : v;
}

export class MidiInput {
  constructor({ onAction, onMessage, onDevices }) {
    this.onAction = onAction;
    this.onMessage = onMessage;
    this.onDevices = onDevices;
    this.access = null;
    this.learning = null; // action name waiting for a control
    this.map = this._loadMap();
  }

  get supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }

  async init() {
    if (!this.supported) throw new Error('Web MIDI is not supported in this browser. Use Chrome or Edge on desktop.');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this._bind();
    this._bind();
  }

  _bind() {
    const names = [];
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e) => this._handle(e, input.name);
      if (input.state === 'connected') names.push(input.name);
    }
    this.onDevices?.(names);
  }

  _handle(e, deviceName) {
    const msg = parseMessage(e.data);
    if (!msg) return;
    this.onMessage?.(msg, deviceName);

    if (this.learning) {
      // ignore note-offs while learning so releasing a button doesn't mis-map
      if (msg.type === 'note' && msg.value === 0) return;
      // one physical control → one action
      for (const k of Object.keys(this.map)) if (this.map[k] === this.learning) delete this.map[k];
      this.map[msg.key] = this.learning;
      const learned = this.learning;
      this.learning = null;
      this._saveMap();
      this.onAction?.({ learned, key: msg.key });
      return;
    }

    const action = this.map[msg.key];
    if (action) this.onAction?.({ action, msg });
  }

  learn(action) { this.learning = action; }
  cancelLearn() { this.learning = null; }

  keyFor(action) { return Object.keys(this.map).find((k) => this.map[k] === action) || null; }

  unmap(action) {
    for (const k of Object.keys(this.map)) if (this.map[k] === action) delete this.map[k];
    this._saveMap();
  }

  clear() { this.map = {}; this._saveMap(); }

  exportJson() { return JSON.stringify({ version: 1, map: this.map }, null, 2); }

  importJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed.map !== 'object') throw new Error('Not a woo mapping file');
    this.map = { ...parsed.map };
    this._saveMap();
  }

  _loadMap() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }

  _saveMap() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.map)); } catch { /* storage unavailable */ }
  }
}
