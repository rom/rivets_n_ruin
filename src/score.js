// Difficulty, and the one way points are awarded.
//
// This lives on its own rather than in game.js because every module that
// deals damage or pays out needs it, and routing them all through the
// orchestrator made four import cycles out of nothing.

import { DIFFICULTY } from './config.js';
import { get as setting } from './settings.js';

// The active difficulty multipliers. Read live, so a change on the settings
// screen applies to the next run without a reload. Other modules call this
// rather than reading the setting themselves, so there is one place that
// decides what a difficulty actually means.
export function diff() {
  const i = Math.max(0, Math.min(DIFFICULTY.length - 1, Number(setting('difficulty')) || 0));
  return DIFFICULTY[i];
}

// Every point the player earns goes through here, so the difficulty payout
// cannot be forgotten at one of the sixteen places that award something.
// Rounded at the point of award, not at the end, so the HUD total is always
// the sum of what it showed.
export function award(game, points) {
  const n = Math.round(points * diff().scoreMul);
  game.score += n;
  return n;
}

// What one enemy hit costs on this hull, as a multiplier.
//
// Lives next to diff() for the same reason diff() lives here: several
// modules deal damage to the player and routing them through the
// orchestrator would make import cycles out of nothing. Both multipliers
// apply — the hull says how dangerous the ship's surroundings are, the
// difficulty says how dangerous the player asked for.
//
// Only enemies scale. Flying into the hull does not: the hull is the hull,
// and a slam costing more on ORICHALCUM than on ARGENTUM would be the game
// lying about its own geometry. Nor does your own ordnance going off in
// your face, which is a mistake with a fixed price.
export function hullDmg(game) {
  const n = game && game.level && game.level.spec && game.level.spec.enemyDmg;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// The one way the player takes damage from something hostile, so neither
// multiplier can be forgotten at one of the places that deals it.
export function hurt(game, amount) {
  const p = game.player;
  const n = amount * diff().enemyDmg * hullDmg(game);
  p.shield -= n;
  return n;
}
