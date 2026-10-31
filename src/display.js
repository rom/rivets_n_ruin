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

export const MAX_SCALE = 3;

const S = {
  scale: 1, cssW: VIEW_W, cssH: VIEW_H, generation: 0,
  wanted: 1,        // what the window would like, before any throttling
  cap: 1,              // what the machine has proven it can sustain
  failedAt: Infinity,  // the lowest scale that proved too slow
  refresh: Infinity,   // estimated display period, ms
  recent: [],          // rolling interval samples backing that estimate
  budget: [],
  cooldown: 0,
};

export const renderScale = () => S.scale;
// Bumped whenever the scale changes, so caches keyed on it can invalidate.
export const scaleGeneration = () => S.generation;

// Chooses the backing-store scale for the space available.
export function computeScale(cssW, cssH, dpr = window.devicePixelRatio || 1) {
  const fit = Math.min(cssW / VIEW_W, cssH / VIEW_H);
  // Round to halves: enough steps to track a window smoothly without
  // thrashing the hull cache on every pixel of a drag-resize.
  const want = Math.round(fit * dpr * 2) / 2;
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
  const capped = Math.min(scale, S.cap);
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
