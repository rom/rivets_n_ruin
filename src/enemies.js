import {
  TURRET, TOWERS, INTERCEPTOR, VIEW_W, FIELD_TOP, FIELD_BOT, APRON, clamp, CULL_MARGIN,
} from './config.js';
import { makePool } from './pool.js';
import { enemyShots, fire } from './projectiles.js';
import { explode, sparks } from './particles.js';
import { sfxTurretShot, sfxEnemyHit, sfxExplode } from './sfx.js';
import { spoils } from './pickups.js';
import { diff, award } from './score.js';

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

  // Wardens protect their neighbours, so the kill order matters. Recomputed
  // each frame because a warden dying must free its neighbours at once.
  const guards = [];
  for (const t of game.level.turrets) {
    if (!t.dead && t.tower && t.tower.aura) guards.push(t);
  }
  for (const t of game.level.turrets) {
    t.shielded = false;
    if (t.dead || !guards.length) continue;
    for (const gd of guards) {
      if (gd !== t && Math.hypot(gd.x - t.x, gd.y - t.y) < gd.tower.aura) { t.shielded = true; break; }
    }
  }

  // Radar paints its neighbours, the same shape of rule as the warden's
  // aura and for the same reason: it changes the order you kill things
  // in. A painted tower sees you further out and swings round faster,
  // so a dish left standing makes every gun behind it worse to fly past.
  //
  // Recomputed each frame, like the aura, because killing the dish has
  // to take the effect with it immediately — a buff that outlives its
  // source by a frame reads as the game cheating.
  const dishes = [];
  for (const t of game.level.turrets) {
    if (!t.dead && t.tower && t.tower.paint) dishes.push(t);
  }
  for (const t of game.level.turrets) {
    t.painted = null;
    // Only things that shoot can be painted. Painting a fuel tank
    // changes nothing about it — it has no aim to sharpen and no wake
    // to bring forward — so the ring the renderer draws would promise
    // a buff that does not exist. Spotted on screen: a port's tanks
    // sitting inside their own control tower's paint, haloed, doing
    // exactly what they did before.
    if (t.dead || !t.tower || t.tower.inert || !dishes.length) continue;
    for (const d of dishes) {
      if (d === t) continue;
      if (Math.hypot(d.x - t.x, d.y - t.y) < d.tower.paint) { t.painted = d.tower; break; }
    }
  }

  // Dishes turn whether or not anybody is watching, which is most of
  // what makes them read as machinery rather than scenery. Everything
  // gets a clock, because the beacons and the glazing blink on it and
  // a structure with nothing moving on it reads as painted on.
  for (const t of game.level.turrets) {
    if (t.dead || !t.tower) continue;
    t.t = (t.t || 0) + dt;
    if (t.tower.spin) t.angle += t.tower.spin * dt;
    else if (t.tower.sweep) {
      // Back and forth across its own face rather than all the way
      // round, so a sweep and a spin are different silhouettes in
      // motion as well as at rest.
      t.sweepT = (t.sweepT || 0) + t.tower.sweep * dt;
      t.angle = -t.dir * Math.PI / 2 + Math.sin(t.sweepT) * 1.15;
    }
  }

  for (const t of game.level.turrets) {
    if (t.dead) continue;
    const tw = t.tower || TOWERS.gun;
    // The ones that never shoot have already had their turn above.
    if (tw.inert) continue;
    const dx = p.x - t.x;
    // A silo opens from the far side of the screen; a painted tower
    // wakes earlier than it otherwise would.
    const wake = Math.max(tw.wake || TURRET.wake, (t.painted && t.painted.paintWake) || 0);
    if (Math.abs(dx) > wake) continue;
    const spec = game.level.spec;

    // A lance telegraphs before it fires. Without the tell it would be an
    // unavoidable hitscan; with it, it is a thing you learn to respect.
    if (t.charge > 0) {
      t.charge -= dt;
      if (t.charge <= 0) { shootTurret(t, p); t.cd = spec.turretCooldown * tw.cooldownMul; }
      continue;
    }

    const dy = p.y - t.y;
    const dist = Math.hypot(dx, dy);
    const inArc = t.dir === 1 ? dy > 8 : dy < -8;

    const want = inArc
      ? Math.atan2(dy, dx)
      : t.dir * Math.PI / 2;   // nothing to shoot at: return to neutral
    const turn = TURRET.turnRate * (tw.turnMul || 1)
      * ((t.painted && t.painted.paintTurn) || 1);
    t.angle = angleTo(t.angle, want, turn * dt);

    if (t.burstLeft > 0) {
      t.burstTimer -= dt;
      if (t.burstTimer <= 0) {
        t.burstTimer = tw.burstGap;
        t.burstLeft--;
        shootTurret(t, p);
        if (t.burstLeft === 0) t.cd = spec.turretCooldown * tw.cooldownMul;
      }
      continue;
    }

    t.cd -= dt;
    const aligned = Math.abs(((Math.atan2(dy, dx) - t.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < TURRET.aimTol;
    // A silo states its own reach; everything else uses the hull's.
    const reach = tw.range || spec.turretRange;
    if (t.cd <= 0 && inArc && dist < reach && aligned && game.state === 'play' && p.alive) {
      if (tw.charge) { t.charge = tw.charge; continue; }
      t.burstLeft = tw.burst;
      t.burstTimer = 0;
    }
  }
}

function shootTurret(t, p) {
  const tw = t.tower || TOWERS.gun;
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  const speed = tw.bulletSpeed;
  // modest lead prediction — enough to punish flying in a straight line
  const tof = Math.hypot(dx, dy) / speed;
  const base = tw.arc
    // a mortar lobs: it aims at where you are horizontally and lets the
    // shell come down, so hugging the far rim does not take you off its line
    ? Math.atan2(t.dir * 90, dx)
    : Math.atan2(dy + p.vy * tof * 0.55, dx + p.vx * tof * 0.55);

  const shots = tw.fan || 1;
  for (let i = 0; i < shots; i++) {
    const a = base + (shots === 1 ? 0 : (i - (shots - 1) / 2) * tw.spread)
      + (shots === 1 ? (Math.random() - 0.5) * tw.spread : 0);
    const mx = t.x + Math.cos(a) * 9;
    const my = t.y + Math.sin(a) * 9;
    // A rocket launches wide of its aim on purpose and turns in afterwards,
    // so the threat reads as a missile arcing onto you rather than a bullet
    // that happens to curve.
    const la = tw.seek ? a + (Math.random() - 0.5) * 0.9 : a;
    fire(enemyShots, mx, my, Math.cos(la) * speed, Math.sin(la) * speed,
      tw.seek ? tw.seekLife : 3.4, tw.arc ? 13 : tw.seek ? 14 : 9,
      tw.arc ? 3 : tw.seek ? 3 : 2,
      tw.seek ? { seek: tw.seek, hp: tw.seekHp } : null);
    sparks(mx, my, Math.cos(la), Math.sin(la), 3, tw.colour);
  }
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
  e.hp = game.level.spec.interceptorHp;
  e.fireCd = 0.35 + Math.random() * 0.6;
}

export function updateInterceptors(game, dt) {
  const p = game.player;

  if (game.state === 'play') {
    game.spawnCd -= dt;
    if (game.spawnCd <= 0) {
      game.spawnCd = game.level.spec.interceptorSpawn * diff().spawn * (0.75 + Math.random() * 0.6);
      // quiet aprons at both ends of the hull
      if (p.x > APRON * 0.6 && p.x < game.level.length - APRON * 0.6) spawnInterceptor(game);
    }
  }

  for (let i = interceptors.count - 1; i >= 0; i--) {
    const e = interceptors.items[i];
    e.t += dt;
    e.x += e.dirX * game.level.spec.interceptorSpeed * dt;

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

    // despawn once well past the viewport; see CULL_MARGIN
    if (e.x < game.cam.x - CULL_MARGIN || e.x > game.cam.x + VIEW_W + CULL_MARGIN) {
      interceptors.kill(i);
    }
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
  spoils(game, e.x, e.y, 'interceptor');
  award(game, INTERCEPTOR.score);
  interceptors.kill(i);
  return true;
}

export function hitTurret(game, t, dmg) {
  // A warden's aura absorbs it. Visible, so it does not read as a bug.
  if (t.shielded) {
    sparks(t.x, t.y - t.dir * 6, 0, -t.dir, 3, '#b45ce0');
    return false;
  }
  t.hp -= dmg;
  if (t.hp > 0) {
    sparks(t.x, t.y - t.dir * 6, 0, -t.dir, 4, '#ffd24a');
    sfxEnemyHit();
    return false;
  }
  t.dead = true;
  const vol = t.tower && t.tower.volatile;
  explode(t.x, t.y - t.dir * 5, vol ? 3.4 : 1.5);
  sfxExplode(vol ? 2.6 : 1.5);
  // A fuel tank takes its neighbours with it. Queued as an ordinary
  // blast rather than applied here, so it goes through the same code
  // every other explosion does — which is also what makes the chain
  // work: the blast kills the next tank, which queues its own.
  //
  // Queued, not recursive. A tank igniting a tank that ignites the
  // first one back is a stack overflow dressed as a feature; the queue
  // is drained once per frame and a dead tank cannot re-enter it.
  if (vol) {
    (game.pendingBlast ||= []).push({
      x: t.x, y: t.y - t.dir * 6, r: vol.r, dmg: vol.dmg,
    });
  }
  spoils(game, t.x, t.y - t.dir * 14, 'turret');
  award(game, (t.tower && t.tower.score) || TURRET.score);
  game.turretsKilled++;
  return true;
}

export const resetEnemies = () => interceptors.clear();
