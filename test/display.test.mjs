import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideScale, computeScale, TUNING,
  setStatic, fitCanvas, renderScale, wantedScale, scaleCap, reportFrame,
} from '../src/display.js';

// Enough of a canvas for fitCanvas: it sets width/height and style, and
// asks for a context it then only calls setTransform on.
function fakeCanvas() {
  return {
    width: 0, height: 0, style: {},
    getContext: () => ({ setTransform() {}, imageSmoothingEnabled: true, imageSmoothingQuality: '' }),
  };
}

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

// --- static mode
//
// Menus used to render at whatever cap gameplay had settled on. On a 2560px
// window that meant a 960x540 backing store blown up 2.6x by the browser:
// the text on the overview, the armourer and the settings page was the most
// blurred thing in the game, and the one thing made entirely of text.

test('a menu renders at the window scale, not at gameplay\'s cap', () => {
  const canvas = fakeCanvas();
  const ctx = canvas.getContext('2d');
  window.innerWidth = 2560;
  window.innerHeight = 1480;

  setStatic(false);
  fitCanvas(canvas, ctx);
  const want = wantedScale();
  assert.ok(want > 1.5, `a 2560px window wants more than 1.5x, got ${want}`);

  // Fast frames first, so the scaler has a refresh estimate and climbs...
  for (let i = 0; i < 3000 && scaleCap() < want; i++) reportFrame(16.6, canvas, ctx);
  const climbed = scaleCap();
  assert.ok(climbed > 1, `the cap never climbed off 1 (got ${climbed})`);

  // ...then slow ones, the way a dense hull would produce.
  for (let i = 0; i < 3000 && scaleCap() >= climbed; i++) reportFrame(90, canvas, ctx);
  fitCanvas(canvas, ctx);
  const capped = renderScale();
  assert.ok(capped < want, `the cap did not come down under load (${capped} of ${want})`);

  assert.equal(setStatic(true), true, 'entering static mode reported no change');
  fitCanvas(canvas, ctx);
  assert.equal(renderScale(), want,
    `a menu rendered at ${renderScale()} when the window wants ${want}`);
  assert.equal(canvas.width, Math.round(640 * want));

  assert.equal(setStatic(false), true);
  fitCanvas(canvas, ctx);
  assert.equal(renderScale(), capped, 'leaving a menu left gameplay at the menu scale');
});

test('setStatic reports only real changes', () => {
  setStatic(false);
  assert.equal(setStatic(false), false);
  assert.equal(setStatic(true), true);
  assert.equal(setStatic(true), false);
  setStatic(false);
});

test('menu frames are kept out of the adaptive estimate', () => {
  const canvas = fakeCanvas();
  const ctx = canvas.getContext('2d');
  setStatic(true);
  const before = scaleCap();
  // frames slow enough to drop any cap, were they being counted
  for (let i = 0; i < 600; i++) {
    assert.equal(reportFrame(400, canvas, ctx), false, 'a menu frame resized the canvas');
  }
  assert.equal(scaleCap(), before, 'a menu talked the gameplay cap down');
  setStatic(false);
});
