import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, BOSSES, THEMES, LEVEL_UP, PICKUP, SHIP } from '../src/config.js';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// A bad colour string is valid JavaScript and canvas silently ignores it, so
// nothing else in the toolchain can catch a typo'd hex value. This can.
test('every theme colour is a valid hex string', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const [slot, value] of Object.entries(theme)) {
      if (slot === 'name') continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        assert.match(v, HEX, `THEMES.${name}.${slot} = ${JSON.stringify(v)}`);
      }
    }
  }
});

test('every theme defines every slot the renderer reads', () => {
  const required = Object.keys(THEMES.steel);
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const slot of required) {
      assert.ok(slot in theme, `THEMES.${name} is missing "${slot}"`);
    }
  }
});

test('there is exactly one boss per level', () => {
  assert.equal(BOSSES.length, LEVELS.length,
    `${LEVELS.length} hulls but ${BOSSES.length} bosses`);
});

test('every level names a theme that exists', () => {
  for (const l of LEVELS) {
    assert.ok(THEMES[l.theme], `${l.name} wants theme "${l.theme}"`);
  }
});

test('level names and seeds are unique', () => {
  assert.equal(new Set(LEVELS.map((l) => l.name)).size, LEVELS.length, 'duplicate level name');
  assert.equal(new Set(LEVELS.map((l) => l.seed)).size, LEVELS.length, 'duplicate seed');
});

test('difficulty rises monotonically across hulls', () => {
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1];
    const b = LEVELS[i];
    assert.ok(b.length > a.length, `${b.name} is not longer than ${a.name}`);
    assert.ok(b.turretHp >= a.turretHp, `${b.name} turrets are not tougher`);
    assert.ok(b.interceptorSpeed >= a.interceptorSpeed, `${b.name} interceptors are not faster`);
    assert.ok(b.interceptorSpawn <= a.interceptorSpawn, `${b.name} interceptors are not denser`);
    assert.ok(b.gapScale <= a.gapScale, `${b.name} obstacles are not tighter`);
  }
});

test('boss difficulty rises monotonically', () => {
  for (let i = 1; i < BOSSES.length; i++) {
    assert.ok(BOSSES[i].coreHp > BOSSES[i - 1].coreHp,
      `${BOSSES[i].name} is not tougher than ${BOSSES[i - 1].name}`);
    assert.ok(BOSSES[i].score > BOSSES[i - 1].score,
      `${BOSSES[i].name} is not worth more than ${BOSSES[i - 1].name}`);
  }
});

test('every boss kind is distinct', () => {
  const kinds = BOSSES.map((b) => b.kind);
  assert.equal(new Set(kinds).size, kinds.length, `repeated boss kind in ${kinds.join(', ')}`);
});

// Gun levels index straight into these arrays. The cap can rise by one per
// hull cleared, so the tables have to be long enough for a full campaign.
test('gun tables cover every reachable upgrade level', () => {
  // The reachable ceiling is the explicit cap, not the per-hull sum, which
  // would be far higher. Both are checked: the cap must be honoured, and the
  // tables must cover it.
  const perHull = PICKUP.gunLevels + LEVEL_UP.gunCap * (LEVELS.length - 1);
  assert.ok(PICKUP.gunCapMax <= perHull, 'gunCapMax should be the binding limit');
  const maxLevel = PICKUP.gunCapMax;
  assert.ok(PICKUP.speedScale.length > maxLevel,
    `speedScale has ${PICKUP.speedScale.length} entries but level ${maxLevel} is reachable`);
  assert.ok(PICKUP.blazeAngles.length > maxLevel,
    `blazeAngles has ${PICKUP.blazeAngles.length} entries but level ${maxLevel} is reachable`);
});

test('gunspeed scale is strictly faster at every level', () => {
  for (let i = 1; i < PICKUP.speedScale.length; i++) {
    assert.ok(PICKUP.speedScale[i] < PICKUP.speedScale[i - 1],
      `speedScale[${i}] is not faster than [${i - 1}]`);
  }
});

test('gunblaze adds barrels at every level', () => {
  for (let i = 1; i < PICKUP.blazeAngles.length; i++) {
    assert.ok(PICKUP.blazeAngles[i].length > PICKUP.blazeAngles[i - 1].length,
      `blazeAngles[${i}] adds no barrels`);
  }
});

test('ship starts with sane values', () => {
  assert.ok(SHIP.shieldMax > 0 && SHIP.lives > 0 && SHIP.maxVX > 0);
  assert.ok(SHIP.brakeX > SHIP.accelX, 'reverse thrust should be stronger than forward');
});
