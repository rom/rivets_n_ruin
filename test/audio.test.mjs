import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { unlock, ctx, voiceCount, voiceCap, tone, noiseHit } from '../src/audio.js';
import {
  startMusic, stopMusic, pauseMusic, resumeMusic,
  musicRunning, musicPaused, musicStep, musicWindow, musicSkipped,
} from '../src/music.js';

// --------------------------------------------------- the music scheduler
//
// Reported from play: "the sound drops out from time to time."
//
// The sequencer fills a window of the audio timeline ahead of the clock,
// woken by a setInterval. setInterval only promises "no sooner than": a
// main thread blocked for longer than the window leaves a hole exactly as
// long as the block, and a tab the browser has backgrounded is throttled
// to roughly one tick a second whatever the interval asks for. Measured in
// a browser against the master tap, with the thread blocked for 850ms of
// every 1000ms: 91.8% of the output was silence. With the window tracking
// the ticks that actually arrive, 5.2%.
//
// These drive the scheduler directly instead: setInterval is captured, so
// the ticks and the audio clock are both under the test's control and the
// result does not depend on how busy the machine running it is.

function captureScheduler() {
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  let tick = null;
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  globalThis.clearInterval = () => { tick = null; };
  const restore = () => {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  };
  return { fire: () => tick && tick(), live: () => tick !== null, restore };
}

// Runs the scheduler for `ticks` wakeups `gap` seconds apart, advancing the
// audio clock with them, and reports the steps that went unheard.
function run({ gap, ticks }) {
  unlock();
  const c = ctx();
  c.currentTime = 0;
  const cap = captureScheduler();
  try {
    stopMusic();
    startMusic();
    assert.ok(cap.live(), 'startMusic installed no timer');
    for (let i = 0; i < ticks; i++) {
      c.currentTime = +(c.currentTime + gap).toFixed(6);
      cap.fire();
    }
    return { skipped: musicSkipped(), window: musicWindow(), step: musicStep() };
  } finally {
    stopMusic();
    cap.restore();
  }
}

test('a healthy tick rate leaves nothing unheard', () => {
  const r = run({ gap: 0.025, ticks: 400 });     // ten seconds at 25ms
  assert.equal(r.skipped, 0, `${r.skipped} steps went unheard on a healthy clock`);
  assert.equal(r.window, 0.12,
    `the window widened to ${r.window} with nothing wrong — changes would land late`);
  assert.ok(r.step > 0, 'the sequence never advanced');
});

test('a tab throttled to one tick a second keeps playing', () => {
  // The reported fault. One tick a second against a fixed 120ms window
  // means 120ms of music per second and 880ms of nothing; the window has
  // to widen past the gap for the tune to survive.
  // Ten steps go unheard, all of them in the one tick where the slowdown
  // begins: the scheduler cannot know the machine is slow until it has
  // been slow once. After that the window is wider than the gap and
  // nothing else is lost. A regression towards the fixed window loses
  // most of a step every tick instead, which is about 250 of them here.
  const r = run({ gap: 1.0, ticks: 30 });
  assert.ok(r.skipped <= 14,
    `${r.skipped} steps went unheard across 30 throttled ticks`);
  assert.ok(r.window > 1.0,
    `the window stayed at ${r.window}s against a 1s gap, so it is still`
    + ' scheduling less than one tick of music per tick');
});

test('the window narrows again once the ticks come back', () => {
  unlock();
  const c = ctx();
  c.currentTime = 0;
  const cap = captureScheduler();
  try {
    stopMusic();
    startMusic();
    for (let i = 0; i < 10; i++) { c.currentTime += 1.0; cap.fire(); }
    const wide = musicWindow();
    assert.ok(wide > 1.0, `the window did not widen under load (${wide})`);
    for (let i = 0; i < 400; i++) { c.currentTime += 0.025; cap.fire(); }
    const narrow = musicWindow();
    assert.ok(narrow < 0.2,
      `the window stayed at ${narrow}s after recovery; an intensity change`
      + ' would land that late for the rest of the run');
  } finally { stopMusic(); cap.restore(); }
});

test('the first gap is measured, not thrown away', () => {
  // currentTime is legitimately 0 when a context has just started, so a
  // falsy test for "no previous tick" discards the first measurement and
  // the window takes an extra tick to learn the rate — a second hole, and
  // twice the steps lost.
  const r = run({ gap: 1.0, ticks: 4 });
  assert.ok(r.window > 1.0,
    `after four one-second ticks the window is ${r.window}s`);
  assert.ok(r.skipped <= 14,
    `${r.skipped} steps lost in four ticks: the first gap went unmeasured`);
});

test('the window never runs away', () => {
  const r = run({ gap: 30, ticks: 6 });          // a clock that jumped
  assert.ok(r.window <= 2.5, `the window reached ${r.window}s`);
  assert.ok(Number.isFinite(r.step) && r.step >= 0, 'the sequence left the rails');
});

test('a long stall does not fire the backlog all at once', () => {
  // The old scheduler jumped nextTime to the present, throwing the stalled
  // stretch away and losing the musical position with it. Stepping over it
  // keeps the form — which bar, which section — where the clock says.
  unlock();
  const c = ctx();
  c.currentTime = 0;
  const cap = captureScheduler();
  try {
    stopMusic();
    startMusic();
    c.currentTime = 0.1; cap.fire();
    const before = musicStep();
    c.currentTime = 8.1;                          // eight seconds gone
    cap.fire();
    const after = musicStep();
    let moved = after - before;
    if (moved < 0) moved += 256;
    // At 8 seconds and roughly ten steps a second, the sequence should be
    // most of a hundred steps further on, not sitting where it was.
    assert.ok(moved > 50,
      `the sequence moved ${moved} steps across an eight-second stall;`
      + ' it should be where the clock says, not where it stopped');
  } finally { stopMusic(); cap.restore(); }
});

// ------------------------------------------------------- hidden tab
//
// requestAnimationFrame stops when a tab is hidden, so the game is frozen,
// but setInterval keeps going throttled. Leaving the sequencer running
// means synthesising for an empty room over a frozen game.

test('hiding the tab stops the clock without losing the place', () => {
  unlock();
  const c = ctx();
  c.currentTime = 0;
  const cap = captureScheduler();
  try {
    stopMusic();
    startMusic();
    for (let i = 0; i < 40; i++) { c.currentTime += 0.025; cap.fire(); }
    const at = musicStep();
    assert.ok(at > 0, 'the sequence never started');

    pauseMusic();
    assert.ok(musicPaused(), 'pauseMusic did not take');
    assert.ok(musicRunning(), 'pausing for a hidden tab must not end the run');
    assert.ok(!cap.live(), 'the timer is still installed while hidden');

    c.currentTime += 60;                     // a minute away
    assert.equal(musicStep(), at, 'the sequence advanced while nobody was listening');

    resumeMusic();
    assert.ok(!musicPaused(), 'resumeMusic did not take');
    assert.ok(cap.live(), 'no timer after coming back');
    assert.equal(musicStep(), at, 'coming back lost the place in the tune');
  } finally { stopMusic(); cap.restore(); }
});

test('resuming twice does not leave two clocks running', () => {
  // Two intervals play the tune at double speed, and the second is never
  // cleared because only one handle is kept.
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  let installs = 0;
  let clears = 0;
  globalThis.setInterval = () => { installs++; return 100 + installs; };
  globalThis.clearInterval = () => { clears++; };
  try {
    stopMusic();
    installs = 0; clears = 0;
    startMusic();
    pauseMusic();
    resumeMusic();
    resumeMusic();
    resumeMusic();
    assert.equal(installs, 2,
      `${installs} clocks installed for one start and one resume`);
    assert.equal(installs - clears, 1, `${installs - clears} clocks left running`);
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
    stopMusic();
  }
});

test('resume does nothing when the music was stopped outright', () => {
  const cap = captureScheduler();
  try {
    stopMusic();
    resumeMusic();
    assert.ok(!cap.live(), 'resume started music that was deliberately off');
    assert.ok(!musicRunning(), 'resume restarted a stopped sequencer');
  } finally { cap.restore(); }
});

// ------------------------------------------------------------- voices
//
// The sfx pool is capped so a dozen explosions cannot clip. What the cap
// must not do is take a voice and never give it back: the count only ever
// falls in an onended handler, and nothing else releases one.

test('voices are returned when a sound finishes', () => {
  unlock();
  const before = voiceCount();
  const nodes = [];
  for (let i = 0; i < 8; i++) {
    const n = tone({ f0: 440, t: 0, decay: 0.05 });
    if (n) nodes.push(n);
  }
  assert.equal(voiceCount(), before + nodes.length, 'taking a voice did not count');
  for (const n of nodes) n.onended();
  assert.equal(voiceCount(), before, 'a finished sound did not give its voice back');
});

test('the cap holds, and releases', () => {
  unlock();
  const cap = voiceCap();
  const nodes = [];
  for (let i = 0; i < cap + 10; i++) {
    const n = i % 2 ? tone({ f0: 300, t: 0 }) : noiseHit({ t: 0 });
    if (n) nodes.push(n);
  }
  assert.equal(voiceCount(), cap, `the cap let ${voiceCount()} voices through`);
  assert.equal(nodes.length, cap, 'sounds past the cap should not have been made');
  for (const n of nodes) n.onended();
  assert.equal(voiceCount(), 0, 'the pool did not drain');
});

// ------------------------------------------------------- the sound effects
//
// What this can and cannot tell you: not whether a sound is any good,
// which needs ears, but what it is made of and when it happens. That is
// enough for the two faults worth catching here.
//
// The first is silence — a mechanic with no cue at all. The second is
// the one that was actually there: a netter, a grapnel and a scorcher
// all called sfxTurretShot, so the three attackers that take something
// other than shield were audibly identical to the ordinary gun you have
// been dodging since hull one. Everything downstream of that is correct
// and the game still does not tell you what hit you.

import * as sfx from '../src/sfx.js';
import { FIELD_VOICE } from '../src/sfx.js';

// What a sound is made of: each oscillator and noise source, with the
// filter in front of it. Enough to tell two sounds apart, loose enough
// to survive the jitter every one of them puts on its frequencies.
function capture(fn) {
  unlock();
  const c = ctx();
  c.made.length = 0;
  fn();
  const made = c.made.slice();
  // Hand every voice back, or the cap fills and later calls in this
  // file silently make nothing. Nothing in the stub ever ends on its own.
  for (const n of made) if (n.onended) n.onended();
  const parts = [];
  for (let i = 0; i < made.length; i++) {
    const n = made[i];
    if (n.kind === 'osc') { parts.push({ kind: 'osc', type: n.type, hz: n.frequency.first() }); continue; }
    if (n.kind !== 'noise') continue;
    // noiseHit builds the source first and the filter in front of it
    // second, so the filter that shapes this noise is the next one
    // made, not the last one.
    const f = made.slice(i + 1).find((m) => m.kind === 'filter');
    parts.push({ kind: 'noise', type: f ? f.type : '?', hz: f ? f.frequency.first() : 0 });
  }
  return parts;
}

// What a cue sounds like on average.
//
// Every one of these jitters its frequencies on purpose, and some of
// them jitter hard: a crackle picks anywhere from 1300 to 2900Hz,
// because fire that picks the same frequency every time sounds like a
// machine. So a single take is not the sound, it is one draw from it,
// and comparing single takes would call a cue different from itself.
// Averaging a handful of takes gives something stable to compare while
// leaving the jitter alone.
function profile(fire, takes = 9) {
  let acc = null;
  for (let i = 0; i < takes; i++) {
    const parts = atFreshClock(() => capture(fire));
    if (!acc) { acc = parts.map((p) => ({ ...p })); continue; }
    assert.equal(parts.length, acc.length, 'a cue changed shape between takes');
    parts.forEach((p, k) => {
      assert.equal(p.kind + p.type, acc[k].kind + acc[k].type,
        'a cue changed its wave or filter type between takes');
      acc[k].hz += p.hz;
    });
  }
  for (const p of acc) p.hz /= takes;
  return acc;
}

// Are these two the same sound? Same shape, same wave and filter types,
// and every average frequency within a major third.
function sameSound(a, b) {
  if (a.length !== b.length || !a.length) return false;
  return a.every((pa, i) => {
    const pb = b[i];
    return pa.kind === pb.kind && pa.type === pb.type
      && Math.max(pa.hz, pb.hz) / Math.max(1, Math.min(pa.hz, pb.hz)) < 1.26;
  });
}

const describe = (parts) => parts.map((p) => `${p.kind}:${p.type}:${Math.round(p.hz)}`).join(' ');

// Every sound the new mechanics make, by the name of the thing that
// makes it. Grouped because the assertions below are all about the set.
const CUES = {
  'net thrown': () => sfx.sfxNetShot(),
  'net lands': () => sfx.sfxSnared(),
  'hook thrown': () => sfx.sfxHookShot(),
  'hook bites': () => sfx.sfxHooked(),
  'towed': () => sfx.sfxTowStrain(),
  'flame thrown': () => sfx.sfxFlame(),
  'alight': () => sfx.sfxBurning(),
  'into fire': () => sfx.sfxFieldEnter('fire'),
  'into storm': () => sfx.sfxFieldEnter('storm'),
  'into ice': () => sfx.sfxFieldEnter('ice'),
  'into sparks': () => sfx.sfxFieldEnter('spark'),
  'cistern': () => sfx.sfxCistern(),
  'reactor': () => sfx.sfxReactor(),
  'pylon': () => sfx.sfxPylon(),
  'caught in a beam': () => sfx.sfxLit(),
  'hyperspace jump': () => sfx.sfxJump(),
  // The two that were already there, in the set on purpose: the fault
  // was new cues that sounded exactly like the ordinary gun, so the
  // ordinary gun has to be something they can collide with.
  'a turret firing': () => sfx.sfxTurretShot(),
  'your own cannon': () => sfx.sfxShoot(),
};

// Throttles are keyed per sound and measured against the audio clock, so
// a test that fires every cue back to back at t=0 would hear the first
// of each and nothing else. Moving the clock on between them is what a
// second of play does anyway.
function atFreshClock(fn) {
  const c = ctx();
  c.currentTime += 5;
  return fn();
}

test('every new mechanic makes a sound', () => {
  for (const [what, fire] of Object.entries(CUES)) {
    const parts = atFreshClock(() => capture(fire));
    assert.ok(parts.length > 0, `"${what}" makes no sound at all`);
  }
});

test('a sound is recognisably itself twice running', () => {
  // The control for the test below. Every cue jitters its frequencies,
  // so if sameSound were too strict nothing would ever match and "no
  // two are alike" would pass without testing anything. Each cue has to
  // match itself across repeats before a mismatch between two of them
  // means anything.
  for (const [what, fire] of Object.entries(CUES)) {
    const a = profile(fire);
    for (let i = 0; i < 4; i++) {
      const b = profile(fire);
      assert.ok(sameSound(a, b),
        `"${what}" does not match itself: ${describe(a)} vs ${describe(b)}`);
    }
  }
});

test('no two of them make the same sound', () => {
  // The bug this is here for: a netter, a grapnel and a scorcher all
  // called sfxTurretShot.
  const names = Object.keys(CUES);
  const takes = names.map((n) => profile(CUES[n]));
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      assert.ok(!sameSound(takes[i], takes[j]),
        `"${names[i]}" and "${names[j]}" are the same sound (${describe(takes[i])}), `
        + 'so neither tells you which one happened');
    }
  }
});

test('the four hazard fields do not share a voice', () => {
  // Flying into a vortex and flying into a fire have to be different
  // from the cockpit, because the only decision a field offers is
  // whether the way round is worth it, and that depends on which it is.
  const kinds = Object.keys(FIELD_VOICE);
  assert.deepEqual(kinds.sort(), ['fire', 'ice', 'spark', 'storm']);
  for (const a of kinds) {
    for (const b of kinds) {
      if (a >= b) continue;
      const va = FIELD_VOICE[a], vb = FIELD_VOICE[b];
      const apart = va.filter !== vb.filter
        || Math.abs(Math.log2(va.f0 / vb.f0)) > 1
        || va.type !== vb.type;
      assert.ok(apart, `${a} and ${b} are the same voice`);
    }
  }
  // ...and the table is really what comes out. fire is dark and
  // low-passed, ice is bright and high-passed: if the lookup were
  // ignored these would be identical.
  const fire = describe(profile(() => sfx.sfxFieldEnter('fire')));
  const ice = describe(profile(() => sfx.sfxFieldEnter('ice')));
  assert.ok(fire.includes('lowpass'), `fire came out as ${fire}`);
  assert.ok(ice.includes('highpass'), `ice came out as ${ice}`);
});

test('the sounds that run every frame are throttled', () => {
  // Burning, being towed and standing in a field are all called from
  // the update loop at 120Hz. Unthrottled, any one of them fills the
  // voice pool on its own and every other sound in the game stops.
  const perSecond = {
    alight: () => sfx.sfxBurning(),
    towed: () => sfx.sfxTowStrain(),
    'in a field': () => sfx.sfxFieldHold('fire'),
  };
  const c = ctx();
  for (const [what, fire] of Object.entries(perSecond)) {
    c.currentTime += 5;
    let sounds = 0;
    for (let f = 0; f < 120; f++) {
      c.currentTime += 1 / 120;
      if (capture(fire).length) sounds++;
    }
    assert.ok(sounds > 0, `"${what}" made no sound across a whole second of play`);
    assert.ok(sounds <= 12,
      `"${what}" made ${sounds} sounds in one second; the voice pool holds far fewer`);
  }
});

// ---------------------------------------------- the wiring, not the sounds
//
// Everything above tests sfx.js. The fault was not in sfx.js: the
// sounds would have been fine, there just were not any, because
// foes.js called sfxTurretShot from all three attacker cases. So this
// drives the real update loop and listens to what actually comes out.

async function attackerShot(kind) {
  const { makeGame } = await import('../src/game.js');
  const { spawnFoe, resetFoes, updateFoes } = await import('../src/foes.js');
  const { DT } = await import('../src/config.js');
  const c = ctx();
  const game = makeGame();
  game.state = 'play';
  resetFoes();
  const f = spawnFoe(game, kind);
  assert.ok(f, `could not spawn a ${kind}`);
  // Right alongside, so every one of them is inside whatever reach it
  // insists on before it will throw anything.
  for (let i = 0; i < 2000; i++) {
    game.player.x = f.x - 40;
    game.player.y = f.y;
    c.currentTime += DT;
    c.made.length = 0;
    updateFoes(game, DT);
    const made = c.made.slice();
    for (const n of made) if (n.onended) n.onended();
    const parts = [];
    for (let k = 0; k < made.length; k++) {
      const n = made[k];
      if (n.kind === 'osc') { parts.push({ kind: 'osc', type: n.type, hz: n.frequency.first() }); continue; }
      if (n.kind !== 'noise') continue;
      const flt = made.slice(k + 1).find((m) => m.kind === 'filter');
      parts.push({ kind: 'noise', type: flt ? flt.type : '?', hz: flt ? flt.frequency.first() : 0 });
    }
    if (parts.length) return parts;
  }
  return [];
}

async function attackerProfile(kind, takes = 7) {
  let acc = null;
  for (let i = 0; i < takes; i++) {
    const parts = await attackerShot(kind);
    assert.ok(parts.length, `a ${kind} fired without making any sound`);
    if (!acc) { acc = parts.map((p) => ({ ...p })); continue; }
    assert.equal(parts.length, acc.length, `a ${kind} changed shape between shots`);
    parts.forEach((p, k) => { acc[k].hz += p.hz; });
  }
  for (const p of acc) p.hz /= takes;
  return acc;
}

test('a net, a hook and a flame do not sound like each other or like a gun', async () => {
  const net = await attackerProfile('netter');
  const hook = await attackerProfile('grapnel');
  const flame = await attackerProfile('scorcher');
  const gun = profile(() => sfx.sfxTurretShot());

  const pairs = [['net', net], ['hook', hook], ['flame', flame], ['a gun', gun]];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      assert.ok(!sameSound(pairs[i][1], pairs[j][1]),
        `${pairs[i][0]} and ${pairs[j][0]} sound the same in play `
        + `(${describe(pairs[i][1])}), so neither says what is coming`);
    }
  }
});

// A frame of the real game, and what it sounded like.
//
// Fingerprints are no use for these: a net landing plays its own cue on
// top of the ordinary hit, so the frame is a mixture and comparing it
// against anything is comparing mixtures. What is testable, and is
// exactly the property that matters, is the difference — the frame
// where the thing happens has to sound like more than the frame where
// it does not. That is what "it has a sound of its own" means.
async function frame(setup) {
  const { makeGame, update } = await import('../src/game.js');
  const { resetFoes } = await import('../src/foes.js');
  const { DT } = await import('../src/config.js');
  const { setSynthetic } = await import('../src/input.js');
  const c = ctx();
  setSynthetic(new Set());
  resetFoes();
  const game = makeGame();
  game.state = 'play';
  game.spawnCd = 1e9;
  game.foeCd = 1e9;
  game.player.invuln = 0;
  const extra = await setup(game);
  c.currentTime += 5;          // clear every throttle before the frame under test
  c.made.length = 0;
  if (extra) await extra(game); else update(game, DT);
  const made = c.made.slice();
  for (const n of made) if (n.onended) n.onended();
  return made.filter((n) => n.kind === 'osc' || n.kind === 'noise').length;
}

// Runs a pair several times and takes the best case for the "without"
// side and the worst for the "with" side, so a cue that only sometimes
// lands cannot pass by luck.
async function louderWith(withSetup, withoutSetup, takes = 5) {
  let least = Infinity;
  let most = 0;
  for (let i = 0; i < takes; i++) {
    least = Math.min(least, await frame(withSetup));
    most = Math.max(most, await frame(withoutSetup));
  }
  return { withIt: least, without: most };
}

async function shotAt(game, fx) {
  const { enemyShots, fire } = await import('../src/projectiles.js');
  const p = game.player;
  const from = fx === 'hook' ? { x: p.x - 60, y: p.y, dead: false } : null;
  fire(enemyShots, p.x, p.y, 0, 0, 1, 3, 7, fx ? { fx, fxFrom: from } : {});
}

test('a net landing and a hook biting each sound like more than a hit', async () => {
  for (const fx of ['net', 'hook']) {
    const r = await louderWith(
      (g) => shotAt(g, fx),
      (g) => shotAt(g, null),
    );
    assert.ok(r.withIt > r.without,
      `a ${fx} landing made ${r.withIt} sounds and a plain hit made ${r.without}; `
      + 'the two are indistinguishable from the cockpit');
  }
});

test('burning, and standing in a field, each have a sound of their own', async () => {
  const { STATUS, HAZARDS } = await import('../src/config.js');
  assert.ok(STATUS.burnTime > 0 && HAZARDS.fire, 'the fixtures moved');

  const burning = await louderWith(
    (g) => { g.player.burnT = STATUS.burnTime; },
    (g) => { g.player.burnT = 0; },
  );
  assert.ok(burning.withIt > burning.without,
    `a burning frame made ${burning.withIt} sounds and a clean one ${burning.without}; `
    + 'the shield bar is the only tell that you are alight');

  // Standing in a fire. Put one under the ship rather than hunting the
  // campaign for a hull that happens to have one where it is wanted.
  const inFire = await louderWith(
    (g) => {
      g.level.hazards = [{ kind: 'fire', x: g.player.x - 80, y: g.player.y - 60, w: 160, h: 120, t: 0 }];
    },
    (g) => { g.level.hazards = []; },
  );
  assert.ok(inFire.withIt > inFire.without,
    `a frame inside a fire made ${inFire.withIt} sounds and one outside ${inFire.without}`);
});

test('a cistern going up does not sound like an ordinary tower', async () => {
  const { TOWERS } = await import('../src/config.js');
  const { hitTurret } = await import('../src/enemies.js');
  const make = (kind) => (g) => {
    const t = {
      x: 400, y: 100, dir: 1, kind, tower: TOWERS[kind], angle: 0, hp: 5,
      dead: false, charge: 0, shielded: false, painted: null, t: 0,
      cd: 0, burstLeft: 0, burstTimer: 0,
    };
    g.level.turrets = [t];
    g.player.x = 4000;             // well clear, so the blast is not about us
    return () => { hitTurret(g, t, 99); };
  };
  const r = await louderWith(make('cistern'), make('gun'));
  assert.ok(r.withIt > r.without,
    `a cistern made ${r.withIt} sounds and a gun made ${r.without}; a 128px blast `
    + 'that sounds like a 0px one gives whoever is beside it no warning');
});

test('a searchlight catching the ship says so', async () => {
  const { TOWERS, DT } = await import('../src/config.js');
  const { updateTurrets } = await import('../src/enemies.js');
  const light = (near) => (g) => {
    const t = {
      x: 400, y: 100, dir: 1, kind: 'searchlight', tower: TOWERS.searchlight,
      angle: 0, hp: 50, dead: false, charge: 0, shielded: false, painted: null,
      t: 0, cd: 0, burstLeft: 0, burstTimer: 0,
    };
    g.level.turrets = [t];
    g.level.gates = [];
    g.player.x = 400;
    g.player.y = near ? 100 + TOWERS.searchlight.beam.range * 0.4 : 100 - 50;
    // Wind the lamp to just before it points straight down the corridor,
    // so the frame under test is the one where it finds you.
    t.beamA = near ? -DT * TOWERS.searchlight.beam.speed : 0;
    return () => { updateTurrets(g, DT); };
  };
  const r = await louderWith(light(true), light(false));
  assert.ok(r.withIt > r.without,
    `being found made ${r.withIt} sounds and not being found made ${r.without}; `
    + 'a light that lights you up for every gun in reach has to say so');
});

test('a field keeps nagging, and a beam pings only when it finds you', async () => {
  const { TOWERS, DT } = await import('../src/config.js');
  const { updateTurrets } = await import('../src/enemies.js');
  const { makeGame, update } = await import('../src/game.js');
  const { resetFoes } = await import('../src/foes.js');
  const { setSynthetic } = await import('../src/input.js');

  // --- a field is a state, so it goes on saying so.
  //
  // Entering was already covered; this is the frame after, which is a
  // different branch and was silent. A field you stop hearing is a
  // field you forget you are in, and the whole decision it offers is
  // whether to keep going.
  const held = async (hazard) => {
    const c = ctx();
    setSynthetic(new Set());
    resetFoes();
    const g = makeGame();
    g.state = 'play';
    g.spawnCd = 1e9; g.foeCd = 1e9; g.player.invuln = 0;
    g.level.hazards = hazard
      ? [{ kind: 'fire', x: g.player.x - 200, y: g.player.y - 100, w: 400, h: 200, t: 0 }] : [];
    update(g, DT);                   // the entry frame, deliberately spent
    assert.equal(!!g.player.inField, hazard, 'the fixture did not put the ship where it meant to');
    c.currentTime += 5;              // past the hold throttle
    c.made.length = 0;
    update(g, DT);                   // the frame under test: still inside, not entering
    const made = c.made.slice();
    for (const n of made) if (n.onended) n.onended();
    return made.filter((n) => n.kind === 'osc' || n.kind === 'noise').length;
  };
  const inside = await held(true);
  const outside = await held(false);
  assert.ok(inside > outside,
    `a frame still inside a field made ${inside} sounds and one outside made ${outside}; `
    + 'crossing in is audible and staying in is not');

  // --- a beam is an event, so it says so once.
  //
  // Pinned where the lamp turns round rather than where it sweeps
  // fastest: at the end of its arc it dwells, and the hold lasts well
  // over the cue's own throttle. Caught in the middle of the sweep the
  // hold is about half a second, the throttle is six tenths, and a cue
  // that fired every single frame would still come out as one sound —
  // which is exactly how the first version of this test passed a
  // searchlight that pinged continuously.
  const beam = TOWERS.searchlight.beam;
  const g = makeGame();
  g.state = 'play';
  const t = {
    x: 400, y: 100, dir: 1, kind: 'searchlight', tower: TOWERS.searchlight,
    angle: 0, hp: 99, dead: false, charge: 0, shielded: false, painted: null,
    t: 0, cd: 0, burstLeft: 0, burstTimer: 0, beamA: 0,
  };
  g.level.turrets = [t];
  g.level.gates = [];
  // bearing = atan2(across, out) ~ the far end of the arc
  g.player.x = t.x + Math.round(Math.tan(beam.arc) * 100);
  g.player.y = t.y + 100;
  g.player.alive = true;

  const c = ctx();
  let caughtFrames = 0, heldFrames = 0, caughtSounds = 0, heldSounds = 0;
  let longestHold = 0, run = 0;
  let was = false;
  for (let f = 0; f < 120 * 12; f++) {
    g.player.x = t.x + Math.round(Math.tan(beam.arc) * 100);
    g.player.y = t.y + 100;
    c.currentTime += DT;
    c.made.length = 0;
    updateTurrets(g, DT);
    const made = c.made.slice();
    for (const n of made) if (n.onended) n.onended();
    const sounds = made.filter((n) => n.kind === 'osc' || n.kind === 'noise').length;
    if (t.beamLit && !was) { caughtFrames++; caughtSounds += sounds; run = 1; }
    else if (t.beamLit) { heldFrames++; heldSounds += sounds; run++; }
    else run = 0;
    longestHold = Math.max(longestHold, run);
    was = t.beamLit;
  }
  assert.ok(caughtFrames > 0, 'the light never found the ship at all');
  assert.ok(caughtSounds > 0, 'the light found the ship and said nothing');
  // The control that makes the next assertion mean something: the hold
  // has to outlast the cue's throttle, or a per-frame ping would be
  // silenced by the throttle and pass as if it were on the edge.
  assert.ok(longestHold * DT > 0.6 * 2,
    `the longest hold was ${(longestHold * DT).toFixed(2)}s, inside the cue's own throttle; `
    + 'this test cannot tell an edge from a continuous ping');
  assert.equal(heldSounds, 0,
    `${heldSounds} pings across ${heldFrames} frames of being held in a beam; `
    + 'it is an event, not an alarm that runs until you leave');
});
