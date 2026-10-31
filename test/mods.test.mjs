import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODS, ITEMS, rows, buy, applyMods, resetShop, modLevel, modName, maxLevel,
} from '../src/shop.js';
import { PICKUP } from '../src/config.js';

function fakeGame(coins = 100000) {
  const game = {
    coins,
    mods: {},
    bought: {},
    player: {
      magnetLevel: 0, maxVXBonus: 0, accelMul: 1, lives: 3,
      gunSpeed: 1, gunBlaze: 1, gunCap: 3, shieldMax: 120,
      ammo: { bomb: 0, grenade: 0, missile: 0 },
    },
  };
  applyMods(game);
  return game;
}

test('every mod declares at least one tier, priced and described', () => {
  for (const [id, m] of Object.entries(MODS)) {
    assert.ok(m.name, `${id} has no name`);
    assert.ok(Array.isArray(m.tiers) && m.tiers.length >= 1, `${id} has no tiers`);
    let last = 0;
    for (const [i, t] of m.tiers.entries()) {
      assert.ok(t.cost > last, `${id} tier ${i + 1} is not dearer than the one before`);
      last = t.cost;
      assert.ok(t.blurb && t.blurb.length > 10, `${id} tier ${i + 1} does not say what it does`);
    }
  }
});

test('the two tiered mods go up to three, and each tier does more', () => {
  for (const id of ['magnet', 'scavenger']) {
    const m = MODS[id];
    assert.equal(m.tiers.length, 3, `${id} should have three tiers`);
    for (let i = 1; i < m.tiers.length; i++) {
      assert.ok(m.tiers[i].mul > m.tiers[i - 1].mul,
        `${id} tier ${i + 1} is no better than tier ${i}, only dearer`);
    }
  }
});

test('names carry their tier, and only when there is more than one', () => {
  assert.equal(modName('magnet', 1), 'LODESTONE I');
  assert.equal(modName('magnet', 3), 'LODESTONE III');
  assert.equal(modName('plating', 1), 'ABLATIVE PLATING');
});

test('no two shop rows share an id', () => {
  const game = fakeGame();
  const ids = rows(game).map((r) => r.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [],
    'two rows share an id, so looking one up by id returns the wrong thing');
});

test('a mod can be bought up to its last tier and no further', () => {
  const game = fakeGame();
  const top = maxLevel('magnet');
  for (let i = 1; i <= top; i++) {
    const row = rows(game).find((r) => r.kind === 'mod' && r.id === 'magnet');
    assert.ok(row, `tier ${i} was not offered`);
    assert.equal(row.cost, MODS.magnet.tiers[i - 1].cost, `tier ${i} is priced wrong`);
    assert.ok(buy(game, row), `tier ${i} would not buy`);
    assert.equal(modLevel(game, 'magnet'), i);
  }
  assert.ok(!rows(game).some((r) => r.kind === 'mod' && r.id === 'magnet'),
    'a fully fitted mod is still on sale');
});

test('each tier costs what it says and leaves the coins short', () => {
  const game = fakeGame(MODS.scavenger.tiers[0].cost);
  const row = rows(game).find((r) => r.id === 'scavenger');
  assert.ok(row.affordable);
  buy(game, row);
  assert.equal(game.coins, 0);
  const next = rows(game).find((r) => r.id === 'scavenger');
  assert.ok(next, 'the second tier was not offered');
  assert.ok(!next.affordable, 'the second tier is affordable on no coins');
  assert.equal(buy(game, next), null, 'it sold a tier that could not be paid for');
  assert.equal(modLevel(game, 'scavenger'), 1);
});

test('lodestone reach and scavenger worth both scale with the tier', () => {
  const reach = [];
  const worth = [];
  for (let lvl = 0; lvl <= 3; lvl++) {
    const game = fakeGame();
    if (lvl) game.mods = { magnet: lvl, scavenger: lvl };
    applyMods(game);
    reach.push(game.player.magnetMul);
    worth.push(game.player.coinMul);
  }
  for (let i = 1; i < reach.length; i++) {
    assert.ok(reach[i] > reach[i - 1], `lodestone ${i} reaches no further (${reach.join(', ')})`);
    assert.ok(worth[i] > worth[i - 1], `scavenger ${i} pays no more (${worth.join(', ')})`);
  }
  assert.equal(reach[0], 1, 'an unfitted lodestone still changes the reach');
  assert.equal(worth[0], 1, 'an unfitted scavenger still changes the worth');
});

test('tractor coils stack multiplicatively with lodestone', () => {
  const game = fakeGame();
  game.player.magnetLevel = PICKUP.magnetLevels.length - 1;
  game.mods = { magnet: 3 };
  applyMods(game);
  const coils = PICKUP.magnetLevels[PICKUP.magnetLevels.length - 1];
  assert.ok(Math.abs(game.player.magnetMul - coils * MODS.magnet.tiers[2].mul) < 1e-9,
    `got ${game.player.magnetMul}`);
});

// A save written before tiers existed holds `true`, not a number.
test('a mod stored as true reads as tier one', () => {
  const game = fakeGame();
  game.mods = { magnet: true, plating: true };
  applyMods(game);
  assert.equal(modLevel(game, 'magnet'), 1);
  assert.equal(game.player.magnetMul, MODS.magnet.tiers[0].mul);
  assert.equal(game.player.scrapeMul, 0.6);
  // and it can still be upgraded from there
  const row = rows(game).find((r) => r.id === 'magnet');
  assert.equal(row.cost, MODS.magnet.tiers[1].cost);
});

test('the single-tier mods still work and are offered once', () => {
  const game = fakeGame();
  for (const id of ['plating', 'autoloader', 'afterburner', 'reclaimer']) {
    const row = rows(game).find((r) => r.id === id);
    assert.ok(row, `${id} is not on sale`);
    buy(game, row);
    assert.equal(modLevel(game, id), 1);
    assert.ok(!rows(game).some((r) => r.id === id), `${id} is on sale twice`);
  }
  const p = game.player;
  assert.equal(p.scrapeMul, 0.6);
  assert.equal(p.reloadMul, 0.65);
  assert.equal(p.keepGunOnDeath, 1);
  assert.equal(p.maxVXBonus, 40);
});

test('resetShop clears every tier', () => {
  const game = fakeGame();
  game.mods = { magnet: 3, scavenger: 2 };
  applyMods(game);
  resetShop(game);
  assert.equal(modLevel(game, 'magnet'), 0);
  assert.equal(game.player.coinMul, 1);
  assert.equal(game.player.magnetMul, PICKUP.magnetLevels[0]);
});
