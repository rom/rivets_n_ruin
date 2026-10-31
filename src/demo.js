// Attract mode.
//
// After two minutes of nobody touching anything, the game plays itself.
// This is the pilot: it is handed the real game state and returns the set
// of actions a player would be holding, which the input layer substitutes
// for the keyboard. It therefore flies the actual game through the actual
// update loop — not a scripted replay, and not a special code path that
// can quietly diverge from the one people play.
//
// It is deliberately a competent amateur rather than a perfect machine.
// An attract loop that never takes a hit tells you nothing about the game;
// one that dies on the first hull tells you the wrong thing.

import {
  FIELD_TOP, FIELD_BOT, VIEW_W, LASER, clamp,
} from './config.js';
import { obstaclesNear } from './level.js';
import { enemyShots } from './projectiles.js';
import { pickups, LOOT } from './pickups.js';
import { foes } from './foes.js';
import { interceptors } from './enemies.js';
import { minis } from './miniboss.js';
import { liveGates } from './gates.js';

export const IDLE_BEFORE_DEMO = 120;     // seconds

// How far ahead the pilot looks, and how finely it samples the lane.
const LOOK = 230;
const LANES = 13;
const EDGE = 26;

const laneY = (i) => FIELD_TOP + EDGE + ((FIELD_BOT - FIELD_TOP - EDGE * 2) * i) / (LANES - 1);

// Scores one candidate height: how safe it is, and what is worth being at.
// Higher is better. The weights are the whole of the pilot's personality.
function scoreLane(game, y) {
  const p = game.player;
  const ahead = p.x + LOOK;
  let s = 0;

  // Structure: a lane with a block in it is not a lane.
  for (const o of obstaclesNear(game.level, p.x - 20, ahead)) {
    if (y > o.y - 14 && y < o.y + o.h + 14) {
      const near = 1 - clamp((o.x - p.x) / LOOK, 0, 1);
      s -= 420 * (0.4 + near);
    }
  }

  // Incoming fire, weighted by how soon it arrives.
  for (let i = 0; i < enemyShots.count; i++) {
    const b = enemyShots.items[i];
    const dx = b.x - p.x;
    if (dx * (b.vx < 0 ? -1 : 1) > 0 && Math.abs(dx) > 260) continue;
    const d = Math.hypot(b.x - p.x, b.y - y);
    if (d < 70) s -= (70 - d) * (b.seek ? 4.5 : 3);
  }

  // Things that ram.
  for (const pool of [foes, interceptors, minis]) {
    for (let i = 0; i < pool.count; i++) {
      const e = pool.items[i];
      if (e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y - y);
      if (d < 120) s -= (120 - d) * 1.1;
      // but a thing ahead at this height is also a thing you can shoot
      if (e.x > p.x && e.x < ahead && Math.abs(e.y - y) < 12) s += 70;
    }
  }

  // Loot, which is what the bonus is paid on.
  for (let i = 0; i < pickups.count; i++) {
    const q = pickups.items[i];
    const d = Math.hypot(q.x - p.x, q.y - y);
    if (d > 260) continue;
    s += (260 - d) * (LOOT.has(q.kind) ? 0.5 : 0.9);
  }

  // The boss, which is the only thing that matters once it is up.
  const b = game.boss;
  if (b && !b.dead && b.entry <= 0) {
    const live = b.parts.filter((pt) => !pt.dead);
    const ty = live.length ? b.y + live[0].dy : b.y;
    s += 260 - Math.min(260, Math.abs(ty - y) * 3);
  }

  // A gate has to be answered at the emitter's height, not avoided.
  for (const g of liveGates(game.level)) {
    const dx = g.x - p.x;
    if (dx < -40 || dx > 420) continue;
    const ey = g.y + g.dir * (LASER.emitterH / 2);
    s += 420 - Math.min(420, Math.abs(ey - y) * 4);
  }

  // Stay off the girders.
  s -= Math.max(0, FIELD_TOP + EDGE - y) * 8;
  s -= Math.max(0, y - (FIELD_BOT - EDGE)) * 8;
  return s;
}

// One frame of flying, as the set of actions a player would be holding.
export function demoActions(game) {
  const a = new Set();
  const p = game.player;
  if (!p.alive || game.state !== 'play') {
    // Through the launch, the exit and the hull-clear screens, and past
    // the ten seconds of wreck-sweeping, it presses on.
    //
    // Pulsed, not held. Menus advance on tapped(), which is the frame an
    // action *starts*; a key the pilot never lets go of produces exactly
    // one edge and then nothing, so the demo reached the title and sat
    // there for as long as you left it.
    if (Math.floor(game.stateT * 4) % 2 === 0) a.add('start');
    return a;
  }

  // --- where to be
  let bestY = p.y;
  let best = -Infinity;
  for (let i = 0; i < LANES; i++) {
    const y = laneY(i);
    const sc = scoreLane(game, y) - Math.abs(y - p.y) * 0.55;
    if (sc > best) { best = sc; bestY = y; }
  }
  const dy = bestY - p.y;
  if (dy < -6) a.add('up');
  else if (dy > 6) a.add('down');

  // --- forward, unless a live gate is in the way and still has to be shot
  const blocking = liveGates(game.level)
    .find((g) => g.x > p.x - 10 && g.x - p.x < LASER.shipClear + 26);
  if (!blocking) a.add('right');

  // --- guns, always. There is nothing on a hull worth not shooting.
  a.add('fire');

  // --- ordnance, when something is worth spending it on
  const crowd = countAhead(game, 200);
  if (crowd >= 3 || (game.boss && !game.boss.dead)) {
    if ((game.time * 2) % 3 < 0.04) a.add('secondary');
  }

  // --- the wreck window: sweep it rather than pressing on
  if (game.lootT > 2) a.delete('right');
  return a;
}

function countAhead(game, range) {
  const p = game.player;
  let n = 0;
  for (const pool of [foes, interceptors]) {
    for (let i = 0; i < pool.count; i++) {
      const e = pool.items[i];
      if (e.x > p.x && e.x - p.x < range) n++;
    }
  }
  return n;
}
