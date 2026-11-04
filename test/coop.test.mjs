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
    shieldMax: 100, lives: 3,
    alive: true, flip: 0, thrusting: false, ...over,
  };
}

// No `lives` on the game. There never was one: the field is the
// player's, and this fixture used to invent a game-level one, which is
// how a wire field that was always zero in play passed its own test.
function fakeGame(over = {}) {
  return {
    cam: { x: 900 },
    state: 'play',
    score: 12345,
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

// The numbers the mini-HUD draws, which is the reason they are on the
// wire at all. Asserted against the values put in rather than against
// the encoder's opinion: a codec wrong in the same way at both ends
// round-trips happily and still shows the wrong bar in play.
test('each ship carries its own spare hulls', () => {
  const game = fakeGame();
  game.player = ship({ lives: 5 });
  const got = decodeSnapshot(encodeSnapshot(game, ship({ lives: 1 }), 1, emptyPools()));
  assert.equal(got.ships[0].lives, 5, 'the host ship lost its spare hulls');
  assert.equal(got.ships[1].lives, 1, 'the guest ship lost its spare hulls');
});

// The refit raises shieldMax every hull: it passes 220 at hull four
// and reaches four figures by the end of a long run. A single byte
// clamped at 255, and the guest takes its own shield from the host
// rather than predicting it — so this was not a display fault, it
// actually cut a late-run guest's shield to 255.
test('a late-run shield survives the wire intact', () => {
  const game = fakeGame();
  game.player = ship({ shield: 870, shieldMax: 1180 });
  const got = decodeSnapshot(encodeSnapshot(game, ship({ shield: 402, shieldMax: 600 }), 1, emptyPools()));
  assert.equal(got.ships[0].shield, 870, 'a shield over 255 was truncated');
  assert.equal(got.ships[0].shieldMax, 1180, 'a ceiling over 255 was truncated');
  assert.equal(got.ships[1].shield, 402);
  assert.equal(got.ships[1].shieldMax, 600);
});

// A bar is a fraction and a fraction needs its denominator. Without
// the ceiling the guest drew the other pilot's 300 against its own
// 100 and showed a bar three times over.
test('the shield ceiling arrives with the shield', () => {
  const game = fakeGame();
  game.player = ship({ shield: 150, shieldMax: 300 });
  const got = decodeSnapshot(encodeSnapshot(game, ship(), 1, emptyPools()));
  const a = got.ships[0];
  assert.equal(a.shield / a.shieldMax, 0.5, 'half a shield did not come back as half');
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
    cam: makeCamera(), time: 0, state: 'play', score: 0, levelIndex: 0,
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

// --- the hull both pilots are on
//
// Which hull the guest is flying has been in every snapshot since
// co-op shipped, and nothing read it. So the host cleared a hull and
// moved on, and the guest kept flying the hull it launched on with the
// new one's attackers, shots and loot drawn over it: shots stopping in
// mid-air, foes inside girders, a boss gate that was not there. When
// the host reached the end screen, the guest was left flying a hull
// nobody was advancing and no key could leave.
//
// These walk a real game through a real update(), because the fault
// was in the wiring between the two and a stub proves only the stub.

import { makeGame, update, followHull } from '../src/game.js';
import { coopState, leaveGame } from '../src/coop.js';

function wireShip(over = {}) {
  return {
    x: 200, y: 180, vx: 0, vy: 0, facing: 1,
    shield: 100, shieldMax: 100, lives: 3,
    alive: true, flip: 0, thrusting: false, ...over,
  };
}

function hostSnapshot(levelIndex, state = 'play') {
  return {
    tick: 1, camX: 0, state, score: 0, levelIndex,
    ships: [wireShip(), wireShip({ x: 240 })],
    foes: [], playerShots: [], enemyShots: [],
    interceptors: [], pickups: [],
  };
}

function asGuest(snap) {
  const S = coopState();
  S.phase = 'playing';
  S.side = 'guest';
  S.snap = snap;
  S.snapAt = performance.now();
}

test('the guest follows the host onto the next hull', (t) => {
  t.after(leaveGame);
  const game = makeGame();
  game.state = 'play';
  const before = game.level;
  assert.equal(game.levelIndex, 0, 'the fixture did not start on the first hull');

  asGuest(hostSnapshot(2));
  update(game, DT);

  assert.equal(game.levelIndex, 2,
    'the guest stayed on the hull it launched from while the host flew another');
  assert.notEqual(game.level, before, 'the hull was never rebuilt');
  assert.equal(game.level.spec.name, game.specs[2].name,
    'the guest rebuilt a hull, but not the one the host is on');
});

test('the guest is carried through the end of a hull and out again', (t) => {
  t.after(leaveGame);
  const game = makeGame();
  game.state = 'play';

  // The host finishes the hull.
  asGuest(hostSnapshot(0, 'levelclear'));
  update(game, DT);
  assert.equal(game.state, 'levelclear', 'the guest kept flying a cleared hull');

  // ...and moves on. This is the one that deadlocked: the follow used
  // to run below the state branches, each of which returns early, so a
  // guest told it was between hulls never read another snapshot and
  // sat on that screen for the rest of the run.
  asGuest(hostSnapshot(1, 'play'));
  update(game, DT);
  assert.equal(game.state, 'play', 'the guest never left the between-hulls screen');
  assert.equal(game.levelIndex, 1);
});

test('the guest does not carry itself onto the next hull', async (t) => {
  t.after(leaveGame);
  const { setSynthetic } = await import('../src/input.js');
  const game = makeGame();
  game.state = 'levelclear';
  asGuest(hostSnapshot(0, 'levelclear'));
  try {
    setSynthetic(new Set(['start']));
    update(game, DT);
  } finally {
    setSynthetic(null);
  }
  assert.equal(game.levelIndex, 0,
    'the guest loaded the next hull on its own; the host decides when the pair moves on');
});

test('a host still carries itself onto the next hull', async (t) => {
  t.after(leaveGame);
  const { setSynthetic } = await import('../src/input.js');
  const game = makeGame();
  game.state = 'levelclear';
  try {
    setSynthetic(new Set(['start']));
    update(game, DT);
  } finally {
    setSynthetic(null);
  }
  assert.equal(game.levelIndex, 1,
    'a solo or hosting pilot can no longer leave the between-hulls screen');
});

test('following the same hull twice rebuilds nothing', () => {
  const game = makeGame();
  const level = game.level;
  assert.equal(followHull(game, game.levelIndex), false,
    'followHull claimed to have changed hull when it had not');
  assert.equal(game.level, level, 'the hull was rebuilt for no reason');
});

test('a hull index off the end of the roster is clamped, not followed', () => {
  const game = makeGame();
  followHull(game, 9999);
  assert.equal(game.levelIndex, game.specs.length - 1,
    'a snapshot claiming hull 9999 took the guest off the end of the roster');
  assert.ok(game.level, 'there is no hull at all');
});

// --- leaving, and the difference between the two ways of doing it
//
// A socket going quiet and a pilot pressing Y used to be the same
// event: both arrived as peer-left and both ended the run. They are
// not the same thing. One is a decision and the other is a train
// going into a tunnel, and the second one should cost nobody a run.

import {
  coopTick, coopHolding, coopHoldLeft, quitGame, joinGame, hostGame,
} from '../src/coop.js';

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    FakeSocket.last = this;
    FakeSocket.opened = (FakeSocket.opened || 0) + 1;
  }

  send(d) { this.sent.push(d); }

  // Closed by the far end, or by the network. NOT by us: leaveGame
  // calls close() too, and the difference between those two is the
  // whole of what is being tested here.
  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }

  say(obj) { this.onmessage({ data: JSON.stringify(obj) }); }
}

function fakeNet() {
  const had = {
    fetch: globalThis.fetch,
    ws: globalThis.WebSocket,
    loc: globalThis.location,
  };
  globalThis.location = { protocol: 'http:', host: 'x' };
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ code: 'BCDFG', seed: 1, hull: 0, host: 'rom' }),
  });
  globalThis.WebSocket = FakeSocket;
  FakeSocket.opened = 0;
  return () => {
    globalThis.fetch = had.fetch;
    globalThis.WebSocket = had.ws;
    globalThis.location = had.loc;
  };
}

// A guest, joined and flying, with the socket the test can talk down.
async function joinedGuest(t) {
  const restore = fakeNet();
  t.after(() => { leaveGame(); restore(); });
  assert.equal(await joinGame('BCDFG', 'tok'), true, 'the fixture could not join');
  const sock = FakeSocket.last;
  sock.say({ t: 'joined', side: 'guest', seed: 1, hull: 0, peer: true, resumeSec: 45 });
  assert.equal(coopState().phase, 'playing', 'the fixture is not in a run');
  return sock;
}

test('a host that quits gives the guest a reason and a countdown', async (t) => {
  const sock = await joinedGuest(t);
  sock.say({ t: 'peer-quit', side: 'host' });

  const S = coopState();
  assert.equal(S.quitBy, 'host');
  assert.equal(S.phase, 'ended');
  assert.ok(S.endIn > 0,
    'the guest was sent back to the title with no reason and no pause');
  assert.ok(/quit/.test(S.error || ''), `the reason reads "${S.error}"`);

  // ...and the countdown actually runs out, rather than parking the
  // guest on a notice it cannot leave.
  for (let i = 0; i < 60 / DT; i++) coopTick(DT);
  assert.equal(S.endIn, 0, 'the countdown never reached zero');
});

test('a guest that quits does not hold the host up', async (t) => {
  const restore = fakeNet();
  t.after(() => { leaveGame(); restore(); });
  // Hosting this time, so the quit arrives from the far side and goes
  // through the same handler a real one would.
  assert.ok(await hostGame(1, 0, 'tok'), 'the fixture could not open a room');
  const sock = FakeSocket.last;
  sock.say({ t: 'joined', side: 'host', seed: 1, hull: 0, peer: true, resumeSec: 45 });
  sock.say({ t: 'peer-quit', side: 'guest' });

  const S = coopState();
  assert.equal(S.quitBy, 'guest');
  assert.equal(S.peerHere, false);
  assert.equal(coopHolding(), false,
    'the host was made to wait out a hold for a pilot who chose to leave');
  assert.equal(S.endIn, 0,
    'the host was given a countdown off a screen it is entitled to stay on');
  assert.ok(/second pilot/.test(S.error || ''), `the reason reads "${S.error}"`);
});

test('a dropped pilot holds the run instead of ending it', async (t) => {
  const sock = await joinedGuest(t);
  sock.say({ t: 'peer-gone', side: 'host', resumeSec: 30 });

  const S = coopState();
  assert.equal(S.phase, 'paused');
  assert.equal(coopHolding(), true, 'the run kept running with one pilot missing');
  assert.equal(S.quitBy, null, 'a dropped connection was recorded as a decision');
  assert.equal(coopHoldLeft(), 30, 'the hold has no stated end');

  // Halfway through, still waiting.
  for (let i = 0; i < 15 / DT; i++) coopTick(DT);
  assert.equal(S.phase, 'paused', 'the hold gave up early');
  assert.ok(coopHoldLeft() < 30 && coopHoldLeft() > 0,
    `the countdown reads ${coopHoldLeft()}`);

  // Past the window the server quoted, there is nothing left to wait for.
  for (let i = 0; i < 20 / DT; i++) coopTick(DT);
  assert.equal(S.phase, 'ended', 'the run was held open for ever');
  assert.equal(coopHolding(), false);
});

test('a pilot who comes back resumes the run', async (t) => {
  const sock = await joinedGuest(t);
  sock.say({ t: 'peer-gone', side: 'host', resumeSec: 30 });
  for (let i = 0; i < 10 / DT; i++) coopTick(DT);
  assert.equal(coopHolding(), true);

  sock.say({ t: 'peer-back', side: 'host' });
  const S = coopState();
  assert.equal(S.phase, 'playing', 'the run did not restart when the pilot returned');
  assert.equal(S.peerHere, true);
  assert.equal(coopHolding(), false, 'the run is still held after they came back');
  assert.equal(S.error, null, 'a resumed run still carries the error that paused it');
});

test('our own connection dropping tries to get back in', async (t) => {
  const sock = await joinedGuest(t);
  const opened = FakeSocket.opened;

  sock.close();              // the network, not the pilot
  const S = coopState();
  assert.equal(S.phase, 'reconnecting',
    'a dropped socket ended the run instead of trying to recover it');
  assert.equal(coopHolding(), true, 'the game kept running with no connection');

  // The first attempt goes out.
  for (let i = 0; i < 3 / DT; i++) coopTick(DT);
  assert.ok(FakeSocket.opened > opened, 'no attempt was made to reconnect');
  assert.match(FakeSocket.last.url, /\/api\/coop\/BCDFG\/guest$/,
    `it reconnected to ${FakeSocket.last.url}`);

  // And the room takes it back, into the run already in progress.
  FakeSocket.last.say({
    t: 'joined', side: 'guest', seed: 1, hull: 0, peer: true,
    resumed: true, resumeSec: 45,
  });
  assert.equal(S.phase, 'playing', 'coming back did not resume the run');
  assert.equal(coopHolding(), false);
});

// The loop that would not stop.
//
// The elapsed clock was reset on every close, and a failed attempt is
// a close — so the give-up deadline never arrived and the client
// hammered a room that had been swept minutes earlier.
test('reconnecting gives up rather than hammering a room that has gone', async (t) => {
  const sock = await joinedGuest(t);
  sock.close();
  const S = coopState();
  // Every attempt fails the moment it is made.
  for (let i = 0; i < 120 / DT; i++) {
    coopTick(DT);
    if (FakeSocket.last && FakeSocket.last.readyState === 1 && FakeSocket.last !== sock) {
      FakeSocket.last.close();
    }
  }
  assert.equal(S.phase, 'ended', 'the client is still trying to reconnect');
  assert.ok(S.tries < 40, `it made ${S.tries} attempts before giving up`);
});

test('leaving on purpose says so, and does not try to come back', async (t) => {
  const sock = await joinedGuest(t);
  quitGame();

  assert.deepEqual(sock.sent, ['{"t":"quit"}'],
    'the other pilot was never told this was a decision');
  const S = coopState();
  assert.equal(S.phase, 'off', 'quitting left the session half-open');
  assert.equal(coopHolding(), false,
    'walking out started a reconnect loop back into the game we just left');
});

// --- the other pilot's panel

import { drawMateHud, MATE_HUD } from '../src/hud.js';

const mateCtx = () => document.createElement('canvas').getContext('2d');

function mateGame(over = {}) {
  return {
    mate: {
      shield: 60, shieldMax: 100, lives: 2, alive: true, x: 100, y: 100, ...over,
    },
  };
}

test('the panel stays on screen', () => {
  assert.ok(MATE_HUD.x >= 0, 'the panel starts off the left of the screen');
  assert.ok(MATE_HUD.x + MATE_HUD.w <= VIEW_W,
    `the panel runs ${MATE_HUD.x + MATE_HUD.w - VIEW_W}px past the right edge`);
  // The segments have to fit inside it too, or the bar runs out of
  // its own plate.
  const bar = MATE_HUD.segs * (MATE_HUD.segW + MATE_HUD.segGap) - MATE_HUD.segGap;
  assert.ok(bar <= MATE_HUD.w - MATE_HUD.pad * 2,
    `the shield bar is ${bar}px inside a ${MATE_HUD.w}px plate`);
});

// The stub canvas throws on a non-finite coordinate, which is what
// makes these worth running: every one of them is a shape of data the
// panel has to survive rather than draw NaN from.
test('the panel draws whatever state the other ship is in', () => {
  const ctx = mateCtx();
  for (const [what, over] of [
    ['a full ship', {}],
    ['no shield left', { shield: 0 }],
    ['a lost ship', { alive: false, shield: 0 }],
    ['no spare hulls', { lives: 0 }],
    ['more hulls than the panel has room for', { lives: 99 }],
    ['a late-run ceiling', { shield: 870, shieldMax: 1180 }],
    ['a missing ceiling', { shieldMax: 0 }],
    ['a shield above its own ceiling', { shield: 400, shieldMax: 100 }],
  ]) {
    drawMateHud(ctx, mateGame(over), { side: 'host', phase: 'playing' });
    drawMateHud(ctx, mateGame(over), { side: 'guest', phase: 'paused' });
    assert.ok(true, what);
  }
});

test('the panel draws nothing when there is no other ship', () => {
  // Called from the frame whenever a co-op run is in flight, and on
  // the very first frames of one there is no mate object yet.
  drawMateHud(mateCtx(), {}, { side: 'host', phase: 'playing' });
  drawMateHud(mateCtx(), { mate: null }, { side: 'host', phase: 'playing' });
});
