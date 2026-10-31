import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, radarProfile } from '../src/level.js';
import { LEVELS, VIEW_W, FIELD_TOP, FIELD_BOT, APRON } from '../src/config.js';

const COLS = VIEW_W;

test('every hull produces a radar profile the right shape', () => {
  for (const spec of LEVELS) {
    const level = buildLevel(spec);
    const p = radarProfile(level, COLS);
    assert.equal(p.top.length, COLS, `${spec.name}: wrong column count`);
    assert.equal(p.bot.length, COLS);
    for (let c = 0; c < COLS; c++) {
      assert.ok(p.top[c] >= 0 && p.top[c] <= 15, `${spec.name}: top[${c}] = ${p.top[c]}`);
      assert.ok(p.bot[c] >= 0 && p.bot[c] <= 15, `${spec.name}: bot[${c}] = ${p.bot[c]}`);
    }
  }
});

test('the profile shows structure where the hull has structure', () => {
  for (const spec of LEVELS) {
    const level = buildLevel(spec);
    const p = radarProfile(level, COLS);
    const inked = [...p.top, ...p.bot].filter(Boolean).length;
    assert.ok(inked > COLS * 0.15,
      `${spec.name}: only ${inked} of ${COLS * 2} radar cells have anything in them`);
    assert.ok(inked < COLS * 1.9,
      `${spec.name}: ${inked} of ${COLS * 2} cells filled — the radar is a solid block`);
  }
});

test('the aprons read as clear, because nothing is built in them', () => {
  const level = buildLevel(LEVELS[0]);
  const p = radarProfile(level, COLS);
  const lastApronCol = Math.floor((APRON * 0.7 / level.length) * COLS);
  for (let c = 0; c < lastApronCol; c++) {
    assert.equal(p.top[c], 0, `column ${c} is inside the launch apron but shows structure`);
    assert.equal(p.bot[c], 0, `column ${c} is inside the launch apron but shows structure`);
  }
});

// Walking a few thousand obstacles every frame to draw a 640px strip would
// be absurd, so the profile is cached on the level. If the cache ever stops
// working the radar quietly becomes the most expensive thing on screen.
test('the profile is computed once per hull and then handed back', () => {
  const level = buildLevel(LEVELS[3]);
  const a = radarProfile(level, COLS);
  const b = radarProfile(level, COLS);
  assert.equal(a, b, 'the profile was rebuilt on the second call');
  assert.equal(a.top, b.top);
  // a different width is a different profile and must not reuse the old one
  const c = radarProfile(level, 320);
  assert.notEqual(a, c);
  assert.equal(c.top.length, 320);
});

test('a hull with nothing on it does not crash the radar', () => {
  const level = { length: 12000, obstacles: [] };
  const p = radarProfile(level, COLS);
  assert.equal(p.top.length, COLS);
  assert.ok([...p.top].every((v) => v === 0));
});

test('a block spanning the whole playfield reads as solid on both sides', () => {
  const level = {
    length: 1000,
    obstacles: [{ x: 400, y: FIELD_TOP, w: 200, h: FIELD_BOT - FIELD_TOP }],
  };
  const p = radarProfile(level, 100);
  assert.equal(p.top[50], 15, 'a full-height block does not read as reaching down');
  assert.equal(p.bot[50], 15, 'a full-height block does not read as reaching up');
  assert.equal(p.top[10], 0, 'structure leaked outside the block');
});
