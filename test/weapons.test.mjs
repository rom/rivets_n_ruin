import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, update } from '../src/game.js';
import { setSynthetic } from '../src/input.js';
import { MODS, ITEMS, rows, buy, purse, applyMods, modLevel } from '../src/shop.js';
import { spawnFoe, foes, resetFoes } from '../src/foes.js';
import { ordnance, fireSecondary, updateOrdnance } from '../src/armory.js';
import { playerShots } from '../src/projectiles.js';
import { DT, LEVELS, LANCE, REAR, ARMORY } from '../src/config.js';

// What the armourer sells, and the three weapons it did not sell before:
// a gun on the tail, a beam down the centreline, and mines to leave
// behind. Plus the two changes to how it sells anything — mods arrive as
// the campaign does, and the permanent systems cost gold bars.

function flying(hull = 20) {
  const game = makeGame();
  game.unlocked = LEVELS.length - 1;
  game.setStartHull(hull);
  for (let f = 0; f < 60 * 120 && game.state !== 'play'; f++) {
    const a = new Set();
    if (Math.floor(f / 15) % 2 === 0) a.add('start');
    setSynthetic(a);
    update(game, DT);
  }
  assert.equal(game.state, 'play', `never reached flight on hull ${hull + 1}`);
  setSynthetic(new Set());
  game.player.invuln = 1e9;
  game.spawnCd = 1e9;
  game.foeCd = 1e9;
  game.coins = 1e6;
  game.bars = 1000;
  return game;
}

test.afterEach(() => setSynthetic(null));

// --- mods arrive with the campaign

test('a mod is not on sale before its hull', () => {
  for (const [id, m] of Object.entries(MODS)) {
    const from = m.from || 0;
    if (from === 0) continue;
    const early = makeGame();
    early.levelIndex = from - 1;
    early.coins = 1e6;
    early.bars = 1000;
    assert.ok(!rows(early).some((r) => r.id === id),
      `${id} is on sale on hull ${from}, one before its own`);

    const onTime = makeGame();
    onTime.levelIndex = from;
    onTime.coins = 1e6;
    onTime.bars = 1000;
    assert.ok(rows(onTime).some((r) => r.id === id),
      `${id} is still not on sale on hull ${from + 1}, which is its own`);
  }
});

test('a mod cannot be bought before its hull even if the row is handed in', () => {
  const late = Object.entries(MODS).find(([, m]) => (m.from || 0) > 0);
  assert.ok(late, 'no mod is gated at all');
  const [id, m] = late;

  const ready = makeGame();
  ready.levelIndex = m.from;
  ready.coins = 1e6;
  ready.bars = 1000;
  const row = rows(ready).find((r) => r.id === id);

  const early = makeGame();
  early.levelIndex = 0;
  early.coins = 1e6;
  early.bars = 1000;
  assert.equal(buy(early, row), null, `${id} was bought on the first hull`);
  assert.equal(modLevel(early, id), 0);
});

test('the first hull still has something to sell', () => {
  const game = makeGame();
  game.levelIndex = 0;
  game.coins = 1e6;
  const offered = rows(game).filter((r) => r.available);
  assert.ok(offered.length >= 4,
    `only ${offered.length} rows on the first hull; the armourer is empty`);
  assert.ok(offered.some((r) => r.kind === 'mod'),
    'no mod at all is available on the first hull');
});

// --- gold bars are a currency

test('a bar-priced mod spends bars and leaves coins alone', () => {
  const game = flying(20);
  const row = rows(game).find((r) => r.currency === 'bars');
  assert.ok(row, 'nothing is priced in bars');
  const coins = game.coins;
  const bars = game.bars;
  assert.ok(buy(game, row), `could not buy ${row.id}`);
  assert.equal(game.coins, coins, 'a bar price was paid in coins');
  assert.equal(game.bars, bars - row.cost, 'the bars were not spent');
});

test('bars you do not have cannot be spent', () => {
  const game = flying(20);
  game.bars = 0;
  const row = rows(game).find((r) => r.currency === 'bars');
  assert.equal(row.affordable, false, 'a bar row is affordable with no bars');
  assert.equal(buy(game, row), null, 'bought a bar-priced mod with no bars');
  assert.ok(game.bars >= 0, `bars went to ${game.bars}`);
});

test('coins cannot pay a bar price and the reverse', () => {
  const game = flying(20);
  game.coins = 1e6;
  game.bars = 0;
  for (const r of rows(game)) {
    if (r.currency === 'bars') {
      assert.equal(r.affordable, false,
        `${r.id} is affordable on coins alone despite a bar price`);
    }
  }
  assert.equal(purse(game, 'bars'), 0);
  assert.equal(purse(game, 'coins'), 1e6);
});

test('every mod states a currency the shop understands', () => {
  for (const [id, m] of Object.entries(MODS)) {
    const c = m.currency || 'coins';
    assert.ok(c === 'coins' || c === 'bars', `${id} is priced in "${c}"`);
    for (const t of m.tiers) {
      assert.ok(Number.isFinite(t.cost) && t.cost > 0, `${id} has a tier costing ${t.cost}`);
      // A bar price in the thousands would be a coin price that forgot to
      // change, and would read as unbuyable rather than as a mistake.
      if (c === 'bars') assert.ok(t.cost < 100, `${id} costs ${t.cost} bars`);
    }
  }
});

// --- the rear battery

test('the rear battery fires backwards, and only at something behind', () => {
  const game = flying(20);
  game.mods = { rear: 1 };
  applyMods(game);
  assert.ok(game.player.rearGun, 'REAR BATTERY did not fit');

  resetFoes();
  playerShots.clear();
  for (let f = 0; f < 240; f++) update(game, DT);
  const idle = playerShots.count;
  assert.equal(idle, 0, `the tail gun fired ${idle} rounds at an empty corridor`);

  const behind = spawnFoe(game, 'weaver');
  behind.hp = 9999; behind.shield = 0; behind.shieldMax = 0;
  let backwards = 0;
  for (let f = 0; f < 480 && !backwards; f++) {
    // Pinned behind the ship: a weaver flies, and a test of the tail gun
    // should not also be a test of where the weaver chose to go.
    behind.x = game.player.x - game.player.facing * 120;
    behind.baseY = game.player.y;
    behind.y = game.player.y;
    behind.dead = false;
    update(game, DT);
    for (let k = 0; k < playerShots.count; k++) {
      if (Math.sign(playerShots.items[k].vx) === -game.player.facing) backwards++;
    }
  }
  assert.ok(backwards > 0, 'nothing was fired at the thing behind the ship');
});

// --- the spinal lance

test('the lance fires on its own cycle', () => {
  const game = flying(20);
  game.mods = { lance: 1 };
  applyMods(game);
  let beams = 0;
  let wasOut = false;
  const seconds = LANCE.cycle[0] * 3;
  for (let f = 0; f < 120 * seconds; f++) {
    update(game, DT);
    const out = game.player.lanceFire > 0;
    if (out && !wasOut) beams++;
    wasOut = out;
  }
  assert.ok(beams >= 2, `only ${beams} beams in ${seconds.toFixed(1)}s at a `
    + `${LANCE.cycle[0]}s cycle`);
  assert.ok(beams <= 5, `${beams} beams is faster than the stated cycle`);
});

test('the lance damages what is in the line, once per firing', () => {
  const game = flying(20);
  game.mods = { lance: 1 };
  applyMods(game);
  resetFoes();
  const v = spawnFoe(game, 'weaver');
  v.hp = 100000; v.shield = 0; v.shieldMax = 0;
  const hp0 = v.hp;

  let beams = 0;
  let wasOut = false;
  for (let f = 0; f < 120 * LANCE.cycle[0] * 2.5; f++) {
    v.x = game.player.x + game.player.facing * 200;
    v.baseY = game.player.y; v.y = game.player.y; v.dead = false;
    v.shield = 0;
    update(game, DT);
    const out = game.player.lanceFire > 0;
    if (out && !wasOut) beams++;
    wasOut = out;
  }
  const dealt = hp0 - v.hp;
  assert.ok(beams >= 1, 'the lance never fired');
  assert.ok(dealt > 0, `${beams} beams dealt nothing`);

  // Once per firing, not once per frame. The beam dwells for a fifth of a
  // second, which at 120Hz is twenty-six frames of contact, so billing
  // per frame would show up here as a number twenty-six times too large.
  //
  // A multiple of the per-hit damage, and never more than one hit per
  // beam. Not exactly one each: the target is a weaver, updateFoes moves
  // it inside the same frame the beam fires, and it can genuinely have
  // woven out of the line — which is the lance working, not failing. The
  // first version of this test asserted one hit per beam and caught the
  // weaver 16px off the centreline.
  assert.equal(dealt % LANCE.damage[0], 0,
    `${dealt} damage is not a whole number of ${LANCE.damage[0]}-point hits, `
    + 'so the beam is being billed per frame');
  assert.ok(dealt <= beams * LANCE.damage[0],
    `${beams} beams dealt ${dealt}, more than one hit each`);
});

// The strict version of the above, against something that cannot dodge.
test('the lance hits a stationary target exactly once per firing', () => {
  const game = flying(20);
  game.mods = { lance: 1 };
  applyMods(game);
  resetFoes();

  // A mine creeps rather than weaves, and at zero speed it simply sits.
  const v = spawnFoe(game, 'mine');
  v.hp = 100000; v.shield = 0; v.shieldMax = 0;
  const hp0 = v.hp;
  let beams = 0;
  let wasOut = false;
  for (let f = 0; f < 120 * LANCE.cycle[0] * 2.5; f++) {
    v.x = game.player.x + game.player.facing * 200;
    v.baseY = game.player.y;
    v.y = game.player.y;
    v.dead = false;
    v.shield = 0;
    update(game, DT);
    // Re-pin after the simulation has had its turn, so the beam, which
    // is resolved later in the same frame, sees it on the line.
    v.x = game.player.x + game.player.facing * 200;
    v.y = game.player.y;
    const out = game.player.lanceFire > 0;
    if (out && !wasOut) beams++;
    wasOut = out;
  }
  assert.ok(beams >= 1, 'the lance never fired');
  assert.equal(hp0 - v.hp, beams * LANCE.damage[0],
    `${beams} beams dealt ${hp0 - v.hp}; one hit each is ${beams * LANCE.damage[0]}`);
});

test('the lance does not reach behind the ship', () => {
  const game = flying(20);
  game.mods = { lance: 1 };
  applyMods(game);
  resetFoes();
  const v = spawnFoe(game, 'weaver');
  v.hp = 100000; v.shield = 0; v.shieldMax = 0;
  const hp0 = v.hp;
  for (let f = 0; f < 120 * LANCE.cycle[0] * 2.5; f++) {
    v.x = game.player.x - game.player.facing * 200;   // behind
    v.baseY = game.player.y; v.y = game.player.y; v.dead = false;
    update(game, DT);
  }
  assert.equal(v.hp, hp0, 'the lance hit something behind the ship');
});

// --- spike mines

test('a mine is dropped where you are and arms after a moment', () => {
  const game = flying(20);
  const p = game.player;
  p.ammo.mine = 3;
  p.secondary = 'mine';
  p.secondaryCd = 0;
  ordnance.clear();

  assert.ok(fireSecondary(game), 'the mine would not drop');
  assert.equal(ordnance.count, 1);
  const m = ordnance.items[0];
  assert.ok(Math.abs(m.x - p.x) < 40, `the mine was placed ${m.x - p.x}px away`);
  assert.equal(p.ammo.mine, 2, 'dropping a mine did not spend one');

  assert.ok((m.armed || 0) < ARMORY.mine.arm, 'the mine armed instantly');
  for (let f = 0; f < 120 * ARMORY.mine.arm + 10; f++) updateOrdnance(game, DT);
  assert.ok((m.armed || 0) >= ARMORY.mine.arm, 'the mine never armed');
});

test('an armed mine goes off when something touches it', () => {
  const game = flying(20);
  const p = game.player;
  p.ammo.mine = 3;
  p.secondary = 'mine';
  p.secondaryCd = 0;
  ordnance.clear();
  resetFoes();
  fireSecondary(game);
  const m = ordnance.items[0];
  for (let f = 0; f < 120; f++) update(game, DT);     // arm it
  assert.equal(ordnance.count, 1, 'the mine went off on its own');

  const v = spawnFoe(game, 'weaver');
  v.hp = 9999; v.shield = 0; v.shieldMax = 0;
  const hp0 = v.hp;
  for (let f = 0; f < 240 && ordnance.count; f++) {
    v.x = m.x; v.baseY = m.y; v.y = m.y; v.dead = false;
    update(game, DT);
  }
  assert.equal(ordnance.count, 0, 'the mine did not go off on contact');
  assert.ok(hp0 - v.hp > 0, 'the mine went off and hurt nothing');
});

test('a mine does not sit on the hull forever', () => {
  const game = flying(20);
  const p = game.player;
  p.ammo.mine = 3;
  p.secondary = 'mine';
  p.secondaryCd = 0;
  ordnance.clear();
  resetFoes();
  fireSecondary(game);
  // Hold the camera on it, so this measures the fuse and not the cull.
  // The loop bound is a fixed wall rather than ARMORY.mine.life: bounding
  // it by the very number under test means a life of 99999 is never
  // actually waited out, and the test passes by not looking.
  const held = ordnance.items[0];
  const WALL = 60;                     // seconds, far past any sane fuse
  let alive = 0;
  for (let f = 0; f < 120 * WALL && ordnance.count; f++) {
    game.cam.x = held.x - 300;
    updateOrdnance(game, DT);
    alive += DT;
  }
  assert.equal(ordnance.count, 0,
    `a mine was still live after ${alive.toFixed(0)}s`);
  assert.ok(alive <= ARMORY.mine.life + 2,
    `the mine lasted ${alive.toFixed(1)}s; its stated life is ${ARMORY.mine.life}s`);
  assert.ok(alive > ARMORY.mine.life - 2,
    `the mine went out after ${alive.toFixed(1)}s, well short of its ${ARMORY.mine.life}s life`);
});

test('mines are on sale, and capped like the rest of the armory', () => {
  const game = flying(20);
  const row = rows(game).find((r) => r.id === 'mine');
  assert.ok(row, 'mines are not on sale');
  const p = game.player;
  p.ammo.mine = 0;
  for (let i = 0; i < 40; i++) {
    const r = rows(game).find((x) => x.id === 'mine');
    if (!r || !r.available) break;
    buy(game, r);
  }
  assert.equal(p.ammo.mine, ARMORY.mine.maxAmmo,
    `bought up to ${p.ammo.mine} mines, the cap is ${ARMORY.mine.maxAmmo}`);
  const full = rows(game).find((r) => r.id === 'mine');
  assert.ok(!full.available, 'mines are still on sale at the cap');
});

test('every ordnance kind has a shop row and a slot in the ammo', () => {
  const game = flying(20);
  for (const kind of ARMORY.order) {
    assert.ok(ITEMS.some((i) => i.id === kind), `${kind} cannot be bought`);
    assert.equal(typeof game.player.ammo[kind], 'number',
      `the player has no ammo slot for ${kind}`);
  }
});
