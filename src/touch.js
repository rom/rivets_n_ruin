// On-screen controls, for the machines that have no keyboard.
//
// The buttons drive the same two sets the keyboard drives — see
// touchDown/touchUp in input.js — so nothing downstream knows or cares
// which one a player is using. A run flown with a thumb goes through the
// identical update path as one flown with a hand on the arrows.
//
// The layout is data in logical screen coordinates, the same 640x384 the
// HUD is laid out in, so it scales with everything else and a test can
// measure it without a browser. Hit testing is on the same numbers the
// drawing uses: a button you can see and cannot press, or press and
// cannot see, is the worst bug this file could have.

import { VIEW_W, FIELD_H, HUD_Y, COL } from './config.js';
import { touchHeld } from './input.js';

// Thumbs are not mice. Apple and Google both land on about 44 device-
// independent pixels as the smallest comfortable target.
//
// This is a floor in LOGICAL pixels, not a promise in CSS ones, and the
// difference is worth being straight about: the playfield is a fixed
// 640x384 letterboxed into whatever screen it gets, so the buttons
// shrink with everything else. On an iPhone 13 held sideways the canvas
// comes out 570 CSS px wide, a ratio of 0.89, and a 48-logical button
// lands at about 43 CSS px — just under the platform guidance and about
// as large as this layout allows without the controls covering the hull
// you are trying to fly along. On a tablet they are comfortably over.
export const MIN_TOUCH = 48;

// `when` is which states a control belongs to: 'play' for the ones you
// fly with, 'menu' for the ones that answer a screen, 'always' for the
// two that must work wherever you are.
export const PADS = [
  // --- flight, bottom left: a four-way pad under the left thumb,
  // centred on (96, 244) with arms that do not overlap each other
  { id: 'left', action: 'left', when: 'play', shape: 'pad', x: 44, y: 244, w: 52, h: 48, glyph: '<' },
  { id: 'right', action: 'right', when: 'play', shape: 'pad', x: 148, y: 244, w: 52, h: 48, glyph: '>' },
  { id: 'up', action: 'up', when: 'play', shape: 'pad', x: 96, y: 194, w: 48, h: 52, glyph: '^' },
  { id: 'down', action: 'down', when: 'play', shape: 'pad', x: 96, y: 294, w: 48, h: 52, glyph: 'v' },

  // --- weapons, bottom right, under the other thumb
  { id: 'fire', action: 'fire', when: 'play', shape: 'round', x: 574, y: 268, r: 36, glyph: 'FIRE' },
  { id: 'secondary', action: 'secondary', when: 'play', shape: 'round', x: 492, y: 222, r: 28, glyph: 'ORD' },
  { id: 'cycle', action: 'cycle', when: 'play', shape: 'round', x: 568, y: 178, r: 25, glyph: 'CYC' },

  // --- the ones that must work wherever you are. A phone has no Escape
  // key, so the pause button is on every screen including the menus.
  { id: 'start', action: 'start', when: 'menu', shape: 'wide', x: 320, y: 298, w: 184, h: 50, glyph: 'START' },
  { id: 'pause', action: 'pause', when: 'always', shape: 'round', x: 604, y: 42, r: 25, glyph: 'II' },
  { id: 'options', action: 'options', when: 'menu', shape: 'round', x: 36, y: 42, r: 25, glyph: 'SET' },
];

// Which controls belong on screen in this game state. Flying gets the
// pad and the guns; a menu gets START and the way into settings; the
// pause button is on both, because a phone has no Escape key.
export function padsFor(state) {
  const flying = state === 'play' || state === 'dying';
  return PADS.filter((b) => b.when === 'always' || (b.when === 'play') === flying);
}

// The rectangle a control answers to. Round buttons get a square of
// their diameter, which is both what a thumb hits and what makes this
// measurable without trigonometry.
export function hitBox(b) {
  if (b.shape === 'round') return { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 };
  return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
}

// Which control a point lands on, or null. Takes logical coordinates.
export function padAt(state, x, y) {
  for (const b of padsFor(state)) {
    const r = hitBox(b);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return b;
  }
  return null;
}

// --- drawing
//
// Deliberately quiet. These sit on top of the playfield and a pilot has
// to be able to see what is behind them, so they are outlines with a
// dim fill that only comes up when a thumb is on them.

function face(ctx, b, lit) {
  const r = hitBox(b);
  ctx.globalAlpha = lit ? 0.5 : 0.16;
  ctx.fillStyle = COL.hudLine;
  ctx.globalAlpha = lit ? 0.42 : 0.14;
  if (b.shape === 'round') {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.globalAlpha = lit ? 1 : 0.5;
  ctx.strokeStyle = lit ? COL.coolHi : COL.cool;
  ctx.lineWidth = 1.5;
  if (b.shape === 'round') {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
  ctx.globalAlpha = 1;
}

export function drawPads(ctx, state) {
  const list = padsFor(state);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of list) {
    const lit = touchHeld(b.action);
    face(ctx, b, lit);
    ctx.fillStyle = lit ? COL.coolHi : COL.cool;
    ctx.globalAlpha = lit ? 1 : 0.75;
    const big = b.glyph.length <= 2;
    ctx.font = `bold ${big ? 17 : 11}px ui-monospace, Menlo, monospace`;
    ctx.fillText(b.glyph, b.x, b.y + (big ? 1 : 0));
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
