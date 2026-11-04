import './_setup.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePool } from '../src/pool.js';

import {
  encodeInput, decodeInput, encodeSnapshot, decodeSnapshot,
  setKinds, kindAt, INPUT_BITS, STATES, PICKUP_KINDS,
  MSG_INPUT, MSG_SNAPSHOT,
} from '../src/coop.js';
import { BOARDS, setBoard, toggleBoard, submitCoopRun, netState } from '../src/net.js';
import { rankLine, BOARD_TITLES } from '../src/hud.js';

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
  foes: pool([]), playerShots: pool([]), enemyShots: pool([]),
  pickups: pool([]), interceptors: pool([]),
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
    playerShots: pool([
      { x: 1000, y: 150, r: 3, vx: 400, seek: 0 },
      { x: 1020, y: 152, r: 3, vx: -400, seek: 0 },
    ]),
    enemyShots: pool([{ x: 1100, y: 200, r: 7, vx: -200, seek: 3 }]),
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
  // Direction and missile-ness ride in the spare bits of the radius
  // byte, because the renderer asks for both and neither is worth a
  // byte of its own at two hundred shots a frame.
  assert.equal(got.playerShots[0].dir, 1, 'a rightward shot came back pointing left');
  assert.equal(got.playerShots[1].dir, -1, 'a leftward shot came back pointing right');
  assert.equal(got.playerShots[0].seek, false);
  assert.equal(got.enemyShots.length, 1);
  assert.equal(got.enemyShots[0].seek, true, 'a missile came back as an ordinary shot');
  assert.equal(got.enemyShots[0].r, 7);
  assert.ok(Math.abs(got.enemyShots[0].x - 1100) <= 1);

  assert.equal(got.pickups.length, 2);
  assert.deepEqual(got.pickups.map((p) => p.kind), ['coin', 'bar']);
});

test('the snapshot carries every pool the renderer draws from', () => {
  // The gap this exists for: interceptors have their own pool,
  // separate from attackers and turrets, and the first version of the
  // snapshot simply left them out. The guest flew through a fight it
  // could not see — and nothing failed, because every test was about
  // the lists that were already there.
  //
  // Pinned by name against render.js, so adding a pool and forgetting
  // the wire fails here rather than being noticed in a screenshot.
  const render = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
  const drawn = ['foes', 'playerShots', 'enemyShots', 'pickups', 'interceptors'];
  for (const name of drawn) {
    assert.ok(render.includes(name + '.count'),
      'render.js no longer draws from ' + name + '; this list is out of date');
  }
  const game = fakeGame();
  const got = decodeSnapshot(encodeSnapshot(game, ship(), 1, emptyPools()));
  for (const name of drawn) {
    assert.ok(Array.isArray(got[name]),
      'the snapshot has no ' + name + '; a guest would see none of them');
  }
});

test('interceptors survive the wire', () => {
  const game = fakeGame();
  const got = decodeSnapshot(encodeSnapshot(game, ship(), 1, {
    ...emptyPools(),
    interceptors: pool([
      { x: 950, y: 120, dirX: -1 },
      { x: 1150, y: 260, dirX: 1 },
    ]),
  }));
  assert.equal(got.interceptors.length, 2);
  assert.ok(Math.abs(got.interceptors[0].x - 950) <= 1);
  assert.equal(got.interceptors[0].dirX, -1, 'an interceptor came back facing the wrong way');
  assert.equal(got.interceptors[1].dirX, 1);
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

// ------------------------------------------------- the second ship
//
// The rules that decide whether co-op is playable rather than merely
// connected: that the second ship is flown by the same code as the
// first, that the camera belongs to both pilots, and that neither can
// drag the other off the screen.

import {
  coopCameraTarget, leashShips, ensureMate,
} from '../src/coopgame.js';
import { updatePlayer, makePlayer } from '../src/player.js';
import { VIEW_W, FIELD_TOP, FIELD_BOT, DT } from '../src/config.js';

function flyable() {
  const p = makePlayer();
  p.x = 400; p.y = 180; p.vx = 0; p.vy = 0; p.alive = true;
  return p;
}

test('the second ship is flown by the same code as the first', () => {
  // Not a second update path. The first thing to go wrong with one
  // would be the two ships handling differently in a way nobody can
  // put their finger on.
  const { makeGame } = { makeGame: null }; // not needed; a bare level is enough
  void makeGame;
  const game = {
    level: { obstacles: [], buckets: new Map(), length: 20000, gates: [], hazards: [], movers: [] },
    cam: { x: 0, shake: 0 }, time: 0, state: 'play', score: 0,
  };
  const a = flyable();
  const b = flyable();
  // Same buttons, same number of frames, from the same start.
  for (let i = 0; i < 60; i++) {
    updatePlayer(a, game, DT, new Set(['right']));
    updatePlayer(b, game, DT, new Set(['right']));
  }
  assert.ok(a.x > 400, 'holding right did not move the ship');
  assert.equal(a.x, b.x, 'two ships given identical input ended up in different places');
  assert.equal(a.vx, b.vx);

  // ...and different buttons move them differently, or the input is
  // not reaching the ship at all.
  const c = flyable();
  for (let i = 0; i < 60; i++) updatePlayer(c, game, DT, new Set(['left']));
  assert.ok(c.x < 400, 'holding left did not move the ship');
});

test('a remote ship gets an edge from its own last frame', () => {
  // "Pressed this frame" has no meaning in a set of held buttons, so
  // it is derived per ship. Per ship and not globally, because two of
  // them are flown from two different sources in the same loop.
  const game = {
    level: { obstacles: [], buckets: new Map(), length: 20000, gates: [], hazards: [], movers: [] },
    cam: { x: 0, shake: 0 }, time: 0, state: 'play', score: 0,
  };
  const jumps = (held, frames) => {
    const p = flyable();
    p.jumpCd = 0;
    let fired = 0;
    let was = 0;
    for (let i = 0; i < frames; i++) {
      updatePlayer(p, game, DT, held(i));
      // The cooldown going from zero to full is a jump happening.
      if (p.jumpCd > was) fired++;
      was = p.jumpCd;
    }
    return fired;
  };

  // Held down for well past the cooldown. An edge fires once; a level
  // fires again the moment the cooldown expires, which is the bug.
  const seconds = 14;
  const frames = Math.ceil(seconds / DT);
  assert.equal(jumps(() => new Set(['jump']), frames), 1,
    'holding jump through the cooldown fired it more than once; '
    + 'the remote edge is being read as a level');

  // Released and pressed again inside the same window: still once,
  // because the cooldown has not expired.
  assert.equal(jumps((i) => (i % 2 ? new Set() : new Set(['jump'])), 240), 1,
    'tapping jump during the cooldown fired it more than once');

  // And never, if it is never pressed.
  assert.equal(jumps(() => new Set(), frames), 0, 'the ship jumped on its own');
});

test('the camera belongs to both pilots', () => {
  const LEN = 20000;
  // Together: centred between them.
  const mid = coopCameraTarget({ x: 1000 }, { x: 1200 }, LEN);
  assert.ok(Math.abs(mid - (1100 - VIEW_W / 2)) < 2,
    `two ships 200px apart put the camera at ${mid}`);

  // Apart: both still on screen while they fit.
  const a = { x: 900 };
  const b = { x: 900 + VIEW_W - 160 };
  const cam = coopCameraTarget(a, b, LEN);
  assert.ok(a.x > cam && a.x < cam + VIEW_W, `the trailing ship is off screen at ${cam}`);
  assert.ok(b.x > cam && b.x < cam + VIEW_W, `the leading ship is off screen at ${cam}`);

  // Never past the ends of the hull.
  assert.equal(coopCameraTarget({ x: 0 }, { x: 10 }, LEN), 0);
  assert.equal(coopCameraTarget({ x: LEN }, { x: LEN }, LEN), LEN - VIEW_W);
});

test('neither pilot can drag the other off the screen', () => {
  // The oldest complaint about shared-screen co-op: the faster player
  // takes the camera and the slower one is scrolled into a wall.
  const cam = 1000;
  const slow = { x: cam - 50, y: 180, vx: -200, alive: true };
  const fast = { x: cam + VIEW_W + 80, y: 180, vx: 300, alive: true };
  leashShips(slow, fast, cam);
  assert.ok(slow.x >= cam, `the trailing ship was left at ${slow.x}, behind the camera at ${cam}`);
  assert.ok(fast.x <= cam + VIEW_W, `the leading ship was left at ${fast.x}`);
  // Stopped, not bounced: a ship shoved backwards by its partner is
  // worse than one that will not go further.
  assert.equal(slow.vx, 0, 'the trailing ship kept its backwards speed');
  assert.equal(fast.vx, 0, 'the leading ship kept its forwards speed');
});

test('the leash keeps ships inside the corridor', () => {
  const a = { x: 100, y: -500, alive: true, vx: 0 };
  const b = { x: 100, y: 99999, alive: true, vx: 0 };
  leashShips(a, b, 0);
  assert.ok(a.y >= FIELD_TOP, `a ship was left at y=${a.y}, above the hull`);
  assert.ok(b.y <= FIELD_BOT, `a ship was left at y=${b.y}, below the hull`);
});

test('a dead pilot is not leashed', () => {
  // A ship that died off the edge should be left where it died
  // rather than dragged back into view to explode somewhere else.
  const dead = { x: 50, y: 180, vx: -100, alive: false };
  leashShips(dead, { x: 500, y: 180, alive: true, vx: 0 }, 1000);
  assert.equal(dead.x, 50, 'a dead ship was dragged back on screen');
});

test('the second ship is made once and kept', () => {
  const game = {};
  const a = ensureMate(game);
  const b = ensureMate(game);
  assert.equal(a, b, 'the second ship was rebuilt, losing everything about it');
  assert.ok(a.isMate, 'the second ship is not marked as one');
  assert.ok(Object.prototype.hasOwnProperty.call(a, 'shield'),
    'the second ship is not a real ship');
});

// ------------------------------------------------- the shake comes down
//
// Reported from play: "the co-op view, for both players, is very jumpy
// — the graphics jump back and forth vertically."
//
// The screen shake is the ONLY thing that moves the view vertically:
// drawWorld's camY is nothing but `cam.shake` turned into a random
// offset. It was wound down inside updateCamera and nowhere else, and
// co-op places the camera itself and so never called updateCamera — so
// one hit left the picture juddering for the rest of the run.

import { makeCamera, kick, decayShake, updateCamera } from '../src/camera.js';
import { hostFrame, guestApply } from '../src/coopgame.js';

function shakenGame() {
  const game = {
    level: { obstacles: [], buckets: new Map(), length: 20000, gates: [], hazards: [], movers: [] },
    cam: makeCamera(), time: 0, state: 'play', score: 0, lives: 3, levelIndex: 0,
    player: makePlayer(),
  };
  game.player.x = 400; game.player.y = 180; game.player.alive = true;
  kick(game.cam, 14);
  return game;
}

test('the host winds the shake down', () => {
  const game = shakenGame();
  assert.ok(game.cam.shake > 0, 'the fixture did not shake the camera');
  for (let i = 0; i < 120; i++) hostFrame(game, DT);
  assert.equal(game.cam.shake, 0,
    `after a second of co-op the camera is still shaking by ${game.cam.shake}; `
    + 'the view judders vertically for the rest of the run');
});

test('the guest winds the shake down', () => {
  const game = shakenGame();
  for (let i = 0; i < 120; i++) guestApply(game, DT);
  assert.equal(game.cam.shake, 0,
    `after a second the guest's camera is still shaking by ${game.cam.shake}`);
});

test('a shake still happens before it decays', () => {
  // The fix must not be "never shake": the kick is how a hit reads.
  const cam = makeCamera();
  kick(cam, 14);
  assert.ok(cam.shake > 0);
  decayShake(cam, DT);
  assert.ok(cam.shake > 0, 'one frame of decay wiped the whole shake');
  assert.ok(cam.shake < 14, 'the shake did not decay at all');
});

test('every path that places the camera winds the shake down', () => {
  // The single-player path, the boss-arena path and both co-op paths.
  // One of these forgot, and the only symptom was a picture that would
  // not sit still.
  const cases = {
    'updateCamera, scrolling': (cam, dt) => updateCamera(cam, { x: 400, facing: 1 }, 20000, dt),
    'updateCamera, boss arena': (cam, dt) => updateCamera(cam, { x: 400, facing: 1 }, 20000, dt, 300),
  };
  for (const [what, run] of Object.entries(cases)) {
    const cam = makeCamera();
    kick(cam, 14);
    for (let i = 0; i < 120; i++) run(cam, DT);
    assert.equal(cam.shake, 0, `${what} left the camera shaking by ${cam.shake}`);
  }
});

// ------------------------------------------------------------ the board
//
// The co-op board is one row per run with two names on it, and the one
// thing it must never do is credit the wrong pilot or the wrong board.
// The server guards the recording; these guard the reading.

test('the board key cycles all three boards and comes back', () => {
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(toggleBoard());
  assert.deepEqual(seen, ['runs', 'coop', 'pilots', 'runs'],
    'the key has to reach the co-op board and then return to the first one');
  setBoard('pilots');
  assert.deepEqual(BOARDS, ['pilots', 'runs', 'coop']);
});

test('an unknown board name falls back rather than blanking the screen', () => {
  assert.equal(setBoard('nonsense'), 'pilots');
  assert.equal(setBoard('coop'), 'coop');
  setBoard('pilots');
});

test('the co-op board has a heading of its own', () => {
  // Three boards, three headings, and none of them empty: a board
  // whose title did not change would look like the previous one with
  // the wrong rows in it.
  const heads = BOARDS.map((b) => BOARD_TITLES[b]);
  for (const [b, pair] of BOARDS.map((b, i) => [b, heads[i]])) {
    assert.ok(pair && pair[0] && pair[1], `${b} has no heading`);
  }
  const titles = heads.map((h) => h[0]);
  assert.equal(new Set(titles).size, titles.length, `two boards share a title: ${titles}`);
  assert.match(BOARD_TITLES.coop[0], /CO-OP/);
});

test('a co-op rank says both pilots placed, and among co-op runs', () => {
  // The row the server sends back names two pilots; that is how the
  // end screen knows which pool the position is out of without having
  // to ask whether a co-op game is still open.
  const line = rankLine({
    online: true,
    submitState: 'recorded',
    rank: { position: 3, score: { hostId: 'a', guestId: 'b', hostName: 'rom', guestName: 'ada' } },
    stats: { players: 40, coopRuns: 11 },
  });
  assert.match(line.head, /BOTH/, 'a pair should not be told "you place"');
  assert.match(line.head, /3 OF 11/,
    'a co-op place is out of the co-op runs, not out of the pilot count');
  assert.equal(line.settled, true);
});

test('a solo rank is unchanged by the co-op branch', () => {
  const line = rankLine({
    online: true,
    submitState: 'recorded',
    rank: { position: 3, score: { playerId: 'a', name: 'rom' } },
    stats: { players: 40, coopRuns: 11 },
  });
  assert.match(line.head, /^YOU PLACE 3 OF 40$/);
});

test('the guest is told the host is posting, not left on SENDING', () => {
  // The guest submits nothing by design. Left on 'sending' that is
  // indistinguishable from a backend that has gone away, which is the
  // exact failure the rest of this screen was rebuilt to stop.
  const line = rankLine({ online: true, submitState: 'posted-by-host' });
  assert.equal(line.settled, true);
  assert.doesNotMatch(line.head, /SENDING/);
  assert.match(line.head, /CO-OP/);
});

test('every submit state the guest can be in reads as an answer', () => {
  for (const submitState of ['posted-by-host', 'recorded', 'refused']) {
    assert.equal(rankLine({ online: true, submitState }).settled, true,
      `${submitState} still reads as "wait"`);
  }
});

test('a co-op submission carries the room and never the partner', async () => {
  // The one property the client half has to hold up: a host posts the
  // room it played in, and nothing that could name the other pilot.
  // The server takes the partner from the room, and its decoder
  // rejects unknown fields outright — so a client that started
  // sending a name here would get a 400 and no row at all.
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts = {}) => {
    sent.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    return Promise.resolve({
      ok: true, status: 201,
      json: () => Promise.resolve({ score: { points: 7 }, rank: { position: 1 } }),
    });
  };
  try {
    netState().player = { id: 'p1', name: 'rom', token: 'tok' };
    netState().run = null;        // unsigned: WebCrypto is not the point here
    await submitCoopRun({
      code: 'BCDFG', points: 7, timeSec: 100, turrets: 1, deaths: 0,
      completed: false, levels: 2, hullsFlown: 2,
    });
  } finally {
    globalThis.fetch = realFetch;
    netState().player = null;
  }

  const post = sent.find((s) => String(s.url).includes('/api/coop/scores'));
  assert.ok(post, `nothing was posted to the co-op route: ${sent.map((s) => s.url)}`);
  assert.equal(post.body.code, 'BCDFG');
  for (const field of ['guestId', 'guestName', 'hostId', 'hostName', 'pairedSec', 'partner']) {
    assert.equal(field in post.body, false,
      `the submission carries ${field}; the partner is the server's to decide`);
  }
});
