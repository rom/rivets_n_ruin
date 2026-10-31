import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFS, GROUPS, get as setting, set as setSetting, reset as resetSettings } from '../src/settings.js';
import { FLASH_DAMP, CONTRAST_RING } from '../src/render.js';
import { startLoop } from '../src/loop.js';
import { DT } from '../src/config.js';

// Accessibility settings that exist but do nothing are worse than none:
// they say the barrier has been removed when it has not. Each of these
// asserts the setting reaches the thing it claims to change.

test.afterEach(() => resetSettings());

test('every accessibility setting is reachable and reversible', () => {
  for (const d of DEFS.filter((x) => x.group === 'ACCESSIBILITY')) {
    const before = setting(d.id);
    const other = d.kind === 'bool' ? !before : d.min;
    setSetting(d.id, other);
    assert.equal(setting(d.id), other, `"${d.label}" would not change`);
    setSetting(d.id, before);
    assert.equal(setting(d.id), before, `"${d.label}" would not change back`);
  }
});

test('the accessibility settings survive a reload', () => {
  setSetting('autofire', true);
  setSetting('gameSpeed', 70);
  setSetting('reduceFlash', true);
  // settings.js reads localStorage once at import; check what it wrote,
  // which is what a reload would read back.
  const saved = JSON.parse(localStorage.getItem('rnr.settings'));
  assert.equal(saved.autofire, true);
  assert.equal(saved.gameSpeed, 70);
  assert.equal(saved.reduceFlash, true);
});

// --- AUTO FIRE

test('auto fire fires without the key, at the gun\'s rate and no faster', async () => {
  const { updatePlayer } = await import('../src/player.js');
  const { playerShots } = await import('../src/projectiles.js');
  const { setSynthetic } = await import('../src/input.js');
  const { makeGame } = await import('../src/game.js');

  // A real game, because the firing path reaches into the level, the
  // camera and the difficulty; a hand-rolled stub only proves the stub.
  const game = makeGame();
  function shotsIn(seconds) {
    playerShots.clear();
    const p = game.player;
    p.x = 200; p.y = 150; p.fireCd = 0; p.flip = 0;
    for (let t = 0; t < seconds; t += DT) updatePlayer(p, game, DT);
    return playerShots.count;
  }

  setSynthetic(new Set());          // no keys held at all
  setSetting('autofire', false);
  const idle = shotsIn(0.6);
  setSetting('autofire', true);
  const auto = shotsIn(0.6);
  setSynthetic(null);

  assert.equal(idle, 0, 'the ship fired with no key held and auto fire off');
  assert.ok(auto > 0, 'auto fire is on and the ship is not firing');

  // ...and it is not a rate boost: holding the key must give the same.
  setSynthetic(new Set(['fire']));
  setSetting('autofire', false);
  const held = shotsIn(0.6);
  setSynthetic(null);
  assert.equal(auto, held,
    `auto fire gave ${auto} shots where holding the key gives ${held}; it is an advantage, not an aid`);
});

// --- GAME SPEED

test('game speed scales how much time reaches the simulation', () => {
  const frames = [];
  let raf = null;
  const realRaf = globalThis.requestAnimationFrame;
  const realNow = globalThis.performance.now;
  globalThis.requestAnimationFrame = (fn) => { raf = fn; };

  let steps = 0;
  let clock = 0;
  globalThis.performance = { now: () => clock };

  const run = (rate, seconds) => {
    steps = 0;
    clock = 0;
    raf = null;
    startLoop(() => { steps++; }, () => {}, rate);
    // startLoop schedules the first frame immediately; drive it by hand.
    for (let i = 0; i < seconds * 60; i++) {
      clock += 1000 / 60;
      const fn = raf;
      raf = null;
      fn(clock);
    }
    return steps;
  };

  const full = run(() => 1, 2);
  const half = run(() => 0.5, 2);
  globalThis.requestAnimationFrame = realRaf;
  globalThis.performance.now = realNow;

  assert.ok(full > 0, 'the loop did not run at all');
  const ratio = half / full;
  assert.ok(ratio > 0.45 && ratio < 0.55,
    `half speed advanced the simulation ${(ratio * 100).toFixed(0)}% as far, not ~50%`);
  frames.push(full, half);
});

test('a broken game speed cannot stall the game', () => {
  const realRaf = globalThis.requestAnimationFrame;
  const realPerf = globalThis.performance;
  let raf = null;
  let clock = 0;
  globalThis.requestAnimationFrame = (fn) => { raf = fn; };
  globalThis.performance = { now: () => clock };

  const drive = (rate) => {
    let steps = 0;
    clock = 0;
    raf = null;
    startLoop(() => { steps++; }, () => {}, rate);
    for (let i = 0; i < 120; i++) {
      clock += 1000 / 60;
      const fn = raf; raf = null; fn(clock);
    }
    return steps;
  };

  // Zero, negative, NaN and a value above 1 are all things a corrupted
  // setting could hold. None may freeze the game or speed it up.
  const normal = drive(() => 1);
  for (const bad of [0, -1, NaN, Infinity, 5]) {
    const got = drive(() => bad);
    assert.ok(got > 0, `a rate of ${bad} stopped the simulation dead`);
    assert.ok(got <= normal + 2, `a rate of ${bad} ran the game faster than normal`);
  }

  globalThis.requestAnimationFrame = realRaf;
  globalThis.performance = realPerf;
});

test('the game speed setting only ever slows, never speeds up', () => {
  const d = DEFS.find((x) => x.id === 'gameSpeed');
  assert.equal(d.max, 100, 'game speed can be set above normal, which is an advantage');
  assert.ok(d.min > 0, 'game speed can be set to zero, which freezes the game');
});

// --- REDUCE FLASHING

test('reducing flashing damps the full-screen flash without removing it', () => {
  assert.ok(FLASH_DAMP > 0,
    'the flash is removed entirely, which takes feedback away from the player it should help');
  assert.ok(FLASH_DAMP < 0.5, `a flash at ${FLASH_DAMP} of full is not meaningfully reduced`);
});

// --- HIGH CONTRAST

test('the high-contrast outline is a colour the bloom will not swallow', () => {
  assert.match(CONTRAST_RING, /^#[0-9a-f]{6}$/i);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(CONTRAST_RING.slice(i, i + 2), 16));
  // Under the 'lighter' composite a near-white ring blooms into the shot
  // it is supposed to frame.
  assert.ok(Math.max(r, g, b) < 235, 'the outline is bright enough to bloom over what it outlines');
  assert.ok(Math.max(r, g, b) > 110, 'the outline is too dark to read against the hull');
});

// --- the group as a whole

test('no accessibility setting is also a difficulty setting in disguise', () => {
  // Difficulty has its own setting and its own score multiplier. An
  // accessibility aid that quietly made the game easier would let a run
  // score as PILOT while being flown as CADET.
  const ids = DEFS.filter((d) => d.group === 'ACCESSIBILITY').map((d) => d.id);
  for (const id of ['difficulty', 'startHull']) {
    assert.ok(!ids.includes(id), `"${id}" is filed under accessibility`);
  }
  assert.ok(GROUPS.includes('ACCESSIBILITY'));
});
