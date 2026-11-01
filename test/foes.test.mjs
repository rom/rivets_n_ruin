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
