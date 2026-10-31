import { ctx, now, musicBus, env, ready } from './audio.js';

// An adaptive procedural score. Driving, minor-key, built on a 16th grid.
//
// Scheduling uses the standard Web Audio lookahead pattern: a coarse timer
// wakes up every 25ms and schedules every step falling inside the next 120ms
// against ctx.currentTime. Sequencing from requestAnimationFrame instead would
// jitter audibly — rAF is tied to the display, the audio clock is not.

const LOOKAHEAD = 0.12;
const TICK = 25;
const BARS = 4;
const STEPS = BARS * 16;

// Scales, as semitone offsets from the root.
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

// Each tune is data: tempo, root, mode, chord movement, drum masks and the
// shape of the lead. Adding another is adding an entry here, not code.
export const TUNES = [
  {
    name: 'DROSS',
    blurb: 'D PHRYGIAN · 152',
    bpm: 152,
    root: 73.416,                       // D2
    scale: PHRYGIAN,
    prog: [0, 1, 0, -2],                // i bII i bVII — the flat second bites
    bass: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0],
    kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    arp: [0, 3, 7, 10, 7, 3],
    arpEvery: 2,
    bassType: 'sawtooth',
    leadType: 'square',
    padCut: 1100,
  },
  {
    name: 'QUENCH',
    blurb: 'A AEOLIAN · 126 · HALF TIME',
    bpm: 126,
    root: 55.000,                       // A1 — sits lower, feels heavier
    scale: AEOLIAN,
    prog: [0, 0, -4, -2],
    bass: [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    arp: [0, 7, 12, 7, 3, 7],
    arpEvery: 4,                        // sparser: more space between hits
    bassType: 'square',
    leadType: 'triangle',
    padCut: 760,
  },
  {
    name: 'OVERDRIVE',
    blurb: 'E DORIAN · 174 · DOUBLE TIME',
    bpm: 174,
    root: 82.407,                       // E2
    scale: DORIAN,
    prog: [0, 3, 5, 3],
    bass: [1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1],
    kick: [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
    arp: [0, 3, 7, 12, 10, 7, 3, 0],
    arpEvery: 1,                        // relentless
    bassType: 'sawtooth',
    leadType: 'square',
    padCut: 1500,
  },
  {
    name: 'VACUUM',
    blurb: 'D AEOLIAN · 104 · DRIFT',
    bpm: 104,
    root: 73.416,
    scale: AEOLIAN,
    prog: [0, -3, -5, -3],
    bass: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    arp: [0, 7, 12, 15, 12, 7],
    arpEvery: 4,
    bassType: 'triangle',
    leadType: 'triangle',
    padCut: 620,
  },
];

const M = {
  step: 0,
  nextTime: 0,
  timer: null,
  intensity: 0,     // 0 title · 1 cruise · 2 combat · 3 return run
  target: 0,
  running: false,
  tune: Number(localStorage.getItem('rnr.tune') || 0) % TUNES.length,
  pendingTune: null,
};

const cur = () => TUNES[M.tune];
const stepDur = () => 60 / cur().bpm / 4;
const note = (semi) => cur().root * Math.pow(2, semi / 12);

export function setIntensity(n) { M.target = n; }

// These report the SELECTED tune, which is the pending one if a switch is
// queued. The audio still changes on the next bar line, but the UI answers
// the keypress at once — otherwise pressing T looks like it did nothing for
// up to a bar and a half.
const selected = () => (M.pendingTune !== null ? M.pendingTune : M.tune);
export const tuneIndex = () => selected();
export const tuneName = () => TUNES[selected()].name;
export const tuneBlurb = () => TUNES[selected()].blurb;
export const tuneCount = () => TUNES.length;

// Switching lands on the next bar line, so a change never chops a phrase in
// half. The choice is remembered across reloads.
export function setTune(i) {
  const n = ((i % TUNES.length) + TUNES.length) % TUNES.length;
  if (n === selected()) return n;
  if (!M.running) { M.tune = n; } else { M.pendingTune = n; }
  try { localStorage.setItem('rnr.tune', String(n)); } catch { /* private mode */ }
  return n;
}

export const nextTune = () => setTune(selected() + 1);

export function startMusic() {
  if (!ready() || M.running) return;
  M.running = true;
  M.step = 0;
  M.nextTime = now() + 0.08;
  M.timer = setInterval(schedule, TICK);
}

export function stopMusic() {
  M.running = false;
  if (M.timer) { clearInterval(M.timer); M.timer = null; }
}

export const musicRunning = () => M.running;
export const musicStep = () => M.step;

function schedule() {
  const c = ctx();
  if (!c || !M.running) return;
  // If the tab was backgrounded the audio clock ran on without us; skip
  // forward rather than frantically scheduling a backlog of stale steps.
  if (M.nextTime < c.currentTime - 0.25) M.nextTime = c.currentTime + 0.05;

  while (M.nextTime < c.currentTime + LOOKAHEAD) {
    playStep(M.step, M.nextTime);
    M.nextTime += stepDur();
    M.step = (M.step + 1) % STEPS;
    // Intensity and tune changes both land on a bar line, so neither a new
    // layer nor a whole new track ever pops in mid-phrase.
    if (M.step % 16 === 0) {
      M.intensity = M.target;
      if (M.pendingTune !== null) { M.tune = M.pendingTune; M.pendingTune = null; }
    }
  }
}

function playStep(s, t) {
  const bus = musicBus();
  const T = cur();
  const bar = (s / 16) | 0;
  const pos = s % 16;
  const chord = T.prog[bar];
  const I = M.intensity;

  // ---- drums
  if (I >= 1) {
    if (T.kick[pos]) kick(t, bus);
    if (T.snare[pos]) snare(t, bus);
    const hatEvery = I >= 3 ? 1 : 2;
    if (pos % hatEvery === 0) hat(t, bus, pos % 4 === 0 ? 0.055 : 0.032);
  }

  // ---- bass
  if (I >= 1 && T.bass[pos]) {
    // walk up the mode on the last bar for a turnaround figure
    const walk = bar === 3 && pos >= 12 ? T.scale[(pos - 12) % T.scale.length] : 0;
    bass(note(chord + walk), t, bus, I >= 2 ? 0.3 : 0.22, T.bassType);
  }

  // ---- pad: the harmonic bed, present from the title screen on
  if (pos === 0) pad(note(chord + 12), t, bus, I === 0 ? 0.1 : 0.062, T.padCut);

  // ---- arpeggio lead
  if (I >= 2 && pos % T.arpEvery === T.arpEvery - 1) {
    const d = T.arp[((s / T.arpEvery) | 0) % T.arp.length];
    arpNote(note(chord + d + 24), t, bus, 0.072, T.leadType);
    if (I >= 3) arpNote(note(chord + d + 36), t, bus, 0.03, 'triangle');
  }

  // ---- title-screen sparkle, in place of drums
  if (I === 0 && pos % 8 === 4) {
    arpNote(note(chord + T.scale[(bar * 2) % T.scale.length] + 24), t, bus, 0.05, 'triangle');
  }
}

// ----------------------------------------------------------------- voices

function kick(t, bus) {
  const c = ctx();
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
  const g = env(bus, t, 0.002, 0.16, 0.85);
  o.connect(g);
  o.start(t); o.stop(t + 0.2);
}

function snare(t, bus) {
  const c = ctx();
  const n = c.createBufferSource();
  const len = Math.floor(c.sampleRate * 0.25);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  n.buffer = b;
  const bq = c.createBiquadFilter();
  bq.type = 'bandpass'; bq.frequency.value = 1900; bq.Q.value = 0.9;
  const g = env(bus, t, 0.002, 0.14, 0.45);
  n.connect(bq).connect(g);
  n.start(t); n.stop(t + 0.2);

  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(330, t);
  o.frequency.exponentialRampToValueAtTime(180, t + 0.08);
  const g2 = env(bus, t, 0.002, 0.09, 0.2);
  o.connect(g2);
  o.start(t); o.stop(t + 0.14);
}

function hat(t, bus, peak) {
  const c = ctx();
  const n = c.createBufferSource();
  const len = Math.floor(c.sampleRate * 0.06);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
  n.buffer = b;
  const bq = c.createBiquadFilter();
  bq.type = 'highpass'; bq.frequency.value = 7500;
  const g = env(bus, t, 0.001, 0.035, peak);
  n.connect(bq).connect(g);
  n.start(t); n.stop(t + 0.08);
}

function bass(f, t, bus, peak, type = 'sawtooth') {
  const c = ctx();
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  // slight detune layer for weight
  const o2 = c.createOscillator();
  o2.type = 'square';
  o2.frequency.value = f / 2;
  o2.detune.value = 6;

  const bq = c.createBiquadFilter();
  bq.type = 'lowpass';
  bq.Q.value = 7;
  bq.frequency.setValueAtTime(1500, t);
  bq.frequency.exponentialRampToValueAtTime(260, t + 0.14);

  const g = env(bus, t, 0.004, 0.13, peak);
  o.connect(bq); o2.connect(bq); bq.connect(g);
  o.start(t); o.stop(t + 0.2);
  o2.start(t); o2.stop(t + 0.2);
}

function arpNote(f, t, bus, peak, type = 'square') {
  const c = ctx();
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  const bq = c.createBiquadFilter();
  bq.type = 'lowpass';
  bq.frequency.value = 4200;
  const g = env(bus, t, 0.003, 0.11, peak);
  o.connect(bq).connect(g);
  o.start(t); o.stop(t + 0.16);
}

function pad(f, t, bus, peak, cutoff = 1100) {
  const c = ctx();
  const dur = stepDur() * 16;
  const g = c.createGain();
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.35);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  g.connect(bus);

  const bq = c.createBiquadFilter();
  bq.type = 'lowpass';
  bq.frequency.value = cutoff;
  bq.Q.value = 1.5;
  bq.connect(g);

  for (const det of [-7, 7]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(bq);
    o.start(t); o.stop(t + dur + 0.1);
  }
}
