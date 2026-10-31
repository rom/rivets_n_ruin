import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadHangar, saveHangar, clearHangar, sanitise, freshHangar,
  MAX_COINS, MAX_MOD_LEVEL,
} from '../src/hangar.js';
import { MODS, resetShop, applyMods, modLevel } from '../src/shop.js';

const KEY = 'rnr.hangar';
const MOD_IDS = Object.keys(MODS);

function wipe() { localStorage.removeItem(KEY); }

// --- what survives a closed tab

test('nothing is remembered before anything is banked', () => {
  wipe();
  assert.deepEqual(loadHangar(), freshHangar());
});

test('coins and mods come back exactly as they were banked', () => {
  wipe();
  saveHangar({ coins: 4210, mods: { scavenger: 2, afterburner: 1 } });
  const back = loadHangar(MOD_IDS);
  assert.equal(back.coins, 4210);
  assert.deepEqual(back.mods, { scavenger: 2, afterburner: 1 });
});

test('clearing the hangar really clears it', () => {
  saveHangar({ coins: 9000, mods: { scavenger: 3 } });
  clearHangar();
  assert.deepEqual(loadHangar(MOD_IDS), freshHangar());
});

// Clearing storage alone does not hold: the game saves again when the tab
// closes, so a wipe that left the live coins and mods in place was written
// straight back. Found by doing exactly that in a browser.
test('a wipe survives the save that happens when the tab closes', () => {
  const game = { coins: 7000, mods: { scavenger: 2 } };
  saveHangar(game);
  clearHangar(game);
  assert.equal(game.coins, 0, 'the live coins survived the wipe');
  assert.deepEqual(game.mods, {}, 'the live mods survived the wipe');

  saveHangar(game);                      // what pagehide would do
  assert.deepEqual(loadHangar(MOD_IDS), freshHangar(),
    'closing the tab after a wipe brought everything back');
});

test('a later save replaces an earlier one rather than merging', () => {
  wipe();
  saveHangar({ coins: 500, mods: { scavenger: 3, magnet: 1 } });
  saveHangar({ coins: 20, mods: { scavenger: 1 } });
  const back = loadHangar(MOD_IDS);
  assert.equal(back.coins, 20);
  assert.deepEqual(back.mods, { scavenger: 1 },
    'a mod sold or lost would come back from an older save');
});

// --- storage is player-editable, so none of it is trusted

test('a hand-edited hangar cannot put the game into a state it cannot render', () => {
  const nonsense = [
    null, undefined, 42, 'hello', [],
    { coins: -5000 },
    { coins: NaN },
    { coins: 'lots' },
    { coins: Infinity },
    { coins: 1e30 },
    { mods: null },
    { mods: 'all of them' },
    { mods: { scavenger: -3 } },
    { mods: { scavenger: 'max' } },
    { mods: { scavenger: Infinity } },
    { mods: { scavenger: 0 } },
  ];
  for (const raw of nonsense) {
    const h = sanitise(raw, MOD_IDS);
    assert.ok(Number.isInteger(h.coins), `${JSON.stringify(raw)} -> coins ${h.coins}`);
    assert.ok(h.coins >= 0 && h.coins <= MAX_COINS, `${JSON.stringify(raw)} -> coins ${h.coins}`);
    for (const [id, lvl] of Object.entries(h.mods)) {
      assert.ok(MOD_IDS.includes(id), `survived an unknown mod "${id}"`);
      assert.ok(Number.isInteger(lvl) && lvl >= 1 && lvl <= MAX_MOD_LEVEL,
        `${id} came back at level ${lvl}`);
    }
  }
});

test('a mod that no longer exists is dropped, not carried', () => {
  // Renaming a mod id is a thing that has already happened once in this
  // codebase: the TRACTOR COILS upgrade and the LODESTONE mod both used
  // "magnet" until one was renamed. A stale id must not come back.
  const h = sanitise({ coins: 10, mods: { scavenger: 1, wormhole_drive: 4 } }, MOD_IDS);
  assert.deepEqual(h.mods, { scavenger: 1 });
});

test('unparseable storage is an empty hangar, not a crash', () => {
  localStorage.setItem(KEY, '{not json at all');
  assert.deepEqual(loadHangar(MOD_IDS), freshHangar());
  localStorage.setItem(KEY, 'null');
  assert.deepEqual(loadHangar(MOD_IDS), freshHangar());
  wipe();
});

test('a save from a future version is not half-read', () => {
  localStorage.setItem(KEY, JSON.stringify({ version: 999, coins: 1e6, mods: { scavenger: 9 } }));
  assert.deepEqual(loadHangar(MOD_IDS), freshHangar(),
    'a newer save format was read as if this build understood it');
  wipe();
});

test('storage being unavailable never stops the game', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('private mode'); },
    setItem() { throw new Error('private mode'); },
    removeItem() { throw new Error('private mode'); },
  };
  try {
    assert.deepEqual(loadHangar(MOD_IDS), freshHangar());
    assert.doesNotThrow(() => saveHangar({ coins: 1, mods: {} }));
    assert.doesNotThrow(() => clearHangar());
  } finally {
    globalThis.localStorage = real;
  }
});

// --- the line between the hangar and the run

test('the run loadout is not banked', () => {
  wipe();
  // `bought` is the ITEMS tally — gun levels and the like. Those are the
  // run's, already forfeit on death, and persisting them would hand a
  // fresh run a maxed ship.
  saveHangar({ coins: 100, mods: { scavenger: 1 }, bought: { gunspeed: 3 } });
  const raw = JSON.parse(localStorage.getItem(KEY));
  assert.equal(raw.bought, undefined, 'the run loadout was written to the hangar');
  assert.deepEqual(Object.keys(loadHangar(MOD_IDS).mods), ['scavenger']);
});

test('a banked mod is in force again after a relaunch, not merely remembered', () => {
  wipe();
  const game = {
    coins: 3000,
    mods: { scavenger: 3, magnet: 2 },
    bought: { gunspeed: 2 },
    player: { magnetLevel: 0, maxVXBonus: 0, accelMul: 1, gunCapBase: 3, gunCap: 3 },
  };
  saveHangar(game);

  // A fresh launch: the loadout resets, the hangar is read back in.
  const next = {
    coins: 0, mods: {}, bought: { gunspeed: 2 },
    player: { magnetLevel: 0, maxVXBonus: 0, accelMul: 1, gunCapBase: 3, gunCap: 3 },
  };
  const owned = loadHangar(MOD_IDS);
  next.coins = owned.coins;
  next.mods = owned.mods;
  resetShop(next);
  applyMods(next);

  assert.equal(next.coins, 3000, 'banked coins did not survive the relaunch');
  assert.equal(modLevel(next, 'scavenger'), 3);
  assert.deepEqual(next.bought, {}, 'the previous run\'s loadout came back with it');
  assert.ok(next.player.coinMul > 1, 'the mod is remembered but not doing anything');
});
