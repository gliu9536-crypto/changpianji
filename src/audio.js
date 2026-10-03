/* ------------------------------------------------------------------ *
 *  VinylAudio — the turntable's own acoustic bed, generated at runtime.
 *
 *  A record player is never silent: there is the click of dust in the
 *  groove, the slow rumble of the platter, and the faint whine of the
 *  direct-drive motor under the disc. The bed is assembled from three
 *  looped buffers and gated by the transport (only while playing).
 * ------------------------------------------------------------------ */
export class VinylAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bed = null;
    this.level = 0.30;
    this.on = false;
  }

  setLevel(v) { this.level = v; if (this.master) this.master.gain.value = v; }

  _noise(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _ensure() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.level;
    master.connect(ctx.destination);
    this.master = master;

    // ---- crackle : sparse impulses -> highpass -> the "dust in the groove"
    //      clicks. An impulse train with random gain reads far closer to vinyl
    //      than filtered noise does.
    const ckLen = ctx.sampleRate * 3;
    const ckBuf = ctx.createBuffer(1, ckLen, ctx.sampleRate);
    const cd = ckBuf.getChannelData(0);
    for (let i = 0; i < ckLen; i++) {
      cd[i] = (Math.random() < 0.0009 ? Math.random() * 1.4 - 0.7 : 0) * (Math.random() < 0.06 ? 3.2 : 1);
    }
    const ck = ctx.createBufferSource(); ck.buffer = ckBuf; ck.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
    const ckG = ctx.createGain(); ckG.gain.value = 0.50;
    ck.connect(hp); hp.connect(ckG); ckG.connect(master); ck.start();

    // ---- rumble : low-frequency bed — a slow sine drifting against filtered
    //      noise, the platter's bearing turning.
    const rmLen = ctx.sampleRate * 2;
    const rmBuf = ctx.createBuffer(1, rmLen, ctx.sampleRate);
    const rd = rmBuf.getChannelData(0);
    for (let i = 0; i < rmLen; i++) {
      const t = i / ctx.sampleRate;
      rd[i] = Math.sin(2 * Math.PI * 33 * t) * 0.5 + Math.sin(2 * Math.PI * 47 * t) * 0.3;
    }
    const rm = ctx.createBufferSource(); rm.buffer = rmBuf; rm.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90;
    const rmG = ctx.createGain(); rmG.gain.value = 0.40;
    rm.connect(lp); lp.connect(rmG); rmG.connect(master); rm.start();

    // ---- motor : a steady 200 Hz hum with its first harmonic — a direct-drive
    //      motor idling under the platter.
    const mLen = ctx.sampleRate * 1;
    const mBuf = ctx.createBuffer(1, mLen, ctx.sampleRate);
    const md = mBuf.getChannelData(0);
    for (let i = 0; i < mLen; i++) {
      const t = i / ctx.sampleRate;
      md[i] = Math.sin(2 * Math.PI * 200 * t) * 0.5 + Math.sin(2 * Math.PI * 400 * t) * 0.16;
    }
    const mo = ctx.createBufferSource(); mo.buffer = mBuf; mo.loop = true;
    const mG = ctx.createGain(); mG.gain.value = 0.18;
    mo.connect(mG); mG.connect(master); mo.start();

    // the bed is gated by a single gain so start()/stop() can fade it
    const bed = ctx.createGain(); bed.gain.value = 0;
    this.bed = bed;
    ckG.disconnect(master); ckG.connect(bed);
    rmG.disconnect(master); rmG.connect(bed);
    mG.disconnect(master); mG.connect(bed);
    bed.connect(master);
  }

  _resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  start() {
    this._ensure(); this._resume();
    this.on = true;
    const t = this.ctx.currentTime;
    this.bed.gain.cancelScheduledValues(t);
    this.bed.gain.setValueAtTime(this.bed.gain.value, t);
    this.bed.gain.linearRampToValueAtTime(0.8, t + 0.25);
  }

  stop() {
    if (!this.ctx || !this.on) return;
    this.on = false;
    const t = this.ctx.currentTime;
    this.bed.gain.cancelScheduledValues(t);
    this.bed.gain.setValueAtTime(this.bed.gain.value, t);
    this.bed.gain.linearRampToValueAtTime(0, t + 0.18);
  }

  /** a detent click — a step of the transport */
  tick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(1600, t);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.04);
  }

  /** a heavier mechanical clunk — the tonearm lifting off / setting down */
  clunk(pitch = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.08);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.13);
  }
}

/* ------------------------------------------------------------------ *
 *  genMusic — a short lo-fi ambient piece, synthesised here and now and
 *  returned as a WAV blob URL. No files, no fetch: the melody exists only
 *  because this function ran.
 * ------------------------------------------------------------------ */
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function genMusic() {
  const sr = 22050;                 // lo-fi, by choice: halves the work and softens the top
  const dur = 32;                   // seconds
  const N = Math.round(sr * dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  // A-minor-ish progression, four chords of eight seconds, held as pads.
  const chords = [
    [57, 60, 64, 67],  // Am7
    [53, 57, 60, 65],  // Fmaj7
    [48, 52, 55, 60],  // Cmaj7
    [55, 59, 62, 67],  // G
  ];
  const chordDur = dur / chords.length;

  // a slow pentatonic line — one note every two seconds, felt rather than counted
  const melody = [69, 72, 76, 72, 67, 71, 74, 71, 64, 67, 71, 67, 62, 64, 67, 74];
  const noteDur = dur / melody.length;

  let lp = 0; // one-pole lowpass state, keeps the whole thing warm

  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const ci = Math.min(chords.length - 1, Math.floor(t / chordDur));
    const chord = chords[ci];

    // pad — a soft stack of detuned sines, one per chord tone
    let pad = 0;
    for (let c = 0; c < chord.length; c++) {
      const f = midi(chord[c]);
      pad += Math.sin(2 * Math.PI * f * t) * 0.5;
      pad += Math.sin(2 * Math.PI * f * 1.004 * t) * 0.28; // slight detune = warmth
    }
    pad /= chord.length;

    // bass — root two octaves down
    const bass = Math.sin(2 * Math.PI * midi(chord[0] - 24) * t) * 0.9;

    // melody — the current note with a gentle attack / release
    const mi = Math.min(melody.length - 1, Math.floor(t / noteDur));
    const nt = (t - mi * noteDur) / noteDur;         // 0..1 within the note
    const env = Math.min(1, nt / 0.12) * (1 - Math.min(1, Math.max(0, (nt - 0.72) / 0.28)));
    const mf = midi(melody[mi]);
    const lead = (Math.sin(2 * Math.PI * mf * t) * 0.6 + Math.sin(2 * Math.PI * mf * 2 * t) * 0.12) * env;

    let s = pad * 0.16 + bass * 0.10 + lead * 0.13;

    // one-pole lowpass around 2.2 kHz — the blanket over the mix
    const k = 1 - Math.exp(-2 * Math.PI * 2200 / sr);
    lp += k * (s - lp);
    s = lp;

    L[i] = s * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.2 * t + 1)); // slow stereo drift
    R[i] = s * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.2 * t + 4));
  }

  return { src: encodeWav(L, R, sr), duration: dur };
}

function encodeWav(L, R, sr) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i])) * 32767;
    const r = Math.max(-1, Math.min(1, R[i])) * 32767;
    dv.setInt16(44 + i * 4, l, true);
    dv.setInt16(44 + i * 4 + 2, r, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
