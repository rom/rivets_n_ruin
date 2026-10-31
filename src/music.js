import { ctx, now, musicBus, env, ready } from './audio.js';

// An adaptive procedural score. Driving, minor-key, built on a 16th grid.
//
// Scheduling uses the standard Web Audio lookahead pattern: a coarse timer
// wakes up every 25ms and schedules every step falling inside the next 120ms
// against ctx.currentTime. Sequencing from requestAnimationFrame instead would
// jitter audibly — rAF is tied to the display, the audio clock is not.

const BPM = 152;
const STEP = 60 / BPM / 4;        // one 16th note
const BARS = 4;
const STEPS = BARS * 16;
const LOOKAHEAD = 0.12;
const TICK = 25;

// D phrygian — the flat second is what makes it sound like a threat.
const ROOT = 73.416;              // D2
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const PROG = [0, 1, 0, -2];       // i - bII - i - bVII, one chord per bar

// Galloping bass, the engine of the whole thing.
const BASS = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0];
const KICK = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];

const M = {
  step: 0,
  nextTime: 0,
  timer: null,
  intensity: 0,     // 0 title · 1 cruise · 2 combat · 3 return run
  target: 0,
  running: false,
};

const note = (semi) => ROOT * Math.pow(2, semi / 12);

export function setIntensity(n) { M.target = n; }

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
    M.nextTime += STEP;
    M.step = (M.step + 1) % STEPS;
    // intensity changes land on a bar line, so layers never pop in mid-phrase
    if (M.step % 16 === 0) M.intensity = M.target;
  }
}

function playStep(s, t) {
  const bus = musicBus();
  const bar = (s / 16) | 0;
  const pos = s % 16;
  const chord = PROG[bar];
  const I = M.intensity;

  // ---- drums
  if (I >= 1) {
    if (KICK[pos]) kick(t, bus);
    if (SNARE[pos]) snare(t, bus);
    const hatEvery = I >= 3 ? 1 : 2;
    if (pos % hatEvery === 0) hat(t, bus, pos % 4 === 0 ? 0.055 : 0.032);
  }

  // ---- bass
  if (I >= 1 && BASS[pos]) {
    // walk up the mode on the last bar for a turnaround figure
    const walk = bar === 3 && pos >= 12 ? PHRYGIAN[(pos - 12) % PHRYGIAN.length] : 0;
    bass(note(chord + walk), t, bus, I >= 2 ? 0.3 : 0.22);
  }

  // ---- pad: the harmonic bed, present from the title screen on
  if (pos === 0) pad(note(chord + 12), t, bus, I === 0 ? 0.1 : 0.062);

  // ---- arpeggio lead
  if (I >= 2 && pos % 2 === 1) {
    const degrees = [0, 3, 7, 10, 7, 3];
    const d = degrees[((s / 2) | 0) % degrees.length];
    arpNote(note(chord + d + 24), t, bus, 0.072);
    if (I >= 3) arpNote(note(chord + d + 36), t, bus, 0.03, 'triangle');
  }

  // ---- title-screen sparkle, in place of drums
  if (I === 0 && pos % 8 === 4) {
    arpNote(note(chord + PHRYGIAN[(bar * 2) % 7] + 24), t, bus, 0.05, 'triangle');
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

function bass(f, t, bus, peak) {
  const c = ctx();
  const o = c.createOscillator();
  o.type = 'sawtooth';
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

function pad(f, t, bus, peak) {
  const c = ctx();
  const dur = STEP * 16;
  const g = c.createGain();
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.35);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  g.connect(bus);

  const bq = c.createBiquadFilter();
  bq.type = 'lowpass';
  bq.frequency.value = 1100;
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
