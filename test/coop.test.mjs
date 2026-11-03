import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePool } from '../src/pool.js';
import { VIEW_W } from '../src/config.js';
import {
  encodeInput, decodeInput, encodeSnapshot, decodeSnapshot,
  setKinds, kindAt, INPUT_BITS, STATES, PICKUP_KINDS,
  MSG_INPUT, MSG_SNAPSHOT,
} from '../src/coop.js';

// The wire between two browsers.
//
// Everything here is about one property: what one side packed is what
// the other side unpacks. A codec that is wrong in the same way at
// both ends passes a round-trip test and fails in play, so the tests
// that matter are the ones that check against the *numbers* — a
// position, a count, a cap — rather than against the encoder's own
// opinion.

const KINDS = ['mine', 'lancer', 'orbiter', 'weaver', 'gnat', 'dart',
  'barge', 'monitor', 'netter', 'grapnel', 'scorcher', 'splitter'];
setKinds(KINDS);

function ship(over = {}) {
  return {
    x: 1000, y: 180, vx: 120, vy: -40, facing: 1, shield: 90,
    alive: true, flip: 0, thrusting: false, ...over,
  };
}

function fakeGame(over = {}) {
  return {
    cam: { x: 900 },
    state: 'play',
    score: 12345,
    lives: 3,
    levelIndex: 4,
    player: ship(),
    ...over,
  };
}

function pool(items) {
  const p = makePool(Math.max(1, items.length), () => ({}));
  for (const it of items) Object.assign(p.spawn(), it);
  return p;
}

const emptyPools = () => ({
  foes: pool([]), playerShots: pool([]), enemyShots: pool([]), pickups: pool([]),
});

// --- input

test('an input frame survives the wire', () => {
  for (const held of [
    new Set(),
    new Set(['fire']),
    new Set(INPUT_BITS),
    new Set(['left', 'up', 'jump']),
  ]) {
    const buf = encodeInput(7, held);
    assert.equal(new DataView(buf).getUint8(0), MSG_INPUT, 'wrong tag');
    const got = decodeInput(buf);
    assert.equal(got.tick, 7);
    assert.deepEqual([...got.held].sort(), [...held].sort());
  }
});

test('an input frame is five bytes whatever is held', () => {
  // Sixty a second, per player. A frame that grows with the number of
  // buttons is a frame somebody will grow.
  for (const held of [new Set(), new Set(INPUT_BITS)]) {
    assert.equal(encodeInput(1, held).byteLength, 5);
  }
});

test('an input frame ignores buttons it does not know', () => {
  // A newer client may send something this build has never heard of.
  // It must arrive as the buttons this build does know, not as noise.
  const got = decodeInput(encodeInput(1, new Set(['fire', 'nonsense', 'walk'])));
  assert.deepEqual([...got.held], ['fire']);
});

test('a snapshot is not mistaken for an input frame', () => {
  const snap = encodeSnapshot(fakeGame(), ship(), 1, emptyPools());
  assert.equal(new DataView(snap).getUint8(0), MSG_SNAPSHOT);
  assert.equal(decodeInput(snap), null, 'a snapshot decoded as an input frame');
});

// --- snapshots

test('both ships survive the wire', () => {
  const game = fakeGame();
  game.player = ship({ x: 1010.4, y: 171.6, vx: 200, vy: -88, facing: -1, shield: 42 });
  const second = ship({ x: 880.2, y: 260.9, vx: -40, vy: 12, facing: 1, shield: 7, alive: false });

  const got = decodeSnapshot(encodeSnapshot(game, second, 99, emptyPools()));
  assert.equal(got.tick, 99);
  assert.equal(got.camX, 900);
  assert.equal(got.state, 'play');
  assert.equal(got.score, 12345);
  assert.equal(got.lives, 3);
  assert.equal(got.levelIndex, 4);

  const [a, b] = got.ships;
  // Positions are whole pixels: the wire stores them as offsets from
  // the camera, which is exact to a pixel and half the bytes.
  assert.ok(Math.abs(a.x - 1010.4) <= 1, `host ship x came back ${a.x}`);
  assert.ok(Math.abs(a.y - 171.6) <= 1, `host ship y came back ${a.y}`);
  assert.equal(a.facing, -1);
  assert.equal(a.shield, 42);
  assert.equal(a.alive, true);

  assert.ok(Math.abs(b.x - 880.2) <= 1, `guest ship x came back ${b.x}`);
  assert.equal(b.alive, false, 'a dead ship came back alive');
  assert.equal(b.shield, 7);
  // Velocity is coarse on purpose — it is only used to smooth
  // between snapshots — but it must not be wrong about direction.
  assert.ok(b.vx < 0 && a.vx > 0, `velocities came back ${a.vx} and ${b.vx}`);
});

test('a ship outside the view still has a position', () => {
  // The camera-relative encoding is signed, so a ship behind the
  // camera is a negative offset rather than a wrap to 65,000.
  const game = fakeGame({ cam: { x: 5000 } });
  game.player = ship({ x: 4000, y: 100 });
  const got = decodeSnapshot(encodeSnapshot(game, ship({ x: 5600, y: 300 }), 1, emptyPools()));
  assert.ok(Math.abs(got.ships[0].x - 4000) <= 1, `came back ${got.ships[0].x}`);
  assert.ok(Math.abs(got.ships[1].x - 5600) <= 1, `came back ${got.ships[1].x}`);
});

test('every game state has a name on both sides', () => {
  for (const state of STATES) {
    const got = decodeSnapshot(encodeSnapshot(fakeGame({ state }), ship(), 1, emptyPools()));
    assert.equal(got.state, state, `${state} did not survive`);
  }
  // Something this build has never heard of must not come back as
  // undefined and poison a switch.
  const game = fakeGame({ state: 'something-new' });
  assert.ok(STATES.includes(decodeSnapshot(
    encodeSnapshot(game, ship(), 1, emptyPools())).state));
});

test('attackers, shots and loot survive the wire', () => {
  const game = fakeGame();
  const pools = {
    foes: pool([
      { kind: 'lancer', x: 950, y: 100, facing: -1, flash: 0.2, shield: 0 },
      { kind: 'scorcher', x: 1200, y: 240, facing: 1, flash: 0, shield: 3 },
    ]),
    playerShots: pool([{ x: 1000, y: 150, r: 3 }, { x: 1020, y: 152, r: 3 }]),
    enemyShots: pool([{ x: 1100, y: 200, r: 7 }]),
    pickups: pool([{ x: 980, y: 300, kind: 'coin' }, { x: 1050, y: 120, kind: 'bar' }]),
  };
  const got = decodeSnapshot(encodeSnapshot(game, ship(), 1, pools));

  assert.equal(got.foes.length, 2);
  assert.equal(got.foes[0].kind, 'lancer');
  assert.equal(got.foes[1].kind, 'scorcher');
  assert.ok(Math.abs(got.foes[0].x - 950) <= 1);
  assert.equal(got.foes[0].facing, -1);
  assert.ok(got.foes[0].flash > 0, 'a flashing attacker came back unflashed');
  assert.ok(got.foes[1].shield > 0, 'a shielded attacker came back unshielded');

  assert.equal(got.playerShots.length, 2);
  assert.equal(got.enemyShots.length, 1);
  assert.equal(got.enemyShots[0].r, 7);
  assert.ok(Math.abs(got.enemyShots[0].x - 1100) <= 1);

  assert.equal(got.pickups.length, 2);
  assert.deepEqual(got.pickups.map((p) => p.kind), ['coin', 'bar']);
});

test('every attacker kind and every loot kind has an index', () => {
  // The index is a byte on the wire. A kind missing from the table
  // decodes as whatever index 0 is, which puts the wrong sprite on
  // the guest's screen and nothing in the console.
  const game = fakeGame();
  for (const kind of KINDS) {
    const got = decodeSnapshot(encodeSnapshot(game, ship(), 1, {
      ...emptyPools(), foes: pool([{ kind, x: 950, y: 100, facing: 1, flash: 0, shield: 0 }]),
    }));
    assert.equal(got.foes[0].kind, kind, `${kind} did not survive the wire`);
  }
  for (const kind of PICKUP_KINDS) {
    const got = decodeSnapshot(encodeSnapshot(game, ship(), 1, {
      ...emptyPools(), pickups: pool([{ x: 950, y: 100, kind }]),
    }));
    assert.equal(got.pickups[0].kind, kind, `pickup ${kind} did not survive`);
  }
});

test('an unknown attacker kind decodes to something drawable', () => {
  const game = fakeGame();
  const got = decodeSnapshot(encodeSnapshot(game, ship(), 1, {
    ...emptyPools(),
    foes: pool([{ kind: 'from-a-newer-build', x: 950, y: 100, facing: 1, flash: 0, shield: 0 }]),
  }));
  assert.ok(KINDS.includes(got.foes[0].kind),
    `an unknown kind came back as ${got.foes[0].kind}`);
  assert.equal(kindAt(999), KINDS[0], 'an index past the table has no fallback');
});

test('what is off screen is not sent', () => {
  // The guest cannot see it, and the budget is the whole reason the
  // format is binary.
  const game = fakeGame({ cam: { x: 1000 } });
  const pools = {
    ...emptyPools(),
    foes: pool([
      { kind: 'mine', x: 1200, y: 100, facing: 1, flash: 0, shield: 0 },   // on screen
      { kind: 'mine', x: 200, y: 100, facing: 1, flash: 0, shield: 0 },    // far behind
      { kind: 'mine', x: 9000, y: 100, facing: 1, flash: 0, shield: 0 },   // far ahead
      { kind: 'mine', x: 1000 + VIEW_W + 10, y: 100, facing: 1, flash: 0, shield: 0 },
    ]),
  };
  const got = decodeSnapshot(encodeSnapshot(game, ship(), 1, pools));
  // The one in view, and the one just past the edge that is about to be.
  assert.equal(got.foes.length, 2, `sent ${got.foes.length} attackers`);
  for (const f of got.foes) {
    assert.ok(f.x > 900 && f.x < 1000 + VIEW_W + 60, `sent one at ${f.x}`);
  }
});

test('a snapshot stays inside its buffer when everything is on screen', () => {
  // The pools hold far more than a snapshot describes. The caps are
  // what stop a busy frame writing past the end of the buffer, which
  // would be a DataView exception once a run got hectic enough.
  const game = fakeGame({ cam: { x: 0 } });
  const many = (n, f) => pool(Array.from({ length: n }, (_, i) => f(i)));
  const pools = {
    foes: many(26, (i) => ({ kind: KINDS[i % KINDS.length], x: i * 20, y: 100, facing: 1, flash: 0, shield: 0 })),
    playerShots: many(340, (i) => ({ x: (i * 2) % VIEW_W, y: 100, r: 3 })),
    enemyShots: many(160, (i) => ({ x: (i * 3) % VIEW_W, y: 150, r: 4 })),
    pickups: many(160, (i) => ({ x: (i * 4) % VIEW_W, y: 200, kind: 'coin' })),
  };
  let buf;
  assert.doesNotThrow(() => { buf = encodeSnapshot(game, ship(), 1, pools); },
    'a full frame overran the snapshot buffer');
  const got = decodeSnapshot(buf);
  assert.ok(got, 'a full frame did not decode');
  // Capped, not truncated mid-entity: every count the reader was
  // given was honoured, which is what the decode succeeding proves.
  assert.ok(got.foes.length <= 32, `sent ${got.foes.length} attackers`);
  assert.ok(got.playerShots.length <= 190, `sent ${got.playerShots.length} shots`);
  assert.ok(got.pickups.length <= 48, `sent ${got.pickups.length} pickups`);
});

test('a busy snapshot is small enough to send twenty times a second', () => {
  const game = fakeGame({ cam: { x: 0 } });
  const many = (n, f) => pool(Array.from({ length: n }, (_, i) => f(i)));
  const buf = encodeSnapshot(game, ship(), 1, {
    foes: many(26, (i) => ({ kind: 'mine', x: i * 20, y: 100, facing: 1, flash: 0, shield: 0 })),
    playerShots: many(120, (i) => ({ x: i * 4, y: 100, r: 3 })),
    enemyShots: many(80, (i) => ({ x: i * 6, y: 150, r: 4 })),
    pickups: many(30, (i) => ({ x: i * 15, y: 200, kind: 'coin' })),
  });
  // Measured, not guessed: a frame with 26 attackers, 200 shots and
  // 30 pickups all on screen comes to about 1.4KB, so twenty a second
  // is roughly 27KB/s — a fifth of what a slow connection carries,
  // and a quarter of what the same thing costs as JSON. The bar is
  // set above the real figure with room to grow, and low enough that
  // adding a field nobody counted shows up here.
  assert.ok(buf.byteLength < 1600,
    `a busy snapshot is ${buf.byteLength} bytes; 20/s would be ${(buf.byteLength * 20 / 1024).toFixed(0)}KB/s`);
});

test('an input frame is not mistaken for a snapshot', () => {
  // The mirror of the test above. Both directions share a socket, so
  // a decoder that does not check its tag reads the other side's
  // traffic as its own and puts ships wherever the bytes land.
  const input = encodeInput(3, new Set(['fire']));
  assert.equal(decodeSnapshot(input), null, 'an input frame decoded as a snapshot');

  // A five-byte input frame is also too short to parse as a snapshot,
  // so the test above passes on a decoder that never looks at the
  // tag. This one is long enough to parse: the only thing stopping
  // it is the tag.
  const wrongTag = new Uint8Array(400);
  wrongTag[0] = MSG_INPUT;
  assert.equal(decodeSnapshot(wrongTag.buffer), null,
    'a long message with the wrong tag decoded as a snapshot');

  // ...and the same the other way: an unknown tag is nobody's.
  const unknown = new Uint8Array(400);
  unknown[0] = 99;
  assert.equal(decodeSnapshot(unknown.buffer), null);
  assert.equal(decodeInput(unknown.buffer), null);
});

test('the caps hold when the pools are fuller than the wire allows', () => {
  // The pools can hold more than a snapshot describes. These numbers
  // are above every cap, so the caps are what is being measured
  // rather than how big the pools happen to be today.
  const game = fakeGame({ cam: { x: 0 } });
  const many = (n, f) => pool(Array.from({ length: n }, (_, i) => f(i)));
  const got = decodeSnapshot(encodeSnapshot(game, ship(), 1, {
    foes: many(60, (i) => ({ kind: 'mine', x: (i * 7) % VIEW_W, y: 100, facing: 1, flash: 0, shield: 0 })),
    playerShots: many(300, (i) => ({ x: (i * 2) % VIEW_W, y: 100, r: 3 })),
    enemyShots: many(260, (i) => ({ x: (i * 2) % VIEW_W, y: 150, r: 4 })),
    pickups: many(120, (i) => ({ x: (i * 5) % VIEW_W, y: 200, kind: 'coin' })),
  }));
  assert.ok(got, 'an over-full frame did not decode');
  assert.equal(got.foes.length, 32, `the attacker cap let ${got.foes.length} through`);
  assert.equal(got.playerShots.length, 190, `the shot cap let ${got.playerShots.length} through`);
  assert.equal(got.enemyShots.length, 190, `the shot cap let ${got.enemyShots.length} through`);
  assert.equal(got.pickups.length, 48, `the pickup cap let ${got.pickups.length} through`);
});

test('a truncated or foreign message does not throw', () => {
  // It arrives from the network. The only acceptable failure is null.
  const good = encodeSnapshot(fakeGame(), ship(), 1, emptyPools());
  for (let n = 0; n < good.byteLength; n++) {
    assert.doesNotThrow(() => decodeSnapshot(good.slice(0, n)),
      `a ${n}-byte snapshot threw`);
  }
  for (const junk of [new ArrayBuffer(0), new ArrayBuffer(1), new Uint8Array([9, 9, 9]).buffer]) {
    assert.doesNotThrow(() => decodeSnapshot(junk));
    assert.doesNotThrow(() => decodeInput(junk));
  }
});
