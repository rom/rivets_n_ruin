import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideScale, computeScale, TUNING } from '../src/display.js';

const many = (v, n = 40) => Array(n).fill(v);
const base = { cap: 1, failedAt: Infinity, refresh: 16, samples: [], phase: 'up' };

test('climbs when frames sit at the refresh period', () => {
  assert.equal(decideScale({ ...base, samples: many(16.4) }), 1 + TUNING.STEP);
});

test('does not climb when frames are already slow', () => {
  assert.equal(decideScale({ ...base, samples: many(26) }), null);
});

test('steps down when sustained frames miss the refresh badly', () => {
  assert.equal(decideScale({ ...base, cap: 2, phase: 'down', samples: many(30) }), 2 - TUNING.STEP);
});

test('does not step below 1', () => {
  assert.equal(decideScale({ ...base, cap: 1, phase: 'down', samples: many(100) }), null);
});

test('never returns to a scale that already proved too slow', () => {
  // hysteresis: without this the scaler oscillates forever
  assert.equal(decideScale({ ...base, cap: 1, failedAt: 1.5, samples: many(16.1) }), null);
  assert.equal(decideScale({ ...base, cap: 2, failedAt: 2.5, samples: many(16.1) }), null);
});

test('does not climb past the maximum', () => {
  assert.equal(decideScale({ ...base, cap: TUNING.MAX_SCALE, samples: many(16.1) }), null);
});

test('waits for a refresh estimate before deciding', () => {
  assert.equal(decideScale({ ...base, refresh: Infinity, samples: many(16) }), null);
  assert.equal(decideScale({ ...base, samples: [] }), null);
});

test('a single slow frame does not move the scale', () => {
  // median, not mean: one GC pause should not cost resolution
  const s = many(16.2, 39).concat([400]);
  assert.equal(decideScale({ ...base, cap: 2, phase: 'down', samples: s }), null);
});

test('judges against the display period, not an absolute millisecond budget', () => {
  // a 144Hz display: 7ms frames are normal, and 16ms is NOT headroom there
  assert.equal(decideScale({ ...base, refresh: 6.9, samples: many(7.1) }), 1 + TUNING.STEP);
  assert.equal(decideScale({ ...base, cap: 2, phase: 'down', refresh: 6.9, samples: many(16) }), 2 - TUNING.STEP);
});

test('computeScale tracks the window and respects the cap', () => {
  assert.ok(computeScale(640, 360, 1) >= 1);
  assert.equal(computeScale(6400, 3600, 1), TUNING.MAX_SCALE, 'should cap on a huge window');
  assert.equal(computeScale(320, 180, 1), 1, 'should never go below 1');
  assert.ok(computeScale(1280, 720, 2) >= computeScale(1280, 720, 1), 'higher DPR wants more pixels');
});
