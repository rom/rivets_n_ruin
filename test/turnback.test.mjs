import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, update } from '../src/game.js';
import { setSynthetic } from '../src/input.js';
import { pickups, resetPickups, spawnPickup } from '../src/pickups.js';
import { foes } from '../src/foes.js';
import { interceptors } from '../src/enemies.js';
import { ordnance } from '../src/armory.js';
import { minis } from '../src/miniboss.js';
import { DT, VIEW_W, CAM, CULL_MARGIN, LEVELS } from '../src/config.js';
import { readFileSync } from 'node:fs';

// Turning round and going back for something must not be what destroys it.
//
// Every pool had its own hand-picked despawn margin — 90px for
// interceptors, 140 for loot, 160 for attackers, 200 for your own
// ordnance — and every one of them was smaller than the 232px the camera
// travels when you reverse. Turning around, without moving the ship at
// all, destroyed everything in the trailing third of the screen you were
// looking at. Reported from play: "the objects just outside of screen are
// lost. It is like the game does not remember what was just there."

test('the cull margin is wider than the camera swing', () => {
  const swing = CAM.lead * 2;
  assert.ok(CULL_MARGIN > swing,
    `turning the ship moves the view ${swing}px and things are culled ${CULL_MARGIN}px `
    + 'out, so reversing destroys what was on screen before the ship has moved');
  // ...and with room for an actual backtrack on top, not just the turn.
  assert.ok(CULL_MARGIN >= swing + VIEW_W / 4,
    `a margin of ${CULL_MARGIN} clears the ${swing}px swing but leaves `
    + 'almost nothing for flying back');
});

// Drives the real game: place loot across the view, reverse, and see what
// is left. A margin test alone would pass with the margin applied to
// nothing.
function flyAndTurn({ backtrackFrames, jumpBy = 0 }) {
  const game = makeGame();
  game.unlocked = LEVELS.length - 1;
  try {
    // Reach flight, then get clear of the hull start so the camera is not
    // clamped against x=0 and can actually slide when the ship turns.
    for (let f = 0; f < 60 * 120 && game.state !== 'play'; f++) {
      const a = new Set();
      if (Math.floor(f / 15) % 2 === 0) a.add('start');
      setSynthetic(a);
      update(game, DT);
    }
    assert.equal(game.state, 'play', 'never reached flight');
    game.player.invuln = 1e9;
    game.player.x = 6000;
    game.player.facing = 1;
    game.spawnCd = 1e9;
    game.foeCd = 1e9;
    setSynthetic(new Set());
    for (let f = 0; f < 200; f++) update(game, DT);   // let the camera settle

    // Out of reach of the ship's own magnet: loot pulled in and banked is
    // not loot that was culled, and conflating the two is how the first
    // version of this measurement reported four collections as losses.
    game.player.y = 300;
    game.player.magnetMul = 0;

    resetPickups();
    const placed = [];
    const camAt = game.cam.x;
    for (let off = -120; off <= 820; off += 60) {
      const p = spawnPickup(game, camAt + off, 70, 'coin');
      if (!p) continue;
      p.baseY = 70;
      p.y = 70;
      p.life = 1e9;              // expiry is a separate question
      p.tag = off;
      placed.push(off);
    }
    assert.ok(placed.length > 10, `only placed ${placed.length} coins`);

    if (jumpBy) {
      // Flying left runs the ship into the hull after about 500px — it is
      // solid, and this pilot does not steer. For the "far enough away"
      // case the ship is placed rather than flown; what is being measured
      // is the recycling rule, not the ship's ability to find a gap.
      game.player.x -= jumpBy;
      setSynthetic(new Set());
      for (let f = 0; f < 240; f++) update(game, DT);
    } else {
      setSynthetic(new Set(['left']));
      for (let f = 0; f < backtrackFrames; f++) update(game, DT);
      setSynthetic(new Set());
      for (let f = 0; f < 30; f++) update(game, DT);
    }

    const alive = new Set();
    for (let i = 0; i < pickups.count; i++) {
      if (pickups.items[i].tag !== undefined) alive.add(pickups.items[i].tag);
    }
    return {
      placed,
      lost: placed.filter((t) => !alive.has(t)),
      moved: 6000 - game.player.x,
    };
  } finally {
    setSynthetic(null);
  }
}

test('turning around does not destroy what was on screen', () => {
  const { lost, moved } = flyAndTurn({ backtrackFrames: 20 });
  const onScreen = lost.filter((off) => off >= 0 && off <= VIEW_W);
  assert.deepEqual(onScreen, [],
    `reversing ${Math.round(moved)}px destroyed loot at screen offsets `
    + `${onScreen.join(', ')} — all of it was visible a moment earlier`);
});

test('a short backtrack does not destroy what was on screen', () => {
  // The reported case: turn, go a short distance, turn back, and the
  // things that were there are gone.
  const { lost, moved } = flyAndTurn({ backtrackFrames: 90 });
  const onScreen = lost.filter((off) => off >= 0 && off <= VIEW_W);
  assert.deepEqual(onScreen, [],
    `backtracking ${Math.round(moved)}px destroyed loot at screen offsets `
    + `${onScreen.join(', ')}`);
});

test('things far enough away are still recycled', () => {
  // The opposite failure: a margin so wide nothing is ever reclaimed, and
  // the pools fill with loot from a hull the player has left behind.
  const { placed, lost } = flyAndTurn({ backtrackFrames: 0, jumpBy: 2500 });
  assert.ok(lost.length > 0,
    `getting 2500px clear recycled nothing at all of ${placed.length} coins`);
});

// Every pool uses the shared margin. A module that kept its own number is
// the bug coming back one pool at a time.
test('no pool has its own despawn margin', () => {
  const src = ['pickups', 'foes', 'enemies', 'armory', 'miniboss'];
  for (const name of src) {
    const text = readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
    // Only comparisons against the camera: `f.x = cam.x + VIEW_W + 26` is
    // a spawn position just outside the view, which is meant to be tight.
    const culls = [...text.matchAll(/[<>]\s*game\.cam\.x\s*[-+]\s*(?:VIEW_W\s*\+\s*)?(\d+)\b/g)]
      .map((m) => Number(m[1]));
    const tooTight = culls.filter((n) => n < CAM.lead * 2);
    assert.deepEqual(tooTight, [],
      `src/${name}.js compares against the camera with a literal margin of `
      + `${tooTight.join(', ')}, which is inside the ${CAM.lead * 2}px turn swing`);
  }
});

// Pool pressure is the reason the margins were tight in the first place.
// Widening them is only safe if nothing actually runs out.
test('the wider margin does not exhaust any pool', () => {
  const game = makeGame();
  game.unlocked = LEVELS.length - 1;
  game.setStartHull(14);
  const watched = [['pickups', pickups], ['foes', foes],
    ['interceptors', interceptors], ['ordnance', ordnance], ['minis', minis]];
  const peak = Object.fromEntries(watched.map(([n]) => [n, 0]));
  try {
    for (let f = 0; f < 120 * 90; f++) {
      const a = new Set(['fire']);
      a.add(Math.floor(f / 240) % 2 ? 'left' : 'right');   // turn constantly
      if (f % 300 === 0) a.add('secondary');
      if (Math.floor(f / 15) % 2 === 0) a.add('start');
      setSynthetic(a);
      update(game, DT);
      for (const [n, p] of watched) if (p.count > peak[n]) peak[n] = p.count;
    }
  } finally {
    setSynthetic(null);
  }
  for (const [n, p] of watched) {
    assert.ok(peak[n] < p.items.length,
      `the ${n} pool filled (${peak[n]}/${p.items.length}) while turning back and `
      + 'forth, so drops were being silently discarded');
  }
});
