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

// Arpeggio stingers. The turnaround and the dock are the two moments the run
// has structure, so they get the only melodic sounds outside the music.
function arp(semis, t, peak, type = 'square', step = 0.075) {
  const root = 293.66; // D4
  semis.forEach((s, i) => {
    tone({
      type, f0: root * Math.pow(2, s / 12), t: t + i * step,
      attack: 0.006, decay: 0.22, peak,
    });
  });
}

export function sfxTurnaround() {
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

export function sfxUi() {
  if (!ready()) return;
  tone({ type: 'square', f0: 660, f1: 990, t: now(), attack: 0.003, decay: 0.07, peak: 0.12, sweep: 'lin' });
}
