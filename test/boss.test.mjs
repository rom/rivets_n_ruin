import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoss, hitBoss, livingParts, shellUp, bossTier } from '../src/boss.js';
import { drawBossBody, tierOf } from '../src/bossart.js';
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

// --- no two bosses look the same
//
// Twenty-five bosses are built from eight ships, and through the first
// sixteen hulls every silhouette comes round exactly twice. Drawn
// identically, the second one reads as the first turning up again under
// a new name. Reported from play as "all bosses occur twice" — and once
// the arena duplicate below was fixed and reported still happening, this
// was what was left.

test('a boss tier counts the ships of its class that came before it', () => {
  const firstOfEachKind = new Map();
  for (const [i, spec] of BOSSES.entries()) {
    if (!firstOfEachKind.has(spec.kind)) firstOfEachKind.set(spec.kind, i);
  }
  for (const [kind, i] of firstOfEachKind) {
    assert.equal(bossTier(i), 0, `the first ${kind} is not tier 0`);
  }
  // ...and each reuse is one higher than the last.
  const seen = new Map();
  for (const [i, spec] of BOSSES.entries()) {
    const want = seen.get(spec.kind) ?? 0;
    assert.equal(bossTier(i), want, `${spec.name} (hull ${i + 1}) is tier ${bossTier(i)}, not ${want}`);
    seen.set(spec.kind, want + 1);
  }
});

test('every boss in the campaign is visually distinct', () => {
  // The invariant the complaint is really about: no two hulls may end in
  // a boss that draws the same. Shape alone does not give that — tier is
  // what makes the ninth hull's warden a different ship from the first.
  const seen = new Map();
  for (const [i, spec] of BOSSES.entries()) {
    const look = `${spec.kind}/${tierOf({ tier: bossTier(i) }) ? bossTier(i) : 0}`;
    const clash = seen.get(look);
    assert.equal(clash, undefined,
      `${spec.name} (hull ${i + 1}) looks exactly like ${clash} — same ship, same refit`);
    seen.set(look, `${spec.name} (hull ${i + 1})`);
  }
});

test('the tier table is deep enough for the most reused ship', () => {
  // tierOf clamps, so a ninth warden would silently come out looking
  // like the eighth. The table has to grow with the campaign, and this
  // is the test that notices when it has not.
  const counts = new Map();
  for (const spec of BOSSES) counts.set(spec.kind, (counts.get(spec.kind) || 0) + 1);
  const worst = Math.max(...counts.values());
  const deepest = BOSSES.reduce((m, _, i) => Math.max(m, bossTier(i)), 0);
  assert.equal(deepest, worst - 1, 'bossTier does not reach the last reuse');
  // One distinct look per reuse, tier 0 being the bare ship.
  const looks = new Set();
  for (let t = 0; t < worst; t++) looks.add(JSON.stringify(tierOf({ tier: t }) || 'bare'));
  assert.equal(looks.size, worst,
    `${worst} ships of the most reused class, but only ${looks.size} distinct refits — `
    + 'the deepest ones clamp to the same look');
});

test('every tier of every ship draws without throwing', () => {
  const ctx = stubCtx();
  const counts = new Map();
  for (const spec of BOSSES) counts.set(spec.kind, (counts.get(spec.kind) || 0) + 1);
  for (const [i, spec] of BOSSES.entries()) {
    const b = {
      kind: spec.kind, tier: bossTier(i), t: 1.2, flash: 0, dead: false,
      hp: 10, maxHp: 10, parts: [], spec, phase: 0,
    };
    assert.doesNotThrow(() => drawBossBody(ctx, b), `${spec.name} threw`);
    b.flash = 1;   // the hit frame takes a different path
    assert.doesNotThrow(() => drawBossBody(ctx, b), `${spec.name} threw on a hit frame`);
  }
});

// The livery is drawn, never composited. The obvious implementation
// washes it over the hull with source-atop, which clips to pixels
// already on the canvas — and the world canvas is opaque, so that tints
// a 300x300 block of dreadnought instead of the boss. Caught by looking
// at the compositing before it was ever rendered.
test('drawing a boss gives back the context it was handed', () => {
  // The alpha half of this used to assert === 1 with the context
  // starting at 1, which the bug it was meant to catch satisfies
  // exactly: tierBands assigned 1 rather than restoring. Starting from
  // a dimmed context is what makes the assertion mean anything —
  // drawBoss dims the whole boss while it comes apart, and that is the
  // state in which the plating stopped fading.
  for (let t = 0; t < 4; t++) {
    for (const alpha of [1, 0.5]) {
      const ctx = stubCtx();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'square';
      drawBossBody(ctx, { kind: 'warden', tier: t, t: 1, flash: 0, dead: false,
        hp: 1, maxHp: 1, parts: [], spec: {}, phase: 0 });
      assert.equal(ctx.globalCompositeOperation, 'source-over',
        `tier ${t} left the context in ${ctx.globalCompositeOperation} mode`);
      assert.equal(ctx.globalAlpha, alpha,
        `tier ${t} left globalAlpha at ${ctx.globalAlpha}, not the ${alpha} it was given`);
      assert.equal(ctx.lineCap, 'square',
        `tier ${t} left lineCap at ${ctx.lineCap}`);
      // Nothing may paint brighter than the alpha it was handed. The
      // refit lamp pulses, and multiplying the pulse in is the only
      // way it can pulse without escaping a dimmed boss.
      const tooBright = ctx.drawn.filter((a) => a > alpha + 1e-9);
      assert.equal(tooBright.length, 0,
        `tier ${t} painted ${tooBright.length} time(s) at up to alpha `
        + `${Math.max(0, ...tooBright)} inside a context dimmed to ${alpha}`);
    }
  }
});

// Records what it was told, so the assertions above can look at it.
function stubCtx() {
  const noop = () => {};
  const st = { globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '',
    strokeStyle: '', lineWidth: 1, lineCap: 'butt', font: '', textAlign: '',
    // The alpha in force at each paint, so a test can check what was
    // actually drawn and not merely what was left behind.
    drawn: [] };
  const stack = [];
  return new Proxy(st, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'fillRect') return () => { t.drawn.push(t.globalAlpha); };
      if (k === 'stroke') return () => { t.drawn.push(t.globalAlpha); };
      if (k === 'save') return () => stack.push({ ...t });
      if (k === 'restore') return () => Object.assign(t, stack.pop() || {});
      if (k === 'createLinearGradient' || k === 'createRadialGradient') {
        return () => ({ addColorStop: noop });
      }
      if (k === 'measureText') return () => ({ width: 0 });
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
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
