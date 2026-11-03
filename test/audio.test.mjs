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
