import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS, rosterFor, minis, resetMinis, planMinis, updateMinis, hitMinis, miniTargets,
  drawMinis, spawnMini,
} from '../src/miniboss.js';
import { LEVELS, DIFFICULTY, APRON, VIEW_W, FIELD_TOP, FIELD_BOT } from '../src/config.js';
import { enemyShots } from '../src/projectiles.js';
import { pickups, resetPickups } from '../src/pickups.js';
import { set as setSetting, reset as resetSettings } from '../src/settings.js';

function fakeGame(levelIndex = 0, overrides = {}) {
  const len = LEVELS[levelIndex].length;
  const g = {
    levelIndex,
    score: 0,
    flash: 0,
    state: 'play',
    boss: null,
    cam: { x: 0, shake: 0 },
    level: {
      length: len, spec: { ...LEVELS[levelIndex], foes: ['mine'] }, turrets: [],
      obstacles: [], buckets: new Map(), chunks: new Map(), chunkGen: -1, tick: 0,
    },
    player: { x: 0, y: 160, alive: true, invuln: 99, shield: 100, vx: 0, vy: 0 },
    escorts: 0,
    arrivals: [],
    ...overrides,
  };
  g.miniPlan = planMinis(g.level, levelIndex);
  g.onMiniArrive = (name) => g.arrivals.push(name);
  g.onMiniEscort = () => { g.escorts++; };
  return g;
}

// Drives updateMinis in physics-sized steps with the ship parked at x, which
// is how a spawn actually gets triggered.
function fly(game, x, seconds) {
  game.player.x = x;
  game.cam.x = Math.max(0, Math.min(x - VIEW_W / 2, game.level.length - VIEW_W));
  const dt = 1 / 120;
  for (let i = 0; i < Math.round(seconds * 120); i++) updateMinis(game, dt);
}

// Shoots one until it dies. Bounded on purpose: if the hitbox ever stops
// registering, this must fail the test rather than spin forever.
function finish(game, m) {
  for (let i = 0; i < 4000 && !m.dead; i++) hitMinis(game, m.x, m.y, 50);
  assert.ok(m.dead, 'could not kill it with 4000 hits');
}

test.beforeEach(() => {
  resetMinis();
  resetPickups();
  enemyShots.clear();
  resetSettings();
});

// ---------------------------------------------------------------- the roster

test('every rostered kind is a real kind, and the roster grows with the hull', () => {
  let prev = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const roster = rosterFor(i);
    assert.ok(roster.length >= 1, `hull ${i} fields no minibosses at all`);
    assert.ok(roster.length <= Object.keys(KINDS).length);
    assert.ok(roster.length >= prev, `hull ${i} fields fewer kinds than hull ${i - 1}`);
    prev = roster.length;
    for (const k of roster) assert.ok(KINDS[k], `hull ${i} rosters unknown kind "${k}"`);
  }
  // the full set has to actually come into play somewhere in the campaign
  assert.equal(rosterFor(LEVELS.length - 1).length, Object.keys(KINDS).length);
});

test('every kind has sane numbers and a valid colour', () => {
  for (const [id, s] of Object.entries(KINDS)) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(s.colour), `${id}: "${s.colour}" is not a hex colour`);
    assert.ok(s.name && s.name.length <= 14, `${id}: name too long for the toast`);
    assert.ok(s.hp > 0 && s.score > 0 && s.r > 8, `${id}: nonsense stats`);
    assert.ok(s.bullets >= 1 && s.bulletSpeed > 0 && s.cycle > 0, `${id}: cannot fire`);
    // it must fit between the girders, or it would be stuck in the hull
    assert.ok(s.r * 2 < FIELD_BOT - FIELD_TOP, `${id}: too tall for the playfield`);
  }
});

// -------------------------------------------------------------- spawn points

test('planned spawn points are clear of both aprons and of the boss arena', () => {
  for (let i = 0; i < LEVELS.length; i++) {
    const level = { length: LEVELS[i].length };
    const plan = planMinis(level, i);
    assert.ok(plan.length >= 1, `hull ${i} plans no minibosses`);
    let last = -1;
    for (const slot of plan) {
      assert.ok(Number.isFinite(slot.x), `hull ${i}: non-finite spawn x`);
      assert.ok(slot.x > APRON, `hull ${i}: spawn at ${slot.x} is inside the launch apron`);
      assert.ok(slot.x < level.length - VIEW_W - APRON,
        `hull ${i}: spawn at ${slot.x} crowds the landing apron`);
      // arenaLeft is length - VIEW_W; a miniboss must never be planned in it
      assert.ok(slot.x < level.length - VIEW_W,
        `hull ${i}: spawn at ${slot.x} is inside the boss arena`);
      assert.ok(slot.x > last, `hull ${i}: spawn points are not in order`);
      last = slot.x;
      assert.equal(slot.spawned, false);
    }
  }
});

test('a plan slot fires once and only once', () => {
  const game = fakeGame(0);
  const at = game.miniPlan[0].x;
  fly(game, at, 0.5);
  assert.equal(minis.count, 1, 'passing the point did not bring one in');
  assert.equal(game.arrivals.length, 1, 'arrival was not announced');
  // fly back and forth over the same point
  fly(game, at - 900, 0.2);
  fly(game, at, 0.2);
  assert.equal(game.arrivals.length, 1, 'the same slot spawned twice');
});

// The run is one-way now, so the leg a miniboss must not arrive on is the
// boss fight: the arena is meant to hold one thing.
test('nothing new arrives once the boss is up', () => {
  const game = fakeGame(0, { boss: { dead: false } });
  fly(game, game.miniPlan[0].x, 1);
  assert.equal(minis.count, 0);
});

test('a miniboss arrives off the right edge, never on top of the ship', () => {
  for (let i = 0; i < LEVELS.length; i++) {
    resetMinis();
    const game = fakeGame(i);
    const at = game.miniPlan[0].x;
    fly(game, at, 1 / 60);
    assert.equal(minis.count, 1);
    const m = minis.items[0];
    assert.ok(m.x > game.cam.x + VIEW_W, `hull ${i}: spawned on screen at ${m.x}`);
    assert.ok(m.y > FIELD_TOP && m.y < FIELD_BOT, `hull ${i}: spawned outside the playfield`);
  }
});

// ------------------------------------------------------------- killing one

function bring(kind, levelIndex = 0) {
  const game = fakeGame(levelIndex);
  const at = game.miniPlan[0].x;
  game.player.x = at;
  game.cam.x = Math.max(0, at - VIEW_W / 2);
  // Consume the plan: this helper places one by hand, and a plan slot firing
  // underneath it would leave two on the hull and confuse every count.
  for (const slot of game.miniPlan) slot.spawned = true;
  const m = spawnMini(game, kind, at);
  assert.ok(m, `${kind}: did not arrive`);
  m.seen = true;        // skip the arrival grace, so despawn tests mean something
  return game;
}

for (const kind of Object.keys(KINDS)) {
  test(`${kind}: can be shot, and dies`, () => {
    const game = bring(kind, LEVELS.length - 1);
    const m = minis.items[0];
    assert.equal(m.kind, kind, 'requested kind did not take');

    // a horizontal sweep from the left at its centre height must connect
    let connected = false;
    for (let x = m.x - 200; x < m.x + 200; x += 3) {
      if (hitMinis(game, x, m.y, 1)) { connected = true; break; }
    }
    assert.ok(connected, `${kind}: a shot at its own centre height never lands`);

    // and enough shots must finish it
    let shots = 0;
    while (!m.dead && shots < 5000) { hitMinis(game, m.x, m.y, 5); shots++; }
    assert.ok(m.dead, `${kind}: survived ${shots} hits — it cannot be killed`);
    assert.ok(game.score > 0, `${kind}: killing it paid nothing`);
    assert.ok(pickups.count > 0, `${kind}: dropped no loot`);
  });
}

test('a dead miniboss stops absorbing shots', () => {
  const game = bring('hauler');
  const m = minis.items[0];
  finish(game, m);
  assert.equal(hitMinis(game, m.x, m.y, 20), false, 'a wreck is still eating shots');
});

test('the hauler sheds coins while it is still alive', () => {
  const game = bring('hauler');
  const m = minis.items[0];
  hitMinis(game, m.x, m.y, Math.ceil(m.maxHp / 2));
  assert.ok(!m.dead, 'half its health should not kill it');
  assert.ok(pickups.count > 0, 'a damaged hauler shed nothing');
});

// --------------------------------------------------------------- behaviour

test('difficulty scales miniboss health', () => {
  const hp = [];
  for (let d = 0; d < DIFFICULTY.length; d++) {
    resetMinis();
    setSetting('difficulty', d);
    hp.push(spawnMini(fakeGame(0), 'hauler', 100).maxHp);
  }
  for (let i = 1; i < hp.length; i++) {
    assert.ok(hp[i] > hp[i - 1], `difficulty ${i} is no tougher than ${i - 1} (${hp.join(', ')})`);
  }
});

test('later hulls field tougher minibosses than the first', () => {
  const hp = [];
  for (let i = 0; i < LEVELS.length; i++) {
    resetMinis();
    hp.push(spawnMini(fakeGame(i), 'hauler', 100).maxHp);
  }
  for (let i = 1; i < hp.length; i++) {
    assert.ok(hp[i] > hp[i - 1], `hull ${i} is no tougher than ${i - 1} (${hp.join(', ')})`);
  }
});

test('a miniboss shoots back', () => {
  const game = bring('bulwark', LEVELS.length - 1);
  const m = minis.items[0];
  game.player.x = m.x - 100;
  for (let i = 0; i < 400; i++) updateMinis(game, 1 / 120);
  assert.ok(enemyShots.count > 0, 'it never fired a shot');
});

test('a harrier calls escorts', () => {
  const game = bring('harrier', LEVELS.length - 1);
  game.player.x = minis.items[0].x - 100;
  for (let i = 0; i < 1200; i++) updateMinis(game, 1 / 120);
  assert.ok(game.escorts > 0, 'the harrier pack flew alone');
});

test('a miniboss breaks off and stops firing once the boss is up', () => {
  const game = bring('cutter', LEVELS.length - 1);
  const m = minis.items[0];
  game.player.x = m.x - 100;
  game.boss = { dead: false };
  const x0 = m.x;
  enemyShots.clear();
  for (let i = 0; i < 60; i++) updateMinis(game, 1 / 120);
  assert.ok(m.x < x0, 'it held its ground in the boss arena');
  assert.equal(enemyShots.count, 0, 'it kept firing during the boss fight');
});

test('a miniboss left far behind despawns', () => {
  const game = bring('hauler');
  const m = minis.items[0];
  game.cam.x = m.x + 4000;
  updateMinis(game, 1 / 120);
  assert.equal(minis.count, 0, 'it followed the ship across the whole hull');
});

test('one that spawns ahead of a lagging camera is not culled on arrival', () => {
  // The ahead-of-camera despawn test used to fire on the spawn frame whenever
  // the camera had not caught up yet, which burned the plan slot and left
  // nothing on screen but the arrival toast.
  const game = fakeGame(0);
  const at = game.miniPlan[0].x;
  game.player.x = at;
  game.cam.x = 0;                 // still back at the dock
  for (let i = 0; i < 120; i++) updateMinis(game, 1 / 120);
  assert.equal(game.arrivals.length, 1, 'it never arrived');
  assert.equal(minis.count, 1, 'it was announced and then culled on arrival');
});

test('asking for a kind that does not exist spawns nothing', () => {
  assert.equal(spawnMini(fakeGame(0), 'dreadnought', 100), null);
  assert.equal(minis.count, 0);
});

test('the pool is finite and refuses to overflow', () => {
  const game = fakeGame(0);
  for (let i = 0; i < 40; i++) spawnMini(game, 'hauler', 100 + i);
  assert.ok(minis.count > 0 && minis.count <= 4, `pool holds ${minis.count}`);
});

test('a live miniboss is a missile target and a wreck is not', () => {
  const game = bring('hauler');
  const out = [];
  miniTargets(out);
  assert.equal(out.length, 1);
  const m = minis.items[0];
  finish(game, m);
  out.length = 0;
  miniTargets(out);
  assert.equal(out.length, 0, 'missiles are still chasing a wreck');
});

test('ramming one costs shield, scaled by difficulty', () => {
  const soft = [];
  for (const d of [0, DIFFICULTY.length - 1]) {
    resetMinis();
    setSetting('difficulty', d);
    const game = bring('hauler');
    const m = minis.items[0];
    game.player.invuln = 0;
    game.player.x = m.x;
    game.player.y = m.y;
    game.player.shield = 1000;
    updateMinis(game, 1 / 120);
    soft.push(1000 - game.player.shield);
  }
  assert.ok(soft[0] > 0, 'flying into one was free');
  assert.ok(soft[1] > soft[0], `ramming does not scale with difficulty (${soft.join(', ')})`);
});

test('drawMinis survives a wreck mid-animation', () => {
  const game = bring('hauler');
  const m = minis.items[0];
  finish(game, m);
  const ctx = document.createElement('canvas').getContext('2d');
  drawMinis(ctx);     // throws if the draw path reads anything undefined
  updateMinis(game, 1.4);
  assert.equal(minis.count, 0, 'the wreck never cleared');
});
