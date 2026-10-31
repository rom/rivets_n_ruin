import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diff, award } from '../src/score.js';
import { DIFFICULTY, DEFAULT_DIFFICULTY } from '../src/config.js';
import { set as setSetting, reset as resetSettings } from '../src/settings.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test.beforeEach(() => resetSettings());

test('the difficulty table is ordered: harder on every axis, and pays more', () => {
  for (let i = 1; i < DIFFICULTY.length; i++) {
    const a = DIFFICULTY[i - 1];
    const b = DIFFICULTY[i];
    assert.ok(b.enemyDmg > a.enemyDmg, `${b.id}: enemies hit no harder than ${a.id}`);
    assert.ok(b.bossHp > a.bossHp, `${b.id}: bosses are no tougher than ${a.id}`);
    assert.ok(b.spawn < a.spawn, `${b.id}: spawns no faster than ${a.id}`);
    assert.ok(b.scrape > a.scrape, `${b.id}: scrapes cost no more than ${a.id}`);
    assert.ok(b.scoreMul > a.scoreMul, `${b.id}: pays no better than ${a.id} — nothing to choose it for`);
  }
  assert.equal(DIFFICULTY[DEFAULT_DIFFICULTY].scoreMul, 1, 'the default must be the unit of score');
  for (const d of DIFFICULTY) {
    assert.ok(d.id && d.name, 'every difficulty needs an id and a name');
    for (const k of ['enemyDmg', 'bossHp', 'spawn', 'scrape', 'scoreMul']) {
      assert.ok(Number.isFinite(d[k]) && d[k] > 0, `${d.id}.${k} is not a positive number`);
    }
  }
});

test('diff() tracks the setting and survives nonsense', () => {
  for (let i = 0; i < DIFFICULTY.length; i++) {
    setSetting('difficulty', i);
    assert.equal(diff().id, DIFFICULTY[i].id);
  }
  // settings.set validates, so reach past it to prove diff() clamps too
  resetSettings();
  assert.equal(diff().id, DIFFICULTY[DEFAULT_DIFFICULTY].id);
});

test('award() scales points by difficulty and keeps the total exact', () => {
  for (let i = 0; i < DIFFICULTY.length; i++) {
    setSetting('difficulty', i);
    const game = { score: 0 };
    let expected = 0;
    for (const n of [25, 300, 2500, 6000, 137]) expected += award(game, n);
    assert.equal(game.score, expected, 'the running total is not the sum of what was awarded');
    assert.ok(Number.isInteger(game.score), `score went fractional on ${DIFFICULTY[i].id}`);
  }
});

test('a harder setting pays strictly more for the same kill', () => {
  const paid = DIFFICULTY.map((_, i) => {
    setSetting('difficulty', i);
    const game = { score: 0 };
    award(game, 6000);
    return game.score;
  });
  for (let i = 1; i < paid.length; i++) {
    assert.ok(paid[i] > paid[i - 1], `difficulty ${i} pays no more than ${i - 1} (${paid.join(', ')})`);
  }
});

// The reason score.js exists: every payout has to go through it, or a
// difficulty that pays more pays more at fifteen places and not the
// sixteenth. A bare `game.score +=` outside score.js is that bug.
test('nothing awards points behind award()', () => {
  const offenders = [];
  for (const f of fs.readdirSync(SRC)) {
    if (!f.endsWith('.js') || f === 'score.js') continue;
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\bscore\s*\+=/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    'these award points without the difficulty multiplier — use award() from score.js');
});
