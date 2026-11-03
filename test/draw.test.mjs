import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, update } from '../src/game.js';
import { drawWorld } from '../src/render.js';
import {
  drawHud, drawScreen, drawRadar, drawShop, drawHelp, drawSettings,
  drawQuitPrompt, drawPaused, drawDemoBadge, HELP_PAGES,
} from '../src/hud.js';
import {
  drawSplash, drawLaunchBanner, drawExitBanner, drawPad, drawTitleBackdrop,
  launchPose, exitPose, SPLASH_TIME, LAUNCH_TIME, EXIT_TIME, ENDING_TIME,
} from '../src/sequences.js';
import { drawOrdnance } from '../src/armory.js';
import { rows as shopRows } from '../src/shop.js';
import { DEFS, set as setSetting, reset as resetSettings } from '../src/settings.js';
import { setSynthetic } from '../src/input.js';
import { DT, LEVELS } from '../src/config.js';
import { buildLevel } from '../src/level.js';

// What this does and does not prove.
//
// It does NOT prove anything was drawn correctly — the canvas here is a
// stub that records nothing, and judging a picture belongs in
// tools/smoke.cjs against a real browser. What it proves is that every
// draw path can be *executed* in every state the game can be in without
// throwing.
//
// That is worth a test on its own, because a throw inside a draw call is
// not a cosmetic bug: startLoop catches it, drops the frame and carries
// on, so a renderer that throws every frame presents as a frozen picture
// with a healthy score, a moving camera and a plausible frame rate. The
// one thing that would tell you is an exception nobody is reading.

const ctx = () => document.createElement('canvas').getContext('2d');

// Every state the game can actually be in, reached by playing into it
// where possible and set directly where it is not.
const STATES = ['title', 'splash', 'launch', 'play', 'dying', 'clear',
  'exit', 'gameover', 'ending', 'victory'];

function gameIn(state) {
  const game = makeGame();
  game.state = state;
  game.stateT = 0.7;
  return game;
}

test.afterEach(() => resetSettings());

test('the world draws in every state without throwing', () => {
  const c = ctx();
  for (const state of STATES) {
    const game = gameIn(state);
    assert.doesNotThrow(() => drawWorld(c, game), `drawWorld threw in state "${state}"`);
    assert.doesNotThrow(() => drawHud(c, game, { muted: false, audio: true }),
      `drawHud threw in state "${state}"`);
    assert.doesNotThrow(() => drawScreen(c, game), `drawScreen threw in state "${state}"`);
    assert.doesNotThrow(() => drawRadar(c, game), `drawRadar threw in state "${state}"`);
  }
});

// Put the game on a given hull, for the draw tests.
//
// setStartHull only records which hull the hangar has selected; reaching
// it means playing the title and launch sequences through, which is
// minutes of simulation per hull. So the level is built and installed
// directly. This matters more than it sounds: for as long as these tests
// called setStartHull and nothing else, all twenty-five of them drew
// hull 1, and "the world draws on every hull" proved one hull.
function onHull(i) {
  const game = makeGame();
  game.state = 'play';
  game.levelIndex = i;
  game.level = buildLevel(LEVELS[i]);
  game.player.x = 200;
  game.cam.x = 0;
  return game;
}

test('the world draws on every hull without throwing', () => {
  const c = ctx();
  for (let i = 0; i < LEVELS.length; i++) {
    const game = onHull(i);
    assert.doesNotThrow(() => drawWorld(c, game), `drawWorld threw on hull ${i + 1}`);
    assert.doesNotThrow(() => drawRadar(c, game), `drawRadar threw on hull ${i + 1}`);
  }
});

test('the world draws with the camera parked on every structure', async () => {
  // The hull tests above draw each hull from its start, where the camera
  // sits at x=0 and everything further in is culled before it is drawn.
  // So the whole of the installation art — and the searchlight beams and
  // the power lines, which are drawn in world space and culled by range
  // — was never executed in node at all.
  //
  // That is how the searchlight shipped broken: TOWERS.array already
  // owned the name `sweep` for its dish speed, the searchlight's
  // `sweep` was an object, so `sw.speed` read undefined, every angle
  // became NaN, and createLinearGradient threw once a frame. The browser
  // found it. This test and the stricter stub in _setup.mjs are what
  // make node find the next one.
  const c = ctx();
  const kinds = new Set();
  let parked = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const game = onHull(i);
    for (const t of game.level.turrets) {
      kinds.add(t.kind);
      // Park the camera so the structure is in the middle of the view,
      // and run the clock on so anything that animates has moved.
      game.cam.x = t.x - 320;
      game.player.x = t.x;
      game.player.y = t.y - t.dir * 60;
      game.time += 0.37;
      for (let f = 0; f < 3; f++) update(game, DT);
      parked++;
      assert.doesNotThrow(() => drawWorld(c, game),
        `drawWorld threw with the camera on a ${t.kind} on hull ${i + 1}`);
    }
  }
  assert.ok(parked > 200, `only parked on ${parked} structures; the test proves little`);
  // Every kind the game defines is built somewhere in the campaign. A
  // tower with a spec, hit points, art and a score that no hull ever
  // stands up is dead content, and it is also art nothing draws.
  const { TOWERS } = await import('../src/config.js');
  const never = Object.keys(TOWERS).filter((k) => !kinds.has(k));
  assert.deepEqual(never, [], `${never.length} tower kind(s) are never built by any hull`);
});

test('every tower kind draws, on both girders, at every phase of its cycle', async () => {
  // The sweep above covers whatever the default run seed happens to
  // build, which is most kinds but not all of them: a flak is only ever
  // the optional gun on a power plant's corner, and at seed 0 that coin
  // never comes up. A kind that is never drawn is a kind whose art is
  // not under test, so this one plants the whole roster by hand.
  const c = ctx();
  const { TOWERS, FIELD_TOP, FIELD_BOT } = await import('../src/config.js');
  const kinds = Object.keys(TOWERS);
  const game = makeGame();
  game.state = 'play';
  // Both girders, because every body is drawn mirrored on the lower one
  // and `dir` is threaded through all of it by hand.
  game.level.turrets = kinds.flatMap((kind, i) => [1, -1].map((dir, j) => ({
    x: 420 + (i * 2 + j) * 180,
    y: dir === 1 ? FIELD_TOP + 30 : FIELD_BOT - 30,
    dir, kind, tower: TOWERS[kind],
    angle: dir * Math.PI / 2,
    hp: Math.round(game.level.spec.turretHp * TOWERS[kind].hpMul), dead: false,
    charge: 0, shielded: false, painted: null, t: i * 0.7,
    cd: 0, burstLeft: 0, burstTimer: 0,
  })));

  for (const t of game.level.turrets) {
    game.cam.x = t.x - 320;
    game.player.x = t.x;
    game.player.y = t.y - t.dir * 70;
    // Right through a whole beam cycle, so the lamp is tested pointing
    // at both ends of its arc and straight down the middle rather than
    // wherever one arbitrary frame leaves it. The searchlight's own
    // cycle is the slowest thing here at 0.75 rad/s.
    for (let f = 0; f < 60; f++) {
      update(game, DT * 8);
      assert.doesNotThrow(() => drawWorld(c, game),
        `drawWorld threw on a ${t.kind} facing ${t.dir > 0 ? 'down' : 'up'} at frame ${f}`);
    }
  }

  // Half of them broken, which is a different branch in every body.
  for (const t of game.level.turrets) if (t.x % 360 < 180) { t.dead = true; t.hp = 0; }
  assert.doesNotThrow(() => drawWorld(c, game), 'drawWorld threw over a half-broken roster');
});

test('the overlays draw without throwing', () => {
  const c = ctx();
  const game = gameIn('title');
  for (let page = 0; page < HELP_PAGES(); page++) {
    assert.doesNotThrow(() => drawHelp(c, page), `drawHelp threw on page ${page}`);
  }
  // Past the last page, which is reachable by holding the key.
  assert.doesNotThrow(() => drawHelp(c, HELP_PAGES() + 5), 'drawHelp threw past the last page');

  for (let sel = 0; sel < DEFS.length; sel++) {
    assert.doesNotThrow(() => drawSettings(c, game, sel),
      `drawSettings threw with "${DEFS[sel].label}" selected`);
  }
  assert.doesNotThrow(() => drawSettings(c, game, 0, { wipeArmed: true }));
  assert.doesNotThrow(() => drawSettings(c, game, 0, { wipeNote: 'HANGAR CLEARED' }));

  game.coins = 5000;
  const rows = shopRows(game);
  for (let sel = 0; sel < rows.length; sel++) {
    assert.doesNotThrow(() => drawShop(c, game, sel, ''),
      `drawShop threw on row "${rows[sel].name}"`);
  }
  assert.doesNotThrow(() => drawShop(c, game, 0, 'BOUGHT GUN SPEED'));
  // A pilot with no coins sees every row unaffordable, which is a
  // different set of branches.
  game.coins = 0;
  assert.doesNotThrow(() => drawShop(c, game, 0, ''));

  assert.doesNotThrow(() => drawQuitPrompt(c, game));
  assert.doesNotThrow(() => drawPaused(c));
  assert.doesNotThrow(() => drawDemoBadge(c, game));
  assert.doesNotThrow(() => drawOrdnance(c));
});

test('the sequences draw across their whole length', () => {
  const c = ctx();
  const game = gameIn('launch');
  // Including past the end, which happens on a dropped frame.
  for (let t = 0; t <= SPLASH_TIME + 1; t += 0.2) {
    assert.doesNotThrow(() => drawSplash(c, t), `drawSplash threw at t=${t.toFixed(1)}`);
  }
  for (let t = 0; t <= LAUNCH_TIME + 1; t += 0.2) {
    const k = t / LAUNCH_TIME;
    assert.doesNotThrow(() => drawLaunchBanner(c, game, k), `launch banner threw at k=${k.toFixed(2)}`);
    const pose = launchPose(k);
    assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y),
      `launchPose(${k.toFixed(2)}) is at (${pose.x}, ${pose.y})`);
  }
  for (let t = 0; t <= EXIT_TIME + 1; t += 0.2) {
    const k = t / EXIT_TIME;
    assert.doesNotThrow(() => drawExitBanner(c, game, k), `exit banner threw at k=${k.toFixed(2)}`);
    const pose = exitPose(k, 300, 160);
    assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y),
      `exitPose(${k.toFixed(2)}) is at (${pose.x}, ${pose.y})`);
  }
  for (let t = 0; t <= 20; t += 1) {
    assert.doesNotThrow(() => drawTitleBackdrop(c, t), `title backdrop threw at t=${t}`);
  }
  assert.doesNotThrow(() => drawPad(c, 0, 0));
  assert.doesNotThrow(() => drawPad(c, 12000, 0));
});

// Settings change what the renderer does, so each combination is a
// different path through it. Off is as important as on: the picture
// settings double as the escape hatch on a slow machine, and a crash in
// the cheap path would hit exactly the people who cannot afford one.
test('the world draws with every picture and accessibility setting both ways', () => {
  const c = ctx();
  const toggles = DEFS.filter((d) => d.kind === 'bool').map((d) => d.id);
  const game = gameIn('play');
  for (const id of toggles) {
    for (const value of [true, false]) {
      setSetting(id, value);
      assert.doesNotThrow(() => { drawWorld(c, game); drawHud(c, game, {}); },
        `drawing threw with ${id}=${value}`);
    }
    setSetting(id, DEFS.find((d) => d.id === id).def);
  }
  // And everything off at once, then everything on at once.
  for (const value of [false, true]) {
    for (const id of toggles) setSetting(id, value);
    assert.doesNotThrow(() => { drawWorld(c, game); drawHud(c, game, {}); },
      `drawing threw with every toggle ${value}`);
  }
});

test('drawing a boss fight does not throw', () => {
  const c = ctx();
  const game = makeGame();
  game.state = 'play';
  // Fly to the far end, where the arena is, and keep drawing on the way.
  try {
    setSynthetic(new Set(['right', 'fire']));
    for (let f = 0; f < 60 * 120 && !game.boss; f++) {
      game.player.x += 40;              // skip ahead rather than fly it
      update(game, DT);
      if (f % 50 === 0) assert.doesNotThrow(() => drawWorld(c, game), `threw at frame ${f}`);
    }
  } finally {
    setSynthetic(null);
  }
  assert.ok(game.boss, 'never reached the arena, so the boss draw path was not covered');
  for (let f = 0; f < 600; f++) {
    update(game, DT);
    if (f % 20 === 0) {
      assert.doesNotThrow(() => drawWorld(c, game), `threw during the boss fight at frame ${f}`);
      assert.doesNotThrow(() => drawRadar(c, game), `radar threw during the boss fight`);
    }
  }
});
