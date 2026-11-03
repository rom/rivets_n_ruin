import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel, mixSeed, pointBlocked, obstaclesNear, firstBlockage } from '../src/level.js';
import { makeGame, update } from '../src/game.js';
import { setSynthetic } from '../src/input.js';
import { foes } from '../src/foes.js';
const poolOfFoes = () => foes;
const pickupsModule = () => pickupsNS;
import * as pickupsNS from '../src/pickups.js';
import { hitTurret as hitTurretDirect } from '../src/enemies.js';
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
    // Measured as clearance for the ship's whole box, not as a gap in a
    // slice. See firstBlockage: the slice version passed eighteen hulls
    // the ship could not get through.
    for (const seed of [1, 7, 0x51ed, 0xbeef, 0x7fffffff, 0xffffffff, 12345, 999983]) {
      const lv = buildLevel(LEVELS[hull], seed);
      const bad = firstBlockage(lv);
      assert.equal(bad, null,
        bad && `${LEVELS[hull].name} seed ${seed} blocked at x=${bad.x}: ${bad.why}`);
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
  // The full sweep, run at sixteen points around the cycle rather than
  // once at the base position, and for the ship's whole box.
  const { lv } = hullWithPress();
  for (let step = 0; step < 16; step++) {
    const t = (step / 16) * 3.4;      // the longest period the band makes
    updateMovers(lv, t);
    const bad = firstBlockage(lv);
    assert.equal(bad, null,
      bad && `blocked at x=${bad.x} (${bad.why}) at t=${t.toFixed(2)}`);
  }
});

test('a chicane never closes against the width of the ship', () => {
  // The pattern that was doing it. Consecutive stubs come off opposite
  // surfaces, and before they were capped as a pair the two free bands
  // could miss each other entirely — leaving the gap between the stubs as
  // the only way through, at 18 to 20px for a ship 19px wide.
  let seen = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const lv = buildLevel(LEVELS[6], seed);
    const bad = firstBlockage(lv);
    assert.equal(bad, null, bad && `seed ${seed} blocked at x=${bad.x}: ${bad.why}`);
    // A chicane is a run of stubs alternating top and bottom with small
    // x gaps; count the hulls that actually contain one so this is not
    // passing on hulls that never grew the pattern under test.
    const byX = [...lv.obstacles].sort((a, b) => a.x - b.x);
    for (let i = 1; i < byX.length; i++) {
      const a = byX[i - 1];
      const b = byX[i];
      const gap = b.x - (a.x + a.w);
      if (gap > 0 && gap < 60 && a.face !== b.face) { seen++; break; }
    }
  }
  assert.ok(seen > 30, `only ${seen} of 120 seeds grew alternating stubs to test`);
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

// ------------------------------------------------------------- modifiers
//
// Past AURUM the campaign was one formula with bigger numbers: seventeen
// generated hulls that field the whole roster and the whole tower list and
// differ only in health, speed and spawn rate. A modifier is one named
// rule that changes how a hull is flown rather than how much of it there
// is.

import {
  MODIFIERS, MODIFIER_CHANCE, MOD_FORCE, hullRule,
} from '../src/config.js';
import { modifierFor, specWithModifier } from '../src/level.js';

test('every modifier is named, explained and reachable', () => {
  const ids = new Set();
  for (const m of MODIFIERS) {
    assert.ok(!ids.has(m.id), `two modifiers share the id ${m.id}`);
    ids.add(m.id);
    assert.ok(m.name && m.name === m.name.toUpperCase(), `${m.id} has no display name`);
    assert.ok(m.blurb && m.blurb.length > 20,
      `${m.id} does not say what it does — a rule the pilot cannot read is`
      + ' the game behaving strangely');
    assert.ok(m.from >= MODIFIER_CHANCE.from,
      `${m.id} can appear before modifiers do at all`);
    assert.ok(m.from < LEVELS.length - 1, `${m.id} can never appear`);
  }
  assert.ok(MODIFIERS.length >= 6, 'too few rules to give the deep hulls identities');
});

test('the tutorial hulls are flown under no rule', () => {
  for (let i = 0; i < MODIFIER_CHANCE.from; i++) {
    for (let seed = 0; seed < 60; seed++) {
      assert.equal(modifierFor(i, LEVELS[i], seed), null,
        `${LEVELS[i].name} drew a modifier, and it is meant to be the tutorial`);
    }
  }
});

test('a modifier is stable for a hull and a seed, and moves with the seed', () => {
  const spec = LEVELS[10];
  const a = modifierFor(10, spec, 0);
  assert.equal(modifierFor(10, spec, 0), a, 'FIXED gave a hull two different rules');

  // ...and across run seeds it actually varies, or SHUFFLED buys nothing.
  const drawn = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const m = modifierFor(10, spec, seed);
    drawn.add(m ? m.id : null);
  }
  assert.ok(drawn.size >= 5,
    `200 run seeds on one hull drew only ${drawn.size} different outcomes`);
  assert.ok(drawn.has(null), 'a hull is never left clean');
});

test('a clean hull stays possible, and a ruled one stays common', () => {
  // Both halves matter: every hull having a rule makes the rule the
  // baseline, and the rate is meant to climb with depth.
  const rate = (i) => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) if (modifierFor(i, LEVELS[i], seed)) n++;
    return n / 400;
  };
  const early = rate(MODIFIER_CHANCE.from);
  const deep = rate(LEVELS.length - 1);
  assert.ok(early > 0.3 && early < 0.6, `the first ruled hull draws one ${(early * 100) | 0}% of the time`);
  assert.ok(deep > early, `deep hulls (${(deep * 100) | 0}%) should draw more than early ones (${(early * 100) | 0}%)`);
  assert.ok(deep <= MODIFIER_CHANCE.cap + 0.05, 'the cap is not holding');
});

test('a modifier never offers a rule the hull is too early for', () => {
  for (let i = 0; i < LEVELS.length; i++) {
    for (let seed = 0; seed < 150; seed++) {
      const m = modifierFor(i, LEVELS[i], seed);
      if (m) assert.ok(i >= m.from, `${LEVELS[i].name} drew ${m.id}, which starts at hull ${m.from + 1}`);
    }
  }
});

test('a spec modifier multiplies, and leaves the original alone', () => {
  const base = LEVELS[10];
  const pressure = MODIFIERS.find((m) => m.id === 'pressure');
  const out = specWithModifier(base, pressure);
  assert.notEqual(out, base, 'the level spec was mutated in place');
  assert.equal(base.gapScale, LEVELS[10].gapScale, 'the original spec changed');
  assert.ok(out.gapScale < base.gapScale, 'PRESSURE did not tighten the corridor');
  assert.equal(out.gapScale, base.gapScale * pressure.spec.gapScale);
  // untouched fields carry over
  assert.equal(out.name, base.name);
  assert.equal(out.turretHp, base.turretHp);
  assert.equal(specWithModifier(base, null), base, 'no modifier should mean no copy');
});

test('a hull built under PRESSURE is still flyable', () => {
  // The one modifier that changes the geometry, so the one that can make
  // a hull impossible. Checked the same way shuffling is.
  const pressure = MODIFIERS.find((m) => m.id === 'pressure');
  for (const hull of [4, 12, LEVELS.length - 1]) {
    const spec = specWithModifier(LEVELS[hull], pressure);
    for (const seed of [0, 7, 0xbeef, 4242]) {
      const lv = build(spec, seed);
      const bad = widestGapFailure(lv);
      assert.equal(bad, null,
        bad && `${LEVELS[hull].name} under PRESSURE, seed ${seed}, is impassable`
          + ` at x=${bad.x} (widest gap ${bad.best}px)`);
    }
  }
});

test('hullRule reads the rule in force and nothing else', () => {
  const none = {};
  assert.equal(hullRule(none, 'gravity'), false, 'a hull with no rule reported one');
  const g = { hullMod: MODIFIERS.find((m) => m.id === 'gravity') };
  assert.equal(hullRule(g, 'gravity'), true);
  assert.equal(hullRule(g, 'blackout'), false, 'one rule answered for another');
  for (const m of MODIFIERS) {
    const live = { hullMod: m };
    const on = MODIFIERS.filter((x) => hullRule(live, x.id));
    assert.equal(on.length, 1, `${m.id} switches on ${on.length} rules`);
  }
});

test('GRAVITY WELL pulls without taking a direction away', () => {
  // A rule that makes a hull unflyable is a broken hull, not a hard one:
  // holding the stick up has to still climb.
  assert.ok(MOD_FORCE.gravity > 0, 'gravity pulls nowhere');
  assert.ok(MOD_FORCE.gravity < 1,
    `gravity at ${MOD_FORCE.gravity} of the ship's own thrust cannot be climbed against`);
});

// The rules actually biting, driven through the real update loop. The
// tests above prove the table is well-formed; these prove it is wired.

function ruledHull(id, hull = LEVELS.length - 1) {
  const game = launchAt(hull);
  game.hullMod = MODIFIERS.find((m) => m.id === id);
  assert.ok(game.hullMod, `no modifier called ${id}`);
  for (const t of game.level.turrets) t.dead = true;
  game.miniPlan = [];
  return game;
}

test('GRAVITY WELL sinks a ship that is not flying, and nothing else does', () => {
  // Measured as the difference between the two, not as an absolute drop:
  // the control hull is real terrain, and a ship let go at an arbitrary x
  // may be resting on something that nudges it. BLACKOUT is the control
  // because it is the only other rule that touches nothing physical.
  const fallUnder = (id) => {
    const game = ruledHull(id);
    const p = game.player;
    p.x = 4000; p.y = 160; p.vx = 0; p.vy = 0; p.invuln = 1e9;
    game.cam.x = p.x - 320;
    const startY = p.y;
    for (let f = 0; f < 60; f++) {
      silence(game);
      p.vx = 0;
      update(game, DT);
    }
    return p.y - startY;
  };
  const pulled = fallUnder('gravity');
  const control = fallUnder('blackout');
  assert.ok(pulled - control > 8,
    `GRAVITY WELL sank the ship ${pulled.toFixed(1)}px against the control's`
    + ` ${control.toFixed(1)}px — the rule is not reaching the ship`);
});

test('GRAVITY WELL can be climbed against', () => {
  const game = ruledHull('gravity');
  const p = game.player;
  p.x = 4000; p.y = 200; p.vx = 0; p.vy = 0; p.invuln = 1e9;
  game.cam.x = p.x - 320;
  const startY = p.y;
  try {
    for (let f = 0; f < 90; f++) {
      silence(game);
      setSynthetic(new Set(['up']));
      p.vx = 0;
      update(game, DT);
    }
  } finally { setSynthetic(null); }
  assert.ok(p.y < startY - 10,
    `holding up under GRAVITY WELL went from y=${startY} to y=${p.y.toFixed(1)}:`
    + ' the rule takes a direction away rather than making one cost something');
});

test('SALVAGE RUN drops no crates, and pays more for the wreck', () => {
  const plain = ruledHull('gravity');          // any rule that is not salvage
  const salvage = ruledHull('salvage');
  const { maybeDrop, spoils, pickups, resetPickups } = pickupsModule();

  // Reset first. The pickup pool is module-global and shared across every
  // test in this file; left full by an earlier one, spawnPickup returns
  // null and maybeDrop reports no crate whatever the rule says — which is
  // a test that passes with the rule deleted.
  let crates = 0;
  for (let i = 0; i < 400; i++) {
    resetPickups();
    if (maybeDrop(plain, 100, 100, 'turret')) crates++;
  }
  assert.ok(crates > 0, 'the control hull dropped no crates either');
  for (let i = 0; i < 400; i++) {
    resetPickups();
    assert.equal(maybeDrop(salvage, 100, 100, 'turret'), null,
      'a SALVAGE RUN dropped a crate');
  }

  // Averaged over many small batches. Sixty kills in one batch saturated
  // the 160-slot pickup pool and measured a doubling as 155 against 136;
  // eight kills left the pool alone but the per-kill roll is random, and
  // a single batch of eight failed about one run in four on variance.
  const coinsFrom = (game) => {
    let total = 0;
    for (let batch = 0; batch < 40; batch++) {
      resetPickups();
      for (let i = 0; i < 6; i++) spoils(game, 3000, 160, 'turret');
      for (let i = 0; i < pickups.count; i++) if (pickups.items[i].kind === 'coin') total++;
    }
    return total / 40;
  };
  const a = coinsFrom(plain);
  const b = coinsFrom(salvage);
  assert.ok(b > a * 1.6,
    `SALVAGE RUN scattered ${b.toFixed(1)} coins a batch against ${a.toFixed(1)}`
    + ` — it only takes and never pays`);
});

test('HARD VACUUM doubles what a scrape costs', () => {
  const cost = (id) => {
    const game = ruledHull(id);
    const p = game.player;
    p.shield = p.shieldMax;
    p.invuln = 0;
    p.x = 4000; p.y = FIELD_TOP + 2; p.vy = 0; p.vx = 0;
    game.cam.x = p.x - 320;
    const was = p.shield;
    silence(game);
    update(game, DT);                 // one frame grinding the upper girder
    return was - p.shield;
  };
  // BLACKOUT as the control, not GRAVITY WELL: a scrape is charged in
  // proportion to the closing speed, and the gravity rule gives the ship
  // vertical speed before it touches anything, so the two sides were being
  // charged for different impacts (5.00 against 2.64, a ratio of 1.89).
  const plain = cost('blackout');
  const vac = cost('vacuum');
  assert.ok(plain > 0, 'the control hull cost nothing to grind');
  assert.ok(Math.abs(vac / plain - MOD_FORCE.vacuumScrape) < 0.1,
    `HARD VACUUM charged ${vac.toFixed(2)} against ${plain.toFixed(2)}:`
    + ` expected ${MOD_FORCE.vacuumScrape}x`);
});

test('HARD VACUUM doubles what the loot is worth', () => {
  // The other half of the rule, and the half nothing covered: deleting the
  // multiplier from pickups.js failed no test at all.
  // Collected the way the game collects: a bar put where the ship is, and
  // the real update run over it. collect() is private and exporting it for
  // a test would be testing a function rather than the behaviour.
  const worth = (id) => {
    const game = ruledHull(id);
    const { resetPickups, spawnPickup, updatePickups, pickups } = pickupsModule();
    resetPickups();
    const bar = spawnPickup(game, game.player.x, game.player.y, 'goldbar');
    assert.ok(bar, 'no gold bar to collect');
    bar.vx = 0; bar.vy = 0;
    bar.baseY = game.player.y;
    bar.x = game.player.x;
    const before = game.score;
    for (let f = 0; f < 10 && pickups.count; f++) updatePickups(game, DT);
    assert.equal(pickups.count, 0, 'the bar was never picked up');
    return game.score - before;
  };
  const plain = worth('blackout');
  const vac = worth('vacuum');
  assert.ok(plain > 0, 'a gold bar was worth nothing on the control hull');
  assert.equal(vac, plain * MOD_FORCE.vacuumLoot,
    `a gold bar paid ${vac} under HARD VACUUM against ${plain} without it`);
});

test('LIVE HULL stands a gun back up, behind you, and only once paid', () => {
  const game = launchAt(LEVELS.length - 1);
  game.hullMod = MODIFIERS.find((m) => m.id === 'livehull');
  game.miniPlan = [];
  const p = game.player;
  const t = game.level.turrets.find((x) => x.x > 3000);
  assert.ok(t, 'no gun to break');

  p.x = t.x; p.y = 160; p.invuln = 1e9;
  const scoreBefore = game.score;
  const killedBefore = game.turretsKilled;
  hitTurretDirect(game, t, 9999);
  assert.ok(t.dead, 'the gun did not break');
  const paidOnce = game.score - scoreBefore;
  assert.ok(paidOnce > 0, 'breaking a gun paid nothing');
  assert.equal(game.turretsKilled, killedBefore + 1);

  // It must not come back while it is still on screen.
  for (let f = 0; f < 120 * 12; f++) {
    silence(game);
    p.x = t.x; p.vx = 0;
    game.cam.x = Math.max(0, t.x - 320);
    update(game, DT);
    assert.ok(t.dead, `the gun was rebuilt in front of the ship at t=${game.time.toFixed(1)}`);
  }

  // Fly well past it and it stands back up.
  let back = false;
  for (let f = 0; f < 120 * 12 && !back; f++) {
    silence(game);
    p.x = t.x + 2000; p.facing = 1; p.vx = 0;
    game.cam.x = Math.max(0, p.x - 320);
    update(game, DT);
    back = !t.dead;
  }
  assert.ok(back, 'LIVE HULL never rebuilt the gun');

  // ...and breaking it again pays nothing. A gun that could be farmed
  // every nine seconds would make the rule an exploit.
  const scoreAfter = game.score;
  const killedAfter = game.turretsKilled;
  hitTurretDirect(game, t, 9999);
  assert.ok(t.dead, 'the rebuilt gun could not be broken');
  assert.equal(game.score, scoreAfter, 'a rebuilt gun paid its score a second time');
  assert.equal(game.turretsKilled, killedAfter, 'a rebuilt gun counted twice');
});

test('a hull with no LIVE HULL rule never rebuilds a gun', () => {
  const game = ruledHull('gravity');
  const p = game.player;
  const t = game.level.turrets.find((x) => x.x > 3000);
  t.dead = true;
  t.downAt = 0;
  for (let f = 0; f < 120 * 20; f++) {
    silence(game);
    p.x = t.x + 3000; p.facing = 1; p.vx = 0; p.invuln = 1e9;
    game.cam.x = Math.max(0, p.x - 320);
    update(game, DT);
  }
  assert.ok(t.dead, 'a gun came back on a hull with no rule for it');
});

// ------------------------------------------------- the entangling attackers
//
// Three that take control rather than shield: a net that slows the ship,
// a hook that slows and drags it off its line, and a flame that leaves
// the hull burning after the thing that lit it is dead.

import { STATUS } from '../src/config.js';
import { spawnFoe } from '../src/foes.js';

function inFlight(hull = LEVELS.length - 1) {
  const game = launchAt(hull);
  for (const t of game.level.turrets) t.dead = true;
  game.miniPlan = [];
  return game;
}

// Everything off the hull except the one attacker under test and what
// it fires. silence() cannot be used here: it clears the foe pool and
// the enemy shots, which is exactly the attacker and exactly its net.
function onlyThis(game) {
  interceptors.clear();
}

// Puts one attacker next to the ship and runs the real loop until it
// fires and connects, or gives up.
function letItHit(game, kind, frames = 120 * 10) {
  const p = game.player;
  resetFoes();
  const f = spawnFoe(game, kind);
  assert.ok(f, `could not spawn a ${kind}`);
  for (let i = 0; i < frames; i++) {
    onlyThis(game);
    // hold them a fixed distance apart so the attacker is always in range
    f.x = p.x + 70;
    f.baseY = p.y;
    f.y = p.y;
    f.dead = false;
    p.invuln = 0;
    p.vx = 0; p.vy = 0;
    update(game, DT);
    if (p.snareT > 0 || p.burnT > 0 || p.towT > 0) return f;
  }
  return null;
}

test('a netter slows the ship, and it wears off', () => {
  const game = inFlight();
  const p = game.player;
  const f = letItHit(game, 'netter');
  assert.ok(f, 'a netter never landed a net in ten seconds at point blank');
  assert.ok(p.snareT > 0, 'the net did not snare');
  // Bounded by a literal, not by STATUS.snareTime: reading the constant
  // under test makes both sides move together and any value passes.
  assert.ok(p.snareT <= 5,
    `a net holds for ${p.snareT.toFixed(1)}s — long enough to be a death sentence`);
  assert.ok(STATUS.snareTime > 0.5 && STATUS.snareTime <= 5,
    `a net set to hold ${STATUS.snareTime}s is not a slow, it is a stop`);

  // It has to actually cost speed, not just set a flag.
  resetFoes();
  p.snareT = STATUS.snareTime;
  const topWhileHeld = reachableSpeed(game, 40);
  p.snareT = 0;
  const topFree = reachableSpeed(game, 40);
  assert.ok(topWhileHeld < topFree * 0.75,
    `netted the ship reached ${topWhileHeld.toFixed(0)}px/s against`
    + ` ${topFree.toFixed(0)} free — the snare is not reaching the controls`);

  // ...and it lets go.
  p.snareT = 0.05;
  resetFoes();
  for (let i = 0; i < 30; i++) { onlyThis(game); update(game, DT); }
  assert.equal(p.snareT <= 0, true, 'the net never let go');
});

// How fast the ship gets in a short burst, measured from the same spot
// both times. The first version just accelerated from wherever the ship
// happened to be, so the netted run flew 150px into a block and the free
// run was measured against a wall — it reported the netted ship as four
// times the faster of the two.
function reachableSpeed(game, frames) {
  const p = game.player;
  p.x = 200;                      // inside the launch apron, clear by construction
  p.y = (FIELD_TOP + FIELD_BOT) / 2;
  p.vx = 0; p.vy = 0; p.facing = 1;
  p.invuln = 1e9;
  try {
    for (let i = 0; i < frames; i++) {
      onlyThis(game);
      setSynthetic(new Set(['right']));
      update(game, DT);
    }
  } finally { setSynthetic(null); }
  return Math.abs(p.vx);
}

test('a grapnel tows the ship, and the line drops with it', () => {
  const game = inFlight();
  const p = game.player;
  const f = letItHit(game, 'grapnel');
  assert.ok(f, 'a grapnel never landed a hook in ten seconds at point blank');
  assert.ok(p.towT > 0 && p.towBy === f, 'the hook did not attach to its owner');

  // Pulled toward the thing holding the line.
  p.vx = 0; p.vy = 0;
  const wasX = p.x;
  for (let i = 0; i < 20; i++) {
    onlyThis(game);
    f.x = p.x + 90; f.y = p.y; f.dead = false;
    update(game, DT);
  }
  assert.ok(p.x > wasX, `being towed from the right moved the ship to ${p.x} from ${wasX}`);

  // Kill the grapnel and the line goes slack.
  f.dead = true;
  f.hp = 0;
  onlyThis(game);
  update(game, DT);
  assert.equal(p.towT, 0, 'the line survived the ship holding it');
  assert.equal(p.towBy, null, 'a dead grapnel is still on the hook');
});

test('a scorcher sets the hull alight, and it keeps burning', () => {
  const game = inFlight();
  const p = game.player;
  const f = letItHit(game, 'scorcher');
  assert.ok(f, 'a scorcher never landed a flame in ten seconds at point blank');
  assert.ok(p.burnT > 0, 'the flame did not light the hull');

  // The fire outlives what lit it — that is the whole of the mechanic.
  f.dead = true;
  f.hp = 0;
  resetFoes();
  // ...and its flames with it. Puffs already in the air kept landing and
  // the burn-only measurement read 42.5 shield against the 6.5 the fire
  // itself costs.
  enemyShots.clear();
  p.x = 200;
  p.y = (FIELD_TOP + FIELD_BOT) / 2;
  p.vx = 0; p.vy = 0;
  p.shield = p.shieldMax;
  p.invuln = 0;
  const before = p.shield;
  const held = p.burnT;
  for (let i = 0; i < 60; i++) { onlyThis(game); update(game, DT); }
  assert.ok(p.shield < before,
    'the hull stopped burning the moment the scorcher died');
  const lost = before - p.shield;
  const want = STATUS.burnDps * 0.5;
  assert.ok(Math.abs(lost - want) < want * 0.5,
    `burned ${lost.toFixed(1)} shield in half a second, expected about ${want.toFixed(1)}`);
  assert.ok(p.burnT < held, 'the fire never burns out');
});

test('none of the three carries over to the next ship', () => {
  const game = inFlight();
  const p = game.player;
  p.snareT = 9; p.burnT = 9; p.towT = 9; p.towBy = { x: 0, y: 0, dead: false, hp: 1 };
  p.shield = 0.0001;
  p.invuln = 0;
  onlyThis(game);
  update(game, DT);
  assert.equal(game.state, 'dying', 'the ship did not die');
  const np = game.player;
  assert.equal(np.snareT, 0, 'the new ship arrived netted');
  assert.equal(np.burnT, 0, 'the new ship arrived on fire');
  assert.equal(np.towT, 0, 'the new ship arrived on a hook');
});

test('a second hit refreshes rather than stacks', () => {
  assert.equal(STATUS.refresh, true);
  const game = inFlight();
  const p = game.player;
  p.snareT = 1;
  p.invuln = 0;
  // two nets in a row
  for (let k = 0; k < 2; k++) {
    const s = enemyShots.spawn();
    Object.assign(s, { x: p.x, y: p.y, vx: 0, vy: 0, life: 1, dmg: 0, r: 6, fx: 'net' });
    onlyThis(game);
    update(game, DT);
  }
  assert.ok(p.snareT <= STATUS.snareTime + 0.01,
    `two nets stacked to ${p.snareT.toFixed(2)}s, past the ${STATUS.snareTime}s one lasts`);
});

// ------------------------------------------------------------ hazard fields
//
// Areas rather than objects: nothing solid, nothing to shoot, and a
// price per second for being inside. The thing that must hold is that
// they are always avoidable — a field is a question about your line, and
// a field spanning the corridor would be a wall that cannot be broken.

import { HAZARDS } from '../src/config.js';
import { hazardAt } from '../src/level.js';

test('every hazard kind is complete and reachable', () => {
  const kinds = Object.keys(HAZARDS);
  assert.equal(kinds.length, 4, `${kinds.length} hazard kinds`);
  for (const [id, h] of Object.entries(HAZARDS)) {
    assert.ok(h.name && h.name === h.name.toUpperCase(), `${id} has no name`);
    assert.ok(h.dps > 0, `${id} costs nothing to fly through`);
    assert.ok(h.dps < 60, `${id} at ${h.dps}/s is not a hazard, it is a wall`);
    for (const c of ['tint', 'glow', 'dark']) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(h[c]), `${id}.${c} is not a colour`);
    }
  }
  // Every kind has to actually be fielded somewhere, or it is art nobody
  // will see.
  const fielded = new Set();
  for (const spec of LEVELS) for (const k of spec.hazardKinds || []) fielded.add(k);
  for (const k of kinds) assert.ok(fielded.has(k), `no hull ever fields a ${k} field`);
});

test('the tutorial hulls field no hazards', () => {
  for (const spec of LEVELS.slice(0, 2)) {
    for (let seed = 0; seed < 30; seed++) {
      assert.equal(buildLevel(spec, seed).hazards.length, 0,
        `${spec.name} grew a hazard field and is meant to be the tutorial`);
    }
  }
});

test('a hull only fields the kinds it lists', () => {
  for (const spec of LEVELS) {
    const allowed = new Set(spec.hazardKinds || []);
    for (let seed = 0; seed < 12; seed++) {
      for (const h of buildLevel(spec, seed).hazards) {
        assert.ok(allowed.has(h.kind),
          `${spec.name} grew a ${h.kind} field, which it does not list`);
      }
    }
  }
});

test('a hazard field always leaves a clear band beside it', () => {
  // The guarantee the whole category rests on. Fields are invisible to
  // the clearance sweep — they are not solid — so nothing else would
  // notice one that spanned the corridor.
  const need = SHIP.hitH + 20;
  let seen = 0;
  for (const spec of LEVELS) {
    for (let seed = 0; seed < 16; seed++) {
      const lv = buildLevel(spec, seed);
      for (const h of lv.hazards) {
        seen++;
        const above = h.y - FIELD_TOP;
        const below = FIELD_BOT - (h.y + h.h);
        assert.ok(Math.max(above, below) >= need,
          `${spec.name}: a ${h.kind} field leaves only ${Math.max(above, below).toFixed(0)}px`
          + ` of clear corridor, and the ship needs ${need}`);
        assert.ok(h.h > 0 && h.w > 0, 'a field with no area');
        assert.ok(h.y >= FIELD_TOP - 1 && h.y + h.h <= FIELD_BOT + 1,
          'a field outside the corridor');
      }
    }
  }
  assert.ok(seen > 200, `only ${seen} fields generated to check`);
});

test('a hazard field never blocks the hull', () => {
  // Belt and braces: fields are not obstacles, so this is really
  // checking that nothing started adding them to the obstacle list.
  for (const spec of LEVELS) {
    const lv = buildLevel(spec, 7);
    assert.ok(lv.hazards.length === 0 || lv.obstacles.every((o) => !o.kind),
      'a hazard leaked into the obstacle list');
    const bad = firstBlockage(lv);
    assert.equal(bad, null, bad && `${spec.name} blocked at x=${bad.x}: ${bad.why}`);
  }
});

test('hazardAt finds the field the ship is standing in, and only that', () => {
  const lv = { hazards: [{ x: 100, y: 50, w: 60, h: 40, kind: 'fire', phase: 0 }] };
  const hw = SHIP.hitW / 2;
  const hh = SHIP.hitH / 2;
  assert.ok(hazardAt(lv, 130, 70, hw, hh), 'the middle of a field read as clear');
  assert.equal(hazardAt(lv, 130, 200, hw, hh), null, 'well below a field read as inside it');
  assert.equal(hazardAt(lv, 400, 70, hw, hh), null, 'well past a field read as inside it');
  // the ship's box counts, not just its centre
  assert.ok(hazardAt(lv, 100 - hw + 2, 70, hw, hh), 'a wingtip inside a field read as clear');
  assert.equal(hazardAt(lv, 100 - hw - 4, 70, hw, hh), null, 'clear of a field read as inside');
  assert.equal(hazardAt({ hazards: [] }, 0, 0, hw, hh), null);
  assert.equal(hazardAt({}, 0, 0, hw, hh), null, 'a level with no field list threw');
});

test('a field costs shield by the second, and only while you are in it', () => {
  const game = inFlight();
  const p = game.player;
  const field = { x: p.x - 200, y: FIELD_TOP, w: 400, h: 120, kind: 'spark', phase: 0 };
  game.level.hazards = [field];
  p.y = FIELD_TOP + 40;                 // inside it
  p.invuln = 0;
  p.shield = p.shieldMax;
  const before = p.shield;
  for (let i = 0; i < 60; i++) {
    onlyThis(game);
    p.x = field.x + 200; p.y = FIELD_TOP + 40; p.vx = 0; p.vy = 0;
    update(game, DT);
  }
  const lost = before - p.shield;
  const want = HAZARDS.spark.dps * 0.5;
  assert.ok(Math.abs(lost - want) < want * 0.4,
    `half a second in an arc field cost ${lost.toFixed(1)}, expected about ${want.toFixed(1)}`);

  // The ship's box counts, not its centre. Parked so the centre is clear
  // of the field and a wingtip is not: a caller that passes a point
  // instead of the hitbox flies through this for free.
  const edge = field.y + field.h;
  p.shield = p.shieldMax;
  const atEdge = p.shield;
  for (let i = 0; i < 40; i++) {
    onlyThis(game);
    p.x = field.x + 200;
    p.y = edge + SHIP.hitH / 2 - 2;     // centre below the field, top edge inside
    p.vx = 0; p.vy = 0;
    update(game, DT);
  }
  assert.ok(p.shield < atEdge,
    'a wingtip inside the field cost nothing — the hitbox is not being used');

  // ...and nothing once clear of it
  p.y = FIELD_BOT - 30;
  p.shield = p.shieldMax;
  const clear = p.shield;
  for (let i = 0; i < 60; i++) {
    onlyThis(game);
    p.x = field.x + 200; p.y = FIELD_BOT - 30; p.vx = 0; p.vy = 0;
    update(game, DT);
  }
  assert.equal(p.shield, clear, 'the ship paid for a field it was not in');
});

test('the four fields are told apart by what they cost', () => {
  // Same shape, same question, different price — otherwise three of them
  // are reskins.
  const rates = Object.values(HAZARDS).map((h) => h.dps);
  assert.equal(new Set(rates).size, rates.length,
    `two hazard kinds cost the same: ${rates.join(', ')}`);
});

// --------------------------------------------------------- colour schemes
//
// COL is the instrument palette — the HUD, the menus, the frames — and
// not the hull, which THEMES colours per hull. A scheme rewrites COL in
// place so the roughly three hundred places that read COL.cool need to
// know nothing about schemes existing.

import { SCHEMES, applyScheme, COL } from '../src/config.js';

test('every scheme is complete, named, and a real palette', () => {
  assert.ok(SCHEMES.length >= 5, `${SCHEMES.length} schemes; four alternatives were asked for`);
  const keys = Object.keys(SCHEMES[0].col);
  const ids = new Set();
  for (const s of SCHEMES) {
    assert.ok(!ids.has(s.id), `two schemes share the id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.name && s.name === s.name.toUpperCase(), `${s.id} has no display name`);
    assert.ok(s.blurb && s.blurb.length > 10, `${s.id} does not say what it is`);
    assert.deepEqual(Object.keys(s.col).sort(), [...keys].sort(),
      `${s.id} does not define the same colours as the others`);
    for (const [k, v] of Object.entries(s.col)) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(v), `${s.id}.${k} is "${v}", not a colour`);
    }
  }
});

test('the schemes are actually different from each other', () => {
  // Five names over one palette would be a setting that does nothing.
  const sigs = SCHEMES.map((s) => Object.values(s.col).join(','));
  assert.equal(new Set(sigs).size, SCHEMES.length, 'two schemes are the same palette');
  // and distinguishable where it counts: the accent you read the HUD by
  const accents = SCHEMES.map((s) => s.col.cool);
  assert.equal(new Set(accents).size, SCHEMES.length, 'two schemes share an accent');
});

test('applying a scheme rewrites the palette everyone already holds', () => {
  const held = COL;                     // what a module captured at import
  const first = applyScheme(0);
  assert.equal(COL.cool, SCHEMES[0].col.cool);
  for (let i = 1; i < SCHEMES.length; i++) {
    applyScheme(i);
    assert.equal(COL.cool, SCHEMES[i].col.cool, `scheme ${i} did not take`);
    assert.equal(held.cool, SCHEMES[i].col.cool,
      'the palette was replaced rather than rewritten, so held references are stale');
    assert.equal(held, COL, 'COL is a different object after a scheme change');
  }
  applyScheme(0);
  assert.equal(COL.cool, first.col.cool);
});

test('a scheme index out of range is clamped, not crashed into', () => {
  for (const bad of [-5, 99, NaN, 1.7]) {
    const s = applyScheme(bad);
    assert.ok(s && s.id, `applyScheme(${bad}) returned nothing`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(COL.cool), `applyScheme(${bad}) left COL broken`);
  }
  applyScheme(0);
});

test('the scheme setting offers every scheme and wraps', () => {
  const def = settings.DEFS.find((d) => d.id === 'scheme');
  assert.ok(def, 'no colour scheme setting');
  assert.equal(def.def, 0, 'the default must be the palette that shipped');
  const was = settings.get('scheme');
  try {
    settings.set('scheme', SCHEMES.length - 1);
    settings.nudge('scheme', 1, {});
    assert.equal(settings.get('scheme'), 0, 'the scheme list does not wrap forward');
    settings.nudge('scheme', -1, {});
    assert.equal(settings.get('scheme'), SCHEMES.length - 1, 'the scheme list does not wrap back');
    // and the display names the scheme rather than printing an index
    settings.set('scheme', 1);
    assert.ok(settings.display(def, null).includes(SCHEMES[1].name),
      `the settings row shows "${settings.display(def, null)}"`);
  } finally {
    settings.set('scheme', was);
  }
});

test('changing the setting changes the live palette', () => {
  const was = settings.get('scheme');
  try {
    settings.set('scheme', 0);
    const base = COL.cool;
    settings.set('scheme', 2);
    assert.notEqual(COL.cool, base, 'setting a scheme did not reach COL');
    assert.equal(COL.cool, SCHEMES[2].col.cool);
  } finally {
    settings.set('scheme', was);
  }
});

// ------------------------------------------------- the on-screen controls
//
// A phone has no keyboard. The buttons drive the same input sets the
// keyboard does, so the only things that can be wrong here are the ones
// a browser would have to show you: a button you can see and cannot
// press, two that overlap, or one off the edge of the screen.

import { PADS, MIN_TOUCH, hitBox, padAt, padsFor } from '../src/touch.js';
import { VIEW_W, VIEW_H, HUD_Y } from '../src/config.js';

test('every on-screen control is big enough for a thumb', () => {
  for (const b of PADS) {
    const r = hitBox(b);
    assert.ok(r.w >= MIN_TOUCH && r.h >= MIN_TOUCH,
      `${b.id} is ${r.w}x${r.h} logical px, under the ${MIN_TOUCH} floor`);
  }
});

test('no two controls on screen at once overlap', () => {
  // Overlapping hit boxes mean a thumb lands on whichever happens to be
  // first in the list, which is the kind of bug that only shows up as
  // "the controls feel wrong".
  for (const state of ['play', 'title', 'levelclear', 'gameover', 'dying']) {
    const list = padsFor(state);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = hitBox(list[i]);
        const b = hitBox(list[j]);
        const over = a.x < b.x + b.w && b.x < a.x + a.w
          && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!over,
          `in ${state}, ${list[i].id} and ${list[j].id} overlap`);
      }
    }
  }
});

test('every control is on the screen', () => {
  for (const b of PADS) {
    const r = hitBox(b);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= VIEW_W && r.y + r.h <= VIEW_H,
      `${b.id} sits at ${r.x},${r.y} ${r.w}x${r.h}, off a ${VIEW_W}x${VIEW_H} screen`);
    // ...and not over the HUD, which is the one thing a player reads
    // while both thumbs are busy.
    assert.ok(r.y + r.h <= HUD_Y + 2,
      `${b.id} reaches ${r.y + r.h}, over the HUD at ${HUD_Y}`);
  }
});

test('flying and menus get the controls they need', () => {
  const flying = padsFor('play').map((b) => b.id);
  for (const need of ['left', 'right', 'up', 'down', 'fire', 'pause']) {
    assert.ok(flying.includes(need), `nothing to ${need} with while flying`);
  }
  assert.ok(!flying.includes('start'), 'the START button is up during a run');

  for (const state of ['title', 'gameover', 'levelclear']) {
    const menu = padsFor(state).map((b) => b.id);
    assert.ok(menu.includes('start'),
      `no way to start anything from ${state} without a keyboard`);
    assert.ok(menu.includes('pause'),
      `no way out of ${state} without a keyboard`);
    assert.ok(!menu.includes('fire'), `the fire button is up on ${state}`);
  }
});

test('hit testing answers the control that was drawn there', () => {
  for (const state of ['play', 'title']) {
    for (const b of padsFor(state)) {
      const r = hitBox(b);
      // the middle, and just inside each corner
      assert.equal(padAt(state, b.x, b.y)?.id, b.id, `${b.id} misses at its centre`);
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const px = r.x + r.w / 2 + dx * (r.w / 2 - 1);
        const py = r.y + r.h / 2 + dy * (r.h / 2 - 1);
        assert.equal(padAt(state, px, py)?.id, b.id, `${b.id} misses just inside its corner`);
      }
    }
  }
  assert.equal(padAt('play', 320, 120), null, 'the open playfield reported a button');
});

test('a control only answers in the states it belongs to', () => {
  const fire = PADS.find((b) => b.id === 'fire');
  assert.ok(padAt('play', fire.x, fire.y), 'the fire button is dead while flying');
  assert.equal(padAt('title', fire.x, fire.y), null,
    'the fire button is live on the title, where it is not drawn');
});

test('the touch setting offers auto, on and off', () => {
  const def = settings.DEFS.find((d) => d.id === 'touch');
  assert.ok(def, 'no on-screen controls setting');
  assert.equal(def.def, 0, 'the default must be AUTO');
  assert.deepEqual(settings.TOUCH_MODES, ['AUTO', 'ON', 'OFF']);
});

test('the buttons press and release like keys', async () => {
  const input = await import('../src/input.js');
  const { touchDown, touchUp, touchClear, held, touchHeld, endFrame, tapped } = input;
  touchClear();
  endFrame();

  touchDown(1, 'fire');
  assert.equal(held('fire'), true, 'a finger down did not hold the action');
  assert.equal(touchHeld('fire'), true, 'the button does not know it is lit');
  assert.equal(tapped('fire'), true, 'a finger down did not register as a press');
  endFrame();
  assert.equal(tapped('fire'), false, 'the press repeated on the next frame');
  assert.equal(held('fire'), true, 'the hold did not survive the frame');

  touchUp(1);
  assert.equal(held('fire'), false, 'lifting the finger left the gun firing');
  assert.equal(touchHeld('fire'), false, 'the button is still lit with nothing on it');

  // Two fingers on buttons for the same action: lifting one must not
  // release it while the other is still down.
  touchDown(1, 'right');
  touchDown(2, 'right');
  touchUp(1);
  assert.equal(held('right'), true, 'one of two fingers let go of the action');
  touchUp(2);
  assert.equal(held('right'), false, 'the last finger up did not release it');

  // Sliding from one button to the next steers rather than sticking.
  touchDown(3, 'left');
  touchUp(3);
  touchDown(3, 'up');
  assert.equal(held('left'), false, 'sliding off a button left it held');
  assert.equal(held('up'), true, 'sliding onto a button did not press it');

  // Losing the pointer entirely — the browser taking the gesture, the
  // tab losing focus — has to let go of everything.
  touchDown(4, 'down');
  touchClear();
  for (const a of ['left', 'right', 'up', 'down', 'fire']) {
    assert.equal(held(a), false, `${a} survived a touch clear`);
  }
  // ...and an unknown pointer id is not an error
  touchUp(99);
  endFrame();
});

// ---------------------------------------------------------- key remapping
//
// The live map is the defaults with the player's bindings over the top.
// What must hold: a rebind takes the key off whatever had it, the keys
// that must keep working cannot be taken, and nothing a hand-edited
// store says can break the map.

import {
  DEFAULT_MAP, MAP, BINDABLE, rebind, resetBindings, keyFor, isBindable, isFixedKey,
} from '../src/input.js';

test('every bindable action is a real action, and the fixed ones are not listed', () => {
  const actions = new Set(Object.values(DEFAULT_MAP));
  for (const [action, label] of BINDABLE) {
    assert.ok(actions.has(action), `${action} is bindable but nothing maps to it`);
    assert.ok(label && label === label.toUpperCase(), `${action} has no readable label`);
  }
  // start must never be rebindable: it is the way back in when
  // everything else has been bound to the wrong thing.
  assert.ok(!isBindable('start'), 'START can be rebound, so it can be lost');
  assert.ok(isFixedKey('Enter'), 'ENTER is not protected');
  assert.ok(!isBindable('wipe') && !isBindable('wipeall'),
    'an irreversible key can be bound to something reached for in flight');
});

test('a rebind moves the action and takes the key off the old one', () => {
  resetBindings();
  try {
    const wasFire = keyFor('fire');
    assert.ok(rebind('fire', 'KeyG'), 'a free key was refused');
    assert.equal(keyFor('fire'), 'KeyG');
    assert.equal(MAP.KeyG, 'fire', 'the live map did not take the binding');
    assert.notEqual(MAP[wasFire], 'fire', 'the old key still fires');

    // Binding a key that another action is using takes it away, rather
    // than leaving one key doing two things.
    assert.ok(rebind('cycle', 'KeyG'));
    assert.equal(MAP.KeyG, 'cycle');
    assert.notEqual(keyFor('fire'), 'KeyG', 'two actions share a key');
  } finally { resetBindings(); }
});

test('the keys that must keep working cannot be taken', () => {
  resetBindings();
  try {
    assert.equal(rebind('fire', 'Enter'), false, 'FIRE was bound onto ENTER');
    assert.equal(MAP.Enter, 'start', 'ENTER stopped starting things');
    assert.equal(rebind('left', 'KeyK'), false, 'MOVE LEFT was bound onto the hangar wipe');
    assert.equal(rebind('start', 'KeyG'), false, 'START was rebound');
    assert.equal(rebind('fire', ''), false, 'an empty key was accepted');
  } finally { resetBindings(); }
});

test('resetting puts every default back', () => {
  rebind('fire', 'KeyG');
  rebind('up', 'KeyI');
  resetBindings();
  assert.deepEqual({ ...MAP }, { ...DEFAULT_MAP },
    'resetting the controls did not restore the shipped map');
});

test('a rebind never leaves the map without the action', () => {
  // Every bindable action must still be reachable by some key after any
  // sequence of rebinds, or a player can lose the ability to fire.
  resetBindings();
  try {
    for (const [action] of BINDABLE) rebind(action, 'Key' + action[0].toUpperCase());
    for (const [action] of BINDABLE) {
      const code = keyFor(action);
      assert.ok(code, `${action} ended up bound to nothing`);
      assert.equal(MAP[code], action, `${action} says ${code} but the map disagrees`);
    }
  } finally { resetBindings(); }
});
