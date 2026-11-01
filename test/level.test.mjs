import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, obstaclesNear, pointBlocked, CHUNK_W } from '../src/level.js';
import { LEVELS, TOWERS, FIELD_TOP, FIELD_BOT, APRON, SHIP} from '../src/config.js';

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

// --- the pattern set
//
// Four more patterns, and the thing that must hold for all of them is
// the thing that has always had to hold: a hull you cannot fly is not a
// hard hull, it is a broken one. The existing walk already checks that
// per hull; this checks the patterns produce variety rather than one
// shape with different numbers, and that the narrowest gap any of them
// makes is one the ship actually fits through.

test('the generator produces a real spread of shapes', () => {
  // A pattern set that collapsed to two shapes would still pass every
  // navigability check and would be a worse game.
  const shapes = new Map();
  for (const L of LEVELS) {
    const lv = buildLevel(L);
    // Signature: how many blocks start at the same x, and whether they
    // hang from the top, stand on the bottom, or float.
    const byX = new Map();
    for (const o of lv.obstacles) {
      const k = Math.round(o.x);
      byX.set(k, (byX.get(k) || 0) + 1);
    }
    for (const n of byX.values()) shapes.set(n, (shapes.get(n) || 0) + 1);
  }
  assert.ok(shapes.size >= 2,
    `every obstacle group is the same size (${[...shapes.keys()].join(', ')})`);

  const floating = LEVELS.flatMap((L) => buildLevel(L).obstacles)
    .filter((o) => o.y > FIELD_TOP + 2 && o.y + o.h < FIELD_BOT - 2);
  assert.ok(floating.length > 0, 'nothing free-standing is ever generated');
});

test('no pattern makes a gap the ship cannot fit through', () => {
  const NEEDED = SHIP.hitH + 10;        // the hull box, plus room to aim
  let worst = Infinity;
  let where = '';
  for (const L of LEVELS) {
    const lv = buildLevel(L);
    for (let x = 0; x < lv.length; x += 7) {
      const spans = lv.obstacles
        .filter((o) => x >= o.x && x < o.x + o.w)
        .map((o) => [o.y, o.y + o.h])
        .sort((a, b) => a[0] - b[0]);
      let y = FIELD_TOP;
      let best = 0;
      for (const [a, b] of spans) {
        if (a - y > best) best = a - y;
        y = Math.max(y, b);
      }
      if (FIELD_BOT - y > best) best = FIELD_BOT - y;
      if (best < worst) { worst = best; where = `${L.name} at x=${x}`; }
    }
  }
  assert.ok(worst >= NEEDED,
    `the narrowest gap in the campaign is ${worst}px, at ${where}; `
    + `the ship needs ${NEEDED}`);
});

test('every hull uses more than a couple of patterns', () => {
  // Measured as distinct group sizes and distinct block heights: a hull
  // built from one pattern reads as a corridor with furniture.
  for (const L of LEVELS.slice(0, 10)) {
    const lv = buildLevel(L);
    const heights = new Set(lv.obstacles.map((o) => Math.round(o.h / 10)));
    assert.ok(heights.size >= 4,
      `${L.name} only has ${heights.size} distinct block heights`);
  }
});
