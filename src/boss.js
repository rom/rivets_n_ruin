// Bosses.
//
// One guards the far end of each hull, and killing it is what opens the
// turnaround — so a run reads as approach, fight, escape, rather than a lap
// with a waypoint. The fight happens in a locked arena at the hull's end:
// the camera pins, the ship is walled in, and there is nowhere to run.
//
// Each boss is a different problem. The Warden is a static fortress whose
// core is only exposed once its pods are gone. Drayline moves and has to be
// led. The Riveter layers both and changes behaviour as it comes apart.

import {
  BOSS, BOSSES, VIEW_W, FIELD_TOP, FIELD_BOT, clamp,
} from './config.js';
import { enemyShots, fire } from './projectiles.js';
import { explode, sparks } from './particles.js';
import { kick } from './camera.js';
import { sfxExplode, sfxEnemyHit, sfxTurretShot } from './sfx.js';
import { spawnPickup } from './pickups.js';
import { spawnInterceptor } from './enemies.js';

// ------------------------------------------------------------------ spawn

export function arenaLeft(game) {
  return game.level.length - VIEW_W;
}

export function makeBoss(game) {
  const spec = BOSSES[game.levelIndex] || BOSSES[BOSSES.length - 1];
  const left = arenaLeft(game);
  const b = {
    spec,
    kind: spec.kind,
    name: spec.name,
    x: left + 470,
    y: (FIELD_TOP + FIELD_BOT) / 2,
    baseY: (FIELD_TOP + FIELD_BOT) / 2,
    hp: spec.coreHp,
    maxHp: spec.coreHp,
    parts: [],
    phase: 0,
    t: 0,
    entry: BOSS.entryTime,
    death: 0,
    flash: 0,
    cd: 1.2,
    burst: 0,
    burstT: 0,
    burstA: 0,
    spin: 0,
    dead: false,
  };

  if (spec.kind === 'warden') {
    // three gun pods on a spine; the core cannot be hurt until they are gone
    for (let i = 0; i < 3; i++) {
      b.parts.push({ dx: -14, dy: -74 + i * 74, hp: spec.podHp, maxHp: spec.podHp, dead: false, flash: 0, r: 15 });
    }
  } else if (spec.kind === 'riveter') {
    // four armour plates around the core
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.parts.push({
        dx: Math.cos(a) * 42, dy: Math.sin(a) * 42,
        hp: spec.plateHp, maxHp: spec.plateHp, dead: false, flash: 0, r: 15, a,
      });
    }
  }
  // entry slide: start off the right edge
  b.x = game.level.length + 90;
  b.targetX = left + 470;
  return b;
}

export const livingParts = (b) => b.parts.filter((p) => !p.dead);
export const shellUp = (b) => livingParts(b).length > 0;

// ----------------------------------------------------------------- update

export function updateBoss(game, dt) {
  const b = game.boss;
  if (!b) return;
  const p = game.player;
  b.t += dt;
  if (b.flash > 0) b.flash -= dt;
  for (const part of b.parts) if (part.flash > 0) part.flash -= dt;

  if (b.entry > 0) {
    b.entry -= dt;
    b.x += (b.targetX - b.x) * (1 - Math.exp(-3.2 * dt));
    return;
  }

  if (b.dead) {
    b.death -= dt;
    // chain of secondary explosions while it comes apart
    if (Math.random() < dt * 11) {
      explode(b.x + (Math.random() - 0.5) * 90, b.y + (Math.random() - 0.5) * 110, 1.4);
      kick(game.cam, 5);
    }
    return;
  }

  switch (b.kind) {
    case 'warden': updateWarden(game, b, p, dt); break;
    case 'drayline': updateDrayline(game, b, p, dt); break;
    default: updateRiveter(game, b, p, dt); break;
  }

  // contact damage: ramming a boss is never the answer
  if (p.alive && p.invuln <= 0
    && Math.abs(p.x - b.x) < 44 && Math.abs(p.y - b.y) < 58) {
    p.shield -= BOSS.contactDamage;
    p.vx = -Math.sign(p.x - b.x || -1) * -220;
    game.flash = Math.max(game.flash, 0.5);
    kick(game.cam, 9);
    p.invuln = 0.5;
  }
}

function shoot(b, x, y, ang, speed, dmg = 10) {
  fire(enemyShots, x, y, Math.cos(ang) * speed, Math.sin(ang) * speed, 5.0, dmg, 3);
}

// --- THE WARDEN: static. Pods fire aimed bursts; once they are gone the
// core opens up and sprays radially. Teaches "kill the parts first".
function updateWarden(game, b, p, dt) {
  const pods = livingParts(b);
  b.cd -= dt;

  if (b.burst > 0) {
    b.burstT -= dt;
    if (b.burstT <= 0) {
      b.burstT = b.spec.burstGap;
      b.burst--;
      if (pods.length) {
        for (const pod of pods) {
          const px = b.x + pod.dx;
          const py = b.y + pod.dy;
          const a = Math.atan2(p.y - py, p.x - px);
          shoot(b, px, py, a, b.spec.bulletSpeed);
        }
      } else {
        // core spray, rotating a little each volley so gaps move
        b.spin += 0.22;
        for (let i = 0; i < 12; i++) {
          shoot(b, b.x, b.y, b.spin + (i / 12) * Math.PI * 2, b.spec.bulletSpeed * 0.8);
        }
      }
      sfxTurretShot();
    }
    return;
  }

  if (b.cd <= 0) {
    b.cd = pods.length ? b.spec.cycle : b.spec.cycle * 0.75;
    b.burst = pods.length ? 3 : 2;
    b.burstT = 0;
  }
}

// --- DRAYLINE: mobile. Tracks the player's height and alternates an aimed
// spread with a horizontal wall that has exactly one gap in it.
function updateDrayline(game, b, p, dt) {
  const half = b.hp / b.maxHp;
  const speed = b.spec.sweepSpeed * (half < 0.5 ? 1.45 : 1);

  // chase the player's altitude, but never instantly
  const want = clamp(p.y, FIELD_TOP + 40, FIELD_BOT - 40);
  b.baseY += clamp(want - b.baseY, -speed * dt, speed * dt);
  b.y = b.baseY + Math.sin(b.t * 1.5) * 14;

  b.cd -= dt;
  if (b.burst > 0) {
    b.burstT -= dt;
    if (b.burstT <= 0) {
      b.burstT = b.spec.burstGap;
      b.burst--;
      if (b.phase === 0) {
        const a = Math.atan2(p.y - b.y, p.x - b.x);
        const n = half < 0.5 ? 5 : 3;
        for (let i = 0; i < n; i++) {
          shoot(b, b.x - 26, b.y, a + (i - (n - 1) / 2) * 0.17, b.spec.bulletSpeed);
        }
      } else {
        // a wall with one gap, placed away from where the player is now
        const gap = p.y < (FIELD_TOP + FIELD_BOT) / 2 ? FIELD_BOT - 60 : FIELD_TOP + 60;
        for (let y = FIELD_TOP + 14; y < FIELD_BOT - 14; y += 26) {
          if (Math.abs(y - gap) < 42) continue;
          shoot(b, b.x - 26, y, Math.PI, b.spec.bulletSpeed * 0.75, 8);
        }
      }
      sfxTurretShot();
    }
    return;
  }

  if (b.cd <= 0) {
    b.phase = 1 - b.phase;
    b.cd = b.spec.cycle * (half < 0.5 ? 0.7 : 1);
    b.burst = b.phase === 0 ? 3 : 1;
    b.burstT = 0;
  }
}

// --- THE RIVETER: plated. Spirals while armoured; once the plates are off it
// drops to launching interceptors and barrages, and gets frantic below a third.
function updateRiveter(game, b, p, dt) {
  const plated = shellUp(b);
  const frac = b.hp / b.maxHp;
  b.baseY += Math.sin(b.t * 0.7) * 26 * dt;
  b.y = clamp(b.baseY + Math.sin(b.t * 1.1) * 30, FIELD_TOP + 56, FIELD_BOT - 56);
  b.spin += dt * (plated ? 1.1 : 2.0);

  b.cd -= dt;
  if (b.burst > 0) {
    b.burstT -= dt;
    if (b.burstT <= 0) {
      b.burstT = b.spec.burstGap;
      b.burst--;
      if (plated) {
        // slow spiral: readable, but it fills the arena
        for (let i = 0; i < 3; i++) {
          shoot(b, b.x, b.y, b.spin + (i / 3) * Math.PI * 2, b.spec.bulletSpeed * 0.7);
        }
      } else {
        const a = Math.atan2(p.y - b.y, p.x - b.x);
        const n = frac < 0.34 ? 7 : 5;
        for (let i = 0; i < n; i++) {
          shoot(b, b.x - 30, b.y, a + (i - (n - 1) / 2) * 0.15, b.spec.bulletSpeed);
        }
        if (frac < 0.34) {
          for (let i = 0; i < 10; i++) {
            shoot(b, b.x, b.y, b.spin + (i / 10) * Math.PI * 2, b.spec.bulletSpeed * 0.6);
          }
        }
      }
      sfxTurretShot();
    }
    return;
  }

  if (b.cd <= 0) {
    b.cd = b.spec.cycle * (frac < 0.34 ? 0.6 : plated ? 1 : 0.8);
    b.burst = plated ? 5 : 3;
    b.burstT = 0;
    // once stripped it calls for help, but never more than the arena can hold
    if (!plated && Math.random() < 0.55) spawnInterceptor(game);
  }
}

// -------------------------------------------------------------- damage

// Returns true if the shot connected with anything.
export function hitBoss(game, b, sx, sy, dmg) {
  if (!b || b.dead || b.entry > 0) return false;

  for (const part of b.parts) {
    if (part.dead) continue;
    if (Math.abs(sx - (b.x + part.dx)) > part.r || Math.abs(sy - (b.y + part.dy)) > part.r) continue;
    part.hp -= dmg;
    part.flash = BOSS.hitFlash;
    if (part.hp <= 0) {
      part.dead = true;
      explode(b.x + part.dx, b.y + part.dy, 1.6);
      sfxExplode(1.6);
      kick(game.cam, 6);
      game.score += b.spec.podScore || b.spec.plateScore || 300;
      spawnPickup(game, b.x + part.dx - 30, b.y + part.dy);
    } else {
      sparks(sx, sy, -1, 0, 4, '#ffd24a');
      sfxEnemyHit();
    }
    return true;
  }

  // The shell has to come off before the core can be hurt. Shots still stop
  // on it, with a duller sound, so "that did nothing" is audible.
  const onCore = Math.abs(sx - b.x) < 34 && Math.abs(sy - b.y) < 46;
  if (!onCore) return false;

  if (shellUp(b)) {
    sparks(sx, sy, -1, 0, 3, '#8e9aa9');
    return true;
  }

  b.hp -= dmg;
  b.flash = BOSS.hitFlash;
  sparks(sx, sy, -1, 0, 5, '#ffd24a');
  sfxEnemyHit();
  if (b.hp <= 0) killBoss(game, b);
  return true;
}

function killBoss(game, b) {
  b.dead = true;
  b.hp = 0;
  b.death = BOSS.deathTime;
  game.score += b.spec.score;
  explode(b.x, b.y, 3.4, '#ffd24a', '#ff7a2f');
  sfxExplode(2.6);
  kick(game.cam, 16);
  game.flash = 0.7;
  for (let i = 0; i < 4; i++) {
    spawnPickup(game, b.x - 60 + i * 34, FIELD_TOP + 50 + i * 42);
  }
}

export const bossBeaten = (b) => b && b.dead && b.death <= 0;
