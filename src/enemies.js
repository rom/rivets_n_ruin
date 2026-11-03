import {
  TURRET, TOWERS, INTERCEPTOR, VIEW_W, FIELD_TOP, FIELD_BOT, APRON, clamp, CULL_MARGIN,
  MOD_FORCE, hullRule,
} from './config.js';
import { makePool } from './pool.js';
import { enemyShots, fire } from './projectiles.js';
import { explode, sparks } from './particles.js';
import { sfxTurretShot, sfxEnemyHit, sfxExplode,
  sfxCistern, sfxReactor, sfxPylon, sfxLit } from './sfx.js';
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
// LIVE HULL: the guns are put back.
//
// Only behind the ship, and only once it is far enough away not to watch
// it happen — a gun reassembling itself on screen reads as a bug, and one
// rebuilt in front of you is a gun you already paid for arriving again
// with no warning. Clearing a live hull means clearing it fast, which is
// the whole of what the rule asks.
//
// A rebuilt gun does not pay again: hullBonus counts the fraction of the
// hull's guns destroyed, and a tower that could be farmed for score every
// nine seconds would make a modifier into an exploit.
function rebuildHull(game) {
  const p = game.player;
  for (const t of game.level.turrets) {
    if (!t.dead || t.downAt === undefined) continue;
    if (game.time - t.downAt < MOD_FORCE.rebuildAfter) continue;
    // behind the ship, and off screen
    if ((t.x - p.x) * p.facing > -VIEW_W * 0.6) continue;
    t.dead = false;
    t.downAt = undefined;
    t.hp = Math.round(game.level.spec.turretHp * (t.tower ? t.tower.hpMul : 1));
    t.cd = Math.random() * 0.8;
    t.burstLeft = 0;
    t.charge = 0;
    t.angle = t.dir * Math.PI / 2;
  }
}

export function updateTurrets(game, dt) {
  const p = game.player;
  if (hullRule(game, 'livehull')) rebuildHull(game);

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
  // Searchlights sweep whether or not anybody is there, and what they
  // catch is lit for everything in reach. A light is not a gun: the
  // whole of its threat is what it does for the guns around it, which
  // is why breaking the lights first is a real decision rather than a
  // detour.
  const lit = beamLights(game, dt);

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
    // `!dishes.length` alone was an early-out from before beams existed,
    // and it silently switched the searchlights off: an air-defence post
    // fields lights, a watchtower, sheds and one gun, and not a single
    // dish — so on the one installation built around them the lights
    // painted nothing and the decision they exist to pose did not
    // exist. Both sources have to be out before this is free.
    if (t.dead || !t.tower || t.tower.inert || (!dishes.length && !lit)) continue;
    for (const d of dishes) {
      if (d === t) continue;
      if (Math.hypot(d.x - t.x, d.y - t.y) < d.tower.paint) { t.painted = d.tower; break; }
    }
    // Being caught in a beam counts as being painted, at the reach of
    // the light that caught you. One mechanic, two ways into it.
    if (!t.painted && lit) {
      for (const L of lit) {
        if (Math.hypot(L.x - t.x, L.y - t.y) < L.tower.beam.range) { t.painted = L.tower; break; }
      }
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

// Turns every searchlight on the hull and reports the ones whose beam
// is currently across the ship.
//
// The angle is stored on the turret so the lamp housing can point where
// the beam goes and the beam can be drawn from the same number — a light
// whose lamp and whose beam disagree reads as two separate bugs.
// Half the beam's width, in radians. Narrow enough that being caught is
// something that happens to you rather than a constant state, wide
// enough that it is not a laser.
const BEAM_WIDTH = 0.22;

function beamLights(game, dt) {
  const p = game.player;
  let caught = null;
  let lit = false;
  for (const t of game.level.turrets) {
    if (!t.tower || !t.tower.beam) continue;
    const sw = t.tower.beam;
    if (t.dead) { t.beamLit = false; continue; }
    t.beamA = (t.beamA || 0) + sw.speed * dt;
    // The lamp swings between the ends of its arc rather than spinning:
    // a searchlight that went all the way round would spend half its
    // time pointed into the hull it is bolted to.
    const aim = Math.sin(t.beamA) * sw.arc;
    t.beamAim = aim;

    // Everything below is measured from straight out of the deck, which
    // is where aim=0 points: `out` is how far in front of the light the
    // ship is, `across` how far to one side. A light on the ceiling and
    // one on the floor then use the same arithmetic.
    const across = p.x - t.x;
    const out = (p.y - t.y) * t.dir;
    const dist = Math.hypot(across, out);
    const bearing = Math.atan2(across, Math.max(1e-3, out));
    const was = t.beamLit;
    t.beamLit = game.player.alive && out > 0 && dist < sw.range
      && Math.abs(bearing - aim) < BEAM_WIDTH;
    // On the edge, not every frame it holds you. Being lit is not
    // damage — it is the guns around you getting better — so the cue
    // belongs at the moment it becomes true and nowhere else.
    if (t.beamLit && !was) lit = true;
    if (t.beamLit) (caught ||= []).push(t);
  }
  // One ping however many lights found you at once, because three
  // lights on one post all sweep past within a second of each other.
  if (lit) sfxLit();
  return caught;
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
  // When, for LIVE HULL. Harmless on every other hull: nothing reads it.
  t.downAt = game.time;
  const vol = t.tower && t.tower.volatile;
  explode(t.x, t.y - t.dir * 5, vol ? 3.4 : 1.5);
  // Three structures are loud enough, or consequential enough, to be
  // worth hearing apart from everything else going up. A cistern
  // reaches four times as far as a fuel tank and the sound is the only
  // warning anyone beside one gets; a reactor takes the whole plant's
  // quickening with it; a pylon drops the line between two of them.
  if (t.kind === 'cistern') sfxCistern();
  else if (t.kind === 'reactor') sfxReactor();
  else if (t.kind === 'pylon') sfxPylon();
  else sfxExplode(vol ? 2.6 : 1.5);
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
  // A gun pays once. On a LIVE HULL the same emplacement can be broken
  // several times in a run, and a tower that could be farmed for score and
  // loot every nine seconds would turn a modifier into an exploit — the
  // right play would be to park behind one and wait, which is the opposite
  // of what the rule asks for. The rebuild is the cost of leaving it
  // standing, not a respawning pickup.
  if (!t.paid) {
    t.paid = true;
    spoils(game, t.x, t.y - t.dir * 14, 'turret');
    award(game, (t.tower && t.tower.score) || TURRET.score);
    game.turretsKilled++;
  }
  return true;
}

export const resetEnemies = () => interceptors.clear();
