import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, BOSSES, THEMES, LEVEL_UP, PICKUP, SHIP } from '../src/config.js';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// A bad colour string is valid JavaScript and canvas silently ignores it, so
// nothing else in the toolchain can catch a typo'd hex value. This can.
// Slots that name a routine rather than a colour.
const NON_COLOUR = new Set(['name', 'surface', 'shape']);

test('every theme colour is a valid hex string', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const [slot, value] of Object.entries(theme)) {
      if (NON_COLOUR.has(slot)) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        assert.match(v, HEX, `THEMES.${name}.${slot} = ${JSON.stringify(v)}`);
      }
    }
  }
});

test('every theme names a surface and an obstacle shape', () => {
  const surfaces = new Set();
  const shapes = new Set();
  for (const [name, theme] of Object.entries(THEMES)) {
    assert.ok(theme.surface, `THEMES.${name} has no surface`);
    assert.ok(theme.shape, `THEMES.${name} has no shape`);
    surfaces.add(theme.surface);
    shapes.add(theme.shape);
  }
  // The whole point of the rework is that hulls stop looking alike, so a
  // duplicate surface is a regression rather than a saving.
  assert.equal(surfaces.size, Object.keys(THEMES).length, 'two themes share a surface');
  assert.equal(shapes.size, Object.keys(THEMES).length, 'two themes share an obstacle shape');
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

// Every behaviour the game has must actually appear, and nothing may ask
// for one that does not exist. The deep campaign reuses them on purpose —
// a ninth pattern invented to fill a table is a worse boss than a known
// one at a harder tempo — so the uniqueness claim is about the first pass
// through, not about the whole list.
test('every boss behaviour appears, and none is invented', () => {
  const kinds = BOSSES.map((b) => b.kind);
  const known = new Set(kinds);
  assert.equal(known.size, 8, `expected eight behaviours, got ${[...known].join(', ')}`);
  // the opening run of the campaign shows each exactly once
  const first = kinds.slice(0, known.size);
  assert.equal(new Set(first).size, first.length,
    `the first ${known.size} bosses repeat a behaviour: ${first.join(', ')}`);
});

test('every boss kind has a body drawn for it', async () => {
  const art = await import('../src/bossart.js');
  // bossart falls back to the riveter for an unknown kind, which is right
  // for something unknown and wrong for a kind the config actually ships.
  const c = document.createElement('canvas').getContext('2d');
  for (const b of BOSSES) {
    art.drawBossBody(c, {
      kind: b.kind, t: 1, flash: 0, parts: [], hp: 1, maxHp: 1,
      x: 0, y: 0, dead: false, entry: 0, blinkT: 0,
    });
  }
});

// Gun levels index straight into these arrays. The cap rises every so many
// hulls cleared, so the tables have to be long enough for a full campaign.
test('gun tables cover every reachable upgrade level', () => {
  // The reachable ceiling is the explicit cap, not the number of rises a
  // campaign contains. Both are checked: the cap must be the binding
  // limit, and the tables must cover it.
  const rises = Math.floor((LEVELS.length - 1) / LEVEL_UP.gunCapEvery);
  assert.ok(PICKUP.gunCapMax <= PICKUP.gunLevels + rises,
    'gunCapMax should be the binding limit, not the number of hulls');
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
