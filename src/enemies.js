import {
  TURRET, INTERCEPTOR, VIEW_W, FIELD_TOP, FIELD_BOT, LEVEL_LEN, APRON, clamp,
} from './config.js';
import { makePool } from './pool.js';
import { enemyShots, fire } from './projectiles.js';
import { explode, sparks } from './particles.js';
import { sfxTurretShot, sfxEnemyHit, sfxExplode } from './sfx.js';

export const interceptors = makePool(INTERCEPTOR.maxActive + 2, () => ({
  x: 0, y: 0, baseY: 0, dirX: -1, t: 0, hp: 0, fireCd: 0,
}));

const angleTo = (a, target, rate) => {
  let d = target - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + clamp(d, -rate, rate);
};

// ------------------------------------------------- pattern 1: hull turrets
// Static, mounted on the hull, 3 HP. Tracks within an arc, fires a lead-aimed
// burst. Threat you choose to engage or evade; the reason to slow down.
export function updateTurrets(game, dt) {
  const p = game.player;
  for (const t of game.level.turrets) {
    if (t.dead) continue;
    const dx = p.x - t.x;
    if (Math.abs(dx) > TURRET.wake) continue;

    const dy = p.y - t.y;
    const dist = Math.hypot(dx, dy);
    const inArc = t.dir === 1 ? dy > 8 : dy < -8;

    const want = inArc
      ? Math.atan2(dy, dx)
      : t.dir * Math.PI / 2;   // nothing to shoot at: return to neutral
    t.angle = angleTo(t.angle, want, TURRET.turnRate * dt);

    if (t.burstLeft > 0) {
      t.burstTimer -= dt;
      if (t.burstTimer <= 0) {
        t.burstTimer = TURRET.burstGap;
        t.burstLeft--;
        shootTurret(t, p);
        if (t.burstLeft === 0) t.cd = TURRET.cooldown;
      }
      continue;
    }

    t.cd -= dt;
    const aligned = Math.abs(((Math.atan2(dy, dx) - t.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < TURRET.aimTol;
    if (t.cd <= 0 && inArc && dist < TURRET.range && aligned && game.state === 'play' && p.alive) {
      t.burstLeft = TURRET.burst;
      t.burstTimer = 0;
    }
  }
}

function shootTurret(t, p) {
  // modest lead prediction — enough to punish flying in a straight line
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  const tof = Math.hypot(dx, dy) / TURRET.bulletSpeed;
  const a = Math.atan2(dy + p.vy * tof * 0.55, dx + p.vx * tof * 0.55);
  const mx = t.x + Math.cos(a) * 9;
  const my = t.y + Math.sin(a) * 9;
  fire(enemyShots, mx, my, Math.cos(a) * TURRET.bulletSpeed, Math.sin(a) * TURRET.bulletSpeed, 3.4, 9, 2);
  sparks(mx, my, Math.cos(a), Math.sin(a), 3, '#ff7a2f');
  sfxTurretShot();
}

// -------------------------------------------- pattern 2: weaving interceptors
// Spawn ahead of your heading and fly at you on a homing sine weave. Can be
// out-run, not out-waited; reversing into a fresh wave is the punishment for
// panicking.
export function spawnInterceptor(game) {
  const e = interceptors.spawn();
  if (!e) return;
  const p = game.player;
  const ahead = p.facing > 0;
  e.x = ahead ? game.cam.x + VIEW_W + 24 : game.cam.x - 24;
  e.dirX = ahead ? -1 : 1;
  e.baseY = FIELD_TOP + 30 + Math.random() * (FIELD_BOT - FIELD_TOP - 60);
  e.y = e.baseY;
  e.t = Math.random() * 6;
  e.hp = INTERCEPTOR.hp;
  e.fireCd = 0.35 + Math.random() * 0.6;
}

export function updateInterceptors(game, dt) {
  const p = game.player;

  if (game.state === 'play') {
    game.spawnCd -= dt;
    if (game.spawnCd <= 0) {
      game.spawnCd = INTERCEPTOR.spawnEvery * (0.75 + Math.random() * 0.6);
      // quiet aprons at both ends of the hull
      if (p.x > APRON * 0.6 && p.x < LEVEL_LEN - APRON * 0.6) spawnInterceptor(game);
    }
  }

  for (let i = interceptors.count - 1; i >= 0; i--) {
    const e = interceptors.items[i];
    e.t += dt;
    e.x += e.dirX * INTERCEPTOR.speed * dt;

    // drift the weave centreline toward the player
    const want = p.y;
    const step = INTERCEPTOR.trackRate * dt;
    e.baseY += clamp(want - e.baseY, -step, step);
    e.y = clamp(
      e.baseY + Math.sin(e.t * INTERCEPTOR.weaveFreq) * INTERCEPTOR.weaveAmp,
      FIELD_TOP + 7, FIELD_BOT - 7,
    );

    e.fireCd -= dt;
    if (e.fireCd <= 0 && p.alive && game.state === 'play') {
      e.fireCd = INTERCEPTOR.fireEvery * (0.7 + Math.random() * 0.6);
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      fire(enemyShots, e.x, e.y,
        Math.cos(a) * INTERCEPTOR.bulletSpeed, Math.sin(a) * INTERCEPTOR.bulletSpeed,
        3.2, 8, 2);
      sfxTurretShot();
    }

    // despawn once well past the viewport
    if (e.x < game.cam.x - 90 || e.x > game.cam.x + VIEW_W + 90) interceptors.kill(i);
  }
}

export function hitInterceptor(game, i, dmg) {
  const e = interceptors.items[i];
  e.hp -= dmg;
  if (e.hp > 0) {
    sparks(e.x, e.y, -e.dirX, 0, 4, '#ffd24a');
    sfxEnemyHit();
    return false;
  }
  explode(e.x, e.y, 1);
  sfxExplode(1);
  game.score += INTERCEPTOR.score;
  interceptors.kill(i);
  return true;
}

export function hitTurret(game, t, dmg) {
  t.hp -= dmg;
  if (t.hp > 0) {
    sparks(t.x, t.y - t.dir * 6, 0, -t.dir, 4, '#ffd24a');
    sfxEnemyHit();
    return false;
  }
  t.dead = true;
  explode(t.x, t.y - t.dir * 5, 1.5);
  sfxExplode(1.5);
  game.score += TURRET.score;
  game.turretsKilled++;
  return true;
}

export const resetEnemies = () => interceptors.clear();
