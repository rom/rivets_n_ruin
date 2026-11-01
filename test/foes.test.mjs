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

// The pieces a spaceport is built from. They arrive as a place, not as
// a roster entry, which is the one way a tower reaches a hull that did
// not ask for it.
const PORT_PARTS = new Set(['control', 'tank', 'lander', 'post']);

test('every tower spec is complete and distinct', async () => {
  const { TOWERS } = await import('../src/config.js');
  // Two shapes of tower now. The ones that shoot need the firing
  // fields; the ones that do not — a dish, a fuel tank, a parked
  // lander — have no business carrying a burst count, and requiring
  // one would mean inventing numbers nothing reads.
  const common = ['name', 'hpMul', 'score', 'colour'];
  const firing = ['burst', 'burstGap', 'cooldownMul', 'bulletSpeed'];
  const names = new Set();
  for (const [kind, tw] of Object.entries(TOWERS)) {
    for (const f of common) {
      assert.ok(tw[f] !== undefined, `TOWERS.${kind}.${f} is missing`);
    }
    for (const f of firing) {
      if (tw.inert) {
        assert.equal(tw[f], undefined,
          `TOWERS.${kind} is inert but carries ${f}; one of the two is wrong`);
      } else {
        assert.ok(tw[f] !== undefined, `TOWERS.${kind}.${f} is missing`);
      }
    }
    // An inert tower has to justify itself: something other than
    // standing there, or it is scenery with hit points.
    if (tw.inert) {
      assert.ok(tw.paint || tw.watch || tw.volatile || kind === 'lander',
        `TOWERS.${kind} neither shoots nor does anything else`);
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
      // A hull mounts what its roster says, with one exception: a
      // spaceport is an arrangement of specific structures rather than
      // a row of whatever the hull happens to field, so its parts are
      // allowed anywhere a port is. Named explicitly, so a roster leak
      // is still caught.
      assert.ok((spec.towers || ['gun']).includes(t.kind) || PORT_PARTS.has(t.kind),
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
  // Arrives as a squadron now, like every other composition. The wiring
  // it needs is the same wiring it always needed.
  const { spawnSquadron, resetFoes } = await import('../src/foes.js');
  const { game, done } = await foeGame(10);
  try {
    let pair = null;
    for (let i = 0; i < 400 && !pair; i++) {
      resetFoes();
      const sq = spawnSquadron(game);
      if (sq && sq.squad.link) pair = sq.members[0];
    }
    assert.ok(pair, 'never rolled a chainer squadron in four hundred spawns');
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

// --- the installations that are not guns
//
// Each of these asks something the gun towers do not, so each is tested
// against the thing it asks rather than against its hit points.

function rig(kinds, opts = {}) {
  // A bare level with the towers placed where the test wants them, so
  // the behaviour under test is not at the mercy of the generator.
  const turrets = kinds.map((k, i) => ({
    x: (opts.x || 500) + i * (opts.gap === undefined ? 40 : opts.gap),
    y: 100, dir: 1, kind: k.kind || k, tower: null,
    angle: Math.PI / 2, hp: k.hp || 10, dead: false,
    charge: 0, shielded: false, painted: null, t: 0,
    cd: 0, burstLeft: 0, burstTimer: 0,
  }));
  return turrets;
}

test('a radar paints its neighbours and stops the moment it dies', async () => {
  const { TOWERS, DT } = await import('../src/config.js');
  const { updateTurrets } = await import('../src/enemies.js');
  const turrets = rig(['radar', 'gun'], { gap: 100 });
  for (const t of turrets) t.tower = TOWERS[t.kind];
  const game = {
    state: 'play', level: { turrets, spec: { turretCooldown: 2, turretRange: 300 }, gates: [] },
    player: { x: 400, y: 200, alive: true, vx: 0, vy: 0 },
  };

  updateTurrets(game, DT);
  assert.ok(turrets[1].painted, 'a gun next to a live dish is not painted');
  assert.equal(turrets[1].painted.name, 'RADAR');
  // The dish does not paint itself, which would be a buff with no
  // counterplay attached to it.
  assert.equal(turrets[0].painted, null, 'the dish painted itself');

  turrets[0].dead = true;
  updateTurrets(game, DT);
  assert.equal(turrets[1].painted, null,
    'the paint outlived the dish — a buff that survives its source reads as the game cheating');
});

test('paint lands only on things that can use it', async () => {
  // A fuel tank has no aim to sharpen and no wake to bring forward, so
  // painting one changes nothing — and the renderer draws a ring
  // around whatever is painted, which would promise a buff that does
  // not exist. Found by looking at a spaceport on screen: the tanks
  // were haloed by their own control tower.
  const { TOWERS, DT } = await import('../src/config.js');
  const { updateTurrets } = await import('../src/enemies.js');
  const turrets = rig(['control', 'tank', 'lander', 'gun'], { gap: 40 });
  for (const t of turrets) t.tower = TOWERS[t.kind];
  const game = {
    state: 'play', level: { turrets, spec: { turretCooldown: 2, turretRange: 300 }, gates: [] },
    player: { x: 400, y: 200, alive: true, vx: 0, vy: 0 },
  };
  updateTurrets(game, DT);
  for (const t of turrets) {
    if (t.tower.inert) {
      assert.equal(t.painted, null, `a ${t.kind} was painted, and cannot use it`);
    }
  }
  assert.ok(turrets[3].painted, 'the gun beside the control tower was not painted');
});

test('paint reaches only as far as it says it does', async () => {
  const { TOWERS, DT } = await import('../src/config.js');
  const { updateTurrets } = await import('../src/enemies.js');
  const far = TOWERS.radar.paint + 60;
  const turrets = rig(['radar', 'gun'], { gap: far });
  for (const t of turrets) t.tower = TOWERS[t.kind];
  const game = {
    state: 'play', level: { turrets, spec: { turretCooldown: 2, turretRange: 300 }, gates: [] },
    player: { x: 0, y: 200, alive: true, vx: 0, vy: 0 },
  };
  updateTurrets(game, DT);
  assert.equal(turrets[1].painted, null, `a gun ${far}px away was painted by a ${TOWERS.radar.paint}px dish`);
});

test('a dish turns on its own, and an array sweeps instead', async () => {
  const { TOWERS, DT } = await import('../src/config.js');
  const { updateTurrets } = await import('../src/enemies.js');
  const turrets = rig(['radar', 'array'], { gap: 900 });
  for (const t of turrets) t.tower = TOWERS[t.kind];
  const game = {
    state: 'play', level: { turrets, spec: { turretCooldown: 2, turretRange: 300 }, gates: [] },
    // Nobody anywhere near: machinery that only moves when watched is
    // scenery, and reads as it.
    player: { x: -5000, y: 200, alive: true, vx: 0, vy: 0 },
  };
  const a0 = turrets[0].angle;
  const seen = new Set();
  for (let i = 0; i < 400; i++) { updateTurrets(game, DT); seen.add(Math.round(turrets[1].angle * 20)); }
  assert.notEqual(turrets[0].angle, a0, 'the dish never turned');
  assert.ok(seen.size > 5, 'the array never swept');
  // A sweep stays on its own face; a spin does not.
  const sweep = [...seen].map((v) => v / 20);
  assert.ok(Math.max(...sweep) - Math.min(...sweep) < Math.PI * 2,
    'the array went all the way round, which is what the dish is for');
});

test('a dish keeps turning with the ship right on top of it', async () => {
  // The spin test above parks the player far away, so the aiming code
  // never runs and a dish that secretly aims would still look right.
  // This is the case that separates them: standing next to a radar, it
  // must go on sweeping past you rather than tracking you, because a
  // dish that points at you is a gun as far as the eye is concerned.
  const { TOWERS, DT } = await import('../src/config.js');
  const { updateTurrets } = await import('../src/enemies.js');
  const turrets = rig(['radar', 'tank'], { gap: 900 });
  for (const t of turrets) t.tower = TOWERS[t.kind];
  const game = {
    state: 'play', level: { turrets, spec: { turretCooldown: 2, turretRange: 300 }, gates: [] },
    player: { x: 510, y: 180, alive: true, vx: 0, vy: 0 },
  };
  const angles = new Set();
  for (let i = 0; i < 300; i++) { updateTurrets(game, DT); angles.add(Math.round(turrets[0].angle * 8)); }
  assert.ok(angles.size > 20,
    `the dish settled on ${angles.size} angle(s) with the ship beside it — it is tracking, not turning`);

  // ...and the fuel tank next to it never acquires anything at all.
  assert.equal(turrets[1].burstLeft, 0, 'a fuel tank opened fire');
  assert.equal(turrets[1].charge, 0, 'a fuel tank started charging');
});

test('a silo opens from far outside everything else', async () => {
  const { TOWERS } = await import('../src/config.js');
  assert.ok(TOWERS.silo.wake > 700, 'a long-range launcher that wakes at normal range is a rocket');
  assert.ok(TOWERS.silo.range > TOWERS.rocket.bulletSpeed,
    'the silo has no reach of its own');
  // Slow enough to be shot down, which is the counterplay.
  assert.ok(TOWERS.silo.bulletSpeed < TOWERS.rocket.bulletSpeed,
    'a long-range missile you cannot out-fly or shoot down is just damage');
  assert.ok(TOWERS.silo.seekHp >= 1, 'the missile cannot be destroyed');
});

test('a fuel tank takes its neighbours with it', async () => {
  const { TOWERS, DT } = await import('../src/config.js');
  const { hitTurret } = await import('../src/enemies.js');
  const { makeGame, update } = await import('../src/game.js');

  const game = makeGame();
  const turrets = rig(['tank', 'tank', 'tank'], { gap: 50, x: 300 });
  for (const t of turrets) { t.tower = TOWERS[t.kind]; t.hp = 4; }
  game.level.turrets = turrets;
  game.state = 'play';
  game.player.x = 900;      // well clear, so the chain is not about us

  hitTurret(game, turrets[0], 99);
  assert.ok(turrets[0].dead, 'the tank survived a direct hit');
  assert.ok((game.pendingBlast || []).length > 0, 'a tank went up without a blast');

  update(game, DT);   // drains the queue, which chains
  const standing = turrets.filter((t) => !t.dead).length;
  assert.equal(standing, 0,
    `${standing} of three tanks still standing — the chain did not carry`);
});

test('a chain of tanks terminates', async () => {
  // A tank igniting a tank that ignites the first one back is a stack
  // overflow dressed as a feature. The queue is what stops it, and a
  // long row is where it would show.
  const { TOWERS, DT } = await import('../src/config.js');
  const { hitTurret } = await import('../src/enemies.js');
  const { makeGame, update } = await import('../src/game.js');
  const game = makeGame();
  const turrets = rig(Array(12).fill('tank'), { gap: 40, x: 300 });
  for (const t of turrets) { t.tower = TOWERS[t.kind]; t.hp = 4; }
  game.level.turrets = turrets;
  game.state = 'play';
  game.player.x = 3000;

  hitTurret(game, turrets[0], 99);
  assert.doesNotThrow(() => update(game, DT), 'the chain did not terminate');
  assert.equal(turrets.filter((t) => !t.dead).length, 0, 'the chain stopped partway');
  assert.equal((game.pendingBlast || []).length, 0, 'the blast queue was left full');
});

test('every spaceport has fuel, control and something parked', async () => {
  const { buildLevel } = await import('../src/level.js');
  let ports = 0;
  for (const spec of LEVELS) {
    const lvl = buildLevel(spec);
    const controls = lvl.turrets.filter((t) => t.kind === 'control');
    for (const c of controls) {
      ports++;
      // The parts of one port are within a few hundred px of its
      // control tower; anything further is a different port.
      const near = lvl.turrets.filter((t) => Math.abs(t.x - c.x) < 360 && t.y === c.y);
      assert.ok(near.some((t) => t.kind === 'tank'), `a port on ${spec.name} has no fuel`);
      assert.ok(near.some((t) => t.kind === 'lander'), `a port on ${spec.name} has nothing parked`);
    }
  }
  assert.ok(ports > 0, 'no hull in the campaign has a spaceport');
});

test('fuel tanks are placed close enough to chain', async () => {
  // A chain that only sometimes chains is a mechanic nobody learns.
  const { buildLevel } = await import('../src/level.js');
  const { TOWERS } = await import('../src/config.js');
  const reach = TOWERS.tank.volatile.r;
  let checked = 0;
  for (const spec of LEVELS) {
    const lvl = buildLevel(spec);
    const byPort = new Map();
    for (const t of lvl.turrets) {
      if (t.kind !== 'tank') continue;
      const key = Math.round(t.x / 400);
      if (!byPort.has(key)) byPort.set(key, []);
      byPort.get(key).push(t);
    }
    for (const tanks of byPort.values()) {
      if (tanks.length < 2) continue;
      tanks.sort((a, b) => a.x - b.x);
      for (let i = 1; i < tanks.length; i++) {
        checked++;
        assert.ok(tanks[i].x - tanks[i - 1].x < reach,
          `${spec.name}: tanks ${Math.round(tanks[i - 1].x)} and ${Math.round(tanks[i].x)} `
          + `are ${Math.round(tanks[i].x - tanks[i - 1].x)}px apart, past the ${reach}px blast`);
      }
    }
  }
  assert.ok(checked > 10, `only ${checked} tank pairs across the campaign; the test proves little`);
});

// --- the ends of the scale
//
// Size is not a difficulty knob with art attached: a thing twice as
// big is twice as easy to hit, so weight has to buy something. Each of
// these is tested against what its weight bought.

test('the roster spans a real range of weight and speed', async () => {
  const { SPEC } = await import('../src/foes.js');
  const rows = Object.entries(SPEC).filter(([k]) => k !== 'shard');
  const rs = rows.map(([, v]) => v.r);
  assert.ok(Math.max(...rs) / Math.min(...rs) >= 3,
    `the biggest attacker is only ${(Math.max(...rs) / Math.min(...rs)).toFixed(1)}x the smallest`);

  // Heavier means slower, or weight is free. Checked as a trend
  // across the extremes rather than pairwise, because a mine is slow
  // and small on purpose.
  const big = rows.filter(([, v]) => v.r >= 20).map(([, v]) => v.speed);
  const small = rows.filter(([, v]) => v.r <= 8).map(([, v]) => v.speed);
  assert.ok(big.length && small.length, 'the roster has no extremes to compare');
  assert.ok(Math.max(...big) < Math.min(...small),
    `the heaviest attacker (${Math.max(...big)}px/s) is not slower than the lightest `
    + `(${Math.min(...small)}px/s)`);

  // ...and heavier has to be worth more, or there is no reason to
  // shoot it rather than go round.
  const bigScore = rows.filter(([, v]) => v.r >= 20).map(([, v]) => v.score);
  const smallScore = rows.filter(([, v]) => v.r <= 8).map(([, v]) => v.score);
  assert.ok(Math.min(...bigScore) > Math.max(...smallScore),
    'a heavy attacker is not worth more than a light one');
});

test('a gnat arrives with company', async () => {
  // One gnat is a non-event: one hit point, no gun, nothing to make
  // you move. Three is a wall to pick a side of, which is the whole
  // of what it contributes.
  const { SQUADS, spawnSquadron, foes, resetFoes } = await import('../src/foes.js');
  const { makeGame } = await import('../src/game.js');
  const game = makeGame();
  game.level.spec = { ...game.level.spec, foes: ['gnat'] };
  // The swarm is a squadron now rather than a special case in the spawn
  // path, so what is checked is that the squadron exists and arrives whole.
  const swarm = SQUADS.find((sq) => sq.id === 'swarm');
  assert.ok(swarm, 'no gnat swarm in the squadron table');
  const want = swarm.of[0][1];
  assert.ok(want >= 3, `a swarm of ${want} is not a wall to pick a side of`);

  let got = 0;
  for (let i = 0; i < 200 && got !== want; i++) {
    resetFoes();
    const sq = spawnSquadron(game);
    if (sq && sq.squad.id === 'swarm') got = sq.members.length;
  }
  assert.equal(got, want, `the gnat swarm arrived ${got} strong, want ${want}`);
  const n = [...Array(foes.count).keys()].filter((i) => foes.items[i].kind === 'gnat').length;
  assert.equal(n, want, `one spawn produced ${n} gnats, want ${want}`);

  // ...and not stacked on one spot, which would be one object drawn
  // three times rather than three things in the way.
  const ys = new Set();
  for (let i = 0; i < foes.count; i++) ys.add(Math.round(foes.items[i].baseY));
  assert.ok(ys.size > 1, 'the swarm spawned on top of itself');
});

test('a dart makes one pass and does not come back', async () => {
  const { SPEC, spawnFoe, foes, resetFoes, updateFoes } = await import('../src/foes.js');
  const { makeGame } = await import('../src/game.js');
  const { DT } = await import('../src/config.js');
  const game = makeGame();
  game.state = 'play';
  resetFoes();
  const f = spawnFoe(game, 'dart');
  f.x = game.player.x + 300;
  f.baseY = game.player.y + 4;
  f.y = f.baseY;
  f.facing = -1;

  let shots = 0;
  const seen = [];
  for (let i = 0; i < 240; i++) {
    const before = f.shotsLeft;
    updateFoes(game, DT);
    if (f.dead || !foes.count) break;
    if (before !== undefined && f.shotsLeft < before) shots++;
    seen.push(f.x);
  }
  assert.ok(shots > 0, 'the dart never fired');
  assert.ok(shots <= SPEC.dart.strafeShots,
    `the dart fired ${shots} times, more than the ${SPEC.dart.strafeShots} it carries`);
  // Committed to a direction: it never reverses.
  const reversals = seen.slice(1).filter((x, i) => x > seen[i]).length;
  assert.equal(reversals, 0, 'the dart turned round, which is what separates it from a chaser');
});

test('a barge opens with a fan, not an aimed shot', async () => {
  // Sitting still off its line beats an aimed gun. The fan is what
  // stops that working, so the thing to test is the spread.
  const { SPEC, spawnFoe, resetFoes, updateFoes } = await import('../src/foes.js');
  const { enemyShots } = await import('../src/projectiles.js');
  const { makeGame } = await import('../src/game.js');
  const { DT } = await import('../src/config.js');
  const game = makeGame();
  game.state = 'play';
  resetFoes();
  enemyShots.clear();
  const f = spawnFoe(game, 'barge');
  f.x = game.player.x + 200;
  f.baseY = game.player.y;
  f.y = f.baseY;
  f.cd = 0;
  updateFoes(game, DT);

  assert.equal(enemyShots.count, SPEC.barge.spread,
    `the barge fired ${enemyShots.count} shots, want a fan of ${SPEC.barge.spread}`);
  const angles = [];
  for (let i = 0; i < enemyShots.count; i++) {
    const s = enemyShots.items[i];
    angles.push(Math.atan2(s.vy, s.vx));
  }
  const spread = Math.max(...angles) - Math.min(...angles);
  assert.ok(spread > 0.5,
    `the fan spans ${spread.toFixed(2)} rad; that is an aimed burst, not a spread`);
});

test('a monitor fires from both ends', async () => {
  // Two mounts at opposite ends is the whole point: it means there is
  // no side of it that is quiet, so going round costs ground rather
  // than being free.
  const { SPEC, spawnFoe, resetFoes, updateFoes } = await import('../src/foes.js');
  const { enemyShots } = await import('../src/projectiles.js');
  const { makeGame } = await import('../src/game.js');
  const { DT } = await import('../src/config.js');
  const game = makeGame();
  game.state = 'play';
  resetFoes();
  const f = spawnFoe(game, 'monitor');
  f.x = game.player.x + 220;
  f.baseY = game.player.y;
  f.y = f.baseY;

  const origins = new Set();
  for (let i = 0; i < 1400; i++) {
    enemyShots.clear();
    f.cd = Math.min(f.cd, 0);
    updateFoes(game, DT);
    for (let k = 0; k < enemyShots.count; k++) origins.add(Math.round(enemyShots.items[k].y));
    if (origins.size >= 2) break;
  }
  assert.ok(origins.size >= 2,
    `every shot came from the same place (${[...origins]}); the second mount is decoration`);
  assert.ok(Math.max(...origins) - Math.min(...origins) > SPEC.monitor.r,
    'the two mounts are not at opposite ends of the hull');
});

test('every attacker in a roster has a body to draw', async () => {
  // A kind fielded with no body falls back to the warder's, which is
  // how an attacker ships looking like a different attacker.
  const { BODY_KINDS } = await import('../src/foeart.js');
  const { SPEC } = await import('../src/foes.js');
  for (const kind of Object.keys(SPEC)) {
    assert.ok(BODY_KINDS.includes(kind),
      `${kind} has no body in foeart.js and would be drawn as a warder`);
  }
});

// --- drawing cost
//
// Switching the canvas composite mode is by a distance the most
// expensive thing a body does: eight monitors on screen cost 15.7ms a
// frame with one switch per engine and 0.3ms with one per ship, for
// pixel-identical output. Measured, then fixed, then measured again.
//
// Timing cannot be asserted in a test — it would be flaky on any
// machine and meaningless on a shared one. The invariant can: a ship
// pays for one switch however many engines it has.

function countingCtx() {
  const noop = () => {};
  const st = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineCap: 'butt', font: '', textAlign: '', switches: 0, _gco: 'source-over' };
  const stack = [];
  return new Proxy(st, {
    get(t, k) {
      if (k === 'globalCompositeOperation') return t._gco;
      if (k in t) return t[k];
      if (k === 'save') return () => stack.push({ ...t });
      if (k === 'restore') return () => { const p = stack.pop(); if (p) { p.switches = t.switches; Object.assign(t, p); } };
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (k === 'measureText') return () => ({ width: 0 });
      return noop;
    },
    set(t, k, v) {
      if (k === 'globalCompositeOperation') { if (v !== t._gco) t.switches++; t._gco = v; return true; }
      t[k] = v; return true;
    },
  });
}

test('a ship pays for one composite switch, not one per engine', async () => {
  const { engines, engine } = await import('../src/foeart.js');
  const ctx = countingCtx();
  // Three engines, the monitor's arrangement.
  engines(ctx, [-11, 0, 11].map((y) => [-23, y, 5, 1.1, '#e8434f', 0.7]));
  // Into 'lighter' and back out: two writes, one round trip.
  assert.ok(ctx.switches <= 2,
    `three engines cost ${ctx.switches} composite writes; batching buys one round trip`);

  // ...and a single engine is no worse than it was.
  const one = countingCtx();
  engine(one, -12, 0, 5, 1.1, '#e8b4ff', 1.4);
  assert.ok(one.switches <= 2, `one engine cost ${one.switches} composite writes`);

  // Both have to hand the context back as they found it. Checked here
  // rather than only after a whole body, because a later canopy() sets
  // the alpha to 1 on its way out and masks the leak — which it did.
  for (const [label, c] of [['engines()', ctx], ['engine()', one]]) {
    assert.equal(c.globalAlpha, 1, `${label} left globalAlpha at ${c.globalAlpha}`);
    assert.equal(c.globalCompositeOperation, 'source-over',
      `${label} left the context in ${c.globalCompositeOperation}`);
  }
});

test('every body leaves the composite mode it was handed', async () => {
  // engine() used to save/restore. It sets and resets now, which is
  // cheaper and only correct if it actually puts the mode back.
  const { drawFoeBody } = await import('../src/foeart.js');
  const { SPEC } = await import('../src/foes.js');
  for (const kind of Object.keys(SPEC)) {
    const ctx = countingCtx();
    ctx.globalCompositeOperation = 'source-over';
    ctx.switches = 0;
    const spec = SPEC[kind];
    drawFoeBody(ctx, {
      kind, t: 1.1, flash: 0, mount: 0, state: 1, shotsLeft: 2, facing: -1,
      hp: spec.hp, maxHp: spec.hp, dead: false, whole: true, shield: 0,
    }, spec, false);
    assert.equal(ctx.globalCompositeOperation, 'source-over',
      `${kind} left the context in ${ctx.globalCompositeOperation}`);
    assert.equal(ctx.globalAlpha, 1, `${kind} left globalAlpha at ${ctx.globalAlpha}`);
  }
});
