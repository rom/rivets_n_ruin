import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKS, markOf, markName, drawShipBody } from '../src/shipart.js';
import { drawFoeBody, drawInterceptorBody, BODY_KINDS } from '../src/foeart.js';
import { SPEC, foes, resetFoes, spawnFoe } from '../src/foes.js';
import { LEVELS, SHIP, PICKUP, FIELD_TOP, FIELD_BOT } from '../src/config.js';
import { MODS } from '../src/shop.js';

const ctx = () => document.createElement('canvas').getContext('2d');

test('there is an airframe for every hull, and one more is not reachable', () => {
  assert.equal(MARKS.length, LEVELS.length,
    `${MARKS.length} marks for ${LEVELS.length} hulls`);
  for (let i = 0; i < LEVELS.length; i++) {
    assert.equal(markOf(i), MARKS[i]);
    assert.ok(markName(i).startsWith('MARK '));
  }
  // out of range clamps rather than returning undefined, which would be a
  // blank ship rather than an error anyone would notice
  assert.equal(markOf(-5), MARKS[0]);
  assert.equal(markOf(999), MARKS[MARKS.length - 1]);
  assert.equal(markName(999), markName(MARKS.length - 1));
});

test('every mark is at least as much ship as the one before it', () => {
  for (let i = 1; i < MARKS.length; i++) {
    const a = MARKS[i - 1];
    const b = MARKS[i];
    for (const k of ['nose', 'half', 'engines', 'wing', 'armour', 'fins', 'gild']) {
      assert.ok(b[k] >= a[k], `mark ${i + 1} has less ${k} than mark ${i}`);
    }
    assert.ok(b.tail <= a.tail, `mark ${i + 1} is shorter at the stern than mark ${i}`);
  }
  // and it does actually grow, rather than eight identical rows
  const first = MARKS[0];
  const last = MARKS[MARKS.length - 1];
  assert.ok(last.nose - last.tail > (first.nose - first.tail) * 1.15,
    'the last airframe is not meaningfully longer than the first');
  assert.ok(last.engines > first.engines, 'the engine count never changes');
});

// The sprite is allowed to be generous, but a ship drawn far larger than
// the box it collides with reads as a bug the first time a shot misses.
test('no airframe runs far ahead of the hitbox it is drawn around', () => {
  for (const [i, m] of MARKS.entries()) {
    const len = m.nose - m.tail;
    const height = m.half * 2;
    assert.ok(len <= SHIP.hitW * 2, `mark ${i + 1} is ${len} long against a ${SHIP.hitW} hitbox`);
    assert.ok(height <= SHIP.hitH * 2.4, `mark ${i + 1} is ${height} tall against a ${SHIP.hitH} hitbox`);
    assert.ok(height < FIELD_BOT - FIELD_TOP, `mark ${i + 1} does not fit between the girders`);
  }
});

test('the ship draws at every mark, fit and load without throwing', () => {
  const c = ctx();
  const player = {
    x: 0, y: 160, vx: 0, vy: 0, facing: 1, flip: 0, invuln: 0, fireCd: 0.2,
    gunSpeed: 0, gunBlaze: 0, ammo: { bomb: 0, grenade: 0, missile: 0 },
  };
  const allMods = {};
  for (const id of Object.keys(MODS)) allMods[id] = MODS[id].tiers.length;

  for (let lvl = 0; lvl < MARKS.length; lvl++) {
    for (const gs of [0, 1, PICKUP.gunCapMax]) {
      for (const gb of [0, 1, PICKUP.gunCapMax]) {
        for (const mods of [{}, { magnet: 1 }, allMods]) {
          player.gunSpeed = gs;
          player.gunBlaze = gb;
          player.ammo = { bomb: gs, grenade: gb, missile: gs };
          drawShipBody(c, player, { levelIndex: lvl, mods });
        }
      }
    }
  }
});

test('the ship draws with a mod stored the pre-tier way', () => {
  const c = ctx();
  const player = {
    x: 0, y: 160, vx: 0, vy: 0, facing: 1, flip: 0, invuln: 0, fireCd: 0,
    gunSpeed: 2, gunBlaze: 2, ammo: { bomb: 2, grenade: 2, missile: 2 },
  };
  drawShipBody(c, player, { levelIndex: 4, mods: { magnet: true, scavenger: true } });
});

test('the ship draws when it is handed no game at all', () => {
  // drawShip is called from a sequence and from the gallery; a missing
  // game must fall back to mark one rather than throw and black the frame.
  drawShipBody(ctx(), {
    x: 0, y: 0, vx: 0, vy: 0, facing: 1, flip: 0, invuln: 0, fireCd: 0,
    gunSpeed: 0, gunBlaze: 0, ammo: {},
  }, null);
});

// --- attackers

test('every attacker kind has a body of its own', () => {
  for (const kind of Object.keys(SPEC)) {
    assert.ok(BODY_KINDS.includes(kind),
      `${kind} has no body and is being drawn as something else`);
  }
});

test('every attacker kind has a body, and it draws in both states', () => {
  const c = ctx();
  const game = {
    levelIndex: 0,
    cam: { x: 0 },
    player: { x: 0, y: 160, facing: 1, alive: true, invuln: 99 },
  };
  for (const kind of Object.keys(SPEC)) {
    resetFoes();
    const f = spawnFoe(game, kind);
    assert.ok(f, `${kind} would not spawn`);
    for (const state of [0, 1]) {
      for (const flash of [0, 0.05]) {
        f.state = state;
        f.flash = flash;
        f.t = 0.7;
        drawFoeBody(c, f, SPEC[kind], flash > 0);
      }
    }
  }
  resetFoes();
  assert.equal(foes.count, 0);
});

test('an unknown kind falls back to a body rather than throwing', () => {
  drawFoeBody(ctx(), { kind: 'dreadnought', t: 1, state: 0 }, SPEC.warder, false);
});

test('the interceptor draws', () => {
  drawInterceptorBody(ctx(), { x: 0, y: 0, dirX: -1 }, 0.5);
});
