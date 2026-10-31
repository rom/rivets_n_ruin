import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEVELS, BOSSES, SHIP, LEVEL_UP } from '../src/config.js';

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
