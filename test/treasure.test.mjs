import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickups, resetPickups, spawnPickup, spoils, tint, isTreasure,
  TREASURES, LOOT, KINDS, rollTreasure, freshHaul,
} from '../src/pickups.js';
import { PICKUP, LEVELS, HULL_BONUS, DIFFICULTY } from '../src/config.js';
import { set as setSetting, reset as resetSettings } from '../src/settings.js';

function fakeGame(levelIndex = 0) {
  return {
    levelIndex,
    score: 0,
    coins: 0,
    haul: freshHaul(),
    hullHaul: freshHaul(),
    level: {
      length: LEVELS[levelIndex].length, spec: LEVELS[levelIndex], turrets: [],
      obstacles: [], buckets: new Map(), chunks: new Map(), chunkGen: -1, tick: 0,
    },
    player: { x: 0, y: 160, alive: true, invuln: 99, shield: 100, coinMul: 1 },
  };
}

test.beforeEach(() => { resetPickups(); resetSettings(); });

test('the treasure tiers are ordered, and rarer the better they pay', () => {
  const tiers = TREASURES.map((k) => PICKUP.treasure[k]);
  assert.ok(tiers.length >= 3, `only ${tiers.length} treasures`);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i].value > tiers[i - 1].value,
      `${TREASURES[i]} is worth no more than ${TREASURES[i - 1]}`);
    assert.ok(tiers[i].coins > tiers[i - 1].coins,
      `${TREASURES[i]} buys no more than ${TREASURES[i - 1]}`);
    assert.ok(tiers[i].weight < tiers[i - 1].weight,
      `${TREASURES[i]} is no rarer than ${TREASURES[i - 1]} despite paying more`);
  }
  for (const [k, t] of Object.entries(PICKUP.treasure)) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(t.colour), `${k}: "${t.colour}" is not a hex colour`);
    assert.ok(t.label && t.label.length <= 14, `${k}: label too long for the toast`);
    assert.ok(t.life > 8, `${k}: ${t.life}s is not long enough to fly back for`);
    assert.equal(tint(k), t.colour);
  }
  // the top tier must be worth more than a coffin, or there is no new top
  const best = tiers[tiers.length - 1];
  assert.ok(best.value > PICKUP.coffinValue,
    `the best treasure pays ${best.value}, a coffin pays ${PICKUP.coffinValue}`);
});

test('every treasure is a known pickup kind, and counts as loot', () => {
  for (const k of TREASURES) {
    assert.ok(KINDS.includes(k), `${k} is not in KINDS and will never be drawn`);
    assert.ok(LOOT.has(k), `${k} is not loot and so will not be magnetised`);
    assert.ok(isTreasure(k));
  }
  for (const k of ['shield', 'life', 'gunspeed']) {
    assert.ok(!isTreasure(k), `${k} should not be treasure`);
    assert.ok(!LOOT.has(k), `${k} should not be loot`);
  }
  for (const k of ['coin', 'goldbar', 'coffin']) assert.ok(LOOT.has(k));
});

test('rollTreasure only ever returns a real treasure', () => {
  const seen = new Set();
  for (let i = 0; i < 4000; i++) {
    const k = rollTreasure();
    assert.ok(PICKUP.treasure[k], `rolled "${k}"`);
    seen.add(k);
  }
  assert.equal(seen.size, TREASURES.length, 'some tier is unreachable: ' + [...seen].join(','));
});

test('a treasure that is spawned is collectable and keeps its own lifetime', () => {
  const game = fakeGame(0);
  for (const k of TREASURES) {
    resetPickups();
    const p = spawnPickup(game, 500, 160, k);
    assert.ok(p, `${k} would not spawn`);
    assert.equal(p.kind, k);
    assert.equal(p.life, PICKUP.treasure[k].life, `${k} got the wrong lifetime`);
  }
});

test('a later hull drops treasure more often, and a boss drops it far more', () => {
  const odds = (i) => PICKUP.treasureChance + PICKUP.treasureHullBonus * i;
  assert.ok(odds(LEVELS.length - 1) > odds(0) * 1.5, 'the late game is no richer than the first hull');
  assert.ok(odds(LEVELS.length - 1) < 0.25, 'treasure on the last hull is no longer rare');
  assert.ok(PICKUP.treasureFromBoss >= 3, 'a boss rolls too few times to be worth the wreck');
});

// Statistical, with a wide margin: this is about the odds being wired up at
// all, not about the exact number.
test('spoils actually produces treasure, and only rarely', () => {
  const game = fakeGame(LEVELS.length - 1);
  let found = 0;
  const RUNS = 3000;
  for (let i = 0; i < RUNS; i++) {
    resetPickups();
    spoils(game, 2000, 160, 'turret');
    for (let j = 0; j < pickups.count; j++) {
      if (isTreasure(pickups.items[j].kind)) { found++; break; }
    }
  }
  const rate = found / RUNS;
  assert.ok(rate > 0.01, `treasure never dropped in ${RUNS} kills (rate ${rate})`);
  assert.ok(rate < 0.25, `treasure dropped on ${(rate * 100).toFixed(0)}% of kills — not treasure`);
});

test('the hull bonus pays on all three things, and the sweep is separate', () => {
  const guns = (n, deadCount) => Array.from({ length: n }, (_, i) => ({ dead: i < deadCount }));
  const base = () => ({
    level: { turrets: guns(10, 5) },
    hullHaul: { coins: 100, bars: 1, coffins: 0, treasures: 0, value: 5000 },
    player: { lives: 2 },
    deathsThisHull: 1,
  });
  // imported lazily: game.js pulls in the whole world
  return import('../src/game.js').then(({ hullBonus }) => {
    const b = hullBonus(base());
    const id = (k) => b.lines.find((l) => l.id === k);
    assert.equal(id('guns').points, Math.round(HULL_BONUS.towers * 0.5));
    assert.equal(id('ships').points, HULL_BONUS.perLife * 2);
    assert.equal(id('haul').points, Math.round(5000 * HULL_BONUS.haulPct));
    assert.ok(!id('sweep'), 'half the guns should not earn a full sweep');
    assert.ok(!id('intact'), 'a lost ship should not earn a clean hull');
    assert.equal(b.total, b.lines.reduce((a, l) => a + l.points, 0));

    const g2 = base();
    g2.level.turrets = guns(10, 10);
    g2.deathsThisHull = 0;
    const b2 = hullBonus(g2);
    assert.ok(b2.lines.find((l) => l.id === 'sweep'), 'every gun broken earned nothing extra');
    assert.ok(b2.lines.find((l) => l.id === 'intact'), 'a clean hull earned nothing extra');
    assert.ok(b2.total > b.total);

    // a hull with no guns on it at all must not divide by zero
    const g3 = base();
    g3.level.turrets = [];
    const b3 = hullBonus(g3);
    assert.ok(Number.isFinite(b3.total), 'a gunless hull produced ' + b3.total);
    assert.equal(b3.lines.find((l) => l.id === 'guns').points, 0);
    assert.ok(!b3.lines.find((l) => l.id === 'sweep'), 'swept a hull with nothing on it');
  });
});

test('the bonus is itemised, not just totalled', () => {
  return import('../src/game.js').then(({ hullBonus }) => {
    const b = hullBonus({
      level: { turrets: [{ dead: true }, { dead: false }] },
      hullHaul: { coins: 7, bars: 0, coffins: 0, treasures: 2, value: 1800 },
      player: { lives: 1 },
      deathsThisHull: 0,
    });
    for (const line of b.lines) {
      assert.ok(line.label && line.detail !== undefined, 'a bonus line with nothing to read');
      assert.ok(Number.isInteger(line.points), `${line.label} paid ${line.points}`);
      assert.ok(line.label.length <= 18, `${line.label} is too long for the column`);
    }
    assert.ok(b.lines.find((l) => l.id === 'haul').detail.includes('2 TREASURES'),
      'the haul line does not name the treasure: ' + b.lines.find((l) => l.id === 'haul').detail);
  });
});
