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

test('the world draws on every hull without throwing', () => {
  const c = ctx();
  for (let i = 0; i < LEVELS.length; i++) {
    const game = makeGame();
    game.unlocked = LEVELS.length - 1;
    game.setStartHull(i);
    game.state = 'play';
    assert.doesNotThrow(() => drawWorld(c, game), `drawWorld threw on hull ${i + 1}`);
    assert.doesNotThrow(() => drawRadar(c, game), `drawRadar threw on hull ${i + 1}`);
  }
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
