// Extra attacker types, introduced hull by hull.
//
// Interceptors teach dodging and turrets teach prioritising. These four each
// ask a different question, and which ones appear is listed per level in
// LEVELS[].foes, so the hulls escalate in kind as well as in number.

import {
  FIELD_TOP, FIELD_BOT, VIEW_W, APRON, clamp,
} from './config.js';
import { makePool } from './pool.js';
import { award } from './score.js';
import { enemyShots, fire } from './projectiles.js';
import { explode, sparks } from './particles.js';
import { sfxTurretShot, sfxEnemyHit, sfxExplode } from './sfx.js';
import { spoils } from './pickups.js';
import { kick } from './camera.js';

export const SPEC = {
  // Drifts at you and detonates. Cheap to kill, expensive to ignore.
  mine:    { hp: 2, speed: 54, score: 120, r: 9, blastR: 54, blastDmg: 26, fuse: 0.45 },
  // Telegraphs, then charges flat out. Punishes sitting in a lane.
  lancer:  { hp: 3, speed: 420, score: 220, r: 11, windup: 0.85, driftSpeed: 60 },
  // Parks and sprays radially. Forces you to close or leave.
  orbiter: { hp: 4, speed: 92, score: 260, r: 12, orbitR: 34, fireEvery: 1.25, bullets: 7 },
  // Frontal shield: only hurt from above, below or behind.
  warder:  { hp: 5, speed: 120, score: 320, r: 13, fireEvery: 1.5, arc: 1.05 },
  // Fast and erratic. Nothing to out-think, everything to out-aim.
  weaver:  { hp: 2, speed: 290, score: 180, r: 9, amp: 76, freq: 5.2 },
  // Breaks into two halves that keep coming. Killing it early is cheaper.
  splitter:{ hp: 6, speed: 130, score: 300, r: 15, fireEvery: 1.8, children: 2 },
  // A half-size splitter. Only ever spawned, never rolled for.
  shard:   { hp: 2, speed: 240, score: 90, r: 8, fireEvery: 2.4 },
  // Seeds mines along its path, so ignoring it costs you the lane.
  bomber:  { hp: 5, speed: 108, score: 340, r: 14, dropEvery: 1.15 },
  // Latches on and drains the shield until it is shot off.
  leech:   { hp: 3, speed: 210, score: 260, r: 10, drain: 11, grabR: 15 },
};

export const foes = makePool(26, () => ({
  kind: 'mine', x: 0, y: 0, baseY: 0, vx: 0, vy: 0,
  hp: 0, t: 0, cd: 0, state: 0, dead: false, flash: 0, facing: -1,
}));

export function resetFoes() { foes.clear(); }

export function spawnFoe(game, kind) {
  const spec = SPEC[kind];
  if (!spec) return null;
  const f = foes.spawn();
  if (!f) return null;
  const p = game.player;
  const ahead = p.facing > 0;

  f.kind = kind;
  f.facing = ahead ? -1 : 1;
  f.x = ahead ? game.cam.x + VIEW_W + 26 : game.cam.x - 26;
  f.baseY = FIELD_TOP + 26 + Math.random() * (FIELD_BOT - FIELD_TOP - 52);
  f.y = f.baseY;
  f.vx = 0; f.vy = 0;
  f.hp = spec.hp;
  f.t = 0;
  f.cd = 0.4 + Math.random() * 0.8;
  f.state = 0;
  f.flash = 0;
  return f;
}

// Picks one of the kinds this hull fields.
export function spawnFoeForLevel(game) {
  const list = game.level.spec.foes;
  if (!list || !list.length) return null;
  return spawnFoe(game, list[Math.floor(Math.random() * list.length)]);
}

export function updateFoes(game, dt) {
  const p = game.player;

  for (let i = foes.count - 1; i >= 0; i--) {
    const f = foes.items[i];
    const spec = SPEC[f.kind];
    f.t += dt;
    if (f.flash > 0) f.flash -= dt;

    switch (f.kind) {
      case 'mine': {
        // creeps toward the ship; detonates when close
        const dx = p.x - f.x;
        const dy = p.y - f.y;
        const d = Math.hypot(dx, dy) || 1;
        f.x += (dx / d) * spec.speed * dt;
        f.baseY += (dy / d) * spec.speed * dt;
        f.y = f.baseY;
        if (p.alive && d < spec.blastR * 0.42) { detonate(game, f, i); continue; }
        break;
      }

      case 'lancer': {
        if (f.state === 0) {
          // windup: drift and line up on the ship's altitude
          f.baseY += clamp(p.y - f.baseY, -spec.driftSpeed * dt, spec.driftSpeed * dt);
          f.y = f.baseY;
          f.x += f.facing * 42 * dt;
          if (f.t > spec.windup) { f.state = 1; sfxTurretShot(); }
        } else {
          f.x += f.facing * spec.speed * dt;
        }
        break;
      }

      case 'orbiter': {
        // slides to a station, then circles it and fires outward
        if (f.state === 0) {
          f.x += f.facing * spec.speed * dt;
          const target = game.cam.x + (f.facing < 0 ? VIEW_W * 0.68 : VIEW_W * 0.32);
          if ((f.facing < 0 && f.x <= target) || (f.facing > 0 && f.x >= target)) f.state = 1;
        } else {
          f.x += Math.cos(f.t * 1.7) * spec.orbitR * dt * 1.6;
          f.baseY += Math.sin(f.t * 1.7) * spec.orbitR * dt * 1.6;
        }
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.fireEvery;
          for (let k = 0; k < spec.bullets; k++) {
            const a = f.t + (k / spec.bullets) * Math.PI * 2;
            fire(enemyShots, f.x, f.y, Math.cos(a) * 150, Math.sin(a) * 150, 4, 8, 2);
          }
          sfxTurretShot();
        }
        break;
      }

      case 'weaver': {
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -70 * dt, 70 * dt);
        f.y = f.baseY + Math.sin(f.t * spec.freq) * spec.amp;
        break;
      }

      case 'splitter':
      case 'shard': {
        f.x += f.facing * spec.speed * dt;
        f.baseY += Math.sin(f.t * 1.3) * 42 * dt;
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.fireEvery;
          const a = Math.atan2(p.y - f.y, p.x - f.x);
          fire(enemyShots, f.x, f.y, Math.cos(a) * 185, Math.sin(a) * 185, 4, 9, 2);
          sfxTurretShot();
        }
        break;
      }

      case 'bomber': {
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -30 * dt, 30 * dt);
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.dropEvery;
          const m = spawnFoe(game, 'mine');
          if (m) { m.x = f.x; m.baseY = f.y; m.y = f.y; }
        }
        break;
      }

      case 'leech': {
        if (f.state === 0) {
          // close on the ship
          const dx = p.x - f.x;
          const dy = p.y - f.y;
          const d = Math.hypot(dx, dy) || 1;
          f.x += (dx / d) * spec.speed * dt;
          f.baseY += (dy / d) * spec.speed * dt;
          f.y = f.baseY;
          if (p.alive && d < spec.grabR) { f.state = 1; }
        } else {
          // attached: rides along, draining, until shot off
          f.x = p.x - p.facing * 14;
          f.y = p.y;
          f.baseY = p.y;
          if (p.alive && p.invuln <= 0) {
            p.shield -= spec.drain * dt;
            if (Math.random() < dt * 8) sparks(f.x, f.y, 0, -1, 2, '#9ad94e');
          }
          if (!p.alive) foes.kill(i);
        }
        break;
      }

      default: { // warder
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -46 * dt, 46 * dt);
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.fireEvery;
          const a = Math.atan2(p.y - f.y, p.x - f.x);
          for (let k = -1; k <= 1; k++) {
            fire(enemyShots, f.x, f.y, Math.cos(a + k * 0.2) * 190, Math.sin(a + k * 0.2) * 190, 4, 9, 2);
          }
          sfxTurretShot();
        }
        break;
      }
    }

    f.y = clamp(f.y, FIELD_TOP + 8, FIELD_BOT - 8);
    f.baseY = clamp(f.baseY, FIELD_TOP + 8, FIELD_BOT - 8);

    if (f.x < game.cam.x - 160 || f.x > game.cam.x + VIEW_W + 160) { foes.kill(i); continue; }

    // ramming
    if (p.alive && p.invuln <= 0
      && Math.abs(f.x - p.x) < spec.r + 9 && Math.abs(f.y - p.y) < spec.r + 5) {
      if (f.kind === 'mine') { detonate(game, f, i); continue; }
      p.shield -= 18;
      game.flash = Math.max(game.flash, 0.35);
      kick(game.cam, 5);
      p.invuln = 0.35;
    }
  }
}

function detonate(game, f, i) {
  const spec = SPEC.mine;
  const p = game.player;
  explode(f.x, f.y, 1.7);
  sfxExplode(1.6);
  kick(game.cam, 7);
  if (p.alive && p.invuln <= 0 && Math.hypot(p.x - f.x, p.y - f.y) < spec.blastR) {
    p.shield -= spec.blastDmg;
    game.flash = Math.max(game.flash, 0.45);
  }
  foes.kill(i);
}

// A warder's frontal plate eats anything arriving within `arc` of head-on.
export function foeShielded(f, sx, sy) {
  if (f.kind !== 'warder') return false;
  const toward = Math.atan2(sy - f.y, sx - f.x);
  const front = f.facing < 0 ? Math.PI : 0;
  const d = Math.abs(((toward - front + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return d < SPEC.warder.arc;
}

// Returns true if the shot was consumed.
export function hitFoe(game, index, sx, sy, dmg) {
  const f = foes.items[index];
  const spec = SPEC[f.kind];

  if (foeShielded(f, sx, sy)) {
    sparks(sx, sy, -1, 0, 3, '#8e9aa9');
    return true;      // absorbed by the plate
  }

  f.hp -= dmg;
  f.flash = 0.08;
  if (f.hp > 0) {
    sparks(sx, sy, -1, 0, 4, '#ffd24a');
    sfxEnemyHit();
    return true;
  }

  if (f.kind === 'mine') { detonate(game, f, index); }
  else {
    explode(f.x, f.y, 1.2);
    sfxExplode(1.1);
    spoils(game, f.x, f.y, f.kind);
    const wasSplitter = f.kind === 'splitter';
    const sx = f.x;
    const sy = f.y;
    const dir = f.facing;
    foes.kill(index);
    if (wasSplitter) {
      // halves peel off above and below, so killing it late is worse
      for (let k = 0; k < SPEC.splitter.children; k++) {
        const c = spawnFoe(game, 'shard');
        if (!c) break;
        c.x = sx;
        c.baseY = clamp(sy + (k ? 26 : -26), FIELD_TOP + 10, FIELD_BOT - 10);
        c.y = c.baseY;
        c.facing = dir;
      }
    }
  }
  award(game, spec.score);
  return true;
}
