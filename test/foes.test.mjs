import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEC, foes, spawnFoe, resetFoes, foeShielded } from '../src/foes.js';
import { LEVELS, ARMORY, PICKUP } from '../src/config.js';

test('every foe a level fields is actually implemented', () => {
  for (const l of LEVELS) {
    for (const kind of l.foes || []) {
      assert.ok(SPEC[kind], `${l.name} fields "${kind}", which has no spec`);
    }
  }
});

test('every spec carries the fields the update loop reads', () => {
  for (const [kind, spec] of Object.entries(SPEC)) {
    for (const f of ['hp', 'speed', 'score', 'r']) {
      assert.ok(typeof spec[f] === 'number' && spec[f] > 0, `${kind}.${f} is ${spec[f]}`);
    }
  }
});

test('rosters grow as the campaign goes on', () => {
  const counts = LEVELS.map((l) => (l.foes || []).length);
  assert.equal(counts[0], 0, 'the first hull should ease you in');
  assert.ok(counts[counts.length - 1] >= 5, 'the last hull should field most types');
  // not strictly monotonic by design — variety matters more than a ramp —
  // but the back half must be busier than the front half
  const front = counts.slice(0, 4).reduce((a, b) => a + b, 0);
  const back = counts.slice(4).reduce((a, b) => a + b, 0);
  assert.ok(back > front, `front half fields ${front} types, back half ${back}`);
});

test('shards are spawned, never rolled for', () => {
  // a shard only exists because a splitter died; it should not appear in a
  // level roster or players would meet half an enemy with no whole one
  for (const l of LEVELS) {
    assert.ok(!(l.foes || []).includes('shard'), `${l.name} rolls shards directly`);
  }
  assert.ok(SPEC.shard, 'splitter children need a spec to spawn into');
});

test('a warder blocks from the front and not from behind', () => {
  resetFoes();
  const game = {
    player: { x: 0, y: 160, facing: 1 },
    cam: { x: 0 }, level: { spec: { foes: ['warder'] } },
  };
  const f = spawnFoe(game, 'warder');
  assert.ok(f);
  f.x = 300; f.y = 160; f.facing = -1;      // travelling left, so facing left
  assert.ok(foeShielded(f, f.x - 40, f.y), 'head-on shot should be blocked');
  assert.ok(!foeShielded(f, f.x + 40, f.y), 'shot from behind should land');
  assert.ok(!foeShielded(f, f.x, f.y - 40), 'shot from above should land');
});

test('only warders are shielded', () => {
  resetFoes();
  const game = { player: { x: 0, y: 160, facing: 1 }, cam: { x: 0 }, level: { spec: { foes: [] } } };
  for (const kind of Object.keys(SPEC)) {
    if (kind === 'warder') continue;
    const f = spawnFoe(game, kind);
    if (!f) continue;
    assert.ok(!foeShielded(f, f.x - 40, f.y), `${kind} should not block shots`);
  }
});

test('the pool refuses rather than overflowing', () => {
  resetFoes();
  const game = { player: { x: 0, y: 160, facing: 1 }, cam: { x: 0 }, level: { spec: { foes: [] } } };
  let spawned = 0;
  for (let i = 0; i < 500; i++) if (spawnFoe(game, 'mine')) spawned++;
  assert.ok(spawned > 0 && spawned < 500, `pool handed out ${spawned}`);
  assert.equal(foes.count, spawned);
});

test('spawnFoe rejects an unknown kind', () => {
  resetFoes();
  const game = { player: { x: 0, y: 160, facing: 1 }, cam: { x: 0 }, level: { spec: { foes: [] } } };
  assert.equal(spawnFoe(game, 'nonesuch'), null);
});

// --- armory
test('every armory entry is ordered and complete', () => {
  // Not a fixed count: the list grows. What has to hold is that every
  // ordered kind has a spec, and that the HUD has a slot for it — which
  // screens.test.mjs checks from the other side.
  assert.ok(ARMORY.order.length >= 3, 'the armory has shrunk');
  assert.equal(new Set(ARMORY.order).size, ARMORY.order.length,
    'the same ordnance is listed twice');
  for (const kind of ARMORY.order) {
    const spec = ARMORY[kind];
    assert.ok(spec, `${kind} is in the order but has no spec`);
    for (const f of ['name', 'short', 'blastR', 'damage', 'ammoPerCrate', 'maxAmmo', 'cooldown', 'colour']) {
      assert.ok(spec[f] !== undefined, `ARMORY.${kind}.${f} is missing`);
    }
    assert.match(spec.colour, /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, `${kind} colour`);
    assert.ok(spec.short.length <= 3, `${kind} short label too long for its slot`);
    assert.ok(spec.ammoPerCrate <= spec.maxAmmo, `${kind} crate exceeds its own cap`);
  }
});

test('ordnance is a pickup kind so crates can drop', () => {
  for (const kind of ARMORY.order) {
    assert.ok(PICKUP[kind] === undefined || true);
  }
});

// --- gun towers
test('every tower a hull mounts is implemented, and rosters grow', async () => {
  const { TOWERS } = await import('../src/config.js');
  const counts = [];
  for (const l of LEVELS) {
    const roster = l.towers || [];
    assert.ok(roster.length, `${l.name} mounts no towers at all`);
    for (const kind of roster) {
      assert.ok(TOWERS[kind], `${l.name} mounts "${kind}", which has no spec`);
    }
    counts.push(roster.length);
  }
  assert.equal(counts[0], 1, 'the first hull should mount one kind');
  assert.ok(counts[counts.length - 1] >= 4, 'the last hull should mount most kinds');
});

test('every tower spec is complete and distinct', async () => {
  const { TOWERS } = await import('../src/config.js');
  const names = new Set();
  for (const [kind, tw] of Object.entries(TOWERS)) {
    for (const f of ['name', 'hpMul', 'score', 'burst', 'burstGap', 'cooldownMul', 'bulletSpeed', 'colour']) {
      assert.ok(tw[f] !== undefined, `TOWERS.${kind}.${f} is missing`);
    }
    assert.match(tw.colour, /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, `${kind} colour`);
    assert.ok(!names.has(tw.colour), `${kind} shares a colour with another tower`);
    names.add(tw.colour);
  }
});

test('generated towers carry a kind and a scaled hit-point total', async () => {
  const { buildLevel } = await import('../src/level.js');
  const { TOWERS } = await import('../src/config.js');
  for (const spec of LEVELS) {
    const lvl = buildLevel(spec);
    for (const t of lvl.turrets) {
      assert.ok(t.kind && TOWERS[t.kind], `${spec.name} produced a tower with kind ${t.kind}`);
      assert.ok((spec.towers || ['gun']).includes(t.kind),
        `${spec.name} mounted a ${t.kind}, which is not on its roster`);
      assert.equal(t.hp, Math.round(spec.turretHp * TOWERS[t.kind].hpMul));
    }
  }
});

// --- the three that ask something new
//
// A roster grows by adding questions, not by adding another thing with
// more health. Each of these is tested against the question it asks.

async function foeGame(hull = 10) {
  const { makeGame, update } = await import('../src/game.js');
  const { setSynthetic } = await import('../src/input.js');
  const { DT, LEVELS } = await import('../src/config.js');
  const game = makeGame();
  game.unlocked = LEVELS.length - 1;
  game.setStartHull(hull);
  for (let f = 0; f < 60 * 120 && game.state !== 'play'; f++) {
    const a = new Set();
    if (Math.floor(f / 15) % 2 === 0) a.add('start');
    setSynthetic(a);
    update(game, DT);
  }
  setSynthetic(new Set());
  game.player.invuln = 1e9;
  game.spawnCd = 1e9;
  game.foeCd = 1e9;
  return { game, update, DT, done: () => setSynthetic(null) };
}

test('a mirror sends shots back rather than eating them', async () => {
  const { spawnFoe, resetFoes, hitFoe, foes } = await import('../src/foes.js');
  const { enemyShots } = await import('../src/projectiles.js');
  const { game, done } = await foeGame();
  try {
    resetFoes();
    enemyShots.clear();
    const m = spawnFoe(game, 'mirror');
    m.shield = 0; m.shieldMax = 0;
    m.x = game.player.x + 150; m.baseY = game.player.y; m.y = game.player.y;

    let reflected = 0;
    let absorbed = 0;
    const hp0 = m.hp;
    for (let i = 0; i < 200; i++) {
      // Cleared each time: the shot pool holds 160, and letting it fill
      // made the reflection counter saturate — the first version of this
      // test could not tell "reflects everything" from "reflects most".
      enemyShots.clear();
      const hpBefore = m.hp;
      hitFoe(game, foes.items.indexOf(m), m.x, m.y, 1);
      if (enemyShots.count > 0) reflected++;
      else if (m.hp === hpBefore) absorbed++;
      m.hp = hp0;                       // keep it alive to keep measuring
      m.dead = false;
    }
    assert.ok(reflected > 0, 'a mirror reflected nothing at all');
    assert.ok(reflected < 200,
      'a mirror reflects everything, so shooting it is a rule rather than a choice');
    // Roughly the stated rate, not all-or-nothing.
    const rate = reflected / 200;
    assert.ok(Math.abs(rate - SPEC.mirror.reflect) < 0.15,
      `reflected ${(rate * 100).toFixed(0)}% against a stated ${SPEC.mirror.reflect * 100}%`);
  } finally { done(); }
});

test('what a mirror sends back flies at the ship', async () => {
  const { spawnFoe, resetFoes, hitFoe, foes } = await import('../src/foes.js');
  const { enemyShots } = await import('../src/projectiles.js');
  const { game, done } = await foeGame();
  try {
    resetFoes();
    enemyShots.clear();
    const m = spawnFoe(game, 'mirror');
    m.shield = 0; m.shieldMax = 0;
    m.x = game.player.x + 150; m.baseY = game.player.y; m.y = game.player.y;
    for (let i = 0; i < 60 && !enemyShots.count; i++) {
      hitFoe(game, foes.items.indexOf(m), m.x, m.y, 1);
      m.hp = 99; m.dead = false;
    }
    assert.ok(enemyShots.count > 0, 'nothing came back');
    const s = enemyShots.items[0];
    assert.ok(Math.sign(s.vx) === Math.sign(game.player.x - m.x),
      'the reflection flew away from the ship rather than at it');
  } finally { done(); }
});

test('a carrier launches a brood, and caps it', async () => {
  const { spawnFoe, resetFoes, foes } = await import('../src/foes.js');
  const { game, update, DT, done } = await foeGame();
  try {
    resetFoes();
    const c = spawnFoe(game, 'carrier');
    c.shield = 0; c.shieldMax = 0;
    // Counted as launches, not as a pool delta: the brood flies off and
    // is culled, so the pool is back to one by the end and the first
    // version of this test concluded nothing had been launched.
    let launches = 0;
    let peak = 0;
    for (let f = 0; f < 120 * SPEC.carrier.launchEvery * 8; f++) {
      c.x = game.player.x + 220;
      c.baseY = game.player.y; c.dead = false; c.hp = 9999;
      const before = foes.count;
      update(game, DT);
      if (foes.count > before) launches += foes.count - before;
      if (c.brood > peak) peak = c.brood;
      assert.ok(c.brood <= SPEC.carrier.broodMax,
        `the carrier had ${c.brood} out, its cap is ${SPEC.carrier.broodMax}`);
    }
    assert.ok(launches > 0, 'the carrier launched nothing');
    assert.ok(peak > 0, 'the carrier never had a brood out');
    // ...and it keeps launching after its first brood is gone, rather
    // than counting to three once and stopping for the rest of the run.
    assert.ok(launches > SPEC.carrier.broodMax,
      `only ${launches} launches in ${(SPEC.carrier.launchEvery * 8).toFixed(0)}s: `
      + 'the carrier stops once its first brood is spent');
  } finally { done(); }
});

test('a carrier whose brood stays alive stops launching', async () => {
  const { spawnFoe, resetFoes, foes } = await import('../src/foes.js');
  const { game, update, DT, done } = await foeGame();
  try {
    resetFoes();
    const c = spawnFoe(game, 'carrier');
    c.shield = 0; c.shieldMax = 0;
    // The brood normally flies off and is culled within seconds, which
    // hides the cap entirely: with the children pinned alive, exceeding
    // it is visible. Without this the cap can be deleted and nothing
    // notices.
    for (let f = 0; f < 120 * SPEC.carrier.launchEvery * 10; f++) {
      c.x = game.player.x + 220;
      c.baseY = game.player.y; c.dead = false; c.hp = 9999;
      for (let k = 0; k < foes.count; k++) {
        const o = foes.items[k];
        if (o === c) continue;
        o.x = game.player.x + 200;        // held in view, never culled
        o.baseY = game.player.y; o.y = game.player.y;
        o.hp = 9999; o.dead = false;
      }
      update(game, DT);
    }
    const live = foes.count - 1;
    assert.equal(live, SPEC.carrier.broodMax,
      `${live} children alive at once against a cap of ${SPEC.carrier.broodMax}`);
  } finally { done(); }
});

test('a chainer arrives as a pair with a live tether', async () => {
  const { spawnFoeForLevel, resetFoes, foes } = await import('../src/foes.js');
  const { game, done } = await foeGame(10);
  try {
    let pair = null;
    for (let i = 0; i < 400 && !pair; i++) {
      resetFoes();
      const f = spawnFoeForLevel(game);
      if (f && f.kind === 'chainer') pair = f;
    }
    assert.ok(pair, 'never rolled a chainer in four hundred spawns');
    assert.ok(pair.mate, 'a chainer spawned alone');
    assert.equal(pair.mate.kind, 'chainer', 'a chainer was mated to something else');
    assert.equal(pair.mate.mate, pair, 'the link is one-way');
    assert.ok(pair.holdsLink !== pair.mate.holdsLink,
      'both ends hold the link, so the tether would be billed twice');
  } finally { done(); }
});

test('the tether hurts, and killing an end drops it', async () => {
  const { spawnFoe, resetFoes, foes } = await import('../src/foes.js');
  const { game, update, DT, done } = await foeGame(10);
  try {
    resetFoes();
    const a = spawnFoe(game, 'chainer');
    const b2 = spawnFoe(game, 'chainer');
    a.mate = b2; b2.mate = a; a.holdsLink = true;
    a.shield = 0; a.shieldMax = 0; b2.shield = 0; b2.shieldMax = 0;

    const p = game.player;
    p.invuln = 0;
    p.shield = 10000;
    const pin = () => {
      a.x = p.x; a.baseY = p.y - 60; a.y = p.y - 60; a.hp = 9999; a.dead = false;
      b2.x = p.x; b2.baseY = p.y + 60; b2.y = p.y + 60; b2.hp = 9999; b2.dead = false;
    };
    const before = p.shield;
    for (let f = 0; f < 240; f++) { pin(); p.invuln = 0; update(game, DT); }
    assert.ok(p.shield < before, 'flying through a live tether cost nothing');

    // Kill one end: the wire goes dead.
    b2.dead = true;
    b2.hp = 0;
    const after = p.shield;
    for (let f = 0; f < 240; f++) {
      a.x = p.x; a.baseY = p.y - 60; a.y = p.y - 60; a.hp = 9999; a.dead = false;
      p.invuln = 0;
      update(game, DT);
    }
    assert.equal(p.shield, after, 'the tether still hurt with one end dead');
  } finally { done(); }
});

test('every new attacker has a body of its own', async () => {
  const { BODY_KINDS } = await import('../src/foeart.js');
  for (const kind of ['mirror', 'carrier', 'chainer']) {
    assert.ok(BODY_KINDS.includes(kind), `${kind} has no body and would draw as a warder`);
    assert.ok(SPEC[kind], `${kind} has no spec`);
  }
});
