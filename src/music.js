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
    chord: [0, 3, 7],           // minor
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
    chord: [0, 3, 7, 10],       // minor seventh, heavier
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
    chord: [0, 3, 7, 9],        // dorian sixth, brighter
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
    chord: [0, 7, 12],          // open fifth, sparse
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
  const step = stepDur();

  // ---- drums
  if (I >= 1) {
    if (T.kick[pos]) kick(t, bus);
    if (T.snare[pos]) snare(t, bus);
    const hatEvery = I >= 3 ? 1 : 2;
    if (pos % hatEvery === 0) hat(t, bus, pos % 4 === 0 ? 0.08 : 0.045);
  }

  // ---- bass
  if (I >= 1 && T.bass[pos]) {
    const walk = bar === 3 && pos >= 12 ? T.scale[(pos - 12) % T.scale.length] : 0;
    bass(note(chord + walk), t, bus, I >= 2 ? 0.34 : 0.24);
  }

  // ---- harmony, as a hard arpeggio rather than a held chord. This is the
  // sound the whole rewrite is for: three notes cycling at 50Hz, which the
  // ear hears as a chord with a trill inside it.
  if (I >= 1 && pos % 4 === 0) {
    const voicing = (T.chord || [0, 3, 7]).map((iv) => chord + iv + 12);
    sidChord(voicing, t, step * 4 * 0.92, I >= 2 ? 0.075 : 0.05, bus, {
      duty: dutyAt(s), cutFrom: 3200, cutTo: 1100, q: 7,
    });
  }

  // ---- lead
  if (I >= 2 && pos % T.arpEvery === T.arpEvery - 1) {
    const d = T.arp[((s / T.arpEvery) | 0) % T.arp.length];
    arpNote(note(chord + d + 24), t, bus, 0.085, null, s);
    if (I >= 3) arpNote(note(chord + d + 36), t, bus, 0.035, null, s + 7);
  }

  // ---- title screen: the pad and an occasional figure, no drums
  if (I === 0) {
    if (pos === 0) pad(note(chord + 12), t, bus, 0.085, T.padCut);
    if (pos % 8 === 4) {
      sidChord((T.chord || [0, 3, 7]).map((iv) => chord + iv + 24),
        t, step * 3, 0.05, bus, { duty: 0.35, cutFrom: 2600, cutTo: 1400, q: 4 });
    }
  }
}

// ----------------------------------------------------------------- voices
//
// Written to sound like a SID rather than like a general-purpose synth. The
// things that actually make a 6581 recognisable, in order of importance:
//
//  1. Pulse waves with a moving duty cycle. Not saw, not square — a pulse
//     whose width sweeps. This is the single most identifying feature.
//  2. Chords played as very fast arpeggios. The chip had three voices, so a
//     chord was faked by cycling its notes every frame at 50Hz. It sounds
//     like a chord and a trill at once, and nothing else sounds like it.
//  3. Hard, short envelopes with an audible click on the attack.
//  4. A resonant low-pass that is swept per note, not set and left.
//  5. Drums built from the same three voices: noise plus a pitch-swept tone.

const PULSE_CACHE = new Map();

// A pulse wave of the given duty, as a Fourier series. OscillatorNode has no
// pulse type and no PWM, so the duty is baked into a PeriodicWave and the
// wave is swapped between notes to make the width move.
function pulseWave(duty) {
  const key = Math.round(duty * 100);
  const hit = PULSE_CACHE.get(key);
  if (hit) return hit;

  const N = 48;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    // a_n for a pulse of width `duty`
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  const w = ctx().createPeriodicWave(real, imag, { disableNormalization: false });
  PULSE_CACHE.set(key, w);
  return w;
}

// The duty drifts across the phrase, which is what gives a SID lead its
// restless, slightly seasick quality.
function dutyAt(step) {
  return 0.12 + 0.34 * (0.5 + 0.5 * Math.sin(step * 0.19));
}

// One pulse voice: oscillator -> swept resonant filter -> hard envelope.
function pulseVoice(f, t, dur, peak, bus, opts = {}) {
  const c = ctx();
  const {
    duty = 0.25, cutFrom = 2600, cutTo = 700, q = 9,
    vibrato = 0, attack = 0.002, detune = 0,
  } = opts;

  const o = c.createOscillator();
  o.setPeriodicWave(pulseWave(duty));
  o.frequency.value = f;
  o.detune.value = detune;

  // per-note vibrato, as a SID would do it from its own frame interrupt
  let lfo = null;
  if (vibrato) {
    lfo = c.createOscillator();
    lfo.frequency.value = 6.2;
    const amt = c.createGain();
    amt.gain.value = vibrato;
    lfo.connect(amt).connect(o.detune);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  const bq = c.createBiquadFilter();
  bq.type = 'lowpass';
  bq.Q.value = q;
  bq.frequency.setValueAtTime(cutFrom, t);
  bq.frequency.exponentialRampToValueAtTime(Math.max(90, cutTo), t + dur);

  // The envelope is deliberately abrupt: a 6581 had no smooth attack and the
  // click on the front of each note is part of the sound.
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  o.connect(bq).connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// A chord, the way the chip did it: the notes of the chord cycled one per
// frame instead of sounded together. 50Hz is the authentic rate.
function sidChord(semis, t, dur, peak, bus, opts = {}) {
  const FRAME = 1 / 50;
  const steps = Math.max(1, Math.floor(dur / FRAME));
  for (let i = 0; i < steps; i++) {
    const semi = semis[i % semis.length];
    pulseVoice(note(semi), t + i * FRAME, FRAME * 1.25, peak, bus, opts);
  }
}

// Bass: a narrow pulse an octave down with a hard filter sweep, which is how
// a SID bass gets its bite without a real resonant ladder.
function bass(f, t, bus, peak, _type) {
  pulseVoice(f, t, 0.16, peak, bus, {
    duty: 0.16, cutFrom: 1500, cutTo: 240, q: 11, attack: 0.001,
  });
  // a sub underneath, triangle, to give it weight on small speakers
  const c = ctx();
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.value = f / 2;
  const g = env(bus, t, 0.003, 0.13, peak * 0.5);
  o.connect(g);
  o.start(t); o.stop(t + 0.2);
}

// Drums, built the way the chip had to: noise and a pitch-swept tone.
function kick(t, bus) {
  const c = ctx();
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.07);
  const g = c.createGain();
  g.gain.setValueAtTime(0.9, t);               // no attack ramp at all
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  o.connect(g).connect(bus);
  o.start(t); o.stop(t + 0.2);
}

function snare(t, bus) {
  const c = ctx();
  const len = Math.floor(c.sampleRate * 0.2);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  // bit-crushed noise: the chip's noise was an LFSR, not white
  let hold = 0;
  for (let i = 0; i < len; i++) {
    if (i % 3 === 0) hold = Math.random() * 2 - 1;
    d[i] = hold * (1 - i / len);
  }
  const n = c.createBufferSource();
  n.buffer = b;
  const bq = c.createBiquadFilter();
  bq.type = 'bandpass'; bq.frequency.value = 1750; bq.Q.value = 1.1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  n.connect(bq).connect(g).connect(bus);
  n.start(t); n.stop(t + 0.2);

  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(400, t);
  o.frequency.exponentialRampToValueAtTime(170, t + 0.06);
  const g2 = env(bus, t, 0.001, 0.07, 0.18);
  o.connect(g2);
  o.start(t); o.stop(t + 0.12);
}

function hat(t, bus, peak) {
  const c = ctx();
  const len = Math.floor(c.sampleRate * 0.05);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  let hold = 0;
  for (let i = 0; i < len; i++) {
    if (i % 2 === 0) hold = Math.random() * 2 - 1;
    d[i] = hold;
  }
  const n = c.createBufferSource();
  n.buffer = b;
  const bq = c.createBiquadFilter();
  bq.type = 'highpass'; bq.frequency.value = 8200;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
  n.connect(bq).connect(g).connect(bus);
  n.start(t); n.stop(t + 0.06);
}

// The lead: a single pulse voice with vibrato and a wide-open filter.
function arpNote(f, t, bus, peak, _type, step = 0) {
  pulseVoice(f, t, 0.1, peak, bus, {
    duty: dutyAt(step), cutFrom: 4200, cutTo: 1600, q: 5, vibrato: 14,
  });
}

// The pad is the one thing a SID could not do, so it stays subtle: a
// detuned pair of narrow pulses, filtered right down.
function pad(f, t, bus, peak, cutoff = 1100) {
  const dur = stepDur() * 16;
  for (const det of [-9, 9]) {
    pulseVoice(f, t, dur, peak * 0.7, bus, {
      duty: 0.5, cutFrom: cutoff, cutTo: cutoff * 0.6, q: 2, attack: 0.25, detune: det,
    });
  }
}
