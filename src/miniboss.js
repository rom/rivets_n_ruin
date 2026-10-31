// Minibosses.
//
// The gap between an attacker you kill in two shots and a boss that gates
// the hull is large, and a long hull with nothing in it but that gap gets
// flat. A miniboss arrives mid-hull, has a name and a health bar, and takes
// real attention — but it does not wall you in and it can be outrun. The
// reward for stopping is the loot; the cost is everything else that keeps
// spawning while you do.

import {
  FIELD_TOP, FIELD_BOT, VIEW_W, APRON, clamp,
} from './config.js';
import { makePool } from './pool.js';
import { enemyShots, fire } from './projectiles.js';
import { explode, sparks, addLight } from './particles.js';
import { kick } from './camera.js';
import { sfxExplode, sfxEnemyHit, sfxTurretShot } from './sfx.js';
import { spoils, scatterCoins, spawnPickup } from './pickups.js';
import { diff, award } from './score.js';

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
  if (!game.returning && game.miniPlan) {
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
    if (m.x < game.cam.x - 320 || (m.seen && m.x > game.cam.x + VIEW_W + 420)) minis.kill(i);

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
  spoils(game, m.x, m.y, 'boss');
  spawnPickup(game, m.x, m.y - 30, 'coffin');
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

    ctx.lineJoin = 'miter';
    ctx.strokeStyle = spec.colour;
    ctx.lineWidth = 2;
    ctx.fillStyle = body;

    if (m.kind === 'hauler') {
      // A pirate ore freighter: slab hull, ore hoppers down the spine, a
      // bridge tower bolted on top and colours flown off the stern.
      poly(ctx, [[-r, -r * 0.5], [-r * 0.6, -r * 0.8], [r * 0.8, -r * 0.8],
        [r, -r * 0.4], [r, r * 0.4], [r * 0.8, r * 0.8], [-r * 0.6, r * 0.8], [-r, r * 0.5]]);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b323d';
      for (let k = -2; k <= 1; k++) ctx.fillRect(k * 13 + 2, -r * 0.6, 10, r * 1.2);
      ctx.fillStyle = core;
      for (let k = -2; k <= 1; k++) ctx.fillRect(k * 13 + 4, -r * 0.45, 6, 4);
      // bridge tower
      ctx.fillStyle = body;
      ctx.strokeStyle = spec.colour;
      ctx.beginPath();
      ctx.moveTo(-r + 1, -r * 0.8); ctx.lineTo(-r + 3, -r - 7);
      ctx.lineTo(-r + 14, -r - 7); ctx.lineTo(-r + 15, -r * 0.8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9ae8f8';
      ctx.fillRect(-r + 4, -r - 5, 8, 3);
      // colours, off the stern
      ctx.fillStyle = '#b02a3a';
      for (let k = 0; k <= 4; k++) {
        ctx.fillRect(r + 2 + k * 2, -8 + Math.sin(m.t * 5 + k) * 2, 2, 7);
      }
    } else if (m.kind === 'cutter') {
      // Alien: a ray, with two horns and the cutting arc strung between
      // them. Nothing on it is bolted to anything.
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.quadraticCurveTo(-r * 0.2, -r * 1.05, r * 0.95, -r * 0.5);
      ctx.quadraticCurveTo(r * 0.5, 0, r * 0.95, r * 0.5);
      ctx.quadraticCurveTo(-r * 0.2, r * 1.05, -r, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // horns
      ctx.strokeStyle = spec.colour;
      ctx.lineWidth = 3;
      for (const sy of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.45, sy * r * 0.5);
        ctx.quadraticCurveTo(-r * 1.25, sy * r * 0.75, -r * 1.05, sy * r * 0.2);
        ctx.stroke();
      }
      // the arc itself, crackling between them
      ctx.strokeStyle = core;
      ctx.lineWidth = 1.5 + Math.abs(Math.sin(m.t * 11)) * 2.5;
      ctx.beginPath();
      ctx.moveTo(-r * 1.05, -r * 0.2);
      ctx.quadraticCurveTo(-r * 1.5 - Math.sin(m.t * 9) * 4, 0, -r * 1.05, r * 0.2);
      ctx.stroke();
      // a single eye, which is the only symmetric thing about it
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 4 + Math.sin(m.t * 3) * 1.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0d13';
      ctx.fillRect(-1, -3, 2, 6);
    } else if (m.kind === 'bulwark') {
      // Assault drum: an armoured octagon ringed with barrels, nose plate
      // forward. Built to be shot at.
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // barrels in the ports, turning with the drum
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + m.t * 0.6;
        const bx = Math.cos(a);
        const by = Math.sin(a);
        ctx.strokeStyle = '#8e9aa9';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(bx * r * 0.8, by * r * 0.8);
        ctx.lineTo(bx * (r + 7), by * (r + 7));
        ctx.stroke();
        ctx.fillStyle = core;
        ctx.fillRect(bx * (r + 7) - 2, by * (r + 7) - 2, 4, 4);
      }
      ctx.fillStyle = '#2b323d';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2); ctx.fill();
      // forward nose plate
      ctx.fillStyle = '#8e9aa9';
      ctx.beginPath();
      ctx.moveTo(-r - 6, 0); ctx.lineTo(-r * 0.6, -r * 0.6);
      ctx.lineTo(-r * 0.6, r * 0.6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(0, 0, 6 + Math.sin(m.t * 6) * 1.5, 0, Math.PI * 2); ctx.fill();
    } else {
      // Pirate raider: swept delta, canopy for a crew, a drone pod slung
      // under each wing and a pennant off the tail.
      poly(ctx, [[-r * 1.15, 0], [r * 0.3, -r * 0.6], [r, -r * 0.85],
        [r * 0.65, 0], [r, r * 0.85], [r * 0.3, r * 0.6]]);
      ctx.fill(); ctx.stroke();
      for (const sy of [-1, 1]) {
        ctx.fillStyle = body;
        ctx.strokeStyle = spec.colour;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(r * 0.1, sy * r * 0.72, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = core;
        ctx.fillRect(r * 0.1 - 7, sy * r * 0.72 - 1.5, 4, 3);
      }
      // canopy
      ctx.fillStyle = '#0a0d13';
      ctx.beginPath(); ctx.ellipse(-r * 0.42, 0, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9ae8f8';
      ctx.beginPath(); ctx.ellipse(-r * 0.45, 0, 5, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = core;
      poly(ctx, [[-r * 0.95, 0], [-r * 0.2, -4], [-r * 0.2, 4]]);
      ctx.fill();
      // pennant
      ctx.fillStyle = '#b02a3a';
      for (let k = 0; k <= 3; k++) {
        ctx.fillRect(r * 0.7 + k * 3, -3 + Math.sin(m.t * 6 + k) * 2.5, 3, 5);
      }
    }
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
