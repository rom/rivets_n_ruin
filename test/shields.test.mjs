import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEC, SHIELD, shieldChanceFor, foes, resetFoes, spawnFoe, hitFoe,
} from '../src/foes.js';
import { LEVELS, PICKUP } from '../src/config.js';
import { resetPickups, pickups } from '../src/pickups.js';
import { spoils } from '../src/pickups.js';

function fakeGame(levelIndex = 0) {
  return {
    levelIndex, score: 0, flash: 0,
    cam: { x: 0, shake: 0 },
    level: {
      length: LEVELS[levelIndex].length, spec: LEVELS[levelIndex], turrets: [],
      obstacles: [], buckets: new Map(), chunks: new Map(), chunkGen: -1, tick: 0,
    },
    player: { x: 0, y: 160, facing: 1, alive: true, invuln: 99, shield: 200 },
  };
}

test.beforeEach(() => { resetFoes(); resetPickups(); });

test('the shield is configured for kinds that exist', () => {
  for (const k of SHIELD.kinds) assert.ok(SPEC[k], `SHIELD lists unknown kind "${k}"`);
  assert.ok(SHIELD.hp > 0 && SHIELD.r > 0);
  assert.ok(SHIELD.fromLevel >= 1, 'the first hull should not field shields');
});

test('shields arrive partway through the campaign and get commoner', () => {
  const chances = LEVELS.map((_, i) => shieldChanceFor(i));
  for (let i = 0; i < SHIELD.fromLevel; i++) {
    assert.equal(chances[i], 0, `hull ${i} fields shields before they are introduced`);
  }
  assert.ok(chances[SHIELD.fromLevel] > 0, 'they never start');
  for (let i = SHIELD.fromLevel + 1; i < chances.length; i++) {
    assert.ok(chances[i] >= chances[i - 1], `hull ${i} is less likely than hull ${i - 1}`);
  }
  assert.ok(chances[chances.length - 1] <= 0.8,
    'nearly every attacker on the last hull is shielded, which is a different game');
});

test('only the listed kinds ever carry one', () => {
  const game = fakeGame(LEVELS.length - 1);
  const shielded = new Set();
  for (let i = 0; i < 3000; i++) {
    resetFoes();
    for (const k of Object.keys(SPEC)) {
      const f = spawnFoe(game, k);
      if (f && f.shield > 0) shielded.add(k);
      resetFoes();
    }
  }
  for (const k of shielded) {
    assert.ok(SHIELD.kinds.includes(k), `${k} grew a shield it is not meant to have`);
  }
  assert.ok(shielded.size > 0, 'nothing is ever shielded on the last hull');
});

test('a shield absorbs its own health, then lets damage through', () => {
  const game = fakeGame(LEVELS.length - 1);
  const f = spawnFoe(game, 'orbiter');
  f.shieldMax = 10;
  f.shield = 10;
  f.hp = 4;

  // four hits of two: all into the shield
  for (let i = 0; i < 4; i++) assert.equal(hitFoe(game, 0, f.x, f.y, 2), true);
  assert.equal(f.shield, 2, `shield is ${f.shield}`);
  assert.equal(f.hp, 4, 'damage reached the hull through a live shield');

  // a hit bigger than what is left carries the remainder through
  hitFoe(game, 0, f.x, f.y, 3);
  assert.equal(f.shield, 0);
  assert.equal(f.hp, 3, `overkill was swallowed: hp is ${f.hp}`);
});

test('a shielded attacker cannot be killed until the shield is gone', () => {
  const game = fakeGame(LEVELS.length - 1);
  const f = spawnFoe(game, 'bomber');
  f.shieldMax = 12; f.shield = 12; f.hp = 3;
  // one shot smaller than the shield can never finish it, however many
  for (let i = 0; i < 11; i++) hitFoe(game, 0, f.x, f.y, 1);
  assert.equal(foes.count, 1, 'it died with a shield still up');
  assert.equal(f.shield, 1);
  for (let i = 0; i < 20 && foes.count; i++) hitFoe(game, 0, f.x, f.y, 1);
  assert.equal(foes.count, 0, 'it survived once the shield was down');
});

test('an unshielded attacker is unaffected', () => {
  const game = fakeGame(0);
  const f = spawnFoe(game, 'weaver');
  assert.equal(f.shield, 0, 'the first hull fielded a shield');
  const hp = f.hp;
  hitFoe(game, 0, f.x, f.y, 1);
  assert.equal(f.hp, hp - 1);
});

test('a reused pool slot does not inherit the last attacker\'s shield', () => {
  const late = fakeGame(LEVELS.length - 1);
  for (let i = 0; i < 200; i++) { resetFoes(); spawnFoe(late, 'orbiter'); }
  resetFoes();
  const early = fakeGame(0);
  for (let i = 0; i < 50; i++) {
    resetFoes();
    const f = spawnFoe(early, 'orbiter');
    assert.equal(f.shield, 0, 'a first-hull attacker spawned with a stale shield');
    assert.equal(f.shieldMax, 0);
  }
});

// --- the hold

test('a boss always sheds bars and coffins, not sometimes', () => {
  for (let run = 0; run < 25; run++) {
    resetPickups();
    const game = fakeGame(3);
    spoils(game, 3000, 160, 'boss');
    const bars = countKind('goldbar');
    const coffins = countKind('coffin');
    assert.ok(bars >= PICKUP.bossBars[0], `a boss shed ${bars} bars`);
    assert.ok(coffins >= PICKUP.bossCoffins[0], `a boss shed ${coffins} coffins`);
  }
});

test('a miniboss sheds a hold too, a smaller one', () => {
  let miniBars = 0;
  let bossBars = 0;
  for (let run = 0; run < 25; run++) {
    resetPickups();
    spoils(fakeGame(3), 3000, 160, 'mini');
    miniBars += countKind('goldbar');
    assert.ok(countKind('coffin') >= PICKUP.miniCoffins[0], 'a miniboss shed no coffin');
    resetPickups();
    spoils(fakeGame(3), 3000, 160, 'boss');
    bossBars += countKind('goldbar');
  }
  assert.ok(bossBars > miniBars, `boss ${bossBars} vs miniboss ${miniBars} bars`);
});

test('an ordinary kill does not shed a hold', () => {
  let bars = 0;
  for (let run = 0; run < 60; run++) {
    resetPickups();
    spoils(fakeGame(3), 3000, 160, 'turret');
    bars += countKind('goldbar');
  }
  assert.ok(bars < 60 * PICKUP.bossBars[0],
    'turrets are shedding boss-sized holds');
});

function countKind(kind) {
  let n = 0;
  for (let i = 0; i < pickups.count; i++) if (pickups.items[i].kind === kind) n++;
  return n;
}
