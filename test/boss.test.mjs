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
