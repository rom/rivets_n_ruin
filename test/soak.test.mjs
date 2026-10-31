import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, update, hullBonus } from '../src/game.js';
import { drawWorld } from '../src/render.js';
import { drawHud, drawScreen, drawRadar, drawShop, drawHelp, drawSettings,
  drawQuitPrompt, drawPaused, drawDemoBadge } from '../src/hud.js';
import { setSynthetic } from '../src/input.js';
import { DT, LEVELS } from '../src/config.js';
import { playerShots, enemyShots } from '../src/projectiles.js';
import { pickups } from '../src/pickups.js';
import { foes } from '../src/foes.js';
import { ordnance } from '../src/armory.js';
import { particles } from '../src/particles.js';

// Playing the game, headlessly, for a long time.
//
// Every other test here holds one thing still and asks a question about
// it. This one does the opposite: it runs the real simulation for tens of
// thousands of frames with input arriving, and after every single one
// asserts the things that must never stop being true — nothing is NaN, no
// pool has overflowed, no state has got stuck, the clock only goes
// forwards.
//
// That is worth having because the failures it catches do not look like
// failures from inside any single module. A mis-ordered argument once made
// the camera NaN, which renders a black screen while score, ship and frame
// rate all still read healthy; an unwinnable hull only shows up by flying
// it. A state assertion in the right loop catches both on the frame they
// happen rather than in a bug report.

const ctx = () => document.createElement('canvas').getContext('2d');

const POOLS = [
  ['player shots', playerShots],
  ['enemy shots', enemyShots],
  ['pickups', pickups],
  ['foes', foes],
  ['ordnance', ordnance],
  ['particles', particles],
];

// Everything that must hold on every frame, whatever is happening.
function invariants(game, frame) {
  const where = `frame ${frame} (state ${game.state}, hull ${game.levelIndex})`;

  for (const [what, v] of [
    ['player.x', game.player.x], ['player.y', game.player.y],
    ['player.vx', game.player.vx], ['player.vy', game.player.vy],
    ['player.shield', game.player.shield],
    ['cam.x', game.cam.x], ['cam.shake', game.cam.shake],
    ['score', game.score], ['time', game.time], ['runTime', game.runTime],
    ['coins', game.coins], ['stateT', game.stateT], ['flash', game.flash],
  ]) {
    assert.ok(Number.isFinite(v), `${where}: ${what} is ${v}`);
  }

  for (const [name, pool] of POOLS) {
    assert.ok(pool.count >= 0 && pool.count <= pool.items.length,
      `${where}: the ${name} pool holds ${pool.count} of ${pool.items.length}`);
    for (let i = 0; i < pool.count; i++) {
      const o = pool.items[i];
      assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y),
        `${where}: live ${name}[${i}] is at (${o.x}, ${o.y})`);
    }
  }

  assert.ok(game.levelIndex >= 0 && game.levelIndex < LEVELS.length,
    `${where}: hull index out of range`);
  assert.ok(game.cam.x >= -1 && game.cam.x <= game.level.length,
    `${where}: camera at ${game.cam.x} is outside a ${game.level.length}px hull`);
  assert.ok(game.player.shield <= game.player.shieldMax + 0.001,
    `${where}: shield ${game.player.shield} is over the ceiling ${game.player.shieldMax}`);
  assert.ok(game.score >= 0, `${where}: score went negative`);
  assert.ok(game.deaths >= 0 && game.deaths <= 200, `${where}: ${game.deaths} deaths`);
}

// A pilot that holds forward and fires, and dodges on a loose cycle. Not
// good — the point is to keep the simulation fed with plausible input for
// a long time, not to win.
function pilot(frame) {
  const a = new Set(['right', 'fire']);
  const phase = Math.floor(frame / 90) % 4;
  if (phase === 1) a.add('up');
  if (phase === 3) a.add('down');
  if (frame % 600 === 0) a.add('secondary');
  // Menus and prompts need ENTER, pulsed: they advance on the frame an
  // action starts, so a held key gives one edge and then nothing.
  if (Math.floor(frame / 15) % 2 === 0) a.add('start');
  return a;
}

test('the game survives being played for a long time', () => {
  const game = makeGame();
  const c = ctx();
  const FRAMES = 120 * 120;         // two minutes of simulated time, at DT
  const seen = new Set();
  let flying = 0;      // frames actually spent in flight
  let restarts = 0;
  let wasOver = false;

  try {
    for (let f = 0; f < FRAMES; f++) {
      setSynthetic(pilot(f));
      update(game, DT);
      seen.add(game.state);
      if (game.state === 'play') flying++;
      if (game.state === 'gameover') wasOver = true;
      else if (wasOver && game.state === 'play') { wasOver = false; restarts++; }
      invariants(game, f);
      // Draw every tenth frame: the renderer is where a bad value turns
      // into a thrown exception rather than a wrong number, and a throw in
      // the draw path kills the frame loop.
      if (f % 10 === 0) {
        drawWorld(c, game);
        drawHud(c, game, { muted: true, audio: false });
      }
    }
  } finally {
    setSynthetic(null);
  }

  // It has to have actually got somewhere, or the test is asserting
  // invariants about a title screen.
  assert.ok(seen.has('play'), `never reached play; saw ${[...seen].join(', ')}`);
  // Counted in frames, not game.runTime: runTime is the current run's
  // clock and resets when this pilot dies and ENTERs back in, so a longer
  // soak reported *less* flight than a shorter one. Frames spent in play
  // is the thing that actually grows with the soak.
  const seconds = flying * DT;
  assert.ok(seconds > 20,
    `only ${seconds.toFixed(1)}s of the two minutes was spent in flight`);
  // And it must have got up and gone again, rather than wedging on the
  // first death: the restart path is a third of what this exercises.
  assert.ok(restarts > 0 || !seen.has('gameover'),
    'the run ended and never restarted, so the restart path was never flown');
});

test('a run that is played badly still ends somewhere it can leave', () => {
  // Fly straight into everything, with no fire, until the ship is lost.
  const game = makeGame();
  try {
    for (let f = 0; f < 60 * 240; f++) {
      const a = new Set(['right']);
      if (Math.floor(f / 15) % 2 === 0) a.add('start');
      setSynthetic(a);
      update(game, DT);
      invariants(game, f);
      if (game.state === 'gameover') break;
    }
  } finally {
    setSynthetic(null);
  }
  // Whatever happened, the game must be in a state a player can act from
  // rather than wedged mid-transition.
  assert.ok(['play', 'gameover', 'clear', 'shop', 'dying', 'title', 'launch', 'exit', 'ending', 'victory']
    .includes(game.state), `wedged in state "${game.state}"`);
});

test('every hull can be flown into, built and drawn', () => {
  // An unwinnable or unbuildable hull would otherwise only surface by
  // someone getting there, which for hull 25 is a long wait.
  const c = ctx();
  for (let i = 0; i < LEVELS.length; i++) {
    const game = makeGame();
    game.unlocked = LEVELS.length - 1;
    game.setStartHull(i);
    try {
      setSynthetic(new Set(['right', 'fire', 'start']));
      for (let f = 0; f < 400; f++) {
        setSynthetic(pilot(f));
        update(game, DT);
        invariants(game, f);
      }
    } finally {
      setSynthetic(null);
    }
    drawWorld(c, game);
    drawHud(c, game, { muted: true, audio: false });
    assert.ok(game.level.length > 0, `hull ${i + 1} built with no length`);
  }
});

test('the end-of-hull bonus is finite and non-negative whatever the run did', () => {
  const game = makeGame();
  for (const [turrets, total, deaths, lives] of [
    [0, 0, 0, 3], [10, 10, 0, 6], [5, 10, 3, 1], [0, 50, 9, 0], [50, 50, 0, 6],
  ]) {
    game.turretsThisHull = turrets;
    game.turretsOnHull = total;
    game.deathsThisHull = deaths;
    game.player.lives = lives;
    const b = hullBonus(game);
    assert.ok(Number.isFinite(b.total), `bonus total is ${b.total}`);
    assert.ok(b.total >= 0, `bonus total is negative: ${b.total}`);
  }
});
