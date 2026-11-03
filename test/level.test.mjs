import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, obstaclesNear, pointBlocked, firstBlockage, CHUNK_W } from '../src/level.js';
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
  // Compared as layouts rather than as counts. Two unrelated hulls landing
  // on the same number of obstacles is a coincidence, not a bug, and this
  // used to assert the counts differed — so re-weighting the pattern bands
  // failed it the moment ARGENTUM and OSMIUM happened to tie at 73.
  const sig = (lv) => lv.obstacles.map((o) => `${o.x}:${o.y}:${o.w}:${o.h}`).join(',');
  assert.notEqual(sig(buildLevel(LEVELS[0])), sig(buildLevel(LEVELS[1])));
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

  test(`${spec.name}: the ship can actually be flown through it`, () => {
    // This used to walk vertical slices looking for a gap at least ten
    // pixels tall. Every slice having a gap is not the same as the ship
    // being able to travel between them: a stub from the roof and one
    // from the floor nineteen pixels apart leave every slice half open,
    // and no way past for a ship nineteen pixels wide. Reported from
    // play, with a screenshot of the ship wedged in one — and eighteen of
    // these twenty-five hulls had at least one.
    const lvl = buildLevel(spec);
    const bad = firstBlockage(lvl);
    assert.equal(bad, null,
      bad && `${spec.name} cannot be flown past x=${bad.x}: ${bad.why}`);
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

// The checker itself, fed hulls that are known to be wrong. Every hull
// the generator makes is passable now, so nothing else in this file can
// tell a working checker from one that always says yes.
function fakeLevel(obstacles, length = 1200) {
  const buckets = new Map();
  for (const o of obstacles) {
    for (let b = Math.floor(o.x / 256); b <= Math.floor((o.x + o.w) / 256); b++) {
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(o);
    }
  }
  return { obstacles, buckets, length, movers: [] };
}

test('the clearance check catches a hull with no room at all', () => {
  const span = FIELD_BOT - FIELD_TOP;
  // A wall with a four-pixel slot in it: every slice has a gap, and the
  // ship is nine pixels tall.
  const lvl = fakeLevel([
    { x: 600, y: FIELD_TOP, w: 40, h: span / 2 - 2, face: 1 },
    { x: 600, y: FIELD_TOP + span / 2 + 2, w: 40, h: span / 2 - 2, face: -1 },
  ]);
  const bad = firstBlockage(lvl);
  assert.ok(bad, 'a 4px slot read as flyable for a 9px ship');
  assert.equal(bad.why, 'no room for the ship at all',
    `a wall with no slot the ship fits reported as "${bad.why}"`);
  assert.ok(bad.x > 560 && bad.x < 660, `reported the blockage at x=${bad.x}`);
});

test('the clearance check catches two stubs the ship cannot thread', () => {
  // The shape that was shipping: a stub from the roof and one from the
  // floor, their free bands not overlapping, with less clear x between
  // them than the ship is wide. Every vertical slice is half open.
  //
  // The gap is one pixel under the ship's width, which is what OSMIUM
  // actually shipped: 18.9px. That matters for which guard catches it.
  // At a wider gap some sampled column sees both stubs at once and the
  // cheap "no room here" test fires; at this width the overlap is a
  // single pixel that column sampling steps straight over, so every
  // column looks open and only the connectivity test can tell.
  const span = FIELD_BOT - FIELD_TOP;
  const lvl = fakeLevel([
    { x: 500, y: FIELD_TOP, w: 80, h: span * 0.55, face: 1 },
    { x: 580 + SHIP.hitW - 1, y: FIELD_BOT - span * 0.55, w: 80, h: span * 0.55, face: -1 },
  ]);
  // the old check: is there a tall enough gap in every slice?
  let thinnest = Infinity;
  for (let x = 10; x < lvl.length; x += 2) {
    let run = 0;
    let best = 0;
    for (let y = FIELD_TOP + 1; y < FIELD_BOT; y += 1) {
      if (pointBlocked(lvl, x, y)) run = 0;
      else { run += 1; best = Math.max(best, run); }
    }
    thinnest = Math.min(thinnest, best);
  }
  assert.ok(thinnest >= 10,
    `this shape is meant to pass the old slice check; thinnest slice was ${thinnest}px`);
  const bad = firstBlockage(lvl);
  assert.ok(bad, 'the ship cannot thread this and the check said it could');
  assert.equal(bad.why, 'nothing here connects to where the ship could be',
    `expected the connectivity test to catch this, not "${bad.why}"`);
});

test('the clearance check passes a hull that is actually open', () => {
  const span = FIELD_BOT - FIELD_TOP;
  const lvl = fakeLevel([
    { x: 500, y: FIELD_TOP, w: 80, h: span * 0.3, face: 1 },
    { x: 700, y: FIELD_BOT - span * 0.3, w: 80, h: span * 0.3, face: -1 },
  ]);
  assert.equal(firstBlockage(lvl), null, 'an open hull reported as blocked');
});

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
