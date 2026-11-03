import {
  SHIP, PICKUP, ARMORY, FIELD_TOP, FIELD_BOT, clamp, REAR, LANCE,
  MOD_FORCE, hullRule} from './config.js';

// Cycles to the next ordnance you actually have, so the key is never a
// no-op while something else is loaded.
function cycleSecondary(p, dir) {
  const order = ARMORY.order;
  const start = order.indexOf(p.secondary);
  for (let i = 1; i <= order.length; i++) {
    const next = order[(start + dir * i + order.length * 2) % order.length];
    if (p.ammo[next] > 0 || i === order.length) { p.secondary = next; return; }
  }
}
import { axisX, axisY, held, tapped } from './input.js';
import { obstaclesNear, pointBlocked } from './level.js';
import { playerShots, enemyShots, fire } from './projectiles.js';
import { sparks, thrust, addLight } from './particles.js';
import { fireSecondary } from './armory.js';
import { diff } from './score.js';
import { kick } from './camera.js';
import { sfxShoot, sfxScrape, sfxFlip } from './sfx.js';
import { get as setting } from './settings.js';

// Built from ARMORY.order rather than written out, so adding ordnance
// cannot leave one kind undefined in half the places that read it.
export const emptyAmmo = () => Object.fromEntries(ARMORY.order.map((k) => [k, 0]));

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
    shieldMax: SHIP.shieldMax,   // the refit and the upgrades both raise this
    // ...but only the upgrades are capped, and only against each other.
    // See PICKUP.shieldBonusMax for why this is counted separately from
    // shieldMax rather than read off it.
    shieldBonus: 0,
    lives: SHIP.lives,
    gunSpeed: 0,                 // gunspeed pickups: faster fire
    gunBlaze: 0,                 // gunblaze pickups: wider spread
    gunCap: PICKUP.gunLevels,    // clearing a hull raises this
    gunCapBase: PICKUP.gunLevels,  // ...this one; mods add on top of it
    drones: 0,                   // DRONE WING escorts, one per tier
    pointDefence: false,         // POINT DEFENCE: missiles get shot down
    shieldRegen: 0,              // CELL REGENERATOR: shield per second
    magnetLevel: 0,             // tractor coils bought at the armourer
    // What the guns revert to when a ship is lost. The refit granted by
    // clearing a hull is part of the ship and survives; everything picked up
    // since is lost with the hull it was collected on.
    gunSpeedBase: 0,
    gunBlazeBase: 0,
    // Armory. Finite, and lost with the ship like every other addon.
    ammo: emptyAmmo(),
    secondary: 'bomb',
    secondaryCd: 0,
    // Per-run enhancements live here rather than mutating the shared config
    // objects, so starting a new run really does give you a stock ship.
    accelMul: 1,
    maxVXBonus: 0,
    maxVYBonus: 0,
    bulletBonus: 0,
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
  if (p.secondaryCd > 0) p.secondaryCd -= dt;
  if (p.pdCd > 0) p.pdCd -= dt;

  // CELL REGENERATOR: the shield comes back on its own. Slow enough that
  // it rewards disengaging rather than removing the reason to.
  if (p.shieldRegen > 0 && p.alive) {
    p.shield = Math.min(p.shieldMax, p.shield + p.shieldRegen * dt);
  }

  updateDrones(p, game, dt);
  if (p.pointDefence) pointDefence(p, game);

  // --- horizontal: thrust along facing, hard brake into a flip when reversing
  if (ix !== 0) {
    if (ix === p.facing) {
      p.vx += ix * SHIP.accelX * p.accelMul * dt;
    } else {
      p.vx += ix * SHIP.brakeX * p.accelMul * dt;
      if (p.vx * p.facing <= 0 && p.flip <= 0) {
        p.facing = ix;
        p.flip = SHIP.flipTime;
        sfxFlip();
      }
    }
  }
  p.vx *= Math.exp(-SHIP.dragX * dt);
  const maxVX = SHIP.maxVX + p.maxVXBonus;
  p.vx = clamp(p.vx, -maxVX, maxVX);

  // --- vertical: snappier, settles quickly
  p.vy += iy * SHIP.accelY * p.accelMul * dt;
  // GRAVITY WELL: something under the hull pulls. Applied before the drag
  // so it settles to a terminal sink rather than accelerating without
  // limit, and sized against SHIP.accelY so holding the stick up still
  // climbs — a modifier that takes a direction away is a broken hull, not
  // a hard one.
  if (hullRule(game, 'gravity')) p.vy += SHIP.accelY * MOD_FORCE.gravity * dt;
  p.vy *= Math.exp(-SHIP.dragY * dt);
  const maxVY = SHIP.maxVY + p.maxVYBonus;
  p.vy = clamp(p.vy, -maxVY, maxVY);

  p.x = clamp(p.x + p.vx * dt, 14, game.level.length - 14);
  p.y += p.vy * dt;

  resolveHull(p, game);

  // engine plume while thrusting
  p.thrustT -= dt;
  if (ix === p.facing && p.thrustT <= 0) {
    p.thrustT = 0.016;
    thrust(p.x - p.facing * 13, p.y, -p.facing, p.vy);
  }

  // muzzle flash lights the hull in front of the ship
  // Auto fire is an accessibility setting, not an advantage: the fire rate
  // is the gun's, not the key's, so holding the key already did exactly
  // this. What it removes is having to hold a key for a whole run.
  if ((held('fire') || setting('autofire')) && p.fireCd <= 0 && p.flip <= 0) {
    // gunspeed shortens the interval; gunblaze adds mirrored angled barrels
    p.fireCd = SHIP.fireRate * PICKUP.speedScale[p.gunSpeed];

    const speed = SHIP.bulletSpeed + p.bulletBonus;
    const inherit = p.vx * 0.3;
    const mx = p.x + p.facing * 14;

    for (const off of [-4, 4]) {
      fire(playerShots, mx, p.y + off, p.facing * speed + inherit, 0, 1.35, 1, 2);
    }
    for (const a of PICKUP.blazeAngles[p.gunBlaze]) {
      for (const sign of [-1, 1]) {
        const ang = sign * a;
        fire(playerShots, mx, p.y + sign * 2,
          p.facing * Math.cos(ang) * speed + inherit,
          Math.sin(ang) * speed, 1.5, 1, 2);
      }
    }
    // DRONE WING fires with you, from where the drones actually are
    for (let i = 0; i < (p.drones || 0); i++) {
      const d = droneAt(p, i);
      fire(playerShots, d.x + p.facing * 7, d.y, p.facing * speed + inherit, 0, 1.3, 1, 2);
    }
    sparks(p.x + p.facing * 15, p.y, p.facing, 0, 2 + p.gunBlaze, '#b4f4ff');
    addLight(p.x + p.facing * 18, p.y, 26, 0.07, '#b4f4ff');
    sfxShoot();
  }

  // --- REAR BATTERY. Fires itself, behind you, and only when there is
  // something back there: a tail gun shooting at nothing is a noise, not
  // a weapon.
  if (p.rearGun) {
    p.rearCd = (p.rearCd || 0) - dt;
    if (p.rearCd <= 0 && behindYou(game, p)) {
      p.rearCd = REAR.fireEvery * (p.reloadMul || 1);
      fire(playerShots, p.x - p.facing * 14, p.y,
        -p.facing * REAR.bulletSpeed, 0, 1.2, REAR.damage, 2);
      sparks(p.x - p.facing * 15, p.y, -p.facing, 0, 2, '#b45ce0');
      sfxShoot();
    }
  }

  // --- SPINAL LANCE. Charges on its own clock and then puts a beam
  // through everything in a line ahead. Nothing to aim: the line is the
  // ship's own centreline, so the decision is where to be pointing when
  // it comes round.
  if (p.lance) {
    const tier = Math.min(p.lance, LANCE.cycle.length) - 1;
    p.lanceT = (p.lanceT || 0) + dt;
    const cycle = LANCE.cycle[tier];
    if (p.lanceT >= cycle) {
      p.lanceT = 0;
      p.lanceFire = LANCE.dwell;
    }
    p.lanceFire = Math.max(0, (p.lanceFire || 0) - dt);
    // Cleared the moment the beam is over, so the next firing bills once
    // too. Without this the lance damaged exactly one thing per run: the
    // flag is what stops twenty-six frames of contact being billed
    // twenty-six times, and nothing was putting it back.
    if (p.lanceFire <= 0) p.lanceSpent = false;
    p.lanceCharge = clamp((p.lanceT - (cycle - LANCE.charge)) / LANCE.charge, 0, 1);
  } else {
    p.lanceFire = 0;
    p.lanceCharge = 0;
    p.lanceSpent = false;
  }

  // --- armory
  if (tapped('cycle')) cycleSecondary(p, 1);
  ARMORY.order.forEach((kind, i) => {
    if (i < 3 && tapped('arm' + (i + 1))) p.secondary = kind;
  });
  if (held('secondary')) fireSecondary(game);
}

// Is there anything behind the ship worth shooting at? Keeps the rear
// battery quiet on an empty corridor.
function behindYou(game, p) {
  const list = game._seekable;
  if (!list) return false;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const dx = (e.x - p.x) * p.facing;
    if (dx < 0 && dx > -REAR.range && Math.abs(e.y - p.y) < 70) return true;
  }
  return false;
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
      // The shortest way out of a block is normally the right way out, but
      // a block anchored to a girder is a special case: when the ship is
      // deep inside one, the short side is the girder, and resolving that
      // way puts it through the rim and outside the playfield.
      //
      // It could not happen while every obstacle was static — you are
      // pushed off a wall long before you are inside it — but a press jaw
      // closes onto the ship, so being deep inside one is the normal case
      // rather than the impossible one. Caught by the press test: a ship
      // held under a closing jaw came out at y=11.5, eight pixels above
      // the hull.
      let downward = pushD < pushU;
      const upFits = p.y - pushU - hh >= FIELD_TOP;
      const downFits = p.y + pushD + hh <= FIELD_BOT;
      if (downward && !downFits && upFits) downward = false;
      else if (!downward && !upFits && downFits) downward = true;
      p.y += downward ? pushD : -pushU;
      impact(p, game, Math.abs(p.vy), p.x, downward ? o.y + o.h : o.y, 0, downward ? 1 : -1);
      p.vy = -p.vy * 0.25;
    }
  }
}

// --- DRONE WING
//
// One escort per tier, holding station off a wing. They are a position
// rather than an entity: nothing collides with them, they cannot be shot,
// and they fire when you fire. Giving them a life of their own would mean
// a second thing to look after, which is not what the mod is for.
export function droneAt(p, i) {
  const side = i % 2 === 0 ? -1 : 1;
  const lag = p.droneLag || { x: p.x, y: p.y };
  return {
    x: lag.x - p.facing * (16 + (i >> 1) * 9),
    y: lag.y + side * (13 + (i >> 1) * 4),
  };
}

function updateDrones(p, game, dt) {
  if (!p.drones) { p.droneLag = null; return; }
  if (!p.droneLag) p.droneLag = { x: p.x, y: p.y };
  // They trail, so the wing reads as flying in formation rather than as
  // two sprites welded to the hull.
  const k = Math.min(1, dt * 7);
  p.droneLag.x += (p.x - p.droneLag.x) * k;
  p.droneLag.y += (p.y - p.droneLag.y) * k;
}

// --- POINT DEFENCE
//
// The answer to a rocket tower, bought rather than aimed. It takes one
// missile at a time and has a cooldown, so it reduces the threat without
// removing it.
const PD_RANGE = 74;
const PD_COOLDOWN = 0.55;

function pointDefence(p, game) {
  if (p.pdCd > 0 || !p.alive) return;
  for (let i = enemyShots.count - 1; i >= 0; i--) {
    const m = enemyShots.items[i];
    if (m.hp <= 0) continue;                 // only ordnance, never bullets
    if (Math.hypot(m.x - p.x, m.y - p.y) > PD_RANGE) continue;
    enemyShots.kill(i);
    p.pdCd = PD_COOLDOWN;
    sparks(m.x, m.y, 0, 0, 7, '#b4f4ff');
    addLight(m.x, m.y, 40, 0.14, '#b4f4ff');
    game.pdFlash = { x: m.x, y: m.y, t: 0.12 };
    return;
  }
}

// Scraping the hull costs shield in proportion to how hard you hit it,
// rate-limited so grinding along a wall drains instead of instantly killing.
function impact(p, game, speed, hx, hy, nx, ny) {
  sparks(hx, hy, nx, ny, 5, '#ffd24a');
  sfxScrape(speed);
  if (p.scrapeCd > 0 || p.invuln > 0) return;
  p.scrapeCd = SHIP.scrapeCd;
  // HARD VACUUM: no air between you and the plating, and it costs double.
  const vac = hullRule(game, 'vacuum') ? MOD_FORCE.vacuumScrape : 1;
  const dmg = (SHIP.grindDamage + speed * SHIP.impactDamage)
    * (p.scrapeMul || 1) * diff().scrape * vac;
  p.shield -= dmg;
  kick(game.cam, 2.5 + speed * 0.02);
  game.flash = Math.max(game.flash, Math.min(0.5, 0.12 + speed * 0.0012));
}

// Back off to open space, so a respawn never drops you inside a block.
export function respawn(p, game) {
  p.vx = 0; p.vy = 0;
  // Losing a ship costs every weapon addon picked up since the last refit.
  // The guns go back to whatever the ship was built with.
  // A Reclaimer mod buys back one level of each, which is the difference
  // between a death being a setback and being the end of the run.
  const keep = p.keepGunOnDeath || 0;
  p.gunSpeed = Math.max(p.gunSpeedBase, Math.min(p.gunSpeed, p.gunSpeedBase + keep));
  p.gunBlaze = Math.max(p.gunBlazeBase, Math.min(p.gunBlaze, p.gunBlazeBase + keep));
  p.ammo = emptyAmmo();
  p.shield = p.shieldMax;
  p.invuln = SHIP.invuln;
  p.flip = 0;
  p.alive = true;
  const mid = (FIELD_TOP + FIELD_BOT) / 2;
  for (let back = 0; back < 1400; back += 40) {
    const x = clamp(p.x - p.facing * back, 40, game.level.length - 40);
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
