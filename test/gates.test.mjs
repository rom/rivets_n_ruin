import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../src/level.js';
import { buildGates, liveGates, gateHit, hitGate, updateGates } from '../src/gates.js';
import { LEVELS, LASER, APRON, VIEW_W, FIELD_TOP, FIELD_BOT } from '../src/config.js';
import { resetPickups, pickups } from '../src/pickups.js';
import { mulberry32 } from '../src/rng.js';

function fakeGame(level, levelIndex = 0) {
  return {
    levelIndex, score: 0, flash: 0, state: 'play',
    cam: { x: 0, shake: 0 },
    level,
    player: { x: 0, y: 160, vx: 0, vy: 0, alive: true, invuln: 0, shield: 400, shieldMax: 400 },
  };
}

test.beforeEach(() => resetPickups());

test('every hull gets the number of gates its spec asks for', () => {
  for (const spec of LEVELS) {
    const level = buildLevel(spec);
    assert.equal(level.gates.length, spec.lasers || 0,
      `${spec.name} asked for ${spec.lasers} gates and got ${level.gates.length}`);
  }
});

test('the first hulls have none, and the last has the most', () => {
  assert.equal(LEVELS[0].lasers, 0, 'the tutorial hull should not wall you in');
  const counts = LEVELS.map((l) => l.lasers || 0);
  assert.ok(counts[counts.length - 1] >= Math.max(...counts),
    `the last hull has ${counts[counts.length - 1]} of a maximum ${Math.max(...counts)}`);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] >= counts[i - 1], `hull ${i} has fewer gates than hull ${i - 1}`);
  }
});

test('gates are clear of both aprons and of the boss arena', () => {
  for (const spec of LEVELS) {
    const level = buildLevel(spec);
    for (const g of level.gates) {
      assert.ok(g.x > APRON, `${spec.name}: a gate at ${g.x} is in the launch apron`);
      assert.ok(g.x < level.length - VIEW_W,
        `${spec.name}: a gate at ${g.x} is inside the boss arena`);
      assert.ok(g.dir === 1 || g.dir === -1);
      assert.ok(g.y === FIELD_TOP || g.y === FIELD_BOT, `${spec.name}: emitter off the girder`);
      assert.ok(g.hp > 0 && g.maxHp === g.hp);
    }
  }
});

// A gate whose emitter is buried in a block is a hull you cannot finish.
test('every emitter is out in the open where it can be shot', () => {
  for (const spec of LEVELS) {
    const level = buildLevel(spec);
    for (const g of level.gates) {
      const cy = g.y + g.dir * (LASER.emitterH / 2);
      const buried = level.obstacles.some((o) =>
        g.x > o.x - LASER.emitterW / 2 && g.x < o.x + o.w + LASER.emitterW / 2
        && cy > o.y - 2 && cy < o.y + o.h + 2);
      assert.ok(!buried, `${spec.name}: the emitter at ${g.x} is inside a block`);
    }
  }
});

test('two gates never land on top of each other', () => {
  for (const spec of LEVELS) {
    const level = buildLevel(spec);
    const xs = level.gates.map((g) => g.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      assert.ok(xs[i] - xs[i - 1] > 400,
        `${spec.name}: gates ${xs[i - 1]} and ${xs[i]} are ${xs[i] - xs[i - 1]}px apart`);
    }
  }
});

test('a hull always generates the same gates', () => {
  const a = buildLevel(LEVELS[5]).gates.map((g) => `${g.x}:${g.dir}`);
  const b = buildLevel(LEVELS[5]).gates.map((g) => `${g.x}:${g.dir}`);
  assert.deepEqual(a, b, 'gate placement is not deterministic');
});

// --- the wall itself

test('a live gate stops the ship from either side, and costs shield', () => {
  const level = buildLevel(LEVELS[5]);
  const g = level.gates[0];
  for (const side of [-1, 1]) {
    g.dead = false; g.hp = g.maxHp; g.burnCd = 0;
    const game = fakeGame(level, 5);
    const p = game.player;
    // start just short, flying into it
    p.x = g.x + side * (LASER.shipClear + 2);
    p.vx = -side * 300;
    const before = p.shield;
    // Thrust held down into the wall the whole time: a gate that only
    // reversed the velocity would be pushed through by this.
    for (let i = 0; i < 240; i++) {
      p.vx = -side * 400;
      p.x += p.vx / 120;
      updateGates(game, 1 / 120);
    }
    const past = side < 0 ? p.x > g.x : p.x < g.x;
    assert.ok(!past, `approaching from ${side < 0 ? 'the left' : 'the right'} got through`);
    // Held at the clear distance, not merely bounced: a gate that only
    // reversed the velocity could be pushed through by enough thrust.
    assert.ok(Math.abs(p.x - (g.x + side * LASER.shipClear)) < 1,
      `held at ${p.x}, the wall is at ${g.x} and should hold at ${g.x + side * LASER.shipClear}`);
    assert.ok(p.shield < before, 'leaning on the beam was free');
  }
});

test('a destroyed gate lets the ship through and stops burning it', () => {
  const level = buildLevel(LEVELS[5]);
  const g = level.gates[0];
  g.dead = false; g.hp = g.maxHp;
  const game = fakeGame(level, 5);
  const p = game.player;

  let shots = 0;
  while (!g.dead && shots < 500) { hitGate(game, g, 2); shots++; }
  assert.ok(g.dead, `the emitter survived ${shots} hits`);
  assert.ok(game.score > 0, 'breaking it paid nothing');
  assert.ok(pickups.count > 0, 'breaking it dropped nothing');

  p.x = g.x - 60;
  p.vx = 300;
  const before = p.shield;
  for (let i = 0; i < 120; i++) { p.x += p.vx / 120; updateGates(game, 1 / 120); }
  assert.ok(p.x > g.x, 'the way did not open');
  assert.equal(p.shield, before, 'a dead beam is still burning');
  assert.equal(liveGates(level).length, level.gates.length - 1);
});

test('the emitter hit box sits where the emitter is drawn', () => {
  const level = buildLevel(LEVELS[5]);
  const g = level.gates[0];
  const cy = g.y + g.dir * (LASER.emitterH / 2);
  assert.ok(gateHit(g, g.x, cy), 'a shot dead centre misses it');
  assert.ok(!gateHit(g, g.x, cy + g.dir * -60), 'the hit box reaches across the playfield');
  assert.ok(!gateHit(g, g.x + 60, cy), 'the hit box is too wide');
});

test('an invulnerable ship is stopped but not burned', () => {
  const level = buildLevel(LEVELS[5]);
  const g = level.gates[0];
  g.dead = false; g.hp = g.maxHp;
  const game = fakeGame(level, 5);
  const p = game.player;
  p.invuln = 99;
  p.x = g.x - LASER.shipClear + 4;
  p.vx = 300;
  const before = p.shield;
  for (let i = 0; i < 120; i++) { p.x += p.vx / 120; updateGates(game, 1 / 120); }
  assert.ok(p.x <= g.x, 'invulnerability let the ship through a wall');
  assert.equal(p.shield, before);
});

test('buildGates copes with a spec that asks for none, and with a crowded hull', () => {
  assert.deepEqual(buildGates(mulberry32(1), { lasers: 0 }, 12000, []), []);
  // a hull that is solid blocks: rather than place an unshootable emitter,
  // it is allowed to place fewer
  const wall = [{ x: 0, y: FIELD_TOP, w: 30000, h: FIELD_BOT - FIELD_TOP }];
  const g = buildGates(mulberry32(2), { lasers: 4 }, 20000, wall);
  assert.ok(Array.isArray(g));
  assert.ok(g.length <= 4);
});
