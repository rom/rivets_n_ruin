import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, radarProfile } from '../src/level.js';
import {
  LEVELS, VIEW_W, VIEW_H, FIELD_H, FIELD_TOP, FIELD_BOT, APRON,
  RADAR_Y, RADAR_H, HUD_Y, HUD_H,
} from '../src/config.js';

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

// --- the bands
//
// The radar used to be drawn over the top of the playfield and faded out
// when the ship flew under it. That was never right for anything that is
// not the ship: a gun mounted on the upper girder sits at y=16 with its
// barrel reaching to about y=29, entirely behind a strip that ran 0..22.
// Half of every hull's guns were hidden behind the thing meant to be
// showing you where they were. It has a band of its own now.

test('the three bands stack and none of them overlaps another', () => {
  assert.equal(RADAR_Y, FIELD_H, 'the radar starts somewhere other than below the playfield');
  assert.equal(HUD_Y, RADAR_Y + RADAR_H, 'the HUD overlaps the radar');
  assert.equal(VIEW_H, FIELD_H + RADAR_H + HUD_H, 'the frame does not fit its three bands');
  assert.ok(RADAR_H >= 20, 'the radar band is too short for three rows');
});

test('the playfield did not shrink to make room', () => {
  // Every gameplay constant is derived from these; the frame grew instead.
  assert.equal(FIELD_H, 324);
  assert.equal(FIELD_TOP, 16);
  assert.equal(FIELD_BOT, 308);
});

test('no gun anywhere on any hull reaches into the radar band', () => {
  // The case that was broken: a gun on the upper girder sits at y=16 and
  // its barrel and base reach about 14px into the playfield, which the old
  // 0..22 strip covered completely.
  const reach = 16;              // barrel plus base, either way from the mount
  for (const spec of LEVELS) {
    const level = buildLevel(spec);
    for (const t of level.turrets) {
      assert.ok(t.y - reach >= 0,
        `${spec.name}: a gun at y=${t.y} reaches above the frame`);
      assert.ok(t.y + reach <= RADAR_Y,
        `${spec.name}: a gun at y=${t.y} reaches into the radar band at ${RADAR_Y}`);
    }
  }
});

test('the radar cannot cover any part of the playfield', () => {
  // The invariant the whole band layout exists for. Anything drawn in
  // playfield coordinates is in 0..FIELD_H; the radar starts at FIELD_H.
  for (const y of [0, FIELD_TOP, 160, FIELD_BOT, FIELD_H]) {
    assert.ok(y <= RADAR_Y, `playfield y=${y} is under the radar`);
  }
});
