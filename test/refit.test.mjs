import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, update } from '../src/game.js';
import { setSynthetic } from '../src/input.js';
import { DT, LEVELS, LEVEL_UP, PICKUP } from '../src/config.js';

// What clearing a hull gives you for free.
//
// It used to be +1 gun speed, +1 gun blaze and +1 to the cap, every single
// hull. Combined, those alone drove both guns to their hard ceiling by
// hull five of twenty-five whatever the drops did — so making the crate
// drops rarer only moved the point at which the free grants took over.
// They are spaced out now, and this is where that schedule is pinned.

// Flies a run to the point where it is actually in flight, so the ship
// being measured is the one the refits built rather than a hand-made
// object that happens to have the same fields.
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
  assert.equal(game.state, 'play', `never reached flight starting on hull ${hull + 1}`);
  return game;
}

test('the free grants arrive on a schedule, not every hull', () => {
  const schedule = [
    ['gunSpeedBase', LEVEL_UP.gunSpeedEvery],
    ['gunBlazeBase', LEVEL_UP.gunBlazeEvery],
  ];
  for (const [field, every] of schedule) {
    assert.ok(every > 1,
      `${field} is granted every ${every} hull(s), which is the thing that was wrong`);
  }
  assert.ok(LEVEL_UP.gunCapEvery > 1,
    'the cap still rises every hull, which is half of what made the guns max out early');
});

test('a refit grants its levels on the hull the schedule says', () => {
  // Starting on hull n credits n refits, so the ship on hull n is the ship
  // you would have had flying there. Walking the start hull up is the
  // cheapest way to read the whole schedule.
  let lastSpeed = 0;
  let lastBlaze = 0;
  let lastCap = PICKUP.gunLevels;
  for (let hull = 0; hull < LEVELS.length; hull++) {
    const p = launchAt(hull).player;
    const refits = hull;      // hulls credited before this one

    const wantSpeed = Math.floor(refits / LEVEL_UP.gunSpeedEvery);
    const wantBlaze = Math.floor(refits / LEVEL_UP.gunBlazeEvery);
    const wantCap = Math.min(PICKUP.gunCapMax,
      PICKUP.gunLevels + Math.floor(refits / LEVEL_UP.gunCapEvery));

    assert.equal(p.gunCapBase, wantCap,
      `on hull ${hull + 1} the cap is ${p.gunCapBase}, want ${wantCap}`);
    assert.equal(p.gunSpeedBase, Math.min(wantCap, wantSpeed),
      `on hull ${hull + 1} the free gun speed is ${p.gunSpeedBase}, want ${wantSpeed}`);
    assert.equal(p.gunBlazeBase, Math.min(wantCap, wantBlaze),
      `on hull ${hull + 1} the free gun blaze is ${p.gunBlazeBase}, want ${wantBlaze}`);

    // Monotone: a later hull is never a worse ship than an earlier one.
    assert.ok(p.gunSpeedBase >= lastSpeed, `hull ${hull + 1} went backwards on gun speed`);
    assert.ok(p.gunBlazeBase >= lastBlaze, `hull ${hull + 1} went backwards on gun blaze`);
    assert.ok(p.gunCapBase >= lastCap, `hull ${hull + 1} went backwards on the cap`);
    lastSpeed = p.gunSpeedBase;
    lastBlaze = p.gunBlazeBase;
    lastCap = p.gunCapBase;
  }
});

test('the free grants alone do not reach the ceiling early', () => {
  // The complaint this fixes: fully pimped guns a fifth of the way in.
  // Measured on the free grants alone, with no drops at all, so it is the
  // schedule being tested and not the crate table.
  const fifth = Math.floor(LEVELS.length / 5);
  const p = launchAt(fifth).player;
  assert.ok(p.gunSpeedBase < PICKUP.gunCapMax,
    `free grants alone reach gun speed ${p.gunSpeedBase} of ${PICKUP.gunCapMax} `
    + `by hull ${fifth + 1} of ${LEVELS.length}`);
  assert.ok(p.gunCapBase < PICKUP.gunCapMax,
    `the cap is already at its maximum by hull ${fifth + 1} of ${LEVELS.length}`);

  // Half way in, there should still be something left to reach for.
  const half = Math.floor(LEVELS.length / 2);
  const mid = launchAt(half).player;
  assert.ok(mid.gunSpeedBase < PICKUP.gunCapMax || mid.gunBlazeBase < PICKUP.gunCapMax,
    `both guns are free-granted to the ceiling by the half-way hull ${half + 1}`);
});

test('the ceiling is still reachable before the campaign ends', () => {
  // The opposite failure: grants so sparse that a pilot who flies all
  // twenty-five hulls never sees the top of the tree.
  const last = launchAt(LEVELS.length - 1).player;
  assert.equal(last.gunCapBase, PICKUP.gunCapMax,
    `the cap only reaches ${last.gunCapBase} of ${PICKUP.gunCapMax} over a whole campaign`);
  // The gun levels themselves may still need drops or the armourer — that
  // is the point — but the cap must open all the way up.
});

test('no refit can push a gun past the hard ceiling', () => {
  for (let hull = 0; hull < LEVELS.length; hull++) {
    const p = launchAt(hull).player;
    assert.ok(p.gunCap <= PICKUP.gunCapMax,
      `hull ${hull + 1}: cap ${p.gunCap} is over the hard maximum ${PICKUP.gunCapMax}`);
    assert.ok(p.gunSpeed <= p.gunCap, `hull ${hull + 1}: gun speed is over its own cap`);
    assert.ok(p.gunBlaze <= p.gunCap, `hull ${hull + 1}: gun blaze is over its own cap`);
    // ...and the tables the levels index into must cover them.
    assert.ok(PICKUP.speedScale[p.gunSpeed] !== undefined,
      `hull ${hull + 1}: no speedScale entry for level ${p.gunSpeed}`);
    assert.ok(PICKUP.blazeAngles[p.gunBlaze] !== undefined,
      `hull ${hull + 1}: no blazeAngles entry for level ${p.gunBlaze}`);
  }
});

// Everything else a refit gives is unchanged and still per-hull; only the
// guns were the problem. Worth pinning so the fix does not quietly take
// the rest of the progression with it.
test('the rest of the refit still arrives every hull', () => {
  const first = launchAt(0).player;
  const tenth = launchAt(9).player;
  assert.ok(tenth.shieldMax > first.shieldMax, 'the shield stopped growing per hull');
  assert.ok(tenth.maxVXBonus > first.maxVXBonus, 'top speed stopped growing per hull');
  assert.ok(tenth.bulletBonus > first.bulletBonus, 'bullet speed stopped growing per hull');
  assert.equal(tenth.shieldMax - first.shieldMax, LEVEL_UP.shieldMax * 9,
    'the shield grant is no longer once per hull');
  assert.equal(tenth.maxVXBonus - first.maxVXBonus, LEVEL_UP.maxVXAdd * 9,
    'the speed grant is no longer once per hull');
});
