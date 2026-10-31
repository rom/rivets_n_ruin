import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVELS, BOSSES, SHIP, LEVEL_UP, PICKUP, HULL_BONUS, DIFFICULTY } from '../src/config.js';
import { MODS } from '../src/shop.js';

// The Go score validator mirrors a handful of client constants in order to
// decide what is physically possible. When they drift, the server starts
// rejecting honest runs with a 422 — which has happened twice, each time
// only discovered by playing. This reads the Go source and compares.

const go = readFileSync(new URL('../internal/validate/score.go', import.meta.url), 'utf8');

// Handles plain numbers and simple products like `0.64 * 0.75`, which is
// how the spawn-interval constant is written so its derivation stays visible.
const goConst = (name) => {
  const m = go.match(new RegExp(`\\b${name}\\s*=\\s*([0-9.]+(?:\\s*\\*\\s*[0-9.]+)*)`));
  assert.ok(m, `could not find ${name} in score.go`);
  return m[1].split('*').map((p) => Number(p.trim())).reduce((a, b) => a * b, 1);
};

const goSlice = (name) => {
  const m = go.match(new RegExp(`var ${name} = \\[\\]\\w+\\{([^}]*)\\}`, 's'));
  assert.ok(m, `could not find ${name} in score.go`);
  return m[1].split(',').map((s) => s.replace(/\/\/.*/g, '').trim()).filter(Boolean);
};

test('top speed matches', () => {
  assert.equal(goConst('BaseMaxVX'), SHIP.maxVX,
    'validate.BaseMaxVX and SHIP.maxVX have drifted');
});

test('per-hull speed gain matches', () => {
  assert.equal(goConst('MaxVXPerLevel'), LEVEL_UP.maxVXAdd,
    'validate.MaxVXPerLevel and LEVEL_UP.maxVXAdd have drifted');
});

test('hull lengths match, in order', () => {
  const lens = goSlice('HullLengths').map(Number);
  assert.deepEqual(lens, LEVELS.map((l) => l.length),
    'validate.HullLengths does not match LEVELS[].length');
});

test('there is a boss reward for every boss', () => {
  assert.equal(goSlice('BossRewards').length, BOSSES.length,
    'validate.BossRewards and BOSSES differ in length');
});

test('boss pickup drop counts are declared for every boss', () => {
  assert.equal(goSlice('BossPickupDrops').length, BOSSES.length,
    'validate.BossPickupDrops and BOSSES differ in length');
});

test('the validator allows for the densest interceptor spawn', () => {
  const fastest = Math.min(...LEVELS.map((l) => l.interceptorSpawn));
  const goInterval = goConst('FastestSpawnInterval');
  // the Go value is spawnEvery * 0.75, the low end of the random multiplier
  assert.ok(goInterval <= fastest * 0.75 + 1e-9,
    `validator assumes interceptors no denser than ${goInterval}s, but a hull spawns at ${(fastest * 0.75).toFixed(3)}s`);
});

// --- the economy.
//
// The ceiling on a submission is built from these, and when the client's
// economy grew past the server's copy of it the server started throwing
// away real runs: a 4.65-million hull was refused against a ceiling of
// 1.74 million, and the end screen showed SENDING RUN... while it happened.
// Each of these is one half of a pair that must not drift again.

test('coin, bar, coffin and treasure values match', () => {
  const top = Math.max(...Object.values(PICKUP.treasure).map((t) => t.value));
  const pairs = [
    ['CoinValue', PICKUP.coinValue],
    ['BarValue', PICKUP.barValue],
    ['CoffinValue', PICKUP.coffinValue],
    ['BestTreasure', top],
    ['MaxCoinsPerKill', PICKUP.coinsPerKill[1]],
    ['MaxLives', PICKUP.maxLives],
    ['TreasureRolls', PICKUP.treasureFromBoss],
    ['BossBarsMax', PICKUP.bossBars[1]],
    ['BossCoffinsMax', PICKUP.bossCoffins[1]],
  ];
  for (const [name, want] of pairs) {
    assert.equal(goConst(name), want, `validate.${name} has drifted from src/config.js`);
  }
});

test('drop rates match, at their most generous', () => {
  assert.equal(goConst('CrateChance'), PICKUP.dropFromTurret,
    'validate.CrateChance has drifted from PICKUP.dropFromTurret');
  assert.equal(goConst('BarChance'), PICKUP.barChance,
    'validate.BarChance has drifted from PICKUP.barChance');
  assert.equal(goConst('CoffinChance'), PICKUP.coffinChance,
    'validate.CoffinChance has drifted from PICKUP.coffinChance');
});

// Treasure odds climb per hull and are never capped, so the server's
// figure has to be the last hull's. It was the eight-hull value for the
// whole of the twenty-five-hull campaign, which is why it is now derived
// from the hull count on both sides rather than written down on either.
test('the treasure rate is the last hull\'s, not an older campaign\'s', () => {
  assert.equal(goConst('TreasureBase'), PICKUP.treasureChance,
    'validate.TreasureBase has drifted from PICKUP.treasureChance');
  assert.equal(goConst('TreasurePerHull'), PICKUP.treasureHullBonus,
    'validate.TreasurePerHull has drifted from PICKUP.treasureHullBonus');
  const lastHull = PICKUP.treasureChance + PICKUP.treasureHullBonus * (LEVELS.length - 1);
  assert.ok(/TreasurePerHull\*float64\(len\(HullLengths\)-1\)/.test(go.replace(/\s+/g, '')),
    'the Go treasure rate is no longer derived from the hull count');
  assert.ok(lastHull > PICKUP.treasureChance,
    'treasure odds no longer climb with the hull; the derivation is pointless');
});

test('end-of-hull bonuses match', () => {
  const pairs = [
    ['BonusTowers', HULL_BONUS.towers],
    ['BonusSweep', HULL_BONUS.fullSweep],
    ['BonusPerLife', HULL_BONUS.perLife],
    ['BonusNoLoss', HULL_BONUS.noLoss],
    ['HaulShare', HULL_BONUS.haulPct],
  ];
  for (const [name, want] of pairs) {
    assert.equal(goConst(name), want, `validate.${name} has drifted from HULL_BONUS`);
  }
});

// The two multipliers a pilot can legitimately stack on top of everything
// else. Either one being low is a ceiling that refuses honest runs.
test('the loot and score multipliers match the best a pilot can buy', () => {
  const scavenger = Math.max(...MODS.scavenger.tiers.map((t) => t.mul || 1));
  assert.equal(goConst('MaxCoinMul'), scavenger,
    'validate.MaxCoinMul is not the top SCAVENGER RIG tier');
  const hardest = Math.max(...DIFFICULTY.map((d) => d.scoreMul));
  assert.equal(goConst('MaxScoreMul'), hardest,
    'validate.MaxScoreMul is not the hardest difficulty\'s scoreMul');
});

test('the afterburner speed bonus matches', () => {
  const src = readFileSync(new URL('../src/shop.js', import.meta.url), 'utf8');
  const m = src.match(/maxVXBonus \+= (\d+)/);
  assert.ok(m, 'could not find the afterburner speed bonus in src/shop.js');
  assert.equal(goConst('AfterburnerBonus'), Number(m[1]),
    'validate.AfterburnerBonus has drifted from the AFTERBURNER mod');
});

test('the validator allows for the most heavily defended hull', () => {
  const maxTurretsSeen = goConst('MaxTurretsPerHull');
  assert.ok(maxTurretsSeen >= 40, 'turret allowance looks too low for eight hulls');
});

// --- the README is the third copy of these facts, and it drifted furthest.
//
// Its hull table went on claiming three hulls long after there were eight,
// and its gap list described systems that had since been built. Nobody
// notices a stale README from inside the code, so the table is checked.

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('the README hull table lists every hull, with its real length', () => {
  const rows = [...readme.matchAll(/\|\s*\*\*([A-Z]+)\*\*[^|]*\|\s*([\d,]+)px\s*\|/g)]
    .map((m) => ({ name: m[1], length: Number(m[2].replace(/,/g, '')) }));
  assert.equal(rows.length, LEVELS.length,
    `README lists ${rows.length} hulls, the game has ${LEVELS.length}`);
  rows.forEach((row, i) => {
    assert.equal(row.name, LEVELS[i].name, `README hull ${i + 1} is out of order`);
    assert.equal(row.length, LEVELS[i].length,
      `README says ${LEVELS[i].name} is ${row.length}px, config says ${LEVELS[i].length}px`);
  });
});

test('the README names every boss', () => {
  for (const b of BOSSES) {
    assert.ok(readme.includes(b.name), `the README never mentions ${b.name}`);
  }
});
