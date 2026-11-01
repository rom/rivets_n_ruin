import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, mixSeed, pointBlocked } from '../src/level.js';
import { makeGame, update } from '../src/game.js';
import { setSynthetic } from '../src/input.js';
import { LEVELS, TOWERS, FIELD_TOP, FIELD_BOT, DT } from '../src/config.js';
import * as settings from '../src/settings.js';

// ------------------------------------------------------------- the run seed
//
// A hull is generated from a seed. With FIXED layouts that seed is the
// hull's own and nothing else, which is what makes a hull learnable and two
// scores on it comparable. With SHUFFLED a per-run seed is folded in.
//
// The thing that has to hold either way is the thing that has always had to
// hold: a hull you cannot fly through is not a hard hull, it is a broken
// one. The existing walk in level.test.mjs checks that for the eight fixed
// seeds the campaign ships. Shuffling means the generator now has to be
// right for seeds nobody has ever looked at.

test('a zero run seed leaves the hull seed alone', () => {
  for (const spec of LEVELS.slice(0, 4)) {
    assert.equal(mixSeed(spec.seed, 0), spec.seed >>> 0,
      `${spec.name}: FIXED must not disturb the seed`);
  }
});

test('FIXED layouts are still byte-identical between builds', () => {
  const a = buildLevel(LEVELS[0]);
  const b = buildLevel(LEVELS[0], 0);
  assert.equal(a.obstacles.length, b.obstacles.length);
  for (let i = 0; i < a.obstacles.length; i++) {
    assert.deepEqual(a.obstacles[i], b.obstacles[i],
      'the default argument changed what an unseeded build produces');
  }
});

test('a run seed changes the layout, and the same one reproduces it', () => {
  const plain = buildLevel(LEVELS[0]);
  const shuffled = buildLevel(LEVELS[0], 0x1234abcd);
  const again = buildLevel(LEVELS[0], 0x1234abcd);

  const sig = (lv) => lv.obstacles.map((o) => `${o.x}:${o.y}:${o.w}:${o.h}`).join(',');
  assert.notEqual(sig(shuffled), sig(plain), 'a run seed produced the fixed layout');
  assert.equal(sig(again), sig(shuffled), 'the same run seed produced a different layout');
});

test('neighbouring run seeds do not produce similar openings', () => {
  // mulberry32 is weakest in its first few outputs, so a plain XOR of
  // consecutive seeds gave runs that opened with the same two patterns.
  // The first obstacle is the one a player sees first, so that is what
  // this measures.
  const first = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const lv = buildLevel(LEVELS[3], seed);
    const o = lv.obstacles[0];
    first.add(`${Math.round(o.x)}:${Math.round(o.y)}:${Math.round(o.w)}`);
  }
  assert.ok(first.size >= 18,
    `24 consecutive seeds gave only ${first.size} distinct openings`);
});

// The expensive one, and the reason the feature is safe to ship: walk the
// whole hull for seeds the campaign has never used and confirm the ship
// still fits through every vertical slice.
const SHIP_H = 10;
function widestGapFailure(lv) {
  for (let x = 10; x < lv.length; x += 17) {
    let run = 0;
    let best = 0;
    for (let y = FIELD_TOP + 1; y < FIELD_BOT; y += 2) {
      if (pointBlocked(lv, x, y)) run = 0;
      else { run += 2; best = Math.max(best, run); }
    }
    if (best < SHIP_H) return { x, best };
  }
  return null;
}

for (const hull of [0, 4, 7, LEVELS.length - 1]) {
  test(`${LEVELS[hull].name}: shuffled layouts stay flyable`, () => {
    for (const seed of [1, 7, 0x51ed, 0xbeef, 0x7fffffff, 0xffffffff, 12345, 999983]) {
      const lv = buildLevel(LEVELS[hull], seed);
      const bad = widestGapFailure(lv);
      assert.equal(bad, null,
        bad && `${LEVELS[hull].name} seed ${seed} is impassable at x=${bad.x}`
          + ` (widest gap ${bad.best}px)`);
    }
  });

  test(`${LEVELS[hull].name}: shuffled turrets still sit on a surface`, () => {
    for (const seed of [3, 0xabc, 0x10203040]) {
      const lv = buildLevel(LEVELS[hull], seed);
      for (const t of lv.turrets) {
        assert.ok(!pointBlocked(lv, t.x, t.y + t.dir * 8),
          `${LEVELS[hull].name} seed ${seed}: muzzle buried at x=${t.x}`);
      }
    }
  });
}

test('the layout setting only offers the two it knows', () => {
  const def = settings.DEFS.find((d) => d.id === 'shuffle');
  assert.ok(def, 'no layout setting');
  assert.equal(def.def, 0, 'the default must be the historical behaviour');
  assert.equal(settings.LAYOUTS[0], 'FIXED');
  assert.equal(settings.LAYOUTS.length, 2);
});

// --------------------------------------------------------- restarting a run
//
// reset() used to rebuild the hull only when the index moved, and put the
// guns back by hand when it did not. The hand-written restore assigned the
// hull's base turretHp flat, dropping the per-tower hpMul — so a BASTION on
// a hull you restarted stood up with a GUN's health. Always rebuilding
// removed the restore and the bug with it; this is what pins it.

function launchAt(hull) {
  const game = makeGame();
  game.unlocked = LEVELS.length - 1;
  game.setStartHull(hull);
  try {
    for (let f = 0; f < 60 * 120 && game.state !== 'play'; f++) {
      const a = new Set();
      if (Math.floor(f / 15) % 2 === 0) a.add('start');
      setSynthetic(a);
      update(game, DT);
    }
  } finally {
    setSynthetic(null);
  }
  assert.equal(game.state, 'play', `never reached flight on hull ${hull + 1}`);
  return game;
}

function checkTurretHp(game, when) {
  const base = game.level.spec.turretHp;
  let checkedHeavy = 0;
  for (const t of game.level.turrets) {
    const want = Math.round(base * TOWERS[t.kind].hpMul);
    assert.equal(t.hp, want,
      `${when}: ${t.kind} has ${t.hp} hp, expected ${want}`);
    if (TOWERS[t.kind].hpMul >= 2) checkedHeavy++;
  }
  return checkedHeavy;
}

test('a restarted hull stands its heavy towers back up at full health', () => {
  // PYRITE fields BASTION, which is hpMul 3.2 — the widest gap between the
  // right answer and the flat base, and so the one worth measuring.
  const game = launchAt(4);
  const heavy = checkTurretHp(game, 'on launch');
  assert.ok(heavy > 0, 'the hull under test fields no heavy tower; pick another');

  // Restart on the same hull: the index does not move, which is the case
  // the old code skipped the rebuild for.
  const before = game.levelIndex;
  try {
    setSynthetic(new Set(['restart']));
    update(game, DT);
  } finally {
    setSynthetic(null);
  }
  assert.equal(game.levelIndex, before, 'the restart was meant to stay on this hull');
  checkTurretHp(game, 'after a restart on the same hull');
});
