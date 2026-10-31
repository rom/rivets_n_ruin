// Procedural audio. Everything is synthesised at runtime from oscillators and
// noise — no asset files, nothing to load, nothing to license, and it suits the
// hardware-synth register the reference games were written in.
//
// Browsers refuse to start an AudioContext outside a user gesture, so the
// context is created lazily by unlock(), called from the first keypress.

const S = {
  ctx: null,
  master: null,
  sfxBus: null,
  musicBus: null,
  noise: null,
  voices: 0,
  muted: localStorage.getItem('rnr.muted') === '1',
};

const MAX_VOICES = 24;   // hard cap; explosions during heavy fire must not clip

export function unlock() {
  if (S.ctx) {
    if (S.ctx.state === 'suspended') S.ctx.resume();
    return S.ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;

  const ctx = new AC();

  // master -> compressor -> out. The compressor is what lets a dozen
  // simultaneous explosions stay loud without distorting.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 24;
  comp.ratio.value = 7;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;
  comp.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = S.muted ? 0 : 0.85;
  master.connect(comp);

  const sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.9;
  sfxBus.connect(master);

  const musicBus = ctx.createGain();
  musicBus.gain.value = 0.42;
  musicBus.connect(master);

  // one shared noise buffer, reused by every percussive sound
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  Object.assign(S, { ctx, master, sfxBus, musicBus, noise: buf });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const ctx = () => S.ctx;
export const now = () => (S.ctx ? S.ctx.currentTime : 0);
// The post-mute master tap. Exported for metering — an analyser hung here
// sees exactly what the speakers get, which is also the only correct place
// to assert that mute works.
export const masterOut = () => S.master;
export const sfxBus = () => S.sfxBus;
export const musicBus = () => S.musicBus;
export const ready = () => S.ctx !== null;
export const isMuted = () => S.muted;

// Applies the current settings to the live graph. Called on any change and
// once the context exists, so settings made before audio was unlocked still
// take effect when it is.
export function applySettings(s) {
  if (!S.ctx) return;
  const t = S.ctx.currentTime;
  const vol = (s.volume ?? 85) / 100;
  S.master.gain.cancelScheduledValues(t);
  S.master.gain.setTargetAtTime(S.muted ? 0 : 0.85 * vol, t, 0.02);
  S.musicBus.gain.setTargetAtTime(s.music === false ? 0 : 0.42, t, 0.03);
  S.sfxBus.gain.setTargetAtTime(s.sfx === false ? 0 : 0.9, t, 0.03);
}

export function toggleMute() {
  S.muted = !S.muted;
  localStorage.setItem('rnr.muted', S.muted ? '1' : '0');
  if (S.master) {
    const t = S.ctx.currentTime;
    S.master.gain.cancelScheduledValues(t);
    S.master.gain.setTargetAtTime(S.muted ? 0 : 0.85, t, 0.02);
  }
  return S.muted;
}

// Ducks the music under a big event (death, fanfare) and lets it back in.
export function duckMusic(amount, hold, release) {
  if (!S.ctx) return;
  const t = S.ctx.currentTime;
  const g = S.musicBus.gain;
  g.cancelScheduledValues(t);
  g.setTargetAtTime(0.42 * amount, t, 0.03);
  g.setTargetAtTime(0.42, t + hold, release);
}

// ------------------------------------------------------------------ voices

function takeVoice(node, endTime) {
  if (S.voices >= MAX_VOICES) return false;
  S.voices++;
  node.onended = () => { S.voices--; };
  return true;
}

// An amplitude envelope. exponentialRamp can't reach 0, hence the 1e-4 floor.
export function env(dest, t, attack, decay, peak) {
  const g = S.ctx.createGain();
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 1e-3), t + attack);
  g.gain.exponentialRampToValueAtTime(1e-4, t + attack + decay);
  g.connect(dest);
  return g;
}

// A pitched voice with an optional pitch sweep f0 -> f1.
export function tone(opts) {
  if (!S.ctx) return;
  const {
    type = 'square', f0, f1 = f0, t = now(), attack = 0.004, decay = 0.12,
    peak = 0.25, dest = S.sfxBus, detune = 0, sweep = 'exp',
  } = opts;

  const o = S.ctx.createOscillator();
  o.type = type;
  o.detune.value = detune;
  o.frequency.setValueAtTime(Math.max(f0, 1e-3), t);
  if (f1 !== f0) {
    if (sweep === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1e-3), t + attack + decay);
    else o.frequency.linearRampToValueAtTime(Math.max(f1, 1e-3), t + attack + decay);
  }

  const g = env(dest, t, attack, decay, peak);
  o.connect(g);
  if (!takeVoice(o, t + attack + decay)) { o.disconnect(); g.disconnect(); return; }
  o.start(t);
  o.stop(t + attack + decay + 0.02);
  return o;
}

// A filtered noise burst — the basis of every impact, explosion and drum hit.
export function noiseHit(opts) {
  if (!S.ctx) return;
  const {
    t = now(), attack = 0.002, decay = 0.2, peak = 0.3,
    filter = 'lowpass', f0 = 2000, f1 = f0, q = 1, dest = S.sfxBus, rate = 1,
  } = opts;

  const src = S.ctx.createBufferSource();
  src.buffer = S.noise;
  src.playbackRate.value = rate;
  // start at a random offset so repeated hits don't sound identical
  const off = Math.random() * 1.5;

  const bq = S.ctx.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(Math.max(f0, 20), t);
  if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + attack + decay);

  const g = env(dest, t, attack, decay, peak);
  src.connect(bq).connect(g);
  if (!takeVoice(src, t + attack + decay)) { src.disconnect(); bq.disconnect(); g.disconnect(); return; }
  src.start(t, off, attack + decay + 0.05);
  src.stop(t + attack + decay + 0.02);
  return src;
}
