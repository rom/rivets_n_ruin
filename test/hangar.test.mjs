import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadHangar, saveHangar, clearHangar, sanitise, freshHangar,
  MAX_COINS, MAX_MOD_LEVEL, mergeHangars, applyHangar, setHangarSync,
} from '../src/hangar.js';
import { wipeProgress } from '../src/game.js';
import { forgetPlayer, netState } from '../src/net.js';
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

// --- the account copy
//
// Coins, bars and bought mods are the one piece of progress the game
// promises survives a lost ship, and they lived only in localStorage —
// so they did not survive a new browser, a cleared cache or a second
// machine, which is most of what an account is for.

test('merging never takes anything away from either copy', () => {
  const local = { coins: 500, bars: 2, mods: { reclaimer: 3, ablative: 1 } };
  const remote = { coins: 120, bars: 9, mods: { reclaimer: 1, spinal: 2 } };
  const m = mergeHangars(local, remote);
  assert.equal(m.coins, 500, 'the richer purse lost');
  assert.equal(m.bars, 9, 'the fuller vault lost');
  assert.deepEqual(m.mods, { reclaimer: 3, ablative: 1, spinal: 2 },
    'a mod bought on one machine went missing');
});

test('merging an empty side keeps the other side whole', () => {
  // The case that matters most: a fresh browser signing in to an
  // account that has things in it, and the reverse. Either direction
  // getting this wrong wipes a pilot's purchases.
  const full = { coins: 900, bars: 4, mods: { reclaimer: 2 } };
  assert.deepEqual(mergeHangars({}, full), { coins: 900, bars: 4, mods: { reclaimer: 2 } });
  assert.deepEqual(mergeHangars(full, {}), { coins: 900, bars: 4, mods: { reclaimer: 2 } });
  assert.deepEqual(mergeHangars(null, undefined), { coins: 0, bars: 0, mods: {} });
});

test('merging sanitises what it is handed', () => {
  // The remote side is a parsed HTTP body and the local side is
  // localStorage. Neither is trusted; both go through sanitise.
  const m = mergeHangars(
    { coins: -5, bars: 'nine', mods: { ok: 2, bad: -1, worse: 'x' } },
    { coins: 1e300, bars: 3, mods: { ok: 1e9 } },
  );
  assert.equal(m.coins, MAX_COINS, 'an absurd balance was not capped');
  assert.equal(m.bars, 3);
  assert.equal(m.mods.ok, MAX_MOD_LEVEL, 'an absurd mod level was not capped');
  assert.equal(m.mods.bad, undefined, 'a negative level was kept');
  assert.equal(m.mods.worse, undefined, 'a non-numeric level was kept');
});

test('applying a hangar puts it into the live game', () => {
  // Writing storage alone leaves the shop and the HUD reading the old
  // values until a reload, which is how a signed-in pilot sees their
  // own purchases appear one game later.
  const game = { coins: 1, bars: 1, mods: { old: 1 } };
  applyHangar(game, { coins: 300, bars: 7, mods: { reclaimer: 2 } });
  assert.equal(game.coins, 300);
  assert.equal(game.bars, 7);
  assert.deepEqual(game.mods, { reclaimer: 2 }, 'the stale mods survived');
});

test('the upload hook is called with what was saved, and cannot break a save', () => {
  const seen = [];
  setHangarSync((h) => { seen.push(h); return Promise.resolve(); });
  const game = { coins: 42, bars: 1, mods: { reclaimer: 1 } };
  saveHangar(game);
  assert.equal(seen.length, 1, 'the hangar was not uploaded');
  assert.equal(seen[0].coins, 42);

  // A shop purchase must not fail because the network did. Both the
  // throwing and the rejecting case, because they take different paths.
  setHangarSync(() => { throw new Error('offline'); });
  assert.doesNotThrow(() => saveHangar(game), 'a failed upload broke the save');
  setHangarSync(() => Promise.reject(new Error('offline')));
  assert.doesNotThrow(() => saveHangar(game), 'a rejected upload broke the save');
  setHangarSync(null);
});

// --- starting over
//
// The hangar wipe clears what you own. The full reset clears what you
// have achieved as well, and the pilot with it — because the account
// holds both the hangar and the best score, and syncBest only ever
// raises the local figure from the server's. A reset that kept the
// identity would watch the best score it had just cleared come back on
// the next sync.

test('wiping progress clears the records and nothing else', () => {
  localStorage.setItem('rnr.best', '123456');
  localStorage.setItem('rnr.unlocked', '7');
  localStorage.setItem('rnr.settings', '{"autofire":true}');
  localStorage.setItem('rnr.muted', '1');

  let startHull = 7;
  const game = { best: 123456, unlocked: 7, setStartHull: (n) => { startHull = n; } };
  wipeProgress(game);

  assert.equal(game.best, 0, 'the best score survived');
  assert.equal(game.unlocked, 0, 'the furthest hull survived');
  assert.equal(startHull, 0, 'the title screen still starts deep in the campaign');
  assert.equal(localStorage.getItem('rnr.best'), null);
  assert.equal(localStorage.getItem('rnr.unlocked'), null);

  // Preferences are not achievements. Wiping an accessibility setting
  // because somebody wanted a clean campaign would be its own bug.
  assert.equal(localStorage.getItem('rnr.settings'), '{"autofire":true}',
    'the reset took the settings with it');
  assert.equal(localStorage.getItem('rnr.muted'), '1', 'the reset took the mute flag');
});

test('forgetting the pilot leaves nothing to sync back', () => {
  localStorage.setItem('rnr.player', JSON.stringify({ id: 'p1', name: 'OLD', token: 't' }));
  // The account's best has to be put in hand first, or asserting it is
  // zero afterwards asserts nothing: it starts at zero. syncBest reads
  // exactly this field and only ever raises the local score from it,
  // so leaving it set is how a cleared best comes back.
  const S = netState();
  S.player = { id: 'p1', name: 'OLD', token: 't' };
  S.best = 4650367;
  forgetPlayer();
  assert.equal(localStorage.getItem('rnr.player'), null, 'the account is still stored');
  assert.equal(netState().player, null, 'the live state still holds the pilot');
  assert.equal(netState().best, 0, "the account's best score is still in hand");
});

test('a reset survives the save that follows it', () => {
  // clearHangar zeroes the live copies precisely so the pagehide save
  // cannot write them straight back. The same has to hold for the rest
  // of a reset, because every one of these is followed by a save.
  localStorage.setItem('rnr.best', '999');
  localStorage.setItem('rnr.unlocked', '5');
  const game = {
    coins: 900, bars: 4, mods: { reclaimer: 2 },
    best: 999, unlocked: 5, setStartHull: () => {},
  };
  clearHangar(game);
  wipeProgress(game);
  saveHangar(game);

  const back = loadHangar();
  assert.equal(back.coins, 0, 'the coins came back');
  assert.equal(back.bars, 0, 'the bars came back');
  assert.deepEqual(back.mods, {}, 'the mods came back');
  assert.equal(localStorage.getItem('rnr.best'), null, 'the best score came back');
});
