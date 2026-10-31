import {
  SHIP, TURRET, INTERCEPTOR, LEVEL_LEN, LEVEL_SEED, APRON, VIEW_W, clamp,
} from './config.js';
import { buildLevel, obstaclesNear } from './level.js';
import { makeCamera, updateCamera, kick } from './camera.js';
import { makePlayer, updatePlayer, respawn } from './player.js';
import {
  interceptors, updateTurrets, updateInterceptors, hitInterceptor, hitTurret, resetEnemies,
} from './enemies.js';
import { playerShots, enemyShots, advance } from './projectiles.js';
import { updateParticles, explode, sparks, particles } from './particles.js';
import { tapped, endFrame } from './input.js';
import {
  sfxPlayerHit, sfxHullAbsorb, sfxDeath, sfxRespawn,
  sfxTurnaround, sfxComplete, sfxGameOver, sfxUi,
} from './sfx.js';
import { setIntensity } from './music.js';

export function makeGame() {
  const level = buildLevel(LEVEL_SEED);
  const game = {
    level,
    cam: makeCamera(),
    player: makePlayer(),
    state: 'title',        // title | play | dying | gameover | complete
    stateT: 0,
    score: 0,
    turretsKilled: 0,
    spawnCd: 1.2,
    flash: 0,
    time: 0,
    returning: false,      // outbound leg done, now fly the hull back
    banner: null,
    best: Number(localStorage.getItem('rnr.best') || 0),
  };
  game.cam.x = clamp(game.player.x - VIEW_W / 2 + SHIP.w, 0, LEVEL_LEN - VIEW_W);
  return game;
}

function reset(game) {
  for (const t of game.level.turrets) {
    t.dead = false;
    t.hp = TURRET.hp;
    t.cd = Math.random() * 0.8;
    t.burstLeft = 0;
    t.angle = t.dir * Math.PI / 2;
  }
  game.player = makePlayer();
  game.score = 0;
  game.turretsKilled = 0;
  game.spawnCd = 1.2;
  game.returning = false;
  game.flash = 0;
  game.time = 0;
  game.banner = null;
  resetEnemies();
  playerShots.clear();
  enemyShots.clear();
  particles.clear();
  game.cam.x = clamp(game.player.x - VIEW_W / 2 + SHIP.w, 0, LEVEL_LEN - VIEW_W);
}

function banner(game, text, sub = '', life = 2.4) {
  game.banner = { text, sub, t: life, max: life };
}

// Drive the score from what is actually happening: sparse on the title,
// full kit in flight, an extra layer for the return run and for a shield
// about to give out.
function scoreIntensity(game) {
  if (game.state !== 'play' && game.state !== 'dying') return 0;
  if (game.returning || game.player.shield < 30) return 3;
  return 2;
}

export function update(game, dt) {
  game.stateT += dt;
  setIntensity(scoreIntensity(game));
  if (game.flash > 0) game.flash = Math.max(0, game.flash - dt * 2.6);
  if (game.banner) {
    game.banner.t -= dt;
    if (game.banner.t <= 0) game.banner = null;
  }

  if (game.state === 'title' || game.state === 'gameover' || game.state === 'complete') {
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
    updateCamera(game.cam, game.player, dt);
    if (game.stateT > 1.15) {
      if (game.player.lives <= 0) {
        game.state = 'gameover';
        game.stateT = 0;
        sfxGameOver();
        if (game.score > game.best) {
          game.best = game.score;
          localStorage.setItem('rnr.best', String(game.score));
        }
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
  const p = game.player;

  updatePlayer(p, game, dt);
  updateTurrets(game, dt);
  updateInterceptors(game, dt);
  advance(playerShots, dt);
  advance(enemyShots, dt);
  updateParticles(dt);
  collide(game);
  updateCamera(game.cam, p, dt);

  // two-way objective: the far end turns you around, the near end finishes you
  if (!game.returning && p.x > LEVEL_LEN - APRON * 0.55) {
    game.returning = true;
    banner(game, 'TURN AND BURN', 'RUN THE HULL BACK TO THE DOCK', 2.8);
    game.score += 2500;
    sfxTurnaround();
  } else if (game.returning && p.x < APRON * 0.55) {
    game.state = 'complete';
    game.stateT = 0;
    sfxComplete();
    game.score += 5000 + Math.max(0, Math.round((260 - game.time) * 25));
    if (game.score > game.best) {
      game.best = game.score;
      localStorage.setItem('rnr.best', String(game.score));
    }
  }

  if (p.shield <= 0 && p.alive) die(game);
  endFrame();
}

function die(game) {
  const p = game.player;
  p.alive = false;
  p.lives--;
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
