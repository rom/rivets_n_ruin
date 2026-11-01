import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, mixSeed, pointBlocked, obstaclesNear } from '../src/level.js';
import { makeGame, update } from '../src/game.js';
import { setSynthetic } from '../src/input.js';
import { foes } from '../src/foes.js';
const poolOfFoes = () => foes;
import { interceptors } from '../src/enemies.js';
import { enemyShots } from '../src/projectiles.js';
import { LEVELS, TOWERS, FIELD_TOP, FIELD_BOT, DT } from '../src/config.js';
import * as settings from '../src/settings.js';
import { readFileSync } from 'node:fs';

// ------------------------------------------------------------- the run seed
//
// A hull is generated from a seed. With FIXED layouts that seed is the
// hull's own and nothing else, which is what makes a hull learnable and two
// scores on it comparable. With SHUFFLED a per-run seed is folded in.
//
// The thing that has to hold either way is the thing that has always had to
// hold: a hull you cannot fly through is not a hard hull, it is a broken
// one. The existing walk in level.test.mjs checks that for the eight fixed
// seeds the campaign ships. Shuffling means the generator now has to be
// right for seeds nobody has ever looked at.

test('a zero run seed leaves the hull seed alone', () => {
  for (const spec of LEVELS.slice(0, 4)) {
    assert.equal(mixSeed(spec.seed, 0), spec.seed >>> 0,
      `${spec.name}: FIXED must not disturb the seed`);
  }
});

test('FIXED layouts are still byte-identical between builds', () => {
  const a = buildLevel(LEVELS[0]);
  const b = buildLevel(LEVELS[0], 0);
  assert.equal(a.obstacles.length, b.obstacles.length);
  for (let i = 0; i < a.obstacles.length; i++) {
    assert.deepEqual(a.obstacles[i], b.obstacles[i],
      'the default argument changed what an unseeded build produces');
  }
});

test('a run seed changes the layout, and the same one reproduces it', () => {
  const plain = buildLevel(LEVELS[0]);
  const shuffled = buildLevel(LEVELS[0], 0x1234abcd);
  const again = buildLevel(LEVELS[0], 0x1234abcd);

  const sig = (lv) => lv.obstacles.map((o) => `${o.x}:${o.y}:${o.w}:${o.h}`).join(',');
  assert.notEqual(sig(shuffled), sig(plain), 'a run seed produced the fixed layout');
  assert.equal(sig(again), sig(shuffled), 'the same run seed produced a different layout');
});

test('neighbouring run seeds do not produce similar openings', () => {
  // mulberry32 is weakest in its first few outputs, so a plain XOR of
  // consecutive seeds gave runs that opened with the same two patterns.
  // The first obstacle is the one a player sees first, so that is what
  // this measures.
  const first = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const lv = buildLevel(LEVELS[3], seed);
    const o = lv.obstacles[0];
    first.add(`${Math.round(o.x)}:${Math.round(o.y)}:${Math.round(o.w)}`);
  }
  assert.ok(first.size >= 18,
    `24 consecutive seeds gave only ${first.size} distinct openings`);
});

// The expensive one, and the reason the feature is safe to ship: walk the
// whole hull for seeds the campaign has never used and confirm the ship
// still fits through every vertical slice.
const SHIP_H = 10;
function widestGapFailure(lv) {
  for (let x = 10; x < lv.length; x += 17) {
    let run = 0;
    let best = 0;
    for (let y = FIELD_TOP + 1; y < FIELD_BOT; y += 2) {
      if (pointBlocked(lv, x, y)) run = 0;
      else { run += 2; best = Math.max(best, run); }
    }
    if (best < SHIP_H) return { x, best };
  }
  return null;
}

for (const hull of [0, 4, 7, LEVELS.length - 1]) {
  test(`${LEVELS[hull].name}: shuffled layouts stay flyable`, () => {
    for (const seed of [1, 7, 0x51ed, 0xbeef, 0x7fffffff, 0xffffffff, 12345, 999983]) {
      const lv = buildLevel(LEVELS[hull], seed);
      const bad = widestGapFailure(lv);
      assert.equal(bad, null,
        bad && `${LEVELS[hull].name} seed ${seed} is impassable at x=${bad.x}`
          + ` (widest gap ${bad.best}px)`);
    }
  });

  test(`${LEVELS[hull].name}: shuffled turrets still sit on a surface`, () => {
    for (const seed of [3, 0xabc, 0x10203040]) {
      const lv = buildLevel(LEVELS[hull], seed);
      for (const t of lv.turrets) {
        assert.ok(!pointBlocked(lv, t.x, t.y + t.dir * 8),
          `${LEVELS[hull].name} seed ${seed}: muzzle buried at x=${t.x}`);
      }
    }
  });
}

test('the layout setting only offers the two it knows', () => {
  const def = settings.DEFS.find((d) => d.id === 'shuffle');
  assert.ok(def, 'no layout setting');
  assert.equal(def.def, 0, 'the default must be the historical behaviour');
  assert.equal(settings.LAYOUTS[0], 'FIXED');
  assert.equal(settings.LAYOUTS.length, 2);
});

// --------------------------------------------------------- restarting a run
//
// reset() used to rebuild the hull only when the index moved, and put the
// guns back by hand when it did not. The hand-written restore assigned the
// hull's base turretHp flat, dropping the per-tower hpMul — so a BASTION on
// a hull you restarted stood up with a GUN's health. Always rebuilding
// removed the restore and the bug with it; this is what pins it.

function launchAt(hull) {
  const game = makeGame();
  game.unlocked = LEVELS.length - 1;
  game.setStartHull(hull);
  try {
    for (let f = 0; f < 60 * 120 && game.state !== 'play'; f++) {
      const a = new Set();
      if (Math.floor(f / 15) % 2 === 0) a.add('start');
      setSynthetic(a);
      update(game, DT);
    }
  } finally {
    setSynthetic(null);
  }
  assert.equal(game.state, 'play', `never reached flight on hull ${hull + 1}`);
  return game;
}

function checkTurretHp(game, when) {
  const base = game.level.spec.turretHp;
  let checkedHeavy = 0;
  for (const t of game.level.turrets) {
    const want = Math.round(base * TOWERS[t.kind].hpMul);
    assert.equal(t.hp, want,
      `${when}: ${t.kind} has ${t.hp} hp, expected ${want}`);
    if (TOWERS[t.kind].hpMul >= 2) checkedHeavy++;
  }
  return checkedHeavy;
}

test('a restarted hull stands its heavy towers back up at full health', () => {
  // PYRITE fields BASTION, which is hpMul 3.2 — the widest gap between the
  // right answer and the flat base, and so the one worth measuring.
  const game = launchAt(4);
  const heavy = checkTurretHp(game, 'on launch');
  assert.ok(heavy > 0, 'the hull under test fields no heavy tower; pick another');

  // Restart on the same hull: the index does not move, which is the case
  // the old code skipped the rebuild for.
  const before = game.levelIndex;
  try {
    setSynthetic(new Set(['restart']));
    update(game, DT);
  } finally {
    setSynthetic(null);
  }
  assert.equal(game.levelIndex, before, 'the restart was meant to stay on this hull');
  checkTurretHp(game, 'after a restart on the same hull');
});

// --------------------------------------------------------------- the press
//
// The one pattern whose geometry moves, and so the one the existing hull
// walk cannot vouch for. That walk reads each obstacle's rectangle once;
// a jaw has a different rectangle every frame, and the base one it is built
// with is the jaw at its smallest. Everything below checks the phases the
// static walk never sees.

import { pressRect, updateMovers, buildLevel as build } from '../src/level.js';
import { SHIP } from '../src/config.js';

// Hull seeds that contain at least one press. Found rather than assumed:
// the band is 4%, so most short hulls have none and a test that silently
// examined zero jaws would pass for the wrong reason.
function hullWithPress() {
  for (let seed = 1; seed < 400; seed++) {
    const lv = build(LEVELS[LEVELS.length - 1], seed);
    if (lv.movers.length >= 4) return { lv, seed };
  }
  return null;
}

test('the generator actually produces presses', () => {
  const found = hullWithPress();
  assert.ok(found, 'no hull in 400 seeds contained a press');
  assert.ok(found.lv.movers.every((o) => o.press), 'a mover with no press descriptor');
  // Jaws come in pairs that share a centre line and a cycle.
  const tops = found.lv.movers.filter((o) => o.press.side > 0).length;
  const bots = found.lv.movers.filter((o) => o.press.side < 0).length;
  assert.equal(tops, bots, 'jaws are not paired');
});

test('a jaw is never degenerate and never leaves the corridor', () => {
  const { lv } = hullWithPress();
  for (let step = 0; step <= 64; step++) {
    const t = (step / 64) * 4;        // several full cycles
    updateMovers(lv, t);
    for (const o of lv.movers) {
      assert.ok(o.h > 0, `jaw collapsed to ${o.h}px at t=${t.toFixed(2)}`);
      assert.ok(o.y >= FIELD_TOP - 1, `jaw above the rim at t=${t.toFixed(2)}`);
      assert.ok(o.y + o.h <= FIELD_BOT + 1, `jaw below the rim at t=${t.toFixed(2)}`);
    }
  }
});

test('a press never closes further than the ship can fit through', () => {
  // The guarantee the whole pattern rests on: squeezed and charged a
  // scrape is a hazard, crushed by geometry you could not answer is a
  // trap. Measured from the rectangles, not from minGap, so an arithmetic
  // slip between the two jaws is caught rather than assumed away.
  const { lv } = hullWithPress();
  const byX = new Map();
  for (const o of lv.movers) {
    const k = Math.round(o.x);
    if (!byX.has(k)) byX.set(k, []);
    byX.get(k).push(o);
  }
  let tightest = Infinity;
  for (let step = 0; step <= 240; step++) {
    const t = (step / 240) * 8;
    updateMovers(lv, t);
    for (const [x, pair] of byX) {
      assert.equal(pair.length, 2, `x=${x} has ${pair.length} jaws, expected a pair`);
      const top = pair.find((o) => o.face === 1);
      const bot = pair.find((o) => o.face === -1);
      const gap = bot.y - (top.y + top.h);
      tightest = Math.min(tightest, gap);
      assert.ok(gap >= SHIP.hitH + 8,
        `press at x=${x} closed to ${gap.toFixed(1)}px at t=${t.toFixed(2)};`
        + ` the ship is ${SHIP.hitH}px tall`);
    }
  }
  // And it does actually close, or it is not a press.
  assert.ok(tightest < 60, `the tightest gap over 8s was ${tightest.toFixed(1)}px — nothing closes`);
});

test('a press is flyable at every phase', () => {
  // The full walk, run at sixteen points around the cycle rather than once
  // at the base position.
  const { lv } = hullWithPress();
  for (let step = 0; step < 16; step++) {
    const t = (step / 16) * 3.4;      // the longest period the band makes
    updateMovers(lv, t);
    const bad = widestGapFailure(lv);
    assert.equal(bad, null,
      bad && `impassable at x=${bad.x} (widest gap ${bad.best}px) at t=${t.toFixed(2)}`);
  }
});

test('jaws stagger, so one altitude does not clear a whole press', () => {
  const { lv } = hullWithPress();
  const phases = new Set(lv.movers.map((o) => o.press.phase.toFixed(3)));
  assert.ok(phases.size > 1, 'every jaw in the hull shares one phase');
});

test('nothing is mounted inside a jaw’s travel', () => {
  // A gun that spends half its life inside a moving block cannot be shot
  // back at, which reads as a bug rather than as a hard hull.
  for (let seed = 1; seed < 60; seed++) {
    const lv = build(LEVELS[LEVELS.length - 1], seed);
    if (!lv.movers.length) continue;
    for (const t of lv.turrets) {
      for (const o of lv.movers) {
        assert.ok(t.x <= o.x - 10 || t.x >= o.x + o.w + 10,
          `seed ${seed}: a ${t.kind} at x=${t.x} sits in the travel of a jaw at x=${o.x}`);
      }
    }
  }
});

test('the collision box and the drawn box are the same rectangle', () => {
  // drawRam draws o.x/o.y/o.w/o.h directly and pressRect is what sets
  // them, so the one way these can diverge is updateMovers writing
  // something pressRect did not say. That is what this pins.
  const { lv } = hullWithPress();
  for (const t of [0, 0.7, 1.9, 3.3]) {
    updateMovers(lv, t);
    for (const o of lv.movers) {
      const want = pressRect(o.press, t);
      assert.equal(o.y, want.y, 'live y disagrees with pressRect');
      assert.equal(o.h, want.h, 'live h disagrees with pressRect');
    }
  }
});

test('a jaw is kept out of the baked hull texture', () => {
  // A chunk is a bitmap cached across frames. A jaw baked into one is
  // frozen at whatever phase it was rendered at, and then the thing you
  // see and the thing you hit are in different places.
  const src = readFileSync(new URL('../src/level.js', import.meta.url), 'utf8');
  const bake = src.slice(src.indexOf('function renderChunk'));
  const loop = bake.slice(bake.indexOf('for (const o of level.obstacles)'));
  assert.ok(/if \(o\.press\) continue;/.test(loop.slice(0, 200)),
    'renderChunk bakes movers into the cached chunk');
});

test('the tutorial hulls field no press', () => {
  // A crusher on the hull that teaches the throttle is an ambush, not an
  // escalation, so the pattern is gated on the hull the way the towers and
  // the attackers are. Checked across many seeds, because with SHUFFLED on
  // an early hull gets layouts the fixed seed never produced.
  for (let i = 0; i < LEVELS.length; i++) {
    const gated = !LEVELS[i].press;
    if (!gated) continue;
    for (let seed = 0; seed < 40; seed++) {
      const lv = build(LEVELS[i], seed);
      assert.equal(lv.movers.length, 0,
        `${LEVELS[i].name} has press: false but seed ${seed} grew ${lv.movers.length} jaws`);
    }
  }
  assert.equal(LEVELS.filter((L) => !L.press).length, 3,
    'the press is meant to arrive on the fourth hull');
});

test('hulls that do field a press reliably get one', () => {
  // The other half of the gate: a pattern that is enabled and never
  // appears is the same bug as one that appears too early.
  let withPress = 0;
  for (let seed = 1; seed <= 40; seed++) {
    if (build(LEVELS[7], seed).movers.length) withPress++;
  }
  assert.ok(withPress >= 30,
    `only ${withPress}/40 AURUM seeds contained a press`);
});

test('a closed jaw actually blocks, and the index can find it', () => {
  // The guard that was missing. Every other press test checks the jaws do
  // not close too far; none of them noticed when the jaws stopped being
  // solid at all. Dropping them from level.obstacles — and so from the
  // broad-phase buckets — leaves a press that is drawn, cycles correctly,
  // and is flown straight through.
  const { lv } = hullWithPress();
  const top = lv.movers.find((o) => o.face === 1);
  assert.ok(top, 'no upper jaw to test');

  // Wind to the phase where this jaw is at full reach.
  let deepest = { t: 0, h: -1 };
  for (let step = 0; step <= 400; step++) {
    const t = (step / 400) * 8;
    updateMovers(lv, t);
    if (top.h > deepest.h) deepest = { t, h: top.h };
  }
  updateMovers(lv, deepest.t);

  const probeY = top.y + top.h - 3;
  const probeX = top.x + top.w / 2;
  assert.ok(pointBlocked(lv, probeX, probeY),
    'the inside of a fully-extended jaw reads as open sky');
  assert.ok(obstaclesNear(lv, probeX, probeX).has(top),
    'the broad-phase index cannot find a jaw, so nothing will ever collide with one');

  // And the same point is clear when the jaw has retracted past it.
  let openest = { t: 0, h: Infinity };
  for (let step = 0; step <= 400; step++) {
    const t = (step / 400) * 8;
    updateMovers(lv, t);
    if (top.h < openest.h) openest = { t, h: top.h };
  }
  updateMovers(lv, openest.t);
  assert.ok(!pointBlocked(lv, probeX, probeY),
    'a retracted jaw still blocks, so it is not really moving');
});

// Flying a press for real. Everything else on the hull is switched off
// first: the first version of this parked the ship motionless on AURUM for
// eight seconds and concluded the press had killed it, when what killed it
// was fifty-nine guns shooting at a stationary target that could not fire
// back. A test of one mechanic has to be a test of one mechanic.
function quietHull(game) {
  for (const t of game.level.turrets) t.dead = true;
  for (const g of game.level.gates || []) g.dead = true;
  game.miniPlan = [];
}
function silence(game) {
  foes.clear();
  interceptors.clear();
  enemyShots.clear();
}

test('a press never touches a ship flying down the middle of it', () => {
  // The fairness guarantee, stated as a number: the gap bottoms out well
  // clear of the ship, so holding the centre line costs nothing at all.
  // If this ever starts costing shield, the press has become a trap.
  const game = launchAt(7);
  quietHull(game);
  const lv = game.level;
  assert.ok(lv.movers.length, 'AURUM built no press to fly into');
  // The tightest press on the hull, not whichever one is first. minGap is
  // rolled per press, so an arbitrary one may simply never close far
  // enough to touch anything — a 14px asymmetry between the two jaws went
  // unnoticed for exactly that reason. A fairness guarantee is measured on
  // the worst case or it is not measured.
  const jaw = lv.movers.reduce((a, b) => (b.press.minGap < a.press.minGap ? b : a));
  const p = game.player;
  p.shield = p.shieldMax;
  const started = p.shield;

  for (let f = 0; f < 120 * 8; f++) {          // eight seconds, several cycles
    silence(game);
    p.x = jaw.x + jaw.w / 2;
    p.y = jaw.press.cy;
    p.vx = 0; p.vy = 0;
    p.invuln = 0;
    update(game, DT);
  }
  assert.equal(p.shield, started,
    `holding the centre of a press cost ${(started - p.shield).toFixed(1)} shield`);
  assert.ok(p.alive, 'the centre line of a press killed the ship');
  // For the record, and so the next person knows how much room this is
  // actually claiming: on AURUM the tightest press closes to 38.7px, which
  // puts each face 19.4px from the centre line against the ship's 4.5px
  // half-height. Offsetting one jaw by 15px fails this test; 14px does
  // not. The margin is real but it is not generous.
});

test('a press pushes a ship caught in it back into the gap', () => {
  // The other half: caught at the wrong phase you are squeezed out and
  // charged for it, not crushed and not pushed through a girder. The ship
  // is placed inside the jaw's travel and then left alone — no pinning, so
  // what is measured is where the press actually puts it.
  const game = launchAt(7);
  quietHull(game);
  const lv = game.level;
  const tight = lv.movers.reduce((a, b) => (b.press.minGap < a.press.minGap ? b : a));
  const jaw = lv.movers.find((o) => o.face === 1 && o.x === tight.x) || tight;
  const p = game.player;
  p.shield = p.shieldMax;
  p.x = jaw.x + jaw.w / 2;
  p.y = FIELD_TOP + 14;                 // hard against the upper girder
  p.vx = 0; p.vy = 0;
  p.invuln = 0;

  let scraped = false;
  for (let f = 0; f < 120 * 6; f++) {
    silence(game);
    p.x = jaw.x + jaw.w / 2;            // held in the press's column only
    p.vx = 0;
    const was = p.shield;
    update(game, DT);
    if (p.shield < was) scraped = true;
    assert.ok(p.y > FIELD_TOP - 2 && p.y < FIELD_BOT + 2,
      `pushed out of the corridor to y=${p.y.toFixed(1)} on frame ${f}`);
    assert.ok(Number.isFinite(p.y), 'the ship left the world');
    if (!p.alive) break;
  }

  assert.ok(scraped, 'sitting in the travel of a closing jaw cost nothing');
  assert.ok(p.alive,
    `six seconds in a press killed the ship; scrapes are meant to be`
    + ` rate-limited (shield ${p.shieldMax} -> ${p.shield.toFixed(1)})`);
  // And it ended up somewhere it can fly from, not embedded in the jaw.
  assert.ok(p.y > jaw.y + jaw.h - 1,
    `the ship finished inside the jaw at y=${p.y.toFixed(1)}`);
});

// ------------------------------------------------------------- squadrons
//
// Attackers used to arrive one at a time, uniformly at random from the
// roster: on a deep hull, fifteen kinds all equally likely at every moment,
// which averages into texture. They arrive as compositions now. The thing
// that must not have changed is how much arrives.

import {
  SQUADS, squadsFor, squadWeight, foeRateFor, spawnSquadron, resetFoes, SPEC,
  NEVER_ALONE,
} from '../src/foes.js';
import { FOE_PACE } from '../src/config.js';

test('every squadron is made of kinds that exist', () => {
  const ids = new Set();
  for (const sq of SQUADS) {
    assert.ok(!ids.has(sq.id), `two squadrons share the id ${sq.id}`);
    ids.add(sq.id);
    assert.ok(sq.of.length, `${sq.id} has no members`);
    for (const [kind, n] of sq.of) {
      assert.ok(SPEC[kind], `${sq.id} fields '${kind}', which is not an attacker`);
      assert.ok(n >= 1, `${sq.id} fields ${n} of ${kind}`);
    }
  }
});

test('a hull only fields squadrons it has the kinds for', () => {
  for (const spec of LEVELS) {
    if (!spec.foes.length) continue;
    const has = new Set(spec.foes);
    for (const sq of squadsFor(spec)) {
      for (const [kind] of sq.of) {
        assert.ok(has.has(kind),
          `${spec.name} can field ${sq.id}, which needs ${kind} — not on its roster`);
      }
    }
  }
});

test('every kind on a roster can still arrive on its own', () => {
  // A roster entry that only ever turns up inside a group stops being its
  // own answer to anything.
  for (const spec of LEVELS) {
    if (!spec.foes.length) continue;
    const alone = new Set(
      squadsFor(spec).filter((sq) => sq.of.length === 1 && sq.of[0][1] === 1)
        .map((sq) => sq.of[0][0]),
    );
    for (const kind of spec.foes) {
      if (NEVER_ALONE.has(kind)) {
        assert.ok(!alone.has(kind),
          `${spec.name} can field a lone ${kind}, which is only half an attacker`);
        assert.ok(squadsFor(spec).some((sq) => sq.of.some(([k, n]) => k === kind && n > 1)),
          `${spec.name} fields ${kind} but never in a group, so it never arrives at all`);
        continue;
      }
      assert.ok(alone.has(kind), `${spec.name} can never field a lone ${kind}`);
    }
  }
});

test('squadrons deliver the pressure the old cadence delivered', () => {
  // The whole point of pacing the gap by weight: composition changed and
  // the difficulty did not. Measured per hull against what one roster pull
  // every FOE_PACE.legacyGap seconds actually produced, which is what the
  // game shipped with.
  for (const spec of LEVELS) {
    if (!spec.foes.length) continue;
    let legacy = 0;
    for (const k of spec.foes) {
      const together = k === 'gnat' ? (SPEC.gnat.swarm || 1) : k === 'chainer' ? 2 : 1;
      legacy += SPEC[k].score * together;
    }
    // 2.6 + 2.2 / 2, written out rather than read from FOE_PACE.legacyGap.
    // Taking it from the config made this test self-referential: both
    // sides moved together and any value passed.
    legacy = legacy / spec.foes.length / 3.7;

    const list = squadsFor(spec);
    const rate = foeRateFor(spec);
    let weight = 0;
    let gap = 0;
    for (const sq of list) {
      const w = squadWeight(sq);
      weight += w;
      gap += Math.max(FOE_PACE.floor, w / rate);
    }
    const now = weight / gap;
    const drift = Math.abs(now / legacy - 1);
    assert.ok(drift < 0.05,
      `${spec.name}: ${now.toFixed(1)} pts/s against the old ${legacy.toFixed(1)}`
      + ` — ${(drift * 100).toFixed(0)}% off`);
  }
});

test('a heavy squadron buys a longer quiet than a light one', () => {
  const spec = LEVELS[LEVELS.length - 1];
  const rate = foeRateFor(spec);
  const gapOf = (id) => {
    const sq = SQUADS.find((s) => s.id === id);
    return Math.max(FOE_PACE.floor, squadWeight(sq) / rate);
  };
  assert.ok(gapOf('monitor') > gapOf('swarm') * 2,
    `a monitor (${gapOf('monitor').toFixed(1)}s) should buy far longer`
    + ` than three gnats (${gapOf('swarm').toFixed(1)}s)`);
});

// Driving the real spawn path.
function flying() {
  const game = launchAt(LEVELS.length - 1);
  for (const t of game.level.turrets) t.dead = true;
  return game;
}

test('a squadron arrives whole, in formation, facing one way', () => {
  const game = flying();
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    resetFoes();
    const sq = spawnSquadron(game);
    assert.ok(sq, 'the hull with every kind on it spawned nothing');
    seen.add(sq.squad.id);
    const want = sq.squad.of.reduce((t, [, n]) => t + n, 0);
    assert.equal(sq.members.length, want,
      `${sq.squad.id} arrived ${sq.members.length} strong, wanted ${want}`);
    const facing = sq.members[0].facing;
    for (const m of sq.members) {
      assert.equal(m.facing, facing, `${sq.squad.id} has a member flying the other way`);
      assert.ok(m.baseY >= FIELD_TOP && m.baseY <= FIELD_BOT,
        `${sq.squad.id} put a member outside the corridor at y=${m.baseY}`);
      assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y), 'a member has no position');
    }
  }
  assert.ok(seen.size > 8,
    `300 spawns produced only ${seen.size} different squadrons`);
});

test('a squadron does not stack its members on one spot', () => {
  // A wide formation spawned near a girder used to have three members
  // clamped onto the same line: one object drawn three times rather than
  // three things in the way.
  const game = flying();
  for (let i = 0; i < 400; i++) {
    resetFoes();
    const sq = spawnSquadron(game);
    if (sq.members.length < 2) continue;
    // Measured as distance, not as a distinct (x, y) key. The key version
    // missed the actual failure: a line formation clamped against a girder
    // puts two members on the same y, 10px apart in x — two different keys
    // and two overlapping sprites. The tightest spacing any formation in
    // the table asks for is about 30px, so 20 is clear of every legitimate
    // one and well above the 10px collapse.
    for (let a = 0; a < sq.members.length; a++) {
      for (let b = a + 1; b < sq.members.length; b++) {
        const A = sq.members[a];
        const B = sq.members[b];
        const d = Math.hypot(A.x - B.x, A.baseY - B.baseY);
        assert.ok(d >= 20,
          `${sq.squad.id} put two members ${d.toFixed(1)}px apart`
          + ` (${sq.members.map((m) => `${Math.round(m.x)},${Math.round(m.baseY)}`).join(' ')})`);
      }
    }
  }
});

test('a chainer never arrives without its mate', () => {
  // The pair and the live tether between them is the attacker, and the
  // old spawn path killed a chainer it could not pair. Driven on a roster
  // of nothing but chainers so the squadron picked is always the pair,
  // and with the pool squeezed so pairing has to fail.
  const game = launchAt(LEVELS.length - 1);
  for (const t of game.level.turrets) t.dead = true;
  game.level.spec = { ...game.level.spec, foes: ['chainer'] };
  const pool = poolOfFoes();

  for (let free = 1; free <= 3; free++) {
    resetFoes();
    while (pool.spawn()) { /* fill */ }
    for (let k = 0; k < free; k++) pool.kill(0);
    const before = pool.count;
    const sq = spawnSquadron(game);
    if (free === 1) {
      assert.equal(sq, null, 'a chainer squadron formed with room for only one');
      assert.equal(pool.count, before, 'the unpaired chainer was left in the pool');
    } else if (sq) {
      assert.equal(sq.members.length, 2, `a chainer squadron of ${sq.members.length}`);
      assert.equal(sq.members[0].mate, sq.members[1], 'the pair is not linked');
      assert.equal(sq.members[1].mate, sq.members[0], 'the link is one-way');
      assert.ok(sq.members[0].holdsLink !== sq.members[1].holdsLink,
        'both ends hold the link, so the tether would be billed twice');
    }
  }
});

test('a squadron that cannot fit in the pool degrades instead of breaking', () => {
  const game = flying();
  // Fill the pool to one slot short, then ask for a squadron.
  const pool = poolOfFoes();
  resetFoes();
  while (pool.spawn()) { /* fill it */ }
  const full = pool.count;
  assert.ok(full > 0, 'the foe pool would not fill');
  pool.kill(0);                       // exactly one slot free
  const sq = spawnSquadron(game);
  assert.ok(sq === null || sq.members.length >= 1,
    'a squadron with no room came back malformed');
  if (sq) {
    for (const m of sq.members) assert.ok(SPEC[m.kind], 'a member has no spec');
    // A lone chainer is not an attacker and must not be left as one.
    if (sq.squad.link) assert.equal(sq.members.length, 2, 'half a chainer pair survived');
  }
  assert.ok(pool.count <= full, 'the pool overflowed');
});
