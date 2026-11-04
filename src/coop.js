// Two-player co-op: the client half.
//
// One scrolling view, a ship each, two browsers. The host runs the
// whole simulation and says what happened; the guest sends its input
// and draws what it is told. See internal/api/coop.go for why it is
// that way round rather than both sides simulating and agreeing.
//
// What crosses the wire, and what does not:
//
//   The hull does not. It is generated from a seed, the seed is in
//   the room, and both sides build the identical 12,000 pixels from
//   it. Sending geometry that both ends can derive would be most of
//   the bandwidth for none of the benefit.
//
//   Particles do not. They are cosmetic and the guest can invent its
//   own; two machines disagreeing about where a spark went is not a
//   disagreement about the game.
//
//   Everything the two players can affect does: both ships, the
//   camera, the attackers, the shots, the loot, the score. The guest
//   draws these from the host's word and never from its own
//   simulation, which is what keeps the two screens showing the same
//   fight.
//
// The guest does predict its own ship, because a ship that answers
// the stick a round trip later is not flyable. It flies locally and
// is corrected toward the host's position; see applySnapshot.

import { VIEW_W } from './config.js';

// --- wire format
//
// Binary, little-endian, hand-packed. JSON was the obvious first
// choice and is about four times the size for this shape of data —
// at twenty snapshots a second that is the difference between
// comfortable and not on a slow link.
//
// Positions in a snapshot are stored as offsets from the camera in
// signed 16-bit pixels. Anything outside the view is not drawn, so a
// pixel of precision across a 640-wide window is exact, and it costs
// two bytes instead of four.

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;
export const MSG_HELLO = 3;

// The buttons a guest can press, as bits. The order is fixed: adding
// one goes on the end, because both sides have to agree and a client
// may be a version behind.
export const INPUT_BITS = [
  'left', 'right', 'up', 'down', 'fire', 'secondary', 'cycle', 'jump',
];

// Attacker kinds, indexed. An index rather than a string per foe:
// twenty-six attackers at eight bytes of name each, twenty times a
// second, for no information a byte cannot carry.
let KINDS = [];
let KIND_OF = new Map();

// setKinds must be called once with the game's attacker roster before
// anything is encoded. Passed in rather than imported so this module
// does not drag the whole config into a test that only wants the
// codec.
export function setKinds(list) {
  KINDS = list.slice();
  KIND_OF = new Map(KINDS.map((k, i) => [k, i]));
}
export const kindAt = (i) => KINDS[i] || KINDS[0] || 'mine';
const kindIndex = (k) => (KIND_OF.has(k) ? KIND_OF.get(k) : 0);

// Caps on what one snapshot describes. The pools are bigger than
// this; what is not sent is what is off screen, which nobody can see
// anyway. Fixed so a reader can trust a length byte.
const MAX_FOES = 32;
const MAX_SHOTS = 190;
const MAX_PICKUPS = 48;
// Interceptors are capped in the game itself at INTERCEPTOR.maxActive
// plus two; this is comfortably above that.
const MAX_INTERCEPTORS = 16;

// How far outside the view an entity is still worth sending. A shot
// just off the edge is about to be on screen.
const CULL = 48;

// Big enough for the worst frame the caps above allow: two ships, 32
// attackers, 190 shots each way and 48 pickups comes to about 2.4KB,
// and the first buffer was 2048 — so a hectic frame threw
// "Offset is outside the bounds of the DataView" and the snapshot
// simply stopped arriving. Sized from the caps, with a check in the
// writer so the next person to raise one finds out here.
// Stands in for a pool a caller did not pass.
const EMPTY_POOL = { count: 0, items: [] };

const SNAPSHOT_BYTES = 4096;

// A reusable buffer. Allocating four kilobytes twenty times a second
// is not fatal, and not doing it is free.
const outBuf = new ArrayBuffer(SNAPSHOT_BYTES);
const outView = new DataView(outBuf);

class Writer {
  constructor(view) { this.v = view; this.at = 0; }
  // Room for one more entity of this size? Asked before writing one,
  // so a frame runs out of buffer by sending fewer things rather
  // than by throwing.
  room(n) { return this.at + n <= this.v.byteLength; }
  u8(n) { this.v.setUint8(this.at, n & 0xff); this.at += 1; }
  i8(n) { this.v.setInt8(this.at, Math.max(-128, Math.min(127, n | 0))); this.at += 1; }
  u16(n) { this.v.setUint16(this.at, n & 0xffff, true); this.at += 2; }
  i16(n) {
    this.v.setInt16(this.at, Math.max(-32768, Math.min(32767, Math.round(n) || 0)), true);
    this.at += 2;
  }
  u32(n) { this.v.setUint32(this.at, n >>> 0, true); this.at += 4; }
  f32(n) { this.v.setFloat32(this.at, Number.isFinite(n) ? n : 0, true); this.at += 4; }
}

// Reading past the end throws, because DataView already does that and
// a hand-written length check on every accessor would be the same
// behaviour in more code. The decoders catch it and answer null: the
// bytes came off a socket, and the only sane response to a message
// that does not parse is to ignore it.
class Reader {
  constructor(view) { this.v = view; this.at = 0; }
  u8() { const n = this.v.getUint8(this.at); this.at += 1; return n; }
  i8() { const n = this.v.getInt8(this.at); this.at += 1; return n; }
  u16() { const n = this.v.getUint16(this.at, true); this.at += 2; return n; }
  i16() { const n = this.v.getInt16(this.at, true); this.at += 2; return n; }
  u32() { const n = this.v.getUint32(this.at, true); this.at += 4; return n; }
  f32() { const n = this.v.getFloat32(this.at, true); this.at += 4; return n; }
  get left() { return this.v.byteLength - this.at; }
}

// --- input, guest to host

export function encodeInput(tick, held) {
  const b = new ArrayBuffer(5);
  const w = new Writer(new DataView(b));
  w.u8(MSG_INPUT);
  w.u16(tick);
  let bits = 0;
  for (let i = 0; i < INPUT_BITS.length; i++) {
    if (held.has(INPUT_BITS[i])) bits |= 1 << i;
  }
  w.u16(bits);
  return b;
}

export function decodeInput(buf) {
  try {
    const r = new Reader(new DataView(buf));
    if (r.u8() !== MSG_INPUT) return null;
    const tick = r.u16();
    const bits = r.u16();
    const held = new Set();
    for (let i = 0; i < INPUT_BITS.length; i++) {
      if (bits & (1 << i)) held.add(INPUT_BITS[i]);
    }
    return { tick, held };
  } catch { return null; }
}

// --- snapshot, host to guest

const shipFlags = (p) => (p.alive ? 1 : 0) | (p.flip > 0 ? 2 : 0) | (p.thrusting ? 4 : 0);

// Everything the far end needs to draw a ship AND to say how it is
// doing. The second half of that is newer than the first: the other
// pilot's shield and spare ships are on screen now, in the mini-HUD,
// and a panel cannot show a number nobody sent.
//
// Shield is two bytes, not one. It was one, clamped to 255, which is
// fine for a stock hull at 100 and wrong from hull four onwards: the
// refit raises shieldMax every hull and it passes a thousand by the
// end of a long run, so a pilot at 400 of 600 was transmitted as 255
// and — because the guest takes its own shield from the host rather
// than predicting it — actually had its shield cut to 255 on screen.
//
// The ceiling goes with it. A bar is a fraction, and a fraction needs
// its denominator; without it the guest drew the other pilot's 300
// against its own 100 and showed a bar three times over.
function writeShip(w, p, camX) {
  w.i16(p.x - camX);
  w.i16(p.y);
  w.i16(p.vx / 4);
  w.i16(p.vy / 4);
  w.i8(p.facing);
  w.u8(shipFlags(p));
  w.u16(Math.max(0, Math.round(p.shield)));
  w.u16(Math.max(1, Math.round(p.shieldMax || 1)));
  // Spare hulls. Capped at PICKUP.maxLives, which is 6, so a byte is
  // room to spare. This used to be sent once for the whole game, off
  // a game.lives that has never existed — the field is the player's —
  // so the byte was always zero and the guest copied it into a field
  // nothing reads. Per ship, because the two pilots lose their own.
  w.u8(Math.max(0, Math.min(255, p.lives | 0)));
}

function readShip(r, camX) {
  const x = r.i16() + camX;
  const y = r.i16();
  const vx = r.i16() * 4;
  const vy = r.i16() * 4;
  const facing = r.i8();
  const flags = r.u8();
  const shield = r.u16();
  const shieldMax = r.u16();
  const lives = r.u8();
  return {
    x, y, vx, vy, facing, shield, shieldMax, lives,
    alive: (flags & 1) !== 0,
    flip: (flags & 2) !== 0 ? 1 : 0,
    thrusting: (flags & 4) !== 0,
  };
}

const inView = (x, camX) => x > camX - CULL && x < camX + VIEW_W + CULL;

/**
 * Pack the world as the host sees it.
 *
 * `second` is the guest's ship, which the host also simulates — the
 * guest's copy is a prediction and this is the truth it is corrected
 * against.
 */
export function encodeSnapshot(game, second, tick, pools) {
  // interceptors defaults to empty: it arrived later than the rest,
  // and a caller that has not heard of it should get a snapshot
  // without interceptors rather than a crash.
  const { foes, playerShots, enemyShots, pickups } = pools;
  const interceptors = pools.interceptors || EMPTY_POOL;
  const camX = game.cam.x;
  const w = new Writer(outView);
  w.u8(MSG_SNAPSHOT);
  w.u16(tick & 0xffff);
  w.f32(camX);
  w.u8(STATES.indexOf(game.state) < 0 ? 0 : STATES.indexOf(game.state));
  w.u32(Math.max(0, game.score | 0));
  w.u8(Math.max(0, Math.min(255, game.levelIndex | 0)));

  writeShip(w, game.player, camX);
  writeShip(w, second, camX);

  let n = 0;
  const foeAt = w.at;
  w.u8(0);
  for (let i = 0; i < foes.count && n < MAX_FOES; i++) {
    const f = foes.items[i];
    if (!inView(f.x, camX)) continue;
    if (!w.room(7 + 2)) break;
    w.u8(kindIndex(f.kind));
    w.i16(f.x - camX);
    w.i16(f.y);
    w.i8(f.facing);
    w.u8((f.flash > 0 ? 1 : 0) | (f.shield > 0 ? 2 : 0));
    n++;
  }
  outView.setUint8(foeAt, n);

  for (const [pool, cap] of [[playerShots, MAX_SHOTS], [enemyShots, MAX_SHOTS]]) {
    let m = 0;
    const at = w.at;
    w.u8(0);
    for (let i = 0; i < pool.count && m < cap && m < 255; i++) {
      const s = pool.items[i];
      if (!inView(s.x, camX)) continue;
        // Unreachable at today's caps — the buffer is sized from them —
      // and kept because that stops being true the moment somebody
      // raises one, and the symptom then is a DataView exception in
      // the middle of a firefight rather than a slightly thinner
      // snapshot.
      if (!w.room(5 + 2)) break;
      w.i16(s.x - camX);
      w.i16(s.y);
      // One byte carries all three things the renderer asks of a
      // shot: how big it is, which way it points, and whether it is
      // a missile. Radii are 2 to 8, so six bits is room to spare
      // and the other two are free.
      const r6 = Math.max(1, Math.min(63, Math.round(s.r)));
      w.u8(r6 | (s.vx < 0 ? 0x40 : 0) | (s.seek > 0 ? 0x80 : 0));
      m++;
    }
    outView.setUint8(at, m);
  }

  // Interceptors. Not attackers and not turrets — their own pool, and
  // the first version of this left them out, so the guest flew
  // through a fight it could not see. A player who cannot see what is
  // shooting at them is not playing the same game.
  let ic = 0;
  const icAt = w.at;
  w.u8(0);
  for (let i = 0; i < interceptors.count && ic < MAX_INTERCEPTORS; i++) {
    const e = interceptors.items[i];
    if (!inView(e.x, camX)) continue;
    if (!w.room(5 + 2)) break;
    w.i16(e.x - camX);
    w.i16(e.y);
    w.i8(e.dirX);
    ic++;
  }
  outView.setUint8(icAt, ic);

  let k = 0;
  const pickAt = w.at;
  w.u8(0);
  for (let i = 0; i < pickups.count && k < MAX_PICKUPS; i++) {
    const p = pickups.items[i];
    if (!inView(p.x, camX)) continue;
    if (!w.room(5)) break;
    w.i16(p.x - camX);
    w.i16(p.y);
    w.u8(PICKUP_KINDS.indexOf(p.kind) < 0 ? 0 : PICKUP_KINDS.indexOf(p.kind));
    k++;
  }
  outView.setUint8(pickAt, k);

  return outBuf.slice(0, w.at);
}

// Game states, indexed for the wire. Order is fixed for the same
// reason the input bits are.
export const STATES = [
  'title', 'splash', 'launching', 'play', 'dying', 'levelclear',
  'exiting', 'gameover', 'ending', 'victory', 'shop',
];

export const PICKUP_KINDS = [
  'shield', 'coin', 'bar', 'gun', 'bomb', 'grenade', 'missile', 'mine',
  'coffin', 'treasure', 'life',
];

export function decodeSnapshot(buf) {
  try {
    return readSnapshot(buf);
  } catch {
    // Truncated, or not ours. Dropped rather than half-applied: half
    // a snapshot would put the guest's ships somewhere and leave its
    // attackers where they were, which looks like a bug in the game.
    return null;
  }
}

function readSnapshot(buf) {
  const r = new Reader(new DataView(buf));
  if (r.left < 2 || r.u8() !== MSG_SNAPSHOT) return null;
  const tick = r.u16();
  const camX = r.f32();
  const state = STATES[r.u8()] || 'play';
  const score = r.u32();
  const levelIndex = r.u8();

  const ships = [readShip(r, camX), readShip(r, camX)];

  const foeList = [];
  const nf = r.u8();
  for (let i = 0; i < nf; i++) {
    // Read in the order it was written. Spelled out rather than built
    // in an object literal: the fields are read by side effect, and
    // an object literal's evaluation order is a thing to look up
    // rather than a thing to see.
    const kind = kindAt(r.u8());
    const x = r.i16() + camX;
    const y = r.i16();
    const facing = r.i8();
    const flags = r.u8();
    foeList.push({
      kind, x, y, facing,
      flash: flags & 1 ? 0.1 : 0,
      shield: flags & 2 ? 1 : 0,
    });
  }

  const readShots = () => {
    const out = [];
    const n = r.u8();
    for (let i = 0; i < n; i++) {
      const x = r.i16() + camX;
      const y = r.i16();
      const packed = r.u8();
      out.push({
        x, y,
        r: packed & 0x3f,
        dir: packed & 0x40 ? -1 : 1,
        seek: (packed & 0x80) !== 0,
      });
    }
    return out;
  };
  const mine = readShots();
  const theirs = readShots();

  const chasers = [];
  const ni = r.u8();
  for (let i = 0; i < ni; i++) {
    chasers.push({ x: r.i16() + camX, y: r.i16(), dirX: r.i8() || -1 });
  }

  const loot = [];
  const np = r.u8();
  for (let i = 0; i < np; i++) {
    loot.push({
      x: r.i16() + camX, y: r.i16(),
      kind: PICKUP_KINDS[r.u8()] || 'coin',
    });
  }

  return {
    tick, camX, state, score, levelIndex,
    ships, foes: foeList, playerShots: mine, enemyShots: theirs,
    interceptors: chasers, pickups: loot,
  };
}

// --- the connection

// How often a dropped pilot tries to get back in, and how long after
// giving up the notice stays on screen.
const RETRY_EVERY = 2;
// A backstop on attempts, in case the server never said how long it
// holds a slot. The window itself comes from the server — this is not
// a second copy of it, it is the thing that stops an endless retry
// loop if that number is missing.
const MAX_TRIES = 30;
// The countdown a guest gets when the host quits. Short: long enough
// to read why the run ended, not long enough to be a wait.
const QUIT_COUNTDOWN = 4;

const S = {
  // 'off' | 'opening' | 'waiting' | 'playing' | 'paused'
  //       | 'reconnecting' | 'ended'
  //
  // 'paused' is the other pilot's connection having dropped, with
  // their slot held; 'reconnecting' is ours having dropped and us
  // trying to get back in. Neither is an ending, which is the whole
  // point of having them: a dropped socket is a bad network, not a
  // decision, and it used to end the run for both pilots.
  phase: 'off',
  side: null,        // 'host' | 'guest'
  code: '',
  seed: 0,
  hull: 0,
  peerHere: false,
  error: null,
  sock: null,
  // The last snapshot a guest received, and when. The clock is for
  // noticing a host that has stopped sending without disconnecting.
  snap: null,
  snapAt: 0,
  // The guest's last reported input, as the host sees it.
  guestHeld: new Set(),
  sent: 0,
  received: 0,

  // --- leaving, on purpose or otherwise
  //
  // Which side chose to leave, when somebody did. Null when nobody
  // has: a socket that simply stopped answering leaves this alone,
  // and that difference is what the two notices below are built on.
  quitBy: null,
  // Seconds left on the guest's countdown back to the title after the
  // host quit. Zero when there is no countdown running.
  endIn: 0,
  // A hold: how long we have been waiting, and how long the server
  // said it would keep the slot. The window comes from the server so
  // the client does not keep its own copy of a number the server
  // owns.
  heldFor: 0,
  resumeSec: 0,
  // Our own reconnect attempts: seconds until the next one, and how
  // many we have made.
  retryIn: 0,
  tries: 0,
  // Set while leaveGame is closing the socket on purpose, so the
  // close handler does not read it as a drop and start reconnecting
  // to a game the pilot has just walked out of.
  leaving: false,
};

export const coopState = () => S;
// A held run is still a co-op run. Including the two waiting phases
// here is what keeps the second ship on screen and the run's shape
// intact across a drop, so that coming back resumes rather than
// restarts.
export const isCoop = () => S.phase === 'playing' || S.phase === 'waiting'
  || S.phase === 'paused' || S.phase === 'reconnecting';
export const isHost = () => S.side === 'host';
export const isGuest = () => S.side === 'guest';
export const coopSnapshot = () => S.snap;
export const guestHeld = () => S.guestHeld;
// The run is held and must not advance: either we are waiting for the
// other pilot's socket or they are waiting for ours. Nothing moves on
// either machine in the meantime — a host that kept simulating would
// fly the returning guest's ship into whatever arrived while they
// were gone.
export const coopHolding = () => S.phase === 'paused' || S.phase === 'reconnecting';
// Seconds left before the hold gives up, floored at zero.
export const coopHoldLeft = () => Math.max(0, Math.ceil(S.resumeSec - S.heldFor));

function wsURL(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

function attach(sock) {
  S.sock = sock;
  sock.binaryType = 'arraybuffer';
  sock.onmessage = (ev) => {
    S.received++;
    if (typeof ev.data === 'string') {
      let m = null;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'joined') {
        S.seed = m.seed;
        S.hull = m.hull;
        S.peerHere = !!m.peer;
        S.phase = m.peer ? 'playing' : 'waiting';
        if (m.resumeSec) S.resumeSec = m.resumeSec;
        // Back in. Not a fresh pairing: the run is still going, so
        // nothing resets and the hold simply lifts.
        if (m.resumed) {
          S.heldFor = 0;
          S.retryIn = 0;
          S.tries = 0;
          S.error = null;
        }
      } else if (m.t === 'peer-joined') {
        S.peerHere = true;
        S.phase = 'playing';
      } else if (m.t === 'peer-back') {
        // Their socket is back and the run goes on from where it
        // stopped.
        S.peerHere = true;
        S.phase = 'playing';
        S.heldFor = 0;
        S.error = null;
      } else if (m.t === 'peer-gone') {
        // Dropped without saying so. Their slot is held; we wait.
        S.peerHere = false;
        S.phase = 'paused';
        S.heldFor = 0;
        if (m.resumeSec) S.resumeSec = m.resumeSec;
      } else if (m.t === 'peer-quit') {
        // A decision, not a network. Named, because what to do about
        // it differs: a guest whose host quit is going back to the
        // title either way and gets told why first, and a host whose
        // guest quit can keep flying the run it is in.
        S.peerHere = false;
        S.quitBy = m.side === 'guest' ? 'guest' : 'host';
        S.phase = 'ended';
        S.error = S.quitBy === 'host'
          ? 'the first pilot quit the game' : 'the second pilot quit the game';
        if (S.quitBy === 'host' && S.side === 'guest') S.endIn = QUIT_COUNTDOWN;
      } else if (m.t === 'peer-left') {
        S.peerHere = false;
        S.phase = 'ended';
        S.error = 'the other pilot left';
      } else if (m.t === 'refused') {
        S.phase = 'ended';
        S.error = m.why || 'refused';
      }
      return;
    }
    // Binary: a snapshot if we are the guest, an input frame if we
    // are the host.
    const view = new DataView(ev.data);
    if (view.byteLength < 1) return;
    const tag = view.getUint8(0);
    if (tag === MSG_SNAPSHOT) {
      const snap = decodeSnapshot(ev.data);
      if (snap) { S.snap = snap; S.snapAt = performance.now(); }
    } else if (tag === MSG_INPUT) {
      const got = decodeInput(ev.data);
      if (got) S.guestHeld = got.held;
    }
  };
  sock.onclose = () => {
    S.sock = null;
    // Walked out on purpose, or already over: nothing to recover.
    if (S.leaving || S.phase === 'ended' || S.phase === 'off') return;
    // Our own socket went while a run was under way. That is the
    // other half of the drop the far side is being told about: try to
    // get back into the room, which the server is holding for exactly
    // this. It used to end here, which meant a tab suspended for a
    // moment cost the run.
    if (S.code && (S.phase === 'playing' || S.phase === 'paused'
      || S.phase === 'reconnecting')) {
      // The elapsed clock is only reset on the way IN to reconnecting.
      // Resetting it on every close reset it on every failed attempt
      // too, so the give-up deadline never arrived and the client
      // hammered a room that had long since been swept.
      if (S.phase !== 'reconnecting') {
        S.heldFor = 0;
        S.retryIn = 0;
      }
      S.phase = 'reconnecting';
      S.peerHere = false;
      S.error = null;
      return;
    }
    S.phase = 'ended';
    S.error = S.error || 'the connection closed';
  };
  sock.onerror = () => { S.error = S.error || 'the connection failed'; };
}

/** Open a room and wait in it. Returns the code to share, or null. */
export async function hostGame(seed, hull, token) {
  S.phase = 'opening';
  S.error = null;
  try {
    const res = await fetch('/api/coop/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ seed, hull }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      S.phase = 'off';
      S.error = (body && body.error) || `could not open a game (${res.status})`;
      return null;
    }
    const room = await res.json();
    S.code = room.code;
    S.seed = room.seed;
    S.hull = room.hull;
    S.side = 'host';
    attach(new WebSocket(wsURL(`/api/coop/${room.code}/host`)));
    return room.code;
  } catch {
    S.phase = 'off';
    S.error = 'could not reach the backend';
    return null;
  }
}

/** Look a room up without committing a socket to it. */
export async function peekGame(code) {
  try {
    const res = await fetch(`/api/coop/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * Join somebody else's room.
 *
 * Two steps, and the first one is the new part: a POST that claims the
 * guest slot for this account, before any socket. The co-op board
 * credits two pilots, so the server has to know who the second one is,
 * and a browser cannot put an Authorization header on a WebSocket. A
 * POST first keeps the token out of the URL -- a token in a query
 * string lands in access logs -- and it also replaces the peek: the
 * reply carries the same seed, hull and host name.
 *
 * So joining now needs an account. Hosting already did, and a run the
 * board cannot name both pilots of is a run the board cannot take.
 */
export async function joinGame(code, token) {
  S.phase = 'opening';
  S.error = null;
  if (!token) {
    S.phase = 'off';
    S.error = 'sign in to join a co-op game';
    return false;
  }
  let room = null;
  try {
    const res = await fetch(`/api/coop/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      S.phase = 'off';
      S.error = (body && body.error) || `could not join (${res.status})`;
      return false;
    }
    room = await res.json();
  } catch {
    S.phase = 'off';
    S.error = 'could not reach the backend';
    return false;
  }
  S.code = room.code;
  S.seed = room.seed;
  S.hull = room.hull;
  S.side = 'guest';
  attach(new WebSocket(wsURL(`/api/coop/${room.code}/guest`)));
  return true;
}

export function leaveGame() {
  // Flagged before the close, so the close handler knows this was a
  // decision and does not start trying to reconnect to a game the
  // pilot has just walked out of.
  S.leaving = true;
  if (S.sock) {
    try { S.sock.close(); } catch { /* already gone */ }
  }
  S.sock = null;
  S.phase = 'off';
  S.side = null;
  S.code = '';
  S.peerHere = false;
  S.snap = null;
  S.error = null;
  S.guestHeld = new Set();
  S.quitBy = null;
  S.endIn = 0;
  S.heldFor = 0;
  S.resumeSec = 0;
  S.retryIn = 0;
  S.tries = 0;
  S.leaving = false;
}

/**
 * Leave, and say so first.
 *
 * The whole difference between this and closing the tab. A socket
 * going quiet is indistinguishable from a bad network at both ends, so
 * the one case where it is not a bad network says as much while it
 * still can — and the other pilot gets told what happened instead of
 * being made to wait out a hold for somebody who is never coming back.
 *
 * Sent on the socket rather than as a request: it is the connection
 * that is ending, the server is already listening to it, and a POST
 * that has to be authenticated and routed is a lot of machinery for
 * one word said on a pipe that is open.
 */
export function quitGame() {
  if (S.sock && S.sock.readyState === 1) {
    try { S.sock.send('{"t":"quit"}'); } catch { /* going anyway */ }
  }
  leaveGame();
}

function send(data) {
  const s = S.sock;
  if (!s || s.readyState !== 1) return false;
  try { s.send(data); S.sent++; return true; } catch { return false; }
}

export function sendInput(tick, held) { return send(encodeInput(tick, held)); }

export function sendSnapshot(game, second, tick, pools) {
  return send(encodeSnapshot(game, second, tick, pools));
}

/**
 * Is the host still talking?
 *
 * A socket that is open and silent is the worst case for a guest: the
 * world simply stops, with no explanation. Half a second of nothing
 * is far longer than the twenty-a-second the host sends at.
 */
export function hostStalled() {
  return S.side === 'guest' && S.phase === 'playing'
    && S.snapAt > 0 && performance.now() - S.snapAt > 500;
}

/**
 * The clocks that are not the game's.
 *
 * Driven from the frame rather than from timers, and this is the
 * reason: all three of these run while the run itself is stopped, and
 * every one of them has to be something a test can step through
 * rather than wait out. A setTimeout here would also outlive the
 * screen that started it, which for a reconnect loop means hammering
 * a room the pilot left minutes ago.
 */
export function coopTick(dt) {
  // The guest's countdown back to the title after the host quit.
  if (S.endIn > 0) S.endIn = Math.max(0, S.endIn - dt);

  if (S.phase === 'paused') {
    S.heldFor += dt;
    if (S.resumeSec > 0 && S.heldFor > S.resumeSec) {
      // The server has stopped holding their slot, so there is
      // nothing left to wait for.
      S.phase = 'ended';
      S.error = 'the other pilot did not come back';
    }
    return;
  }

  if (S.phase !== 'reconnecting') return;

  S.heldFor += dt;
  // Past the window the server quoted, the room is gone and so is any
  // point in asking for it again.
  if ((S.resumeSec > 0 && S.heldFor > S.resumeSec) || S.tries > MAX_TRIES) {
    S.phase = 'ended';
    S.error = 'could not get back into the game';
    return;
  }
  S.retryIn -= dt;
  if (S.retryIn > 0 || S.sock) return;
  S.retryIn = RETRY_EVERY;
  S.tries++;
  // Straight back onto the socket, with no POST in front of it. The
  // room already knows which account holds this side — the host's
  // came with the room and the guest's was recorded at /join — so
  // there is nothing to claim a second time, and one fewer thing that
  // can fail while trying to recover.
  try {
    attach(new WebSocket(wsURL(`/api/coop/${S.code}/${S.side}`)));
  } catch {
    S.sock = null;
  }
}
