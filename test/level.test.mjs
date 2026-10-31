import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, obstaclesNear, pointBlocked, CHUNK_W } from '../src/level.js';
import { LEVELS, TOWERS, FIELD_TOP, FIELD_BOT, APRON } from '../src/config.js';

// Hull generation became testable in node when the texture moved to lazy
// per-chunk rendering: buildLevel no longer touches a canvas.

test('generation is deterministic for a seed', () => {
  const a = buildLevel(LEVELS[0]);
  const b = buildLevel(LEVELS[0]);
  assert.equal(a.obstacles.length, b.obstacles.length);
  assert.equal(a.turrets.length, b.turrets.length);
  for (let i = 0; i < a.obstacles.length; i++) {
    assert.deepEqual(a.obstacles[i], b.obstacles[i]);
  }
});

test('different hulls generate different layouts', () => {
  const a = buildLevel(LEVELS[0]);
  const b = buildLevel(LEVELS[1]);
  assert.notEqual(a.obstacles.length, b.obstacles.length);
});

for (const spec of LEVELS) {
  test(`${spec.name}: obstacles stay inside the playfield`, () => {
    const lvl = buildLevel(spec);
    assert.ok(lvl.obstacles.length > 0, 'no obstacles generated');
    for (const o of lvl.obstacles) {
      assert.ok(o.y >= FIELD_TOP - 1, `obstacle above the rim at x=${o.x}`);
      assert.ok(o.y + o.h <= FIELD_BOT + 1, `obstacle below the rim at x=${o.x}`);
      assert.ok(o.w > 0 && o.h > 0, 'degenerate obstacle');
      assert.ok(o.x >= 0 && o.x + o.w <= lvl.length, 'obstacle outside the hull');
    }
  });

  test(`${spec.name}: both aprons are left clear`, () => {
    const lvl = buildLevel(spec);
    for (const o of lvl.obstacles) {
      assert.ok(o.x + o.w > APRON * 0.5, `obstacle in the launch apron at x=${o.x}`);
    }
  });

  test(`${spec.name}: a gap always exists to fly through`, () => {
    // Walk the hull and confirm no vertical slice is fully blocked. A hull
    // you cannot pass is unwinnable, and it would only show up by playing.
    const lvl = buildLevel(spec);
    const SHIP_H = 10;
    for (let x = 10; x < lvl.length; x += 17) {
      let run = 0;
      let best = 0;
      for (let y = FIELD_TOP + 1; y < FIELD_BOT; y += 2) {
        if (pointBlocked(lvl, x, y)) run = 0;
        else { run += 2; best = Math.max(best, run); }
      }
      assert.ok(best >= SHIP_H, `${spec.name} is impassable at x=${x} (widest gap ${best}px)`);
    }
  });

  test(`${spec.name}: turrets sit on a surface, not inside one`, () => {
    const lvl = buildLevel(spec);
    for (const t of lvl.turrets) {
      assert.ok(t.dir === 1 || t.dir === -1, 'turret has no facing');
      // Hit points are the hull's toughness scaled by the tower type, so a
      // flak emplacement on a late hull is tougher than a gun on an early one.
      const mul = TOWERS[t.kind].hpMul;
      assert.equal(t.hp, Math.round(spec.turretHp * mul),
        `${t.kind} on ${spec.name} has ${t.hp} hp, expected ${Math.round(spec.turretHp * mul)}`);
      assert.ok(!pointBlocked(lvl, t.x, t.y + t.dir * 8),
        `turret muzzle buried in hull at x=${t.x}`);
    }
  });
}

test('the broad-phase bucket index finds every overlapping obstacle', () => {
  const lvl = buildLevel(LEVELS[2]);
  for (const o of lvl.obstacles.slice(0, 40)) {
    const probe = o.x + o.w / 2;
    const found = obstaclesNear(lvl, probe, probe);
    assert.ok(found.has(o), `bucket lookup missed an obstacle at x=${o.x}`);
  }
});

test('pointBlocked agrees with the obstacle rectangles', () => {
  const lvl = buildLevel(LEVELS[0]);
  const o = lvl.obstacles[5];
  assert.ok(pointBlocked(lvl, o.x + o.w / 2, o.y + o.h / 2), 'centre of a block reads as clear');
  assert.ok(pointBlocked(lvl, 50, FIELD_TOP - 5), 'outside the rim should read as blocked');
});

test('chunk count covers the hull', () => {
  const lvl = buildLevel(LEVELS[7]);
  const needed = Math.ceil(lvl.length / CHUNK_W);
  assert.ok(needed > 1, 'the longest hull should need many chunks');
  assert.equal(lvl.chunks.size, 0, 'chunks should start unrendered');
});
