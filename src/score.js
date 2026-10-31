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
