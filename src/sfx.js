import { tone, noiseHit, now, ready, sfxBus, ctx, duckMusic } from './audio.js';

// Rate limiting: the cannon fires ~9 times a second, so its sound has to be
// short, quiet and slightly varied or it turns into a drill.
const lastAt = {};
function throttle(key, minGap) {
  const t = now();
  if (lastAt[key] !== undefined && t - lastAt[key] < minGap) return false;
  lastAt[key] = t;
  return true;
}

const rnd = (a, b) => a + Math.random() * (b - a);

export function sfxShoot() {
  if (!ready() || !throttle('shoot', 0.05)) return;
  const t = now();
  tone({ type: 'square', f0: rnd(900, 1020), f1: 220, t, attack: 0.002, decay: 0.07, peak: 0.1 });
  noiseHit({ t, attack: 0.001, decay: 0.04, peak: 0.055, filter: 'highpass', f0: 1800, q: 0.8 });
}

export function sfxTurretShot() {
  if (!ready() || !throttle('turret', 0.04)) return;
  const t = now();
  tone({ type: 'sawtooth', f0: rnd(300, 360), f1: 110, t, attack: 0.003, decay: 0.1, peak: 0.075 });
  noiseHit({ t, attack: 0.001, decay: 0.06, peak: 0.05, filter: 'bandpass', f0: 900, q: 2 });
}

// Enemy soaking a hit without dying — metallic, pitched up, clearly not a kill.
export function sfxEnemyHit() {
  if (!ready() || !throttle('ehit', 0.03)) return;
  const t = now();
  noiseHit({ t, attack: 0.001, decay: 0.07, peak: 0.12, filter: 'bandpass', f0: rnd(2400, 3200), q: 6 });
  tone({ type: 'square', f0: rnd(1500, 1900), f1: 900, t, attack: 0.001, decay: 0.05, peak: 0.06 });
}

// Player shots absorbed by the hull — dull, so it reads as "wasted".
export function sfxHullAbsorb() {
  if (!ready() || !throttle('absorb', 0.06)) return;
  const t = now();
  noiseHit({ t, attack: 0.001, decay: 0.07, peak: 0.16, filter: 'bandpass', f0: rnd(620, 900), q: 1.8 });
  tone({ type: 'triangle', f0: rnd(200, 260), f1: 90, t, attack: 0.002, decay: 0.06, peak: 0.08 });
}

export function sfxExplode(scale = 1) {
  if (!ready()) return;
  const t = now();
  noiseHit({
    t, attack: 0.003, decay: 0.34 * scale, peak: 0.42,
    filter: 'lowpass', f0: 2600, f1: 160, q: 1.4, rate: 1 / Math.max(0.6, scale),
  });
  tone({ type: 'triangle', f0: 180 * scale, f1: 34, t, attack: 0.004, decay: 0.3 * scale, peak: 0.3 });
  // crackle tail
  noiseHit({ t: t + 0.04, attack: 0.002, decay: 0.26 * scale, peak: 0.14, filter: 'highpass', f0: 1400, q: 0.7 });
}

// Hull contact. Pitch and brightness track impact speed, so a graze and a
// full-tilt slam are audibly different — the player learns the damage model
// through their ears before they read the shield bar.
export function sfxScrape(speed) {
  if (!ready() || !throttle('scrape', 0.07)) return;
  const t = now();
  const hard = Math.min(1, speed / 310);
  noiseHit({
    t, attack: 0.002, decay: 0.1 + hard * 0.16, peak: 0.12 + hard * 0.26,
    filter: 'bandpass', f0: 1100 + hard * 2200, f1: 400, q: 1.6,
  });
  tone({ type: 'sawtooth', f0: 120 + hard * 90, f1: 46, t, attack: 0.003, decay: 0.12 + hard * 0.12, peak: 0.1 + hard * 0.2 });
}

export function sfxPlayerHit() {
  if (!ready() || !throttle('phit', 0.06)) return;
  const t = now();
  tone({ type: 'sawtooth', f0: 420, f1: 90, t, attack: 0.002, decay: 0.22, peak: 0.26 });
  noiseHit({ t, attack: 0.001, decay: 0.16, peak: 0.2, filter: 'bandpass', f0: 1600, f1: 300, q: 2.5 });
}

// The flip: a filtered noise sweep, the sound of the ship slewing through zero.
export function sfxFlip() {
  if (!ready() || !throttle('flip', 0.12)) return;
  const t = now();
  noiseHit({ t, attack: 0.03, decay: 0.16, peak: 0.13, filter: 'bandpass', f0: 500, f1: 3000, q: 3 });
  tone({ type: 'triangle', f0: 200, f1: 620, t, attack: 0.04, decay: 0.12, peak: 0.07, sweep: 'lin' });
}

// The jump: a short charge that climbs and vanishes, then the hull
// arriving somewhere else. Two halves so the ear hears a departure and a
// landing rather than one noise, which is what tells you it worked.
export function sfxJump() {
  if (!ready()) return;
  const t = now();
  tone({ type: 'sawtooth', f0: 210, f1: 1900, t, attack: 0.012, decay: 0.1, peak: 0.16 });
  tone({ type: 'square', f0: 420, f1: 2600, t: t + 0.01, attack: 0.008, decay: 0.08, peak: 0.1 });
  noiseHit({ t, attack: 0.004, decay: 0.12, peak: 0.16, filter: 'highpass', f0: 1800, f1: 5200 });
  // arrival
  noiseHit({ t: t + 0.11, attack: 0.002, decay: 0.16, peak: 0.26,
    filter: 'lowpass', f0: 2600, f1: 160, q: 1.4, rate: 0.8 });
  tone({ type: 'triangle', f0: 760, f1: 180, t: t + 0.11, attack: 0.004, decay: 0.16, peak: 0.14 });
}

export function sfxDeath() {
  if (!ready()) return;
  const t = now();
  duckMusic(0.25, 1.1, 0.5);
  noiseHit({ t, attack: 0.005, decay: 0.9, peak: 0.5, filter: 'lowpass', f0: 3200, f1: 90, q: 1.2, rate: 0.6 });
  tone({ type: 'sawtooth', f0: 320, f1: 26, t, attack: 0.006, decay: 0.85, peak: 0.34 });
  tone({ type: 'square', f0: 150, f1: 20, t: t + 0.05, attack: 0.004, decay: 0.7, peak: 0.2 });
  for (let i = 0; i < 4; i++) {
    noiseHit({ t: t + 0.1 + i * 0.12, attack: 0.003, decay: 0.3, peak: 0.18, filter: 'lowpass', f0: 1800, f1: 120 });
  }
}

export function sfxRespawn() {
  if (!ready()) return;
  const t = now();
  tone({ type: 'square', f0: 220, f1: 880, t, attack: 0.02, decay: 0.2, peak: 0.12, sweep: 'lin' });
}

// Arpeggio stingers. Something arriving and reaching the dock are the two
// moments the run has structure, so they get the only melodic sounds
// outside the music. (The first was called sfxTurnaround until well after
// the turnaround itself was removed; it now plays when a boss or a
// miniboss shows up.)
function arp(semis, t, peak, type = 'square', step = 0.075, root = 293.66) {
  semis.forEach((s, i) => {
    tone({
      type, f0: root * Math.pow(2, s / 12), t: t + i * step,
      attack: 0.006, decay: 0.22, peak,
    });
  });
}

export function sfxArrival() {
  if (!ready()) return;
  const t = now();
  duckMusic(0.45, 0.8, 0.4);
  arp([0, 3, 7, 12], t, 0.17);
  noiseHit({ t, attack: 0.01, decay: 0.5, peak: 0.16, filter: 'highpass', f0: 2000 });
}

export function sfxComplete() {
  if (!ready()) return;
  const t = now();
  duckMusic(0.3, 2.2, 0.8);
  arp([0, 3, 7, 12, 15, 19], t, 0.2);
  arp([12, 15, 19, 24, 27, 31], t + 0.02, 0.1, 'triangle');
  tone({ type: 'sawtooth', f0: 73.4, f1: 73.4, t, attack: 0.05, decay: 1.6, peak: 0.16 });
}

export function sfxGameOver() {
  if (!ready()) return;
  const t = now();
  arp([12, 8, 5, 0], t, 0.18, 'sawtooth', 0.17);
  tone({ type: 'sawtooth', f0: 110, f1: 55, t: t + 0.5, attack: 0.08, decay: 1.4, peak: 0.2 });
}

// Each pickup gets its own shape so you know what you grabbed without
// looking: a rising major third for good news, a wider leap for a new life.
const PICKUP_ARP = {
  shield:    [0, 7, 12],
  life:      [0, 4, 7, 12, 19],
  healthbar: [0, 5, 12],
  gunspeed:  [0, 2, 7],
  gunblaze:  [0, 3, 10],
};

export function sfxPickup(kind) {
  if (!ready()) return;
  const t = now();
  const semis = PICKUP_ARP[kind] || [0, 7];
  const type = kind === 'gunblaze' ? 'sawtooth' : 'square';
  arp(semis, t, kind === 'life' ? 0.2 : 0.14, type, 0.055);
  noiseHit({ t, attack: 0.002, decay: 0.12, peak: 0.07, filter: 'highpass', f0: 3000 });
}

// Loot has its own escalating family: a coin is a short bright blip that
// climbs as you chain them, a bar is three rising notes, a coffin is a
// fanfare. You can hear what you picked up without looking at it.
let coinChain = 0;
let coinChainAt = 0;

export function sfxCoin() {
  if (!ready()) return;
  const t = now();
  if (t - coinChainAt > 0.55) coinChain = 0;   // a pause resets the run
  coinChainAt = t;
  const step = Math.min(coinChain, 11);
  coinChain++;
  if (!throttle('coin', 0.035)) return;
  const f = 880 * Math.pow(2, step / 12);
  tone({ type: 'square', f0: f, f1: f * 1.5, t, attack: 0.002, decay: 0.07, peak: 0.075, sweep: 'lin' });
  tone({ type: 'triangle', f0: f * 2, f1: f * 3, t: t + 0.015, attack: 0.002, decay: 0.05, peak: 0.04, sweep: 'lin' });
}

export function sfxGoldBar() {
  if (!ready()) return;
  const t = now();
  arp([0, 7, 12], t, 0.17, 'square', 0.045);
  noiseHit({ t, attack: 0.002, decay: 0.16, peak: 0.07, filter: 'highpass', f0: 4200 });
}

export function sfxCoffin() {
  if (!ready()) return;
  const t = now();
  duckMusic(0.55, 0.7, 0.35);
  arp([0, 4, 7, 12, 16, 19], t, 0.2, 'square', 0.06);
  arp([12, 16, 19, 24], t + 0.03, 0.1, 'triangle', 0.06);
  tone({ type: 'sawtooth', f0: 110, f1: 110, t, attack: 0.03, decay: 0.8, peak: 0.1 });
}

// Treasure. Four tiers, each a longer and higher flourish than the last, so
// what you picked up is audible before the toast is read. Tier 0 is a quick
// chime; tier 3 ducks the music and takes its time.
export function sfxTreasure(tier = 0) {
  if (!ready()) return;
  const t = now();
  const k = Math.max(0, Math.min(3, tier));
  if (k >= 2) duckMusic(0.5, 0.55 + k * 0.15, 0.3);

  const figures = [
    [0, 7, 12],
    [0, 5, 9, 14],
    [0, 4, 7, 12, 16],
    [0, 3, 7, 10, 14, 19, 24],
  ];
  const base = [660, 700, 740, 784][k];
  const gap = [0.055, 0.06, 0.055, 0.05][k];
  arp(figures[k], t, 0.05 + k * 0.012, 'square', gap, base);
  arp(figures[k].map((n) => n + 12), t + 0.025, 0.03 + k * 0.01, 'triangle', gap, base);
  noiseHit({ t, attack: 0.002, decay: 0.1 + k * 0.08, peak: 0.05, filter: 'highpass', f0: 5200 });
  if (k >= 2) {
    tone({ type: 'sawtooth', f0: 98, f1: 196, t, attack: 0.02, decay: 0.5 + k * 0.2, peak: 0.08, sweep: 'lin' });
  }
}

export function sfxUi() {
  if (!ready()) return;
  tone({ type: 'square', f0: 660, f1: 990, t: now(), attack: 0.003, decay: 0.07, peak: 0.12, sweep: 'lin' });
}

// ----------------------------------------------- the attackers that hold you
//
// A netter, a grapnel and a scorcher all played sfxTurretShot, which is
// the ordinary gun — so the one cue that could tell you a net was on its
// way sounded exactly like the thing you had been dodging all game. Each
// now throws something that sounds like what it is, and the moment it
// lands on you is a second, different sound: the launch is information
// about the room, the catch is information about your ship.

// A net is cloth and air, so there is no crack in it: a breathy sweep
// that falls, and a low flutter under it.
export function sfxNetShot() {
  if (!ready() || !throttle('net', 0.08)) return;
  const t = now();
  noiseHit({ t, attack: 0.014, decay: 0.18, peak: 0.1, filter: 'bandpass', f0: rnd(2300, 2900), f1: 640, q: 1.1 });
  tone({ type: 'triangle', f0: rnd(280, 330), f1: 150, t, attack: 0.012, decay: 0.15, peak: 0.05 });
}

// Caught: a soft thud, and the drive bogging down a long way. The pitch
// fall is doing the work — it is the same information the speed bar
// shows, arriving sooner.
export function sfxSnared() {
  if (!ready() || !throttle('snared', 0.2)) return;
  const t = now();
  noiseHit({ t, attack: 0.004, decay: 0.22, peak: 0.2, filter: 'lowpass', f0: 1300, f1: 240, q: 1 });
  tone({ type: 'sawtooth', f0: 540, f1: 120, t, attack: 0.006, decay: 0.42, peak: 0.16 });
  tone({ type: 'square', f0: 270, f1: 70, t: t + 0.03, attack: 0.006, decay: 0.38, peak: 0.08 });
}

// A hook is a machine: a launcher clank, then the line paying out, which
// is the rising hiss.
export function sfxHookShot() {
  if (!ready() || !throttle('hook', 0.08)) return;
  const t = now();
  tone({ type: 'square', f0: rnd(820, 960), f1: 400, t, attack: 0.001, decay: 0.055, peak: 0.12 });
  noiseHit({ t: t + 0.02, attack: 0.012, decay: 0.24, peak: 0.1, filter: 'highpass', f0: 900, f1: 3400 });
}

// The bite, and the line coming up taut behind it. Rising, where the net
// falls: one slows you where you are, the other is about to move you.
export function sfxHooked() {
  if (!ready() || !throttle('hooked', 0.2)) return;
  const t = now();
  noiseHit({ t, attack: 0.001, decay: 0.09, peak: 0.26, filter: 'bandpass', f0: 1900, q: 7 });
  tone({ type: 'square', f0: 1200, f1: 300, t, attack: 0.001, decay: 0.1, peak: 0.13 });
  tone({ type: 'sawtooth', f0: 90, f1: 230, t: t + 0.05, attack: 0.04, decay: 0.3, peak: 0.1, sweep: 'lin' });
}

// Held on the line. Quiet and slow on purpose: it has to sit under
// everything else for as long as the tow lasts without becoming the
// thing you hear, so it is a creak every third of a second, not a tone.
export function sfxTowStrain() {
  if (!ready() || !throttle('tow', 0.3)) return;
  const t = now();
  tone({ type: 'sawtooth', f0: rnd(145, 195), f1: rnd(215, 265), t, attack: 0.09, decay: 0.22, peak: 0.05, sweep: 'lin' });
  noiseHit({ t, attack: 0.06, decay: 0.2, peak: 0.035, filter: 'bandpass', f0: rnd(380, 470), q: 5 });
}

// A gout of flame: all breath, no pitch, and dark. Anything tonal here
// reads as a gun again.
export function sfxFlame() {
  if (!ready() || !throttle('flame', 0.11)) return;
  const t = now();
  noiseHit({ t, attack: 0.022, decay: 0.3, peak: 0.15, filter: 'lowpass', f0: 950, f1: 290, q: 0.7, rate: 0.7 });
  noiseHit({ t, attack: 0.012, decay: 0.2, peak: 0.065, filter: 'bandpass', f0: rnd(1700, 2600), q: 0.9 });
}

// Alight. Burning outlasts the thing that lit you, so this has to keep
// saying so without wearing out — crackle, irregular, and short.
export function sfxBurning() {
  if (!ready() || !throttle('burn', 0.15)) return;
  const t = now();
  noiseHit({ t, attack: 0.004, decay: 0.14, peak: 0.075, filter: 'bandpass', f0: rnd(1300, 2900), q: 3 });
  noiseHit({ t: t + 0.05, attack: 0.002, decay: 0.1, peak: 0.045, filter: 'highpass', f0: 3000 });
}

// ------------------------------------------------------------ hazard fields
//
// Four of them, and the whole decision a field offers is whether to go
// round. That decision is worth nothing if you cannot tell from the
// cockpit which one you have flown into, so the four do not share a
// voice: fire roars, a storm buffets, ice rings, sparks snap.
export const FIELD_VOICE = {
  fire: { filter: 'lowpass', f0: 860, f1: 250, q: 0.8, rate: 0.72, type: 'sawtooth', tf0: 115, tf1: 72 },
  storm: { filter: 'bandpass', f0: 380, f1: 1500, q: 0.6, rate: 0.55, type: 'triangle', tf0: 68, tf1: 128 },
  ice: { filter: 'highpass', f0: 3100, f1: 5200, q: 2.4, rate: 1.35, type: 'sine', tf0: 1500, tf1: 2400 },
  spark: { filter: 'bandpass', f0: 2700, f1: 1150, q: 9, rate: 1.1, type: 'square', tf0: 940, tf1: 300 },
};

function fieldVoice(kind, t, peak, decay) {
  const v = FIELD_VOICE[kind] || FIELD_VOICE.fire;
  noiseHit({
    t, attack: 0.012, decay, peak,
    filter: v.filter, f0: v.f0 * rnd(0.88, 1.14), f1: v.f1, q: v.q, rate: v.rate,
  });
  tone({
    type: v.type, f0: v.tf0 * rnd(0.92, 1.1), f1: v.tf1, t,
    attack: 0.014, decay: decay * 0.9, peak: peak * 0.5,
  });
}

// Crossing the edge. Louder than the hold, because the edge is the
// moment you can still do something about it.
export function sfxFieldEnter(kind) {
  if (!ready() || !throttle('fieldin', 0.22)) return;
  fieldVoice(kind, now(), 0.17, 0.3);
}

// Still in it. Quiet, and often enough to nag.
export function sfxFieldHold(kind) {
  if (!ready() || !throttle('fieldhold', 0.21)) return;
  fieldVoice(kind, now(), 0.07, 0.24);
}

// ------------------------------------------------------------ installations

// Bulk storage. The ordinary blast with a sub under it and a long roll
// after, because a cistern's reach is four times a fuel tank's and the
// sound is the only warning anyone standing next to one gets.
export function sfxCistern() {
  if (!ready() || !throttle('cistern', 0.07)) return;
  const t = now();
  duckMusic(0.55, 0.35, 0.3);
  sfxExplode(1.6);
  tone({ type: 'sine', f0: 92, f1: 22, t, attack: 0.01, decay: 0.7, peak: 0.3 });
  noiseHit({ t: t + 0.09, attack: 0.012, decay: 0.5, peak: 0.18, filter: 'lowpass', f0: 1200, f1: 90, rate: 0.55 });
}

// A plant going down: a long spin-down, and the floor falling out from
// under every gun it was quickening.
export function sfxReactor() {
  if (!ready() || !throttle('reactor', 0.4)) return;
  const t = now();
  duckMusic(0.5, 0.5, 0.4);
  tone({ type: 'sawtooth', f0: 1380, f1: 58, t, attack: 0.02, decay: 1.1, peak: 0.19 });
  tone({ type: 'square', f0: 690, f1: 40, t: t + 0.08, attack: 0.02, decay: 0.9, peak: 0.11 });
  noiseHit({ t: t + 0.5, attack: 0.006, decay: 0.5, peak: 0.28, filter: 'lowpass', f0: 2200, f1: 100, rate: 0.7 });
}

// A line coming down: the twang first, the arc after.
export function sfxPylon() {
  if (!ready() || !throttle('pylon', 0.05)) return;
  const t = now();
  tone({ type: 'triangle', f0: rnd(620, 790), f1: 175, t, attack: 0.002, decay: 0.26, peak: 0.13 });
  noiseHit({ t, attack: 0.001, decay: 0.09, peak: 0.15, filter: 'bandpass', f0: 3400, q: 8 });
  noiseHit({ t: t + 0.06, attack: 0.001, decay: 0.14, peak: 0.09, filter: 'highpass', f0: 2600 });
}

// Caught in a searchlight. Two notes, rising, and nothing else: it is
// not damage, it is the guns around you getting better, and it has to be
// legible over whatever is already happening.
export function sfxLit() {
  if (!ready() || !throttle('lit', 0.6)) return;
  const t = now();
  tone({ type: 'square', f0: 1480, t, attack: 0.004, decay: 0.08, peak: 0.07 });
  tone({ type: 'square', f0: 1980, t: t + 0.09, attack: 0.004, decay: 0.1, peak: 0.07 });
}
