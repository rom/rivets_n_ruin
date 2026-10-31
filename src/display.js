// Display scaling.
//
// The game is written entirely in a 640x360 logical coordinate system, which
// is what every gameplay constant assumes. What changed is that the canvas
// backing store is no longer 640x360: it is that times a render scale chosen
// from the window size and the device pixel ratio, and the context carries a
// matching transform. So all drawing code is unchanged, but strokes, sprites
// and above all text are rasterised at display resolution instead of being
// drawn into 640x360 and then blown up by CSS.
//
// The cap exists because the hull texture is cached per scale: see level.js.

import { VIEW_W, VIEW_H } from './config.js';

// Raised past 3 because 3 still leaves a 4K window upscaling ~2x. The cost
// is bounded by the adaptive scaler, which only climbs this far on hardware
// that demonstrably keeps up, and by HULL_MAX_SCALE below, which stops the
// hull texture cache from scaling with the square of this number.
export const MAX_SCALE = 4;

// The hull is texture rather than line art, so rasterising it beyond 2x buys
// very little and costs a great deal: chunk memory grows with the square of
// the scale. It is rendered at this cap and smoothly upscaled; text, sprites
// and the HUD still get the full scale, which is where blockiness shows.
export const HULL_MAX_SCALE = 2;
export const hullScale = () => Math.min(S.scale, HULL_MAX_SCALE);

const S = {
  scale: 1, cssW: VIEW_W, cssH: VIEW_H, generation: 0,
  wanted: 1,        // what the window would like, before any throttling
  cap: 1,              // what the machine has proven it can sustain
  failedAt: Infinity,  // the lowest scale that proved too slow
  refresh: Infinity,   // estimated display period, ms
  recent: [],          // rolling interval samples backing that estimate
  budget: [],
  cooldown: 0,
  static: false,       // a menu is up: see setStatic
};

// --- static mode
//
// The adaptive cap exists to protect the frame rate of a scrolling hull with
// a few hundred sprites on it. A menu has none of that: it is a dim rect and
// some text over a frozen world, and it does not need protecting.
//
// Without this the overview, the armourer and the settings page all rendered
// at whatever cap gameplay had settled on — on a 2560px window that meant a
// 960x540 backing store upscaled 2.6x by the browser, which is exactly as
// blocky as it sounds. They now render at the full window scale, and the
// frames they produce are kept out of the adaptive estimate entirely, so a
// cheap menu cannot talk the scaler into a cap that gameplay then has to
// live with.
export const isStatic = () => S.static;

export function setStatic(on) {
  if (S.static === !!on) return false;
  S.static = !!on;
  return true;
}

const targetScale = () => (S.static ? S.wanted : Math.min(S.wanted, S.cap));

export const renderScale = () => S.scale;
// Bumped whenever the scale changes, so caches keyed on it can invalidate.
export const scaleGeneration = () => S.generation;

// Chooses the backing-store scale for the space available.
export function computeScale(cssW, cssH, dpr = window.devicePixelRatio || 1) {
  const fit = Math.min(cssW / VIEW_W, cssH / VIEW_H);
  // Round UP to the next half. Rounding to nearest leaves the backing store
  // smaller than the CSS box, so the browser upscales what we just took care
  // to render sharply — at a 1400px window that was still a 1.08x blur.
  const want = Math.ceil(fit * dpr * 2) / 2;
  return Math.max(1, Math.min(MAX_SCALE, want));
}

// Sizes the canvas and returns true if the scale actually changed.
export function fitCanvas(canvas, ctx) {
  const availW = window.innerWidth;
  const availH = window.innerHeight - 40;
  const fit = Math.min(availW / VIEW_W, availH / VIEW_H);

  const cssW = Math.round(VIEW_W * fit);
  const cssH = Math.round(VIEW_H * fit);
  const scale = computeScale(cssW, cssH);

  S.wanted = scale;
  const capped = targetScale();
  const changed = capped !== S.scale;
  S.scale = capped;
  S.cssW = cssW;
  S.cssH = cssH;
  if (changed) S.generation++;

  canvas.width = Math.round(VIEW_W * S.scale);
  canvas.height = Math.round(VIEW_H * S.scale);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';

  // Resizing a canvas resets its context state, so re-apply everything.
  applyTransform(ctx);
  return changed;
}

// Puts the context back into logical coordinates. Must be called after any
// canvas resize, and at the top of each frame.
export function applyTransform(ctx) {
  ctx.setTransform(S.scale, 0, 0, S.scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

// --- adaptive scaling
//
// Resolution is not free: every full-screen pass costs pixels, and a machine
// without GPU-accelerated canvas can be four times slower at 2x than at 1x.
// Rather than pick a conservative scale for everyone, the game watches its
// own frame times and backs off only on hardware that cannot keep up — and
// climbs again if it turns out it can.

// Start conservative and climb.
//
// Two things make this harder than "measure fps and react":
//
//  - On a vsync-locked display the frame interval can never fall below the
//    refresh period, so an absolute "fast enough" threshold in milliseconds
//    can never be met at 60Hz. Everything is therefore judged relative to
//    the fastest interval actually observed, which estimates the refresh.
//  - Without hysteresis the scaler oscillates: it climbs to a scale that is
//    too slow, drops back, finds headroom, climbs again. So a scale that has
//    once proven too slow is never attempted again this session.

// Calibrate at scale 1, where the renderer is cheapest, so the first
// refresh estimate reflects the display rather than our own cost.
const START_CAP = 1;
const DOWN_SAMPLE = 18;    // react to being slow quickly
const UP_SAMPLE = 80;      // and to having headroom slowly
const DOWN_COOLDOWN = 24;
const UP_COOLDOWN = 110;
const SLOW_RATIO = 1.35;   // median this much worse than refresh = struggling
const COMFY_RATIO = 1.18;  // median this close to refresh = keeping up
const STEP = 0.5;

const median = (arr) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a[a.length >> 1];
};

// The decision itself, as a pure function so it can be tested without a DOM
// or a real display. Returns the new cap, or null to leave it alone.
export function decideScale(st) {
  const { cap, failedAt, refresh, samples, phase } = st;
  if (!Number.isFinite(refresh) || !samples.length) return null;
  const med = median(samples);

  if (phase === 'down' && med > refresh * SLOW_RATIO && cap > 1) {
    return Math.max(1, cap - STEP);
  }
  if (phase === 'up') {
    const next = Math.min(MAX_SCALE, cap + STEP);
    if (next < failedAt && next > cap && med < refresh * COMFY_RATIO) return next;
  }
  return null;
}

export function reportFrame(ms, canvas, ctx) {
  // A menu frame says nothing about whether gameplay can hold its rate, in
  // either direction: it is cheaper to draw and it renders at a different
  // scale. Measuring it would either talk the cap up on evidence that does
  // not apply, or down because the resize itself cost a frame.
  if (S.static) return false;

  // Estimate the display period from a low percentile of recent intervals.
  if (ms > 4 && ms < 200) {
    S.recent.push(ms);
    if (S.recent.length > 120) S.recent.shift();
    if (S.recent.length >= 20) {
      const a = S.recent.slice().sort((x, y) => x - y);
      // Monotonically non-increasing. If the estimate were allowed to rise,
      // a slow scale would redefine "normal" as its own bad frame time and
      // the scaler would never step back down — it would climb into a hole
      // and stay there. A low percentile filters outlier-fast frames; the
      // min() keeps the estimate honest about the display's real ceiling.
      S.refresh = Math.min(S.refresh, a[Math.floor(a.length * 0.15)]);
    }
  }
  if (!Number.isFinite(S.refresh)) return false;

  if (S.cooldown > 0) { S.cooldown--; return false; }
  S.budget.push(ms);

  for (const [need, phase, cool] of [[DOWN_SAMPLE, 'down', DOWN_COOLDOWN], [UP_SAMPLE, 'up', UP_COOLDOWN]]) {
    if (S.budget.length < need) continue;
    const next = decideScale({
      cap: S.cap, failedAt: S.failedAt, refresh: S.refresh,
      samples: S.budget, phase,
    });
    if (phase === 'up') S.budget.length = 0;
    if (next === null) continue;
    if (next < S.cap) S.failedAt = Math.min(S.failedAt, S.cap);
    S.cap = next;
    S.budget.length = 0;
    S.cooldown = cool;
    return fitCanvas(canvas, ctx);
  }
  return false;
}

export const scaleCap = () => S.cap;
export const wantedScale = () => S.wanted;
export const refreshEstimate = () => S.refresh;

export const TUNING = { MAX_SCALE, START_CAP, SLOW_RATIO, COMFY_RATIO, STEP, DOWN_SAMPLE, UP_SAMPLE };
