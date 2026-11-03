import {
  SHIP, INTERCEPTOR, LEVELS, LEVEL_UP, PICKUP, BOSS, HULL_BONUS, APRON, VIEW_W,
  FIELD_TOP, FIELD_BOT, clamp, LANCE, FOE_PACE} from './config.js';
import { diff, award, hurt } from './score.js';
import { get as setting, set as setSetting, onChange as onSetting } from './settings.js';
import {
  buildLevel, obstaclesNear, updateMovers, modifierFor, specWithModifier,
} from './level.js';
import { updateGates, hitGate, gateHit, liveGates } from './gates.js';
import { makeBoss, updateBoss, hitBoss, bossBeaten, arenaLeft } from './boss.js';
import { makeCamera, updateCamera, kick } from './camera.js';
import { makePlayer, updatePlayer, respawn } from './player.js';
import {
  interceptors, updateTurrets, updateInterceptors, hitInterceptor, hitTurret, resetEnemies,
} from './enemies.js';
import { playerShots, enemyShots, advance } from './projectiles.js';
import { updateParticles, explode, sparks, particles, thrust as thrustPlume } from './particles.js';
import {
  updatePickups, resetPickups, pickups, TREASURES, freshHaul,
} from './pickups.js';
import {
  updateFoes, resetFoes, foes, hitFoe, spawnFoeForLevel, spawnSquadron, foeRateFor,
  dropAttached,
  SPEC as FOE_SPEC,
} from './foes.js';
import { updateOrdnance, resetOrdnance, ordnance } from './armory.js';
import {
  minis, resetMinis, planMinis, updateMinis, hitMini, hitMinis, miniTargets,
} from './miniboss.js';
import { resetShop, applyMods, MODS } from './shop.js';
import { loadHangar, saveHangar } from './hangar.js';
import { SPLASH_TIME, LAUNCH_TIME, EXIT_TIME, ENDING_TIME, launchPose, exitPose } from './sequences.js';
import { tapped, anyTapped, endFrame } from './input.js';
import {
  sfxCoin, sfxGoldBar, sfxCoffin, sfxTreasure,
  sfxPickup, sfxPlayerHit, sfxHullAbsorb, sfxDeath, sfxRespawn,
  sfxArrival, sfxComplete, sfxGameOver, sfxUi, sfxShoot,
} from './sfx.js';
import { setIntensity, setTune } from './music.js';
import { submitRun, heartbeat, serverBest, startRun } from './net.js';
import { activeModId } from './mods.js';

export { diff } from './score.js';

// The seed a run folds into every hull it builds. Zero when the pilot wants
// fixed layouts, which is what makes buildLevel ignore it entirely.
//
// Not Date.now(): two tabs opened together, or a restart inside the same
// millisecond, would fly the same "random" campaign. crypto.getRandomValues
// is in every browser the game already requires, and the fallback is only
// for a test environment that has no crypto at all.
function freshRunSeed() {
  if (!Number(setting('shuffle'))) return 0;
  try {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  } catch {
    return (Math.random() * 0x100000000) >>> 0;
  }
}

export function makeGame(modSpec = null) {
  // A mod overrides the first hull's seed; the rest of the campaign is
  // unchanged, so a mod is a variant opening rather than a whole new game.
  const specs = modSpec
    ? [{ ...LEVELS[0], ...modSpec }, ...LEVELS.slice(1)]
    : LEVELS;
  // Drawn once here so the title screen's hull has one, and redrawn by
  // reset() for every run after.
  const runSeed = freshRunSeed();
  const hullMod = modifierFor(0, specs[0], runSeed);
  const level = buildLevel(specWithModifier(specs[0], hullMod), runSeed);
  const game = {
    level,
    runSeed,
    hullMod,               // the rule this hull is flown under, or null
    cam: makeCamera(),
    player: makePlayer(),
    state: 'splash',       // splash | title | launching | play | dying
                           // | exiting | levelclear | gameover | ending | victory
    stateT: 0,
    specs,
    levelIndex: 0,
    score: 0,
    turretsKilled: 0,
    deaths: 0,
    coins: 0,            // replaced from the hangar below
    coffins: 0,
    bars: 0,
    treasures: 0,
    startAt: 0,            // the hull this run began on; see reportRun
    haul: freshHaul(),       // the whole run
    hullHaul: freshHaul(),   // this hull only, for the end-of-hull bonus
    bonus: null,             // last hull's bonus breakdown, for the overview
    deathsThisHull: 0,
    mods: {},            // replaced from the hangar below
    bought: {},
    submitted: false,
    spawnCd: 1.2,
    foeCd: 3.0,
    flash: 0,
    time: 0,        // clock for the current hull, shown on the clear screen
    runTime: 0,     // clock for the whole campaign, which is what gets submitted
    toast: null,
    boss: null,            // set once the arena at the far end is entered
    bossDown: false,       // this hull's boss has been beaten; see the arena check
    lootT: 0,              // seconds left to sweep a beaten boss's wreck
    leaving: false,        // the loot window closed; run out through the end
    bossWreck: null,       // where it died, for the countdown readout
    miniPlan: planMinis(level, 0),   // where along this hull minibosses wait
    quitting: false,       // quit confirmation is open
    banner: null,
    best: Number(localStorage.getItem('rnr.best') || 0),
    // The furthest hull ever reached, and the one selected on the title
    // screen. Progress through an eight-hull campaign should not be lost
    // every time a run ends.
    unlocked: clamp(Number(localStorage.getItem('rnr.unlocked') || 0), 0, LEVELS.length - 1),
    startHull: 0,          // set below, from the setting, bounded by unlocked
    onPickup: (kind) => sfxPickup(kind),
    // Loot has its own sound family, escalating with value.
    onHaul: (kind) => {
      if (kind === 'coin') sfxCoin();
      else if (kind === 'goldbar') sfxGoldBar();
      else if (kind === 'coffin') sfxCoffin();
      else sfxTreasure(TREASURES.indexOf(kind));
    },
  };
  // A miniboss announces itself: it is not another interceptor, and the
  // pilot gets a moment to decide whether to stop for it.
  game.onMiniArrive = (name) => {
    game.toast = { text: name, kind: 'coffin', t: 2.2 };
    kick(game.cam, 5);
    sfxArrival();
  };
  game.onMiniEscort = () => spawnFoeForLevel(game);

  // Where a run begins. The setting owns it, so it can be changed from the
  // settings page as well as from the title, and it survives a reload —
  // but it is always bounded by how far the pilot has actually got.
  const syncStartHull = () => {
    game.startHull = clamp(Number(setting('startHull')) || 0, 0, game.unlocked);
  };
  syncStartHull();
  onSetting((id) => { if (id === 'startHull' || id === null) syncStartHull(); });
  game.setStartHull = (n) => {
    const v = clamp(n, 0, game.unlocked);
    game.startHull = v;
    setSetting('startHull', v);
  };
  // What the pilot already owns. Coins and mods outlive the tab; see
  // hangar.js for why those two and nothing else.
  const owned = loadHangar(Object.keys(MODS));
  game.coins = owned.coins;
  game.bars = owned.bars;
  game.mods = owned.mods;
  applyMods(game);

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
  // Which hull this run began on. A run that starts at AURUM reaches hull
  // eight having flown one, and the two numbers mean different things to
  // the leaderboard and to the validator: the first is how far you got,
  // the second is how long it could possibly have taken.
  game.startAt = at;
  // A fresh run gets a fresh seed, and the hull is rebuilt whether or not
  // the index moved — otherwise a run started from the title after another
  // run on the same hull would fly the previous run's layout with the new
  // run's seed, which is neither setting's behaviour.
  game.runSeed = freshRunSeed();
  game.levelIndex = at;
  game.hullMod = modifierFor(at, game.specs[at], game.runSeed);
  game.level = buildLevel(specWithModifier(game.specs[at], game.hullMod), game.runSeed);
  setTune(game.specs[at].tune);
  // The gates and turrets used to be walked here and put back by hand,
  // because the hull was only rebuilt when the index moved. It always is
  // now, so a fresh one arrives with fresh guns — and the walk was wrong
  // anyway: it assigned the hull's base turretHp flat, dropping the per-
  // tower hpMul, so a BASTION restarted on the hull it died on stood up
  // with a GUN's health. See the reset test in level.test.mjs.
  game.player = makePlayer();
  // Open a run with the server. Fire-and-forget: a backend that is down
  // costs the leaderboard, never the run.
  startRun(activeModId());
  for (let i = 0; i < at; i++) applyRefit(game);   // the ship you would have
  applyMods(game);
  game.score = 0;
  game.turretsKilled = 0;
  game.deaths = 0;
  // Coins and mods deliberately survive: they are the hangar, not the run.
  // Everything else a shop sells is the run's loadout and does reset; see
  // resetShop and hangar.js.
  game.coffins = 0;
  // game.bars is the purse now, not a run counter: the armourer prices
  // its permanent systems in gold bars, so banking them has to work the
  // way banking coins does. The per-run and per-hull counts the bonus and
  // the end screen read are in haul and hullHaul, where they already were.

  game.treasures = 0;
  game.haul = freshHaul();
  game.hullHaul = freshHaul();
  game.bonus = null;
  game.deathsThisHull = 0;
  resetShop(game);
  game.submitted = false;
  game.spawnCd = 1.2;
  game.foeCd = 3.0;
  game.boss = null;
  game.bossDown = false;
  game.lootT = 0;
  game.leaving = false;
  game.bossWreck = null;
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
  resetMinis();
  game.miniPlan = planMinis(game.level, at);
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
  // Which refit this is. Counted on the player rather than passed in,
  // because reset() credits the hulls you skipped by calling this in a
  // loop and the end-of-hull path calls it once — a caller that had to
  // work out the number itself is a caller that can get it wrong.
  p.refits = (p.refits || 0) + 1;
  const every = (n) => n > 0 && p.refits % n === 0;

  // Bounded: see SHIP.shieldCap. The bonus the upgrades have added rides
  // on top of the cap rather than being squeezed out by it, or a healthbar
  // collected before the cap would silently stop counting after it.
  const refitFloor = Math.min(SHIP.shieldCap, p.shieldMax - (p.shieldBonus || 0)
    + LEVEL_UP.shieldMax);
  p.shieldMax = refitFloor + (p.shieldBonus || 0);
  p.shield = p.shieldMax;
  p.accelMul *= LEVEL_UP.accelMul;
  p.maxVXBonus += LEVEL_UP.maxVXAdd;
  p.maxVYBonus += LEVEL_UP.maxVYAdd;
  p.bulletBonus += LEVEL_UP.bulletSpeedAdd;
  // The refit raises the base; applyMods adds any extra mounts on top of
  // it. Raising the live cap here would be lost the next time mods are
  // applied, and raising both would double-count.
  if (every(LEVEL_UP.gunCapEvery)) {
    p.gunCapBase = Math.min(PICKUP.gunCapMax, (p.gunCapBase || p.gunCap) + 1);
  } else {
    p.gunCapBase = p.gunCapBase || p.gunCap;
  }
  p.gunCap = Math.max(p.gunCap, p.gunCapBase);
  // The refit raises the floor as well as the current level, so a ship lost
  // on a later hull does not fall back to a factory-standard gun.
  if (every(LEVEL_UP.gunSpeedEvery)) {
    p.gunSpeedBase = Math.min(p.gunCap, p.gunSpeedBase + 1);
  }
  if (every(LEVEL_UP.gunBlazeEvery)) {
    p.gunBlazeBase = Math.min(p.gunCap, p.gunBlazeBase + 1);
  }
  p.gunSpeed = Math.max(p.gunSpeed, p.gunSpeedBase);
  p.gunBlaze = Math.max(p.gunBlaze, p.gunBlazeBase);
  p.lives = Math.min(PICKUP.maxLives, p.lives + LEVEL_UP.lives);
  // Mods act on top of the refit, so they are re-applied after it rather
  // than left holding values computed against the previous airframe.
  applyMods(game);
}

// Then ENTER loads the hull itself.
function loadNextHull(game) {
  const p = game.player;
  game.levelIndex++;
  recordUnlock(game);
  // The hull's haul and its end-of-hull bonus are both in by now, and a
  // pilot who closes the tab between hulls should keep them.
  saveHangar(game);
  game.hullMod = modifierFor(game.levelIndex, game.specs[game.levelIndex], game.runSeed);
  game.level = buildLevel(
    specWithModifier(game.specs[game.levelIndex], game.hullMod), game.runSeed);
  setTune(game.specs[game.levelIndex].tune);

  p.x = 180;
  p.y = (FIELD_TOP + FIELD_BOT) / 2;
  p.vx = 0; p.vy = 0;
  p.facing = 1;
  p.flip = 0;
  p.invuln = SHIP.invuln;
  p.alive = true;

  game.submitted = false;
  game.boss = null;
  game.bossDown = false;
  game.lootT = 0;
  game.leaving = false;
  game.bossWreck = null;
  game.time = 0;          // per-hull clock restarts; runTime keeps going
  game.hullHaul = freshHaul();
  game.bonus = null;
  game.deathsThisHull = 0;
  game.spawnCd = 1.2;
  game.toast = null;
  resetEnemies();
  resetPickups();
  resetFoes();
  resetOrdnance();
  resetMinis();
  game.miniPlan = planMinis(game.level, game.levelIndex);
  playerShots.clear();
  enemyShots.clear();
  particles.clear();
  game.cam.x = clamp(p.x - VIEW_W / 2 + SHIP.w, 0, game.level.length - VIEW_W);
}

function banner(game, text, sub = '', life = 2.4) {
  game.banner = { text, sub, t: life, max: life };
}

// How many hulls this run actually covered, as opposed to how far it got.
// Two different numbers, and conflating them is what made the server throw
// away a real 4.65-million run: it read "reached hull eight" as "flew eight
// hulls" and decided 256 seconds was impossibly fast for them.
//
// Exported because it is the arithmetic, not the submission, that was
// wrong, and arithmetic is what a test can hold still.
export function hullsFlown(game) {
  return Math.max(1, (game.levelIndex || 0) - (game.startAt || 0) + 1);
}

// Report a finished run to the backend. Fire-and-forget: submitRun never
// throws and never blocks, so a dead backend cannot stall the end screen.
function reportRun(game) {
  // Bank what the run earned before anything else. A run that ends is the
  // last certain moment to do it, and the coins are the pilot's whatever
  // the leaderboard makes of the score.
  saveHangar(game);
  if (game.submitted) return;
  game.submitted = true;
  submitRun({
    modId: activeModId(),
    points: game.score,
    timeSec: Number(game.runTime.toFixed(2)),
    levels: game.levelIndex + 1,
    hullsFlown: hullsFlown(game),
    turrets: game.turretsKilled,
    deaths: game.deaths,
    completed: game.state === 'victory',   // only a full campaign counts as completed
  });
}

// Drive the score from what is actually happening: sparse on the title,
// full kit in flight, an extra layer for the boss fight and for a shield
// about to give out. (It used to say "the return run", which outlived the
// return run by some margin.)
function scoreIntensity(game) {
  if (game.state !== 'play' && game.state !== 'dying') return 0;
  // The boss fight and a failing shield are the two moments worth a layer.
  if (game.boss || game.player.shield < 30) return 3;
  return 2;
}

export function update(game, dt) {
  game.stateT += dt;
  setIntensity(scoreIntensity(game));

  // --- splash. Any key skips it; it is shown once per load, not per run.
  if (game.state === 'splash') {
    if (game.stateT > SPLASH_TIME || anyTapped()) {
      game.state = 'title';
      game.stateT = 0;
    }
    updateParticles(dt);
    endFrame();
    return;
  }

  // --- launching and the run out through the far end. The ship is on rails
  // and the controls are locked, so neither can be flown out of; either can
  // be skipped.
  if (game.state === 'launching' || game.state === 'exiting') {
    const dur = game.state === 'launching' ? LAUNCH_TIME : EXIT_TIME;
    const k = clamp(game.stateT / dur, 0, 1);
    const pose = game.state === 'launching'
      ? launchPose(k)
      : exitPose(k, game.seqFromX, game.seqFromY);
    const p = game.player;
    p.x = pose.x;
    p.y = pose.y;
    p.vx = 0; p.vy = 0;
    p.facing = 1;
    game.seqThrust = pose.thrust;
    game.seqTilt = pose.tilt;
    if (pose.thrust > 0.15 && Math.random() < dt * 60) {
      thrustPlume(p.x - p.facing * 13, p.y, -p.facing, 0);
    }
    updateCamera(game.cam, p, game.level.length, dt);
    updateParticles(dt);

    if (k >= 1 || tapped('start') || tapped('fire')) finishSequence(game);
    endFrame();
    return;
  }

  // --- the ending: the last landing, played out.
  if (game.state === 'ending') {
    updateParticles(dt);
    if (game.stateT > ENDING_TIME || tapped('start')) {
      game.state = 'victory';
      game.stateT = 0;
    }
    endFrame();
    return;
  }

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
  if (game.pdFlash && game.pdFlash.t > 0) game.pdFlash.t -= dt;
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
      game.state = 'launching';
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
    if (tapped('left') && game.startHull > 0) { game.setStartHull(game.startHull - 1); sfxUi(); }
    if (tapped('right') && game.startHull < game.unlocked) { game.setStartHull(game.startHull + 1); sfxUi(); }
    if (tapped('start') || tapped('fire')) {
      sfxUi();
      reset(game);
      game.state = 'launching';
      game.stateT = 0;
      banner(game, "RIVETS 'N RUIN", 'BREAK THE GUNS — RUN THE HULL THROUGH', 2.6);
    }
    updateParticles(dt);
    endFrame();
    return;
  }

  if (tapped('restart')) { reset(game); game.state = 'launching'; game.stateT = 0; }

  if (game.state === 'dying') {
    updateParticles(dt);
    advance(playerShots, dt);
    advance(enemyShots, dt, game.player);
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

  // The jaws move first. A jaw closing onto the ship has to be resolved by
  // the player's own push-out in the same frame, or the ship spends a frame
  // inside solid steel and comes out the wrong side of it.
  updateMovers(game.level, game.time);
  updatePlayer(p, game, dt);
  // Gates run immediately after the ship moves, so a beam stops it in the
  // same frame rather than letting it sit a frame inside the wall.
  updateGates(game, dt);
  updateTurrets(game, dt);
  updateInterceptors(game, dt);
  updateFoes(game, dt);
  updateMinis(game, dt);
  updateBoss(game, dt);
  // Missiles need something to chase; gather it once rather than per missile.
  collectSeekable(game);
  fireLance(game);
  updateOrdnance(game, dt);
  applyBlasts(game);
  updatePickups(game, dt);
  advance(playerShots, dt);
  advance(enemyShots, dt, game.player);
  updateParticles(dt);
  collide(game);
  updateCamera(game.cam, p, game.level.length, dt,
    game.boss && !bossBeaten(game.boss) ? arenaLeft(game) : null);

  // --- the arena at the far end
  // `bossDown` and not just `!game.boss`: killing the boss sets
  // game.boss to null so the camera unpins and the wall comes down, and
  // the player is then standing in the arena sweeping the wreck for ten
  // seconds with nothing holding the spawn back. A second, identical
  // boss arrived on the very next frame, banner and all. Reported from
  // play as "all bosses occur twice", and exactly right.
  const inArena = p.x > arenaLeft(game) + 70;
  if (inArena && !game.boss && !game.bossDown) {
    game.boss = makeBoss(game);
    banner(game, game.boss.name, game.boss.spec.tag, 3.0);
    sfxArrival();
  }
  if (game.boss && !bossBeaten(game.boss)) {
    // Wall the ship in. There is no retreating from a boss, and the camera
    // pins so the fight reads as a single room rather than a scroll.
    const left = arenaLeft(game);
    p.x = clamp(p.x, left + 24, game.level.length - BOSS.arenaMargin);
    if (p.x <= left + 24 && p.vx < 0) p.vx = 0;
  }

  // One objective, one direction: break the boss and the far end opens.
  // Flying the same hull back the other way doubled its length without
  // adding anything to it — the guns were already broken and the loot
  // already collected, so the return leg was a commute.
  //
  // The wreck pays out, and a boss sheds a hold: bars, coffins, treasure
  // and a cloud of coins, all of it scattered across an arena the ship was
  // walled into a second ago. Leaving immediately threw most of it away.
  // So the arena stays open for a while, with the clock on screen, and
  // ENTER leaves early for anyone who has already swept it.
  if (game.boss && bossBeaten(game.boss) && game.lootT === 0) {
    game.lootT = BOSS.lootWindow;
    game.bossWreck = { x: game.boss.x, y: game.boss.y };
    game.boss = null;
    game.bossDown = true;      // this hull's arena is spent
    banner(game, 'WRECK CLEARED', 'COLLECT — ENTER TO LAUNCH EARLY', 2.4);
  }
  if (game.lootT > 0) {
    game.lootT = Math.max(0, game.lootT - dt);
    if (tapped('start') || tapped('fire')) game.lootT = 0;
    if (game.lootT === 0) game.leaving = true;
  }

  if (game.leaving) {
    game.leaving = false;
    game.seqFromX = p.x;
    game.seqFromY = p.y;
    // Award the bonuses BEFORE anything reads the score. This used to report
    // the run to the backend first, so every submitted completion was short
    // by its own completion bonus.
    award(game, 2500);
    award(game, 5000 + Math.max(0, Math.round((260 - game.time) * 25)));
    game.bonus = hullBonus(game);
    for (const line of game.bonus.lines) award(game, line.points);
    game.stateT = 0;
    sfxComplete();

    // The ship flies itself out through the far end; that sequence decides
    // what comes next.
    game.state = 'exiting';
    game.banner = null;
  }

  // Squadrons, on their own slower cadence so they punctuate the
  // interceptor stream rather than drowning it.
  //
  // The gap after one is paced by what arrived, in the only currency the
  // roster already agrees on: what it was worth to kill. A swarm of gnats
  // comes round again quickly; a monitor buys itself a long quiet. Tuned
  // so the threat per second stays what the one-at-a-time cadence
  // delivered — composition was the point, not a difficulty change.
  game.foeCd -= dt;
  if (game.foeCd <= 0) {
    let weight = FOE_PACE.assumed;
    if (p.x > APRON && p.x < game.level.length - APRON) {
      const sq = spawnSquadron(game);
      if (sq) weight = sq.weight;
    }
    const rate = foeRateFor(game.level.spec) * (game.level.spec.foeRateMul || 1);
    const gap = rate > 0 ? Math.max(FOE_PACE.floor, weight / rate) : FOE_PACE.floor;
    game.foeCd = gap * (FOE_PACE.jitter + Math.random() * (2 - FOE_PACE.jitter * 2));
  }

  // Tell the backend we are out here. Self-throttling to one beat every 5s.
  heartbeat(activeModId(), (game.levelIndex + p.x / game.level.length) / game.specs.length,
    game.score, game.levelIndex);

  if (p.shield <= 0 && p.alive) die(game);
  endFrame();
}

// The best score lives in two places on purpose: the backend owns it (so it
// follows the pilot across browsers and survives a cleared localStorage) and
// localStorage caches it (so it still shows when the backend is unreachable).
// Whichever is higher wins.
// Everything the pilot has earned, forgotten.
//
// The hangar is cleared separately (clearHangar, which also zeroes the
// live coins so the pagehide save cannot write them straight back);
// this is the rest of it: the best score and the furthest hull reached.
//
// Deliberately not touched: the settings, the mute flag and the chosen
// tune. Those are how somebody likes to play, not what they have
// achieved, and wiping an accessibility setting because a player wanted
// a clean campaign would be its own small bug.
export function wipeProgress(game) {
  game.best = 0;
  game.unlocked = 0;
  game.setStartHull(0);
  for (const k of ['rnr.best', 'rnr.unlocked']) {
    try { localStorage.removeItem(k); } catch { /* private mode */ }
  }
  return game;
}

export function syncBest(game) {
  const remote = serverBest();
  if (remote > game.best) {
    game.best = remote;
    try { localStorage.setItem('rnr.best', String(remote)); } catch { /* private mode */ }
  }
}

// SPINAL LANCE: while the beam is out, everything in the line ahead
// takes damage. Applied here rather than in player.js because this is
// where the collision pairs live, and a weapon that reaches across the
// screen is a collision pair like any other.
//
// Damage is applied once per firing, not once per frame: the beam dwells
// for a fifth of a second, and at 120Hz that is twenty-six frames of
// contact. Billing all of them would make it the strongest thing in the
// game by two orders of magnitude.
function fireLance(game) {
  const p = game.player;
  if (!p.alive || !p.lance || p.lanceFire <= 0 || p.lanceSpent) return;
  p.lanceSpent = true;
  const tier = Math.min(p.lance, LANCE.damage.length) - 1;
  const dmg = LANCE.damage[tier];
  const reach = VIEW_W;
  const x0 = p.x;

  for (let i = foes.count - 1; i >= 0; i--) {
    const f = foes.items[i];
    const dx = (f.x - x0) * p.facing;
    if (dx > 0 && dx < reach && Math.abs(f.y - p.y) < LANCE.halfHeight + 10) {
      hitFoe(game, i, f.x, f.y, dmg);
    }
  }
  for (let i = interceptors.count - 1; i >= 0; i--) {
    const e = interceptors.items[i];
    const dx = (e.x - x0) * p.facing;
    if (dx > 0 && dx < reach && Math.abs(e.y - p.y) < LANCE.halfHeight + 8) {
      hitInterceptor(game, i, dmg);
    }
  }
  for (const t of game.level.turrets) {
    const dx = (t.x - x0) * p.facing;
    if (!t.dead && dx > 0 && dx < reach && Math.abs(t.y - p.y) < LANCE.halfHeight + 10) {
      hitTurret(game, t, dmg);
    }
  }
  // hitMinis takes a point, not a line, so the line test is here and the
  // hit goes through the same single-target call everything else uses.
  for (let i = minis.count - 1; i >= 0; i--) {
    const m = minis.items[i];
    if (m.dead) continue;
    const dx = (m.x - x0) * p.facing;
    if (dx > 0 && dx < reach && Math.abs(m.y - p.y) < LANCE.halfHeight + m.spec.r) {
      hitMini(game, i, m.x, m.y, dmg);
    }
  }
  const b = game.boss;
  if (b && !b.dead && b.entry <= 0) {
    for (const pt of b.parts) {
      const dx = (b.x + pt.dx - x0) * p.facing;
      if (!pt.dead && dx > 0 && dx < reach && Math.abs(b.y + pt.dy - p.y) < LANCE.halfHeight + 14) {
        hitBoss(game, b, b.x + pt.dx, b.y + pt.dy, dmg);
      }
    }
  }
  sfxShoot();
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
  miniTargets(out);
  for (const t of game.level.turrets) {
    if (!t.dead && Math.abs(t.x - px) < 420) out.push(t);
  }
  for (const g of liveGates(game.level)) {
    if (Math.abs(g.x - px) < 420) out.push({ x: g.x, y: g.y + g.dir * 7 });
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
    for (let i = minis.count - 1; i >= 0; i--) {
      const m = minis.items[i];
      if (!m.dead && hit(m.x, m.y)) hitMini(game, i, m.x, m.y, bl.dmg);
    }
    for (const t of game.level.turrets) {
      if (!t.dead && hit(t.x, t.y)) hitTurret(game, t, bl.dmg);
    }
    for (const g of game.level.gates || []) {
      if (!g.dead && hit(g.x, g.y + g.dir * 7)) hitGate(game, g, bl.dmg);
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

// Where each on-rails sequence hands back control.
function finishSequence(game) {
  const p = game.player;
  if (game.state === 'launching') {
    game.state = 'play';
    game.stateT = 0;
    p.invuln = Math.max(p.invuln, 0.8);   // a moment of grace off the pad
    return;
  }
  // the run out through the far end
  if (game.levelIndex < game.specs.length - 1) {
    game.state = 'levelclear';
    game.banner = null;
    applyRefit(game);
  } else {
    game.state = 'ending';
    recordBest(game);
    reportRun(game);
  }
  game.stateT = 0;
}

// What clearing this hull paid, itemised. Three questions, each about a
// different way of flying it: did you break the guns, did you keep your
// ships, did you pick the hull clean. Returned rather than applied so the
// overview can show the breakdown that produced the number.
export function hullBonus(game) {
  const turrets = game.level.turrets;
  const total = turrets.length;
  const killed = turrets.reduce((n, t) => n + (t.dead ? 1 : 0), 0);
  const pct = total ? killed / total : 0;
  const h = game.hullHaul || { coins: 0, bars: 0, coffins: 0, treasures: 0, value: 0 };
  const lives = Math.max(0, game.player.lives);

  const lines = [];
  lines.push({
    id: 'guns',
    label: 'GUNS BROKEN',
    detail: killed + '/' + total + '   ' + Math.round(pct * 100) + '%',
    points: Math.round(HULL_BONUS.towers * pct),
  });
  if (total && killed === total) {
    lines.push({ id: 'sweep', label: 'FULL SWEEP', detail: 'NOTHING LEFT FIRING', points: HULL_BONUS.fullSweep });
  }
  lines.push({
    id: 'ships',
    label: 'SHIPS REMAINING',
    detail: String(lives),
    points: HULL_BONUS.perLife * lives,
  });
  if (!game.deathsThisHull) {
    lines.push({ id: 'intact', label: 'NO LOSSES', detail: 'HULL FLOWN CLEAN', points: HULL_BONUS.noLoss });
  }
  lines.push({
    id: 'haul',
    label: 'HAUL',
    detail: haulLine(h),
    points: Math.round(h.value * HULL_BONUS.haulPct),
  });

  return { lines, total: lines.reduce((a, l) => a + l.points, 0), killed, towers: total, pct, haul: h };
}

function haulLine(h) {
  const bits = [h.coins + ' COINS'];
  if (h.bars) bits.push(h.bars + ' BAR' + (h.bars > 1 ? 'S' : ''));
  if (h.coffins) bits.push(h.coffins + ' COFFIN' + (h.coffins > 1 ? 'S' : ''));
  if (h.treasures) bits.push(h.treasures + ' TREASURE' + (h.treasures > 1 ? 'S' : ''));
  return bits.join(' \u00b7 ');
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
  // Whatever was clamped to the hull is destroyed with it, before the new
  // ship arrives to inherit it.
  dropAttached(game);
  p.lives--;
  game.deaths++;
  game.deathsThisHull++;
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

    // A homing missile is the only enemy ordnance that can be destroyed,
    // and it has to be: there is no dodging something that turns.
    for (let j = enemyShots.count - 1; j >= 0 && !gone; j--) {
      const m = enemyShots.items[j];
      if (m.hp <= 0) continue;
      if (Math.abs(s.x - m.x) > m.r + 6 || Math.abs(s.y - m.y) > m.r + 6) continue;
      m.hp -= s.dmg;
      gone = true;
      if (m.hp <= 0) {
        explode(m.x, m.y, 0.7, '#ffd0e8', '#ff5fa8');
        enemyShots.kill(j);
        award(game, 60);
      } else {
        sparks(m.x, m.y, -Math.sign(s.vx), 0, 3, '#ff5fa8');
      }
    }

    if (!gone && hitMinis(game, s.x, s.y, s.dmg)) gone = true;

    if (!gone && game.boss && hitBoss(game, game.boss, s.x, s.y, s.dmg)) gone = true;

    if (!gone) {
      for (const g of game.level.gates || []) {
        if (g.dead) continue;
        if (gateHit(g, s.x, s.y)) { hitGate(game, g, s.dmg); gone = true; break; }
      }
    }

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
        hurt(game, s.dmg);
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
        hurt(game, INTERCEPTOR.ramDamage);
        game.flash = Math.max(game.flash, 0.45);
        kick(game.cam, 7);
        sfxPlayerHit();
      }
    }
  }
}
