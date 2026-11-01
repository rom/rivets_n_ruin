// Minibosses.
//
// The gap between an attacker you kill in two shots and a boss that gates
// the hull is large, and a long hull with nothing in it but that gap gets
// flat. A miniboss arrives mid-hull, has a name and a health bar, and takes
// real attention — but it does not wall you in and it can be outrun. The
// reward for stopping is the loot; the cost is everything else that keeps
// spawning while you do.

import {
  FIELD_TOP, FIELD_BOT, VIEW_W, APRON, clamp, CULL_MARGIN,
} from './config.js';
import { makePool } from './pool.js';
import { drawMiniBody } from './miniart.js';
import { enemyShots, fire } from './projectiles.js';
import { explode, sparks, addLight } from './particles.js';
import { kick } from './camera.js';
import { sfxExplode, sfxEnemyHit, sfxTurretShot } from './sfx.js';
import { spoils, scatterCoins, spawnPickup } from './pickups.js';
import { diff, award } from './score.js';

// How far behind the view a miniboss gets before it gives up. Its own
// number rather than CULL_MARGIN: outrunning one is a real choice the
// hull offers, and that choice needs a nearer line than "far enough that
// you cannot have meant to come back".
const OUTRUN_BY = 320;

export const KINDS = {
  hauler: {
    name: 'ORE HAULER', hp: 70, score: 2400, r: 30,
    speed: 54, cycle: 1.5, bullets: 9, bulletSpeed: 150,
    // Slow and fat, sheds coins as it is damaged. The easy one.
    bleeds: true, colour: '#d9a62e',
  },
  cutter: {
    name: 'ARC CUTTER', hp: 95, score: 3200, r: 26,
    speed: 128, cycle: 1.15, bullets: 5, bulletSpeed: 230,
    // Keeps pace with you and fires tight aimed spreads.
    tracks: true, colour: '#4fd0e8',
  },
  bulwark: {
    name: 'BULWARK', hp: 150, score: 4200, r: 34,
    speed: 72, cycle: 1.3, bullets: 14, bulletSpeed: 170,
    // Radial walls and a lot of health. Expensive to stop for.
    radial: true, colour: '#b45ce0',
  },
  harrier: {
    name: 'HARRIER PACK', hp: 120, score: 3800, r: 24,
    speed: 190, cycle: 0.9, bullets: 4, bulletSpeed: 255,
    // Fast, and calls escorts while it runs rings around you.
    tracks: true, escorts: true, colour: '#e8434f',
  },
};

// Which hull fields which, and how many appear along it.
export function rosterFor(levelIndex) {
  const all = ['hauler', 'cutter', 'bulwark', 'harrier'];
  return all.slice(0, Math.min(all.length, 1 + Math.floor(levelIndex / 2)));
}

export const minis = makePool(4, () => ({
  kind: 'hauler', spec: null, x: 0, y: 0, baseY: 0, hp: 0, maxHp: 0,
  t: 0, cd: 0, flash: 0, dead: false, deathT: 0, facing: -1, bled: 0, seen: false,
}));

export const resetMinis = () => minis.clear();
export const liveMini = () => (minis.count ? minis.items[0] : null);

// Spawn points: evenly spread along the hull, away from both aprons and
// away from the boss arena, so a miniboss never crowds either.
export function planMinis(level, levelIndex) {
  const n = 1 + Math.floor(levelIndex / 2);
  const first = APRON * 2;
  const last = level.length - VIEW_W - APRON;
  const span = last - first;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: first + (span * (i + 1)) / (n + 1), spawned: false });
  }
  return out;
}

export function updateMinis(game, dt) {
  const p = game.player;

  // trigger: the player passes a planned point on the outbound leg
  if (game.miniPlan && !game.boss) {
    for (const slot of game.miniPlan) {
      if (slot.spawned || p.x < slot.x - VIEW_W * 0.55) continue;
      slot.spawned = true;
      const roster = rosterFor(game.levelIndex);
      spawnMini(game, roster[Math.floor(Math.random() * roster.length)], slot.x);
    }
  }

  // A miniboss never shares the arena with a boss: the fight at the far end
  // is meant to read as one room with one thing in it, so anything still
  // alive breaks off and runs for the open hull behind you.
  const fleeing = !!game.boss;

  for (let i = minis.count - 1; i >= 0; i--) {
    const m = minis.items[i];
    const spec = m.spec;
    m.t += dt;
    if (m.flash > 0) m.flash -= dt;

    if (m.dead) {
      m.deathT -= dt;
      if (Math.random() < dt * 9) explode(m.x + (Math.random() - 0.5) * 50, m.y + (Math.random() - 0.5) * 50, 1.2);
      if (m.deathT <= 0) minis.kill(i);
      continue;
    }

    // movement
    if (fleeing) {
      m.x -= spec.speed * 1.7 * dt;
    } else if (spec.tracks) {
      m.baseY += clamp(p.y - m.baseY, -spec.speed * dt, spec.speed * dt);
      m.x += Math.sign(p.x - m.x + 180) * spec.speed * 0.45 * dt;
    } else {
      m.baseY += Math.sin(m.t * 0.9) * 40 * dt;
      m.x += m.facing * spec.speed * dt;
    }
    m.y = clamp(m.baseY + Math.sin(m.t * 1.4) * 12, FIELD_TOP + spec.r, FIELD_BOT - spec.r);

    // firing
    m.cd -= dt;
    if (m.cd <= 0 && !fleeing && game.state === 'play' && p.alive) {
      m.cd = spec.cycle;
      if (spec.radial) {
        for (let k = 0; k < spec.bullets; k++) {
          const a = m.t + (k / spec.bullets) * Math.PI * 2;
          fire(enemyShots, m.x, m.y, Math.cos(a) * spec.bulletSpeed, Math.sin(a) * spec.bulletSpeed, 4.5, 10, 2);
        }
      } else {
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        for (let k = 0; k < spec.bullets; k++) {
          const off = (k - (spec.bullets - 1) / 2) * 0.13;
          fire(enemyShots, m.x, m.y, Math.cos(a + off) * spec.bulletSpeed, Math.sin(a + off) * spec.bulletSpeed, 4, 10, 2);
        }
      }
      sfxTurretShot();
      if (spec.escorts && Math.random() < 0.6) game.onMiniEscort?.();
    }

    // Despawn well behind: a miniboss can be outrun, and should be. Ahead
    // of the camera it is only culled once it has actually been on screen —
    // it spawns beyond the right edge by design, and if the camera is still
    // catching up (a respawn, a hull load) the ahead test would otherwise
    // cull it on its very first frame, burning the slot and leaving nothing
    // behind but the arrival toast.
    if (m.x < game.cam.x + VIEW_W) m.seen = true;
    if (m.x < game.cam.x - OUTRUN_BY
      || (m.seen && m.x > game.cam.x + VIEW_W + CULL_MARGIN)) {
      minis.kill(i);
    }

    // ramming
    if (p.alive && p.invuln <= 0
      && Math.abs(m.x - p.x) < spec.r + 10 && Math.abs(m.y - p.y) < spec.r + 6) {
      p.shield -= 22 * diff().enemyDmg;
      p.invuln = 0.4;
      kick(game.cam, 6);
      game.flash = Math.max(game.flash, 0.4);
    }
  }
}

// Puts one on the hull. Exported so the gallery and the tests can ask for a
// particular kind instead of rolling for it.
export function spawnMini(game, kind, atX) {
  const spec = KINDS[kind];
  if (!spec) return null;
  const m = minis.spawn();
  if (!m) return null;
  m.kind = kind;
  m.spec = spec;
  m.x = Math.max(atX, game.cam.x + VIEW_W + 40);
  m.baseY = (FIELD_TOP + FIELD_BOT) / 2;
  m.y = m.baseY;
  // scales with the hull, and with the difficulty, like everything else
  m.maxHp = Math.round(spec.hp * (1 + game.levelIndex * 0.22) * diff().bossHp);
  m.hp = m.maxHp;
  m.t = 0;
  m.cd = 1.2;
  m.flash = 0;
  m.dead = false;
  m.deathT = 0;
  m.facing = -1;
  m.bled = 0;
  m.seen = false;
  game.onMiniArrive?.(spec.name);
  return m;
}

export function hitMini(game, index, sx, sy, dmg) {
  const m = minis.items[index];
  if (m.dead) return false;
  m.hp -= dmg;
  m.flash = 0.08;

  // a hauler sheds coins as it comes apart, so hurting it pays before it dies
  if (m.spec.bleeds) {
    const shed = Math.floor((1 - m.hp / m.maxHp) * 14) - m.bled;
    if (shed > 0) { scatterCoins(game, m.x, m.y, shed); m.bled += shed; }
  }

  if (m.hp > 0) {
    sparks(sx, sy, -1, 0, 4, '#ffd24a');
    sfxEnemyHit();
    return true;
  }

  m.dead = true;
  m.deathT = 1.3;
  award(game, m.spec.score);
  explode(m.x, m.y, 2.6, '#ffd24a', m.spec.colour);
  addLight(m.x, m.y, 130, 0.4, m.spec.colour);
  sfxExplode(2.2);
  kick(game.cam, 11);
  spoils(game, m.x, m.y, 'mini');
  return true;
}

// A shot against the whole pool. Mirrors hitBoss: returns whether the shot
// was consumed, so the collision loop does not need to know the geometry.
export function hitMinis(game, sx, sy, dmg) {
  for (let i = minis.count - 1; i >= 0; i--) {
    const m = minis.items[i];
    if (m.dead) continue;
    const r = m.spec.r;
    if (Math.abs(sx - m.x) < r && Math.abs(sy - m.y) < r) return hitMini(game, i, sx, sy, dmg);
  }
  return false;
}

// Everything a homing missile may lock onto. A miniboss is the best target
// on the hull, so it had better be lockable.
export function miniTargets(out) {
  for (let i = 0; i < minis.count; i++) {
    const m = minis.items[i];
    if (!m.dead) out.push(m);
  }
}

// Minibosses are drawn as ships, not boxes. The hull they fly over is mid
// grey with grey blocks bolted to it, so a grey square with a stripe reads
// as scenery — each kind gets a silhouette of its own, a body darker than
// anything structural, and its accent colour on the parts that matter.
export function drawMinis(ctx) {
  for (let i = 0; i < minis.count; i++) {
    const m = minis.items[i];
    const spec = m.spec;
    const r = spec.r;
    const lit = m.flash > 0;
    const body = lit ? '#ffd24a' : '#141922';
    const hurt = 1 - m.hp / m.maxHp;
    const core = hurt > 0.66 ? '#e8434f' : hurt > 0.33 ? '#ff7a2f' : spec.colour;

    ctx.save();
    ctx.translate(Math.round(m.x), Math.round(m.y));
    if (m.dead) ctx.globalAlpha = 0.4 + 0.4 * Math.abs(Math.sin(m.deathT * 20));

    // engine wash out the back; they all came from somewhere at speed
    ctx.fillStyle = spec.colour;
    ctx.globalAlpha *= 0.35 + 0.25 * Math.sin(m.t * 11);
    ctx.fillRect(r - 2, -4, 9 + Math.sin(m.t * 17) * 3, 8);
    ctx.globalAlpha = m.dead ? 0.4 + 0.4 * Math.abs(Math.sin(m.deathT * 20)) : 1;

    // The bodies live in miniart.js, built from the same vocabulary as
    // the attackers: a dark hull with one lit upper surface, panel lines
    // and rivets for scale, engine bells on their own clock, a canopy or
    // an eye so you can see which way it is looking. Drawn inline here
    // out of bare polygons, they read as diagrams of ships rather than
    // ships, which is what they were.
    ctx.lineJoin = 'miter';
    drawMiniBody(ctx, m, spec, lit, core);
    ctx.restore();

    // Its own health bar, above it, on a dark plate so it never merges with
    // the ship's own trim at full health.
    if (!m.dead) {
      const w = Math.max(40, r * 2);
      const bx = Math.round(m.x) - w / 2;
      const by = Math.round(m.y) - r - 11;
      ctx.fillStyle = '#0a0d13';
      ctx.fillRect(bx - 2, by - 2, w + 4, 9);
      ctx.fillStyle = '#232b36';
      ctx.fillRect(bx, by, w, 5);
      ctx.fillStyle = core;
      ctx.fillRect(bx, by, Math.round(w * Math.max(0, m.hp / m.maxHp)), 5);
      ctx.fillStyle = spec.colour;
      ctx.fillRect(bx - 2, by + 7, w + 4, 1);
    }
  }
}

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
