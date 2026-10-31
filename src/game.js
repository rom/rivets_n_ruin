import {
  SHIP, INTERCEPTOR, LEVELS, LEVEL_UP, PICKUP, BOSS, APRON, VIEW_W,
  FIELD_TOP, FIELD_BOT, clamp,
} from './config.js';
import { buildLevel, obstaclesNear } from './level.js';
import { makeBoss, updateBoss, hitBoss, bossBeaten, arenaLeft } from './boss.js';
import { makeCamera, updateCamera, kick } from './camera.js';
import { makePlayer, updatePlayer, respawn } from './player.js';
import {
  interceptors, updateTurrets, updateInterceptors, hitInterceptor, hitTurret, resetEnemies,
} from './enemies.js';
import { playerShots, enemyShots, advance } from './projectiles.js';
import { updateParticles, explode, sparks, particles } from './particles.js';
import { updatePickups, resetPickups, pickups } from './pickups.js';
import { updateFoes, resetFoes, foes, hitFoe, spawnFoeForLevel, SPEC as FOE_SPEC } from './foes.js';
import { updateOrdnance, resetOrdnance, ordnance } from './armory.js';
import { resetShop, applyMods } from './shop.js';
import { tapped, endFrame } from './input.js';
import {
  sfxPickup, sfxPlayerHit, sfxHullAbsorb, sfxDeath, sfxRespawn,
  sfxTurnaround, sfxComplete, sfxGameOver, sfxUi,
} from './sfx.js';
import { setIntensity, setTune } from './music.js';
import { submitRun, heartbeat, serverBest } from './net.js';
import { activeModId } from './mods.js';

export function makeGame(modSpec = null) {
  // A mod overrides the first hull's seed; the rest of the campaign is
  // unchanged, so a mod is a variant opening rather than a whole new game.
  const specs = modSpec
    ? [{ ...LEVELS[0], ...modSpec }, ...LEVELS.slice(1)]
    : LEVELS;
  const level = buildLevel(specs[0]);
  const game = {
    level,
    cam: makeCamera(),
    player: makePlayer(),
    state: 'title',        // title | play | dying | levelclear | gameover | victory
    stateT: 0,
    specs,
    levelIndex: 0,
    score: 0,
    turretsKilled: 0,
    deaths: 0,
    coins: 0,
    coffins: 0,
    mods: {},
    bought: {},
    submitted: false,
    spawnCd: 1.2,
    foeCd: 3.0,
    flash: 0,
    time: 0,        // clock for the current hull, shown on the clear screen
    runTime: 0,     // clock for the whole campaign, which is what gets submitted
    toast: null,
    returning: false,      // outbound leg done, now fly the hull back
    boss: null,            // set once the arena at the far end is entered
    quitting: false,       // quit confirmation is open
    banner: null,
    best: Number(localStorage.getItem('rnr.best') || 0),
    // The furthest hull ever reached, and the one selected on the title
    // screen. Progress through an eight-hull campaign should not be lost
    // every time a run ends.
    unlocked: clamp(Number(localStorage.getItem('rnr.unlocked') || 0), 0, LEVELS.length - 1),
    startHull: clamp(Number(localStorage.getItem('rnr.unlocked') || 0), 0, LEVELS.length - 1),
    onPickup: (kind) => sfxPickup(kind),
  };
  game.cam.x = clamp(game.player.x - VIEW_W / 2 + SHIP.w, 0, level.length - VIEW_W);
  return game;
}

// Records the furthest hull reached, so it can be started from next time.
function recordUnlock(game) {
  if (game.levelIndex > game.unlocked) {
    game.unlocked = game.levelIndex;
    try { localStorage.setItem('rnr.unlocked', String(game.unlocked)); } catch { /* private mode */ }
  }
}

// Starts a run at the selected hull. Hulls before it are credited as flown:
// arriving at PYRITE in a factory-standard ship would not be a challenge,
// it would be a joke.
function reset(game) {
  const at = clamp(game.startHull, 0, game.specs.length - 1);
  if (game.levelIndex !== at) {
    game.levelIndex = at;
    game.level = buildLevel(game.specs[at]);
  }
  setTune(game.specs[at].tune);
  for (const t of game.level.turrets) {
    t.dead = false;
    t.hp = game.level.spec.turretHp;
    t.cd = Math.random() * 0.8;
    t.burstLeft = 0;
    t.angle = t.dir * Math.PI / 2;
  }
  game.player = makePlayer();
  for (let i = 0; i < at; i++) applyRefit(game);   // the ship you would have
  applyMods(game);
  game.score = 0;
  game.turretsKilled = 0;
  game.deaths = 0;
  game.coins = 0;
  game.coffins = 0;
  resetShop(game);
  game.submitted = false;
  game.spawnCd = 1.2;
  game.foeCd = 3.0;
  game.returning = false;
  game.boss = null;
  game.quitting = false;
  game.flash = 0;
  game.time = 0;
  game.runTime = 0;
  game.banner = null;
  game.toast = null;
  resetEnemies();
  resetFoes();
  resetPickups();
  resetOrdnance();
  playerShots.clear();
  enemyShots.clear();
  particles.clear();
  game.cam.x = clamp(game.player.x - VIEW_W / 2 + SHIP.w, 0, game.level.length - VIEW_W);
}

// Clearing a hull carries the pilot forward: same ship, upgraded, same score
// and lives. Only the hull is new. This is the run's power curve meeting its
// difficulty curve.
function applyRefit(game) {
  const p = game.player;

  p.shieldMax += LEVEL_UP.shieldMax;
  p.shield = p.shieldMax;
  p.accelMul *= LEVEL_UP.accelMul;
  p.maxVXBonus += LEVEL_UP.maxVXAdd;
  p.maxVYBonus += LEVEL_UP.maxVYAdd;
  p.bulletBonus += LEVEL_UP.bulletSpeedAdd;
  p.gunCap = Math.min(PICKUP.gunCapMax, p.gunCap + LEVEL_UP.gunCap);
  // The refit raises the floor as well as the current level, so a ship lost
  // on a later hull does not fall back to a factory-standard gun.
  p.gunSpeedBase = Math.min(p.gunCap, p.gunSpeedBase + LEVEL_UP.gunSpeed);
  p.gunBlazeBase = Math.min(p.gunCap, p.gunBlazeBase + LEVEL_UP.gunBlaze);
  p.gunSpeed = Math.max(p.gunSpeed, p.gunSpeedBase);
  p.gunBlaze = Math.max(p.gunBlaze, p.gunBlazeBase);
  p.lives = Math.min(PICKUP.maxLives, p.lives + LEVEL_UP.lives);
}

// Then ENTER loads the hull itself.
function loadNextHull(game) {
  const p = game.player;
  game.levelIndex++;
  recordUnlock(game);
  game.level = buildLevel(game.specs[game.levelIndex]);
  setTune(game.specs[game.levelIndex].tune);

  p.x = 180;
  p.y = (FIELD_TOP + FIELD_BOT) / 2;
  p.vx = 0; p.vy = 0;
  p.facing = 1;
  p.flip = 0;
  p.invuln = SHIP.invuln;
  p.alive = true;

  game.returning = false;
  game.submitted = false;
  game.boss = null;
  game.time = 0;          // per-hull clock restarts; runTime keeps going
  game.spawnCd = 1.2;
  game.toast = null;
  resetEnemies();
  resetPickups();
  resetFoes();
  resetOrdnance();
  playerShots.clear();
  enemyShots.clear();
  particles.clear();
  game.cam.x = clamp(p.x - VIEW_W / 2 + SHIP.w, 0, game.level.length - VIEW_W);
}

function banner(game, text, sub = '', life = 2.4) {
  game.banner = { text, sub, t: life, max: life };
}

// Report a finished run to the backend. Fire-and-forget: submitRun never
// throws and never blocks, so a dead backend cannot stall the end screen.
function reportRun(game) {
  if (game.submitted) return;
  game.submitted = true;
  submitRun({
    modId: activeModId(),
    points: game.score,
    timeSec: Number(game.runTime.toFixed(2)),
    levels: game.levelIndex + 1,
    turrets: game.turretsKilled,
    deaths: game.deaths,
    completed: game.state === 'victory',   // only a full campaign counts as completed
  });
}

// Drive the score from what is actually happening: sparse on the title,
// full kit in flight, an extra layer for the return run and for a shield
// about to give out.
function scoreIntensity(game) {
  if (game.state !== 'play' && game.state !== 'dying') return 0;
  if (game.levelIndex > 0 && game.returning) return 3;
  if (game.returning || game.player.shield < 30) return 3;
  return 2;
}

export function update(game, dt) {
  game.stateT += dt;
  setIntensity(scoreIntensity(game));

  // --- quit confirmation. Freezes the simulation while it is up: being shot
  // while deciding whether to leave would be a cheap way to lose a run.
  if (game.quitting) {
    if (tapped('yes')) {
      game.quitting = false;
      // The run was genuinely flown, so it is recorded rather than forfeited.
      recordBest(game);
      reportRun(game);
      game.state = 'title';
      game.stateT = 0;
      sfxGameOver();
    } else if (tapped('no') || tapped('quit') || tapped('pause')) {
      game.quitting = false;
      sfxUi();
    }
    updateParticles(dt);
    endFrame();
    return;
  }

  if (tapped('quit') && (game.state === 'play' || game.state === 'dying')) {
    game.quitting = true;
    sfxUi();
    endFrame();
    return;
  }
  if (game.flash > 0) game.flash = Math.max(0, game.flash - dt * 2.6);
  if (game.banner) {
    game.banner.t -= dt;
    if (game.banner.t <= 0) game.banner = null;
  }
  if (game.toast) {
    game.toast.t -= dt;
    if (game.toast.t <= 0) game.toast = null;
  }

  // Between hulls: ENTER carries the upgraded ship onto the next one.
  if (game.state === 'levelclear') {
    if (tapped('start') || tapped('fire')) {
      sfxUi();
      loadNextHull(game);
      game.state = 'play';
      game.stateT = 0;
      const spec = game.specs[game.levelIndex];
      banner(game, spec.name, spec.subtitle, 3.0);
    }
    updateParticles(dt);
    endFrame();
    return;
  }

  if (game.state === 'title' || game.state === 'gameover' || game.state === 'victory') {
    // Pick a hull: anything up to the furthest ever reached.
    if (tapped('left') && game.startHull > 0) { game.startHull--; sfxUi(); }
    if (tapped('right') && game.startHull < game.unlocked) { game.startHull++; sfxUi(); }
    if (tapped('start') || tapped('fire')) {
      sfxUi();
      reset(game);
      game.state = 'play';
      game.stateT = 0;
      banner(game, "RIVETS 'N RUIN", 'RUN THE HULL — AND RUN IT BACK', 2.6);
    }
    updateParticles(dt);
    endFrame();
    return;
  }

  if (tapped('restart')) { reset(game); game.state = 'play'; game.stateT = 0; }

  if (game.state === 'dying') {
    updateParticles(dt);
    advance(playerShots, dt);
    advance(enemyShots, dt);
    updateCamera(game.cam, game.player, game.level.length, dt);
    if (game.stateT > 1.15) {
      if (game.player.lives <= 0) {
        game.state = 'gameover';
        game.stateT = 0;
        sfxGameOver();
        recordBest(game);
        reportRun(game);
      } else {
        respawn(game.player, game);
        sfxRespawn();
        game.state = 'play';
        game.stateT = 0;
      }
    }
    endFrame();
    return;
  }

  // ---------------------------------------------------------------- playing
  game.time += dt;
  game.runTime += dt;
  const p = game.player;

  updatePlayer(p, game, dt);
  updateTurrets(game, dt);
  updateInterceptors(game, dt);
  updateFoes(game, dt);
  updateBoss(game, dt);
  // Missiles need something to chase; gather it once rather than per missile.
  collectSeekable(game);
  updateOrdnance(game, dt);
  applyBlasts(game);
  updatePickups(game, dt);
  advance(playerShots, dt);
  advance(enemyShots, dt);
  updateParticles(dt);
  collide(game);
  updateCamera(game.cam, p, game.level.length, dt,
    game.boss && !bossBeaten(game.boss) ? arenaLeft(game) : null);

  // --- the arena at the far end
  const inArena = !game.returning && p.x > arenaLeft(game) + 70;
  if (inArena && !game.boss) {
    game.boss = makeBoss(game);
    banner(game, game.boss.name, game.boss.spec.tag, 3.0);
    sfxTurnaround();
  }
  if (game.boss && !bossBeaten(game.boss)) {
    // Wall the ship in. There is no retreating from a boss, and the camera
    // pins so the fight reads as a single room rather than a scroll.
    const left = arenaLeft(game);
    p.x = clamp(p.x, left + 24, game.level.length - BOSS.arenaMargin);
    if (p.x <= left + 24 && p.vx < 0) p.vx = 0;
  }

  // two-way objective: the boss opens the way back, the dock finishes you
  if (!game.returning && game.boss && bossBeaten(game.boss)) {
    game.returning = true;
    game.boss = null;
    banner(game, 'WAY OPEN — TURN AND BURN', 'RUN THE HULL BACK TO THE DOCK', 3.0);
    game.score += 2500;
    sfxTurnaround();
  } else if (game.returning && p.x < APRON * 0.55) {
    // Award the bonus BEFORE anything reads the score. This used to report
    // the run to the backend first, so every submitted completion was short
    // by its own completion bonus.
    game.score += 5000 + Math.max(0, Math.round((260 - game.time) * 25));
    game.stateT = 0;
    sfxComplete();

    if (game.levelIndex < game.specs.length - 1) {
      game.state = 'levelclear';     // more hull to fly; the run continues
      game.banner = null;            // don't let TURN AND BURN sit over the panel
      applyRefit(game);              // so the refit panel shows real numbers
    } else {
      game.state = 'victory';        // campaign over: now it counts
      recordBest(game);
      reportRun(game);
    }
  }

  // Extra attacker types, on their own slower cadence so they punctuate the
  // interceptor stream rather than drowning it.
  game.foeCd -= dt;
  if (game.foeCd <= 0) {
    game.foeCd = 2.6 + Math.random() * 2.2;
    if (p.x > APRON && p.x < game.level.length - APRON) spawnFoeForLevel(game);
  }

  // Tell the backend we are out here. Self-throttling to one beat every 5s.
  heartbeat(activeModId(), (game.levelIndex + p.x / game.level.length) / game.specs.length, game.score);

  if (p.shield <= 0 && p.alive) die(game);
  endFrame();
}

// The best score lives in two places on purpose: the backend owns it (so it
// follows the pilot across browsers and survives a cleared localStorage) and
// localStorage caches it (so it still shows when the backend is unreachable).
// Whichever is higher wins.
export function syncBest(game) {
  const remote = serverBest();
  if (remote > game.best) {
    game.best = remote;
    try { localStorage.setItem('rnr.best', String(remote)); } catch { /* private mode */ }
  }
}

// Everything a homing missile may lock onto, rebuilt each frame. Turrets
// are included only when close, so a missile does not fly the length of the
// hull chasing one it will never reach.
function collectSeekable(game) {
  const out = game._seekable || (game._seekable = []);
  out.length = 0;
  const px = game.player.x;
  for (let i = 0; i < interceptors.count; i++) out.push(interceptors.items[i]);
  for (let i = 0; i < foes.count; i++) out.push(foes.items[i]);
  for (const t of game.level.turrets) {
    if (!t.dead && Math.abs(t.x - px) < 420) out.push(t);
  }
  const b = game.boss;
  if (b && !b.dead && b.entry <= 0) {
    const live = b.parts.filter((pt) => !pt.dead);
    if (live.length) for (const pt of live) out.push({ x: b.x + pt.dx, y: b.y + pt.dy });
    else out.push(b);
  }
}

// Area damage from bombs, grenades and missiles. Collected during the
// ordnance update and resolved here, so one blast applies once to each
// thing in range whatever the iteration order.
function applyBlasts(game) {
  const blasts = game.pendingBlast;
  if (!blasts || !blasts.length) return;

  for (const bl of blasts) {
    const hit = (x, y) => Math.hypot(x - bl.x, y - bl.y) < bl.r;

    for (let i = interceptors.count - 1; i >= 0; i--) {
      const e = interceptors.items[i];
      if (hit(e.x, e.y)) hitInterceptor(game, i, bl.dmg);
    }
    for (let i = foes.count - 1; i >= 0; i--) {
      const f = foes.items[i];
      // a blast ignores a warder's frontal plate, which is rather the point
      if (hit(f.x, f.y)) hitFoe(game, i, f.x, f.y - 999, bl.dmg);
    }
    for (const t of game.level.turrets) {
      if (!t.dead && hit(t.x, t.y)) hitTurret(game, t, bl.dmg);
    }
    const b = game.boss;
    if (b && !b.dead && b.entry <= 0) {
      for (const pt of b.parts) {
        if (!pt.dead && hit(b.x + pt.dx, b.y + pt.dy)) hitBoss(game, b, b.x + pt.dx, b.y + pt.dy, bl.dmg);
      }
      if (hit(b.x, b.y)) hitBoss(game, b, b.x, b.y, bl.dmg);
    }
    // You are not immune to your own ordnance, but you take far less of it.
    const p = game.player;
    if (p.alive && p.invuln <= 0 && hit(p.x, p.y)) {
      p.shield -= bl.dmg * 0.3;
      game.flash = Math.max(game.flash, 0.3);
    }
  }
  blasts.length = 0;
}

function recordBest(game) {
  if (game.score > game.best) {
    game.best = game.score;
    try { localStorage.setItem('rnr.best', String(game.score)); } catch { /* private mode */ }
  }
}

function die(game) {
  const p = game.player;
  p.alive = false;
  p.lives--;
  game.deaths++;
  explode(p.x, p.y, 2.4, '#b4f4ff', '#4fd0e8');
  explode(p.x, p.y, 1.6);
  sfxDeath();
  kick(game.cam, 14);
  game.flash = 0.75;
  game.state = 'dying';
  game.stateT = 0;
}

function collide(game) {
  const p = game.player;

  // player shots -> hull, turrets, interceptors
  for (let i = playerShots.count - 1; i >= 0; i--) {
    const s = playerShots.items[i];
    let gone = false;

    for (let j = interceptors.count - 1; j >= 0 && !gone; j--) {
      const e = interceptors.items[j];
      if (Math.abs(s.x - e.x) < 12 && Math.abs(s.y - e.y) < 8) {
        hitInterceptor(game, j, s.dmg);
        gone = true;
      }
    }

    for (let j = foes.count - 1; j >= 0 && !gone; j--) {
      const f = foes.items[j];
      const r = FOE_SPEC[f.kind].r;
      if (Math.abs(s.x - f.x) < r && Math.abs(s.y - f.y) < r) gone = hitFoe(game, j, s.x, s.y, s.dmg);
    }

    if (!gone && game.boss && hitBoss(game, game.boss, s.x, s.y, s.dmg)) gone = true;

    if (!gone) {
      for (const t of game.level.turrets) {
        if (t.dead) continue;
        if (Math.abs(s.x - t.x) < 10 && Math.abs(s.y - (t.y + t.dir * 4)) < 9) {
          hitTurret(game, t, s.dmg);
          gone = true;
          break;
        }
      }
    }

    // shots are absorbed by the hull — no shooting through a block
    if (!gone) {
      for (const o of obstaclesNear(game.level, s.x, s.x)) {
        if (s.x > o.x && s.x < o.x + o.w && s.y > o.y && s.y < o.y + o.h) {
          sparks(s.x, s.y, -Math.sign(s.vx), 0, 4, '#8e9aa9');
          sfxHullAbsorb();
          gone = true;
          break;
        }
      }
    }

    if (gone) playerShots.kill(i);
  }

  if (!p.alive) return;

  const hw = SHIP.hitW / 2;
  const hh = SHIP.hitH / 2;

  // enemy shots -> player, hull
  for (let i = enemyShots.count - 1; i >= 0; i--) {
    const s = enemyShots.items[i];
    if (Math.abs(s.x - p.x) < hw + s.r && Math.abs(s.y - p.y) < hh + s.r) {
      enemyShots.kill(i);
      if (p.invuln <= 0) {
        p.shield -= s.dmg;
        game.flash = Math.max(game.flash, 0.3);
        kick(game.cam, 3.5);
        sparks(s.x, s.y, -Math.sign(s.vx), 0, 6, '#e8434f');
        sfxPlayerHit();
      }
      continue;
    }
    let hitHull = false;
    for (const o of obstaclesNear(game.level, s.x, s.x)) {
      if (s.x > o.x && s.x < o.x + o.w && s.y > o.y && s.y < o.y + o.h) { hitHull = true; break; }
    }
    if (hitHull) {
      sparks(s.x, s.y, -Math.sign(s.vx), 0, 3, '#8e9aa9');
      enemyShots.kill(i);
    }
  }

  // ramming
  for (let j = interceptors.count - 1; j >= 0; j--) {
    const e = interceptors.items[j];
    if (Math.abs(e.x - p.x) < hw + 9 && Math.abs(e.y - p.y) < hh + 6) {
      hitInterceptor(game, j, 99);
      if (p.invuln <= 0) {
        p.shield -= INTERCEPTOR.ramDamage;
        game.flash = Math.max(game.flash, 0.45);
        kick(game.cam, 7);
        sfxPlayerHit();
      }
    }
  }
}
