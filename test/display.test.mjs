import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideScale, computeScale, TUNING,
  setStatic, fitCanvas, renderScale, wantedScale, scaleCap, reportFrame,
  hullScale, uiScale,
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

// --- two scales
//
// The adaptive cap used to shrink the whole backing store. On a 2560px
// window at cap 1 that meant a 640px canvas stretched to fill, and the
// HUD — the one part of the screen made entirely of text — went to mush
// the moment gameplay started and came back sharp in the menus.
// Reported from play as "the text in the HUD gets blocky".
//
// So there are two scales now: the canvas always gets the window's, and
// only the world buffer follows the cap. These tests hold that line,
// because the tempting one-line "fix" for a frame-rate problem is to
// take the canvas down with it again.

// Drives the scaler down the way a dense hull does, and reports the
// scale it settles at.
function underLoad(canvas, ctx, ui) {
  const want = wantedScale();
  for (let i = 0; i < 3000 && scaleCap() < want; i++) reportFrame(16.6, canvas, ctx);
  const climbed = scaleCap();
  assert.ok(climbed > 1, `the cap never climbed off 1 (got ${climbed})`);
  for (let i = 0; i < 3000 && scaleCap() >= climbed; i++) reportFrame(90, canvas, ctx);
  fitCanvas(canvas, ctx, ui);
  return want;
}

test('load takes the world down and leaves the UI layer alone', () => {
  const canvas = fakeCanvas();
  const ctx = canvas.getContext('2d');
  const ui = { canvas: fakeCanvas(), ctx: fakeCanvas().getContext('2d') };
  window.innerWidth = 2560;
  window.innerHeight = 1480;

  setStatic(false);
  fitCanvas(canvas, ctx, ui);
  const want = underLoad(canvas, ctx, ui);
  assert.ok(want > 1.5, `a 2560px window wants more than 1.5x, got ${want}`);

  assert.ok(renderScale() < want,
    `the world did not come down under load (${renderScale()} of ${want}) — the cap is doing nothing`);
  assert.equal(canvas.width, Math.round(640 * renderScale()),
    'the world canvas is not sized for the world scale');

  assert.equal(uiScale(), want,
    `the UI dropped to ${uiScale()} under load; the HUD text is blocky again`);
  assert.equal(ui.canvas.width, Math.round(640 * want),
    'the UI backing store followed the world scale instead of the window');
  // Both layers are stacked on the same box, so their CSS size must agree
  // to the pixel or the HUD lands somewhere other than over the world.
  assert.equal(ui.canvas.style.width, canvas.style.width);
  assert.equal(ui.canvas.style.height, canvas.style.height);
});

test('a menu spends the full scale on the world too', () => {
  const canvas = fakeCanvas();
  const ctx = canvas.getContext('2d');
  const ui = { canvas: fakeCanvas(), ctx: fakeCanvas().getContext('2d') };
  window.innerWidth = 2560;
  window.innerHeight = 1480;

  setStatic(false);
  fitCanvas(canvas, ctx, ui);
  const want = underLoad(canvas, ctx, ui);
  const capped = renderScale();
  assert.ok(capped < want);

  // A menu is a dim rect and some text over a frozen world. There is
  // nothing there to protect.
  assert.equal(setStatic(true), true, 'entering static mode reported no change');
  fitCanvas(canvas, ctx, ui);
  assert.equal(renderScale(), want, `a menu rendered its world at ${renderScale()}, not ${want}`);
  assert.equal(uiScale(), want);

  assert.equal(setStatic(false), true);
  fitCanvas(canvas, ctx, ui);
  assert.equal(renderScale(), capped, 'leaving a menu left gameplay at the menu scale');
  assert.equal(uiScale(), want, 'leaving a menu shrank the UI layer');
});

test('a page with no UI layer still plays', () => {
  // fitCanvas takes the layer as an optional argument precisely so an
  // older index.html, or a test, can leave it out.
  const canvas = fakeCanvas();
  const ctx = canvas.getContext('2d');
  window.innerWidth = 1280;
  window.innerHeight = 760;
  setStatic(false);
  assert.doesNotThrow(() => fitCanvas(canvas, ctx));
  assert.ok(canvas.width > 0);
});

test('the hull cache follows the world, not the window', () => {
  // The hull is drawn into the world buffer, so caching it at the
  // sharper canvas scale would spend memory on pixels that get
  // downsampled on the way in.
  const canvas = fakeCanvas();
  const ctx = canvas.getContext('2d');
  window.innerWidth = 2560;
  window.innerHeight = 1480;
  setStatic(false);
  fitCanvas(canvas, ctx);
  assert.ok(hullScale() <= renderScale() + 1e-9,
    `hull cached at ${hullScale()} for a world rendered at ${renderScale()}`);
  assert.ok(hullScale() <= uiScale() + 1e-9);
  assert.ok(hullScale() <= 2, 'the hull cache broke its own ceiling');
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
