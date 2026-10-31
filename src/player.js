import {
  SHIP, PICKUP, FIELD_TOP, FIELD_BOT, LEVEL_LEN, clamp,
} from './config.js';
import { axisX, axisY, held } from './input.js';
import { obstaclesNear, pointBlocked } from './level.js';
import { playerShots, fire } from './projectiles.js';
import { sparks, thrust } from './particles.js';
import { kick } from './camera.js';
import { sfxShoot, sfxScrape, sfxFlip } from './sfx.js';

export function makePlayer() {
  return {
    x: 180, y: (FIELD_TOP + FIELD_BOT) / 2,
    vx: 0, vy: 0,
    facing: 1,
    flip: 0,         // >0 while mid-flip
    fireCd: 0,
    scrapeCd: 0,
    invuln: SHIP.invuln,
    shield: SHIP.shieldMax,
    shieldMax: SHIP.shieldMax,   // healthbars raise this
    lives: SHIP.lives,
    gunSpeed: 0,                 // gunspeed pickups: faster fire
    gunBlaze: 0,                 // gunblaze pickups: wider spread
    thrustT: 0,
    alive: true,
  };
}

export function updatePlayer(p, game, dt) {
  const ix = axisX();
  const iy = axisY();

  if (p.flip > 0) p.flip -= dt;
  if (p.fireCd > 0) p.fireCd -= dt;
  if (p.scrapeCd > 0) p.scrapeCd -= dt;
  if (p.invuln > 0) p.invuln -= dt;

  // --- horizontal: thrust along facing, hard brake into a flip when reversing
  if (ix !== 0) {
    if (ix === p.facing) {
      p.vx += ix * SHIP.accelX * dt;
    } else {
      p.vx += ix * SHIP.brakeX * dt;
      if (p.vx * p.facing <= 0 && p.flip <= 0) {
        p.facing = ix;
        p.flip = SHIP.flipTime;
        sfxFlip();
      }
    }
  }
  p.vx *= Math.exp(-SHIP.dragX * dt);
  p.vx = clamp(p.vx, -SHIP.maxVX, SHIP.maxVX);

  // --- vertical: snappier, settles quickly
  p.vy += iy * SHIP.accelY * dt;
  p.vy *= Math.exp(-SHIP.dragY * dt);
  p.vy = clamp(p.vy, -SHIP.maxVY, SHIP.maxVY);

  p.x = clamp(p.x + p.vx * dt, 14, LEVEL_LEN - 14);
  p.y += p.vy * dt;

  resolveHull(p, game);

  // engine plume while thrusting
  p.thrustT -= dt;
  if (ix === p.facing && p.thrustT <= 0) {
    p.thrustT = 0.016;
    thrust(p.x - p.facing * 13, p.y, -p.facing, p.vy);
  }

  if (held('fire') && p.fireCd <= 0 && p.flip <= 0) {
    // gunspeed shortens the interval; gunblaze adds mirrored angled barrels
    p.fireCd = SHIP.fireRate * PICKUP.speedScale[p.gunSpeed];

    const speed = SHIP.bulletSpeed;
    const inherit = p.vx * 0.3;
    const mx = p.x + p.facing * 14;

    for (const off of [-4, 4]) {
      fire(playerShots, mx, p.y + off, p.facing * speed + inherit, 0, 1.7, 1, 2);
    }
    for (const a of PICKUP.blazeAngles[p.gunBlaze]) {
      for (const sign of [-1, 1]) {
        const ang = sign * a;
        fire(playerShots, mx, p.y + sign * 2,
          p.facing * Math.cos(ang) * speed + inherit,
          Math.sin(ang) * speed, 1.5, 1, 2);
      }
    }
    sparks(p.x + p.facing * 15, p.y, p.facing, 0, 2 + p.gunBlaze, '#b4f4ff');
    sfxShoot();
  }
}

function resolveHull(p, game) {
  const hw = SHIP.hitW / 2;
  const hh = SHIP.hitH / 2;

  // rim girders
  if (p.y - hh < FIELD_TOP) {
    p.y = FIELD_TOP + hh;
    impact(p, game, Math.abs(p.vy), p.x, p.y - hh, 0, 1);
    p.vy = -p.vy * 0.25;
  } else if (p.y + hh > FIELD_BOT) {
    p.y = FIELD_BOT - hh;
    impact(p, game, Math.abs(p.vy), p.x, p.y + hh, 0, -1);
    p.vy = -p.vy * 0.25;
  }

  for (const o of obstaclesNear(game.level, p.x - 40, p.x + 40)) {
    if (p.x + hw <= o.x || p.x - hw >= o.x + o.w) continue;
    if (p.y + hh <= o.y || p.y - hh >= o.y + o.h) continue;

    const pushR = o.x + o.w - (p.x - hw);
    const pushL = p.x + hw - o.x;
    const pushD = o.y + o.h - (p.y - hh);
    const pushU = p.y + hh - o.y;
    const mx = Math.min(pushR, pushL);
    const my = Math.min(pushD, pushU);

    if (mx < my) {
      const right = pushR < pushL;
      p.x += right ? pushR : -pushL;
      impact(p, game, Math.abs(p.vx), right ? o.x + o.w : o.x, p.y, right ? 1 : -1, 0);
      p.vx = -p.vx * 0.25;
    } else {
      const downward = pushD < pushU;
      p.y += downward ? pushD : -pushU;
      impact(p, game, Math.abs(p.vy), p.x, downward ? o.y + o.h : o.y, 0, downward ? 1 : -1);
      p.vy = -p.vy * 0.25;
    }
  }
}

// Scraping the hull costs shield in proportion to how hard you hit it,
// rate-limited so grinding along a wall drains instead of instantly killing.
function impact(p, game, speed, hx, hy, nx, ny) {
  sparks(hx, hy, nx, ny, 5, '#ffd24a');
  sfxScrape(speed);
  if (p.scrapeCd > 0 || p.invuln > 0) return;
  p.scrapeCd = SHIP.scrapeCd;
  const dmg = SHIP.grindDamage + speed * SHIP.impactDamage;
  p.shield -= dmg;
  kick(game.cam, 2.5 + speed * 0.02);
  game.flash = Math.max(game.flash, Math.min(0.5, 0.12 + speed * 0.0012));
}

// Back off to open space, so a respawn never drops you inside a block.
export function respawn(p, game) {
  p.vx = 0; p.vy = 0;
  // Dying costs one level off each gun — enough to feel, not enough to
  // undo a whole run's worth of pickups.
  p.gunSpeed = Math.max(0, p.gunSpeed - 1);
  p.gunBlaze = Math.max(0, p.gunBlaze - 1);
  p.shield = p.shieldMax;
  p.invuln = SHIP.invuln;
  p.flip = 0;
  p.alive = true;
  const mid = (FIELD_TOP + FIELD_BOT) / 2;
  for (let back = 0; back < 1400; back += 40) {
    const x = clamp(p.x - p.facing * back, 40, LEVEL_LEN - 40);
    for (const y of [mid, mid - 60, mid + 60, mid - 110, mid + 110]) {
      if (!blockedBox(game.level, x, y)) { p.x = x; p.y = y; return; }
    }
  }
  p.y = mid;
}

function blockedBox(level, x, y) {
  const hw = SHIP.hitW / 2 + 10;
  const hh = SHIP.hitH / 2 + 10;
  return pointBlocked(level, x - hw, y - hh) || pointBlocked(level, x + hw, y - hh)
      || pointBlocked(level, x - hw, y + hh) || pointBlocked(level, x + hw, y + hh)
      || pointBlocked(level, x, y);
}
