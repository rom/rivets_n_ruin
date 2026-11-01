import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoss, hitBoss, livingParts, shellUp } from '../src/boss.js';
import { BOSSES, FIELD_TOP, FIELD_BOT, VIEW_W } from '../src/config.js';

function fakeGame(levelIndex) {
  return {
    levelIndex,
    score: 0,
    flash: 0,
    cam: { x: 0, shake: 0 },
    // enough of a level for spoils() and pointBlocked() to work
    level: {
      length: 12000, spec: { name: 'T', foes: [] }, turrets: [],
      obstacles: [], buckets: new Map(), chunks: new Map(), chunkGen: -1, tick: 0,
    },
    player: { x: 0, y: 160, alive: true, invuln: 99, shield: 100, vx: 0, vy: 0 },
  };
}

// Simulates a horizontal shot sweeping across the boss, the way the cannon
// actually fires, and reports what it hit first. A part that no sweep can
// ever reach is a part that cannot be destroyed.
function sweep(game, b, y, fromRight) {
  const step = 3;
  const x0 = fromRight ? b.x + 220 : b.x - 220;
  for (let i = 0; i < 150; i++) {
    const x = fromRight ? x0 - i * step : x0 + i * step;
    const before = livingParts(b).length;
    const hpBefore = b.hp;
    if (hitBoss(game, b, x, y, 1)) {
      if (livingParts(b).length < before) return 'part-killed';
      if (b.hp < hpBefore) return 'core';
      // consumed without damaging anything: either a part took a hit, or
      // the shell absorbed it
      for (const p of b.parts) {
        if (p.dead) continue;
        if (Math.abs(x - (b.x + p.dx)) <= p.r && Math.abs(y - (b.y + p.dy)) <= p.r) return 'part';
      }
      return 'absorbed';
    }
  }
  return 'missed';
}

for (const [i, spec] of BOSSES.entries()) {
  test(`${spec.name}: every section can actually be shot`, () => {
    const game = fakeGame(i);
    const b = makeBoss(game);
    b.x = 400;                 // place it, skipping the entry slide
    b.entry = 0;
    if (!b.parts.length) return;   // no shell to strip

    for (const part of b.parts) {
      const y = b.y + part.dy;
      const fresh = makeBoss(game);
      fresh.x = 400;
      fresh.entry = 0;
      const left = sweep(game, fresh, y, false);
      const fresh2 = makeBoss(game);
      fresh2.x = 400;
      fresh2.entry = 0;
      const right = sweep(game, fresh2, y, true);
      assert.ok(left === 'part' || left === 'part-killed' || right === 'part' || right === 'part-killed',
        `a section at dy=${part.dy} cannot be hit from either side `
        + `(left: ${left}, right: ${right}) — the shell can never be stripped`);
    }
  });

  test(`${spec.name}: can be killed outright`, () => {
    const game = fakeGame(i);
    const b = makeBoss(game);
    b.x = 400;
    b.entry = 0;
    // strip every section by sweeping at its own height, then the core
    for (let guard = 0; guard < 400 && shellUp(b); guard++) {
      for (const part of b.parts) {
        if (part.dead) continue;
        hitBoss(game, b, b.x + part.dx, b.y + part.dy, 50);
      }
    }
    assert.ok(!shellUp(b), 'sections could not all be destroyed');
    for (let guard = 0; guard < 400 && !b.dead; guard++) {
      hitBoss(game, b, b.x, b.y, 50);
    }
    assert.ok(b.dead, 'the core survived');
  });
}

// --- one boss per hull
//
// Killing the boss sets game.boss to null, so the camera unpins and the
// wall comes down. The arena spawn only checked `!game.boss` — and the
// player then stands in that arena for ten seconds sweeping the wreck,
// with nothing holding the spawn back. A second, identical boss arrived
// on the very next frame, banner and arrival sound and all. Reported
// from play as "all bosses occur twice".

async function inTheArena(hull = 0) {
  const { makeGame, update } = await import('../src/game.js');
  const { setSynthetic } = await import('../src/input.js');
  const { DT, LEVELS } = await import('../src/config.js');
  const { arenaLeft } = await import('../src/boss.js');

  const game = makeGame();
  game.unlocked = LEVELS.length - 1;
  game.setStartHull(hull);
  for (let f = 0; f < 60 * 120 && game.state !== 'play'; f++) {
    const a = new Set();
    if (Math.floor(f / 15) % 2 === 0) a.add('start');
    setSynthetic(a);
    update(game, DT);
  }
  assert.equal(game.state, 'play', 'never reached flight');
  setSynthetic(new Set());
  game.player.invuln = 1e9;
  game.spawnCd = 1e9;
  game.foeCd = 1e9;
  game.player.x = arenaLeft(game) + 120;

  // Keeps the ship at the far end and alive. Both matter: the wreck
  // window is ten seconds long, and a test that lets the ship get shot
  // down halfway through reports 'dying' instead of the thing it came to
  // measure. Only pins the position in flight — during the launch and
  // exit animations the position is the animation's to own.
  const hold = () => {
    game.player.invuln = 1e9;
    game.player.shield = 1e4;
    game.spawnCd = 1e9;
    game.foeCd = 1e9;
    if (game.state === 'play') {
      game.player.x = Math.max(game.player.x, arenaLeft(game) + 120);
    }
  };
  return { game, update, DT, hold, done: () => setSynthetic(null) };
}

test('the arena spawns one boss, and one only', async () => {
  const { game, update, DT, hold, done } = await inTheArena();
  try {
    update(game, DT);
    assert.ok(game.boss, 'no boss appeared in the arena at all');
    const first = game.boss.name;

    // Beaten, the way the death animation finishing leaves it.
    game.boss.dead = true;
    game.boss.death = 0;
    update(game, DT);
    assert.equal(game.boss, null, 'a beaten boss was not cleared');
    assert.ok(game.lootT > 0, 'the wreck window did not open');

    // The whole wreck window, spent in the arena, which is the point of
    // the wreck window.
    const seen = [];
    for (let f = 0; f < 120 * 14; f++) {
      hold();
      update(game, DT);
      if (game.boss && !seen.includes(game.boss.name)) seen.push(game.boss.name);
    }
    assert.deepEqual(seen, [],
      `${seen.join(', ')} arrived while the first one's wreck was still being swept`);
    assert.ok(game.bossDown, 'the hull does not remember that its boss is down');
    void first;
  } finally { done(); }
});

test('leaving the arena and coming back does not restock it', async () => {
  const { game, update, DT, hold, done } = await inTheArena();
  const { arenaLeft } = await import('../src/boss.js');
  try {
    update(game, DT);
    game.boss.dead = true;
    game.boss.death = 0;
    update(game, DT);

    // Out of the arena entirely, then back in.
    game.player.x = arenaLeft(game) - 400;
    for (let f = 0; f < 120; f++) update(game, DT);
    for (let f = 0; f < 240; f++) { hold(); update(game, DT); }
    assert.equal(game.boss, null, 'the arena restocked itself on re-entry');
  } finally { done(); }
});

// Presses a key the way a finger does, then lets go and waits.
//
// setSynthetic() is what advances the edge — it rolls the current set into
// synthPrev — so the set has to be reinstalled every frame or the press
// never goes stale and `tapped()` keeps firing. Installing it once and
// running six frames reported six taps, which walked the game from the
// wreck window through the exit sequence and off the level-clear screen
// in three frames flat. The real keyboard does not behave that way:
// endFrame() clears `pressed`, so a held key taps once.
function tap(setSynthetic, update, game, DT, action, frames = 40, hold = () => {}) {
  const key = new Set([action]);
  const none = new Set();
  for (let f = 0; f < 8; f++) { setSynthetic(key); hold(); update(game, DT); }
  for (let f = 0; f < frames; f++) { setSynthetic(none); hold(); update(game, DT); }
}

// Flies the hull's arena, kills the boss there, and reports what the
// arena does next. Shared by the two clearing tests below because the
// interesting part of both is what happens AFTER the kill.
function killTheBoss(game, update, DT) {
  update(game, DT);
  assert.ok(game.boss, 'no boss appeared in the arena at all');
  const name = game.boss.name;
  game.boss.dead = true;
  game.boss.death = 0;
  update(game, DT);
  assert.ok(game.bossDown, 'the hull does not remember that its boss is down');
  return name;
}

test('a new game does not start with its boss already down', async () => {
  const { makeGame } = await import('../src/game.js');
  assert.equal(makeGame().bossDown, false);
});

test('restarting the run gets the boss back', async () => {
  // The flag is per hull, not for good. Clearing it is the other half of
  // the fix, and forgetting that half is the worse bug: every run after
  // the first would reach the arena and find it empty. makeGame() alone
  // does not prove it — the clearing lives in reset(), which is only
  // reachable through the keys, so this test goes through them.
  const { game, update, DT, hold, done } = await inTheArena();
  const { setSynthetic } = await import('../src/input.js');
  const { arenaLeft } = await import('../src/boss.js');
  try {
    killTheBoss(game, update, DT);

    tap(setSynthetic, update, game, DT, 'restart', 2, hold);
    assert.equal(game.bossDown, false, 'a restarted run still thinks its boss is down');

    // Launch animation, then straight to the far end of the fresh hull.
    for (let f = 0; f < 120 * 6 && game.state !== 'play'; f++) { hold(); update(game, DT); }
    assert.equal(game.state, 'play', `restart never reached flight (${game.state})`);
    game.player.invuln = 1e9;
    game.spawnCd = 1e9;
    game.foeCd = 1e9;
    game.player.x = arenaLeft(game) + 120;
    for (let f = 0; f < 120 && !game.boss; f++) { hold(); update(game, DT); }
    assert.ok(game.boss, 'the restarted run reached the arena and found it empty');
  } finally { done(); }
});

test('the next hull gets its own boss', async () => {
  // Same flag, the other clearing site: carrying the ship onward through
  // levelclear. If loadNextHull() does not clear it, hull 2 onwards can
  // never be finished at all, because the arena that ends them is empty.
  const { game, update, DT, hold, done } = await inTheArena();
  const { setSynthetic } = await import('../src/input.js');
  const { arenaLeft } = await import('../src/boss.js');
  try {
    const first = killTheBoss(game, update, DT);
    const hull = game.levelIndex;

    // END the wreck window early, which is what the prompt on screen
    // offers, then take the offer to fly on.
    hold();
    tap(setSynthetic, update, game, DT, 'start', 4, hold);
    for (let f = 0; f < 120 * 12 && game.state !== 'levelclear'; f++) { hold(); update(game, DT); }
    assert.equal(game.state, 'levelclear', `the hull never cleared (${game.state})`);

    tap(setSynthetic, update, game, DT, 'start', 2, hold);
    assert.equal(game.levelIndex, hull + 1, 'did not advance a hull');
    assert.equal(game.bossDown, false, 'the next hull starts with its boss already down');

    for (let f = 0; f < 120 * 6 && game.state !== 'play'; f++) { hold(); update(game, DT); }
    assert.equal(game.state, 'play', `the next hull never reached flight (${game.state})`);
    game.player.invuln = 1e9;
    game.spawnCd = 1e9;
    game.foeCd = 1e9;
    game.player.x = arenaLeft(game) + 120;
    for (let f = 0; f < 120 && !game.boss; f++) { hold(); update(game, DT); }
    assert.ok(game.boss, 'the next hull reached its arena and found it empty');
    assert.notEqual(game.boss.name, first, 'the next hull got the previous hull\'s boss');
  } finally { done(); }
});
