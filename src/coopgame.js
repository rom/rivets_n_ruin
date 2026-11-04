// Co-op, where it meets the game loop.
//
// Kept out of game.js on purpose. The single-player loop is long
// enough already, and the two things co-op needs from it — a second
// ship on the host, and a world replaced wholesale on the guest — are
// each one call at one place. Everything else lives here.
//
// The split, again, because it is the thing to hold in your head:
//
//   The host simulates everything, including the guest's ship, from
//   the inputs the guest sends. It is the only machine whose opinion
//   about where anything is counts.
//
//   The guest flies its own ship locally so the stick answers now
//   rather than a round trip later, and is corrected toward the
//   host's position every snapshot. Everything else on its screen —
//   the other ship, the attackers, the shots, the loot — is the
//   host's word, copied into the same pools the single-player
//   renderer already reads, so not one drawing function had to learn
//   that co-op exists.

import { SHIP, VIEW_W, FIELD_TOP, FIELD_BOT, DT } from './config.js';
import { updatePlayer, makePlayer } from './player.js';
import { foes } from './foes.js';
import { interceptors } from './enemies.js';
import { playerShots, enemyShots } from './projectiles.js';
import { pickups } from './pickups.js';
import { held as keyHeld } from './input.js';
import {
  isCoop, isHost, isGuest, coopState, coopSnapshot, guestHeld,
  sendInput, sendSnapshot, setKinds,
} from './coop.js';

// Snapshots a second. Twenty is the usual answer for a game at this
// speed: the ships are interpolated between them and the rest is
// redrawn, and going to sixty triples the bandwidth to move things
// that were already close enough.
const SNAPSHOT_HZ = 20;
const SNAPSHOT_EVERY = 1 / SNAPSHOT_HZ;

// How hard the guest's predicted ship is pulled back to where the
// host says it is.
//
// Snapping would make every packet a visible twitch. Ignoring the
// correction would let the two screens drift apart until the guest is
// flying somewhere the host is not. A fraction per frame converges in
// a few frames and reads as nothing.
const CORRECT = 0.25;
// Past this the prediction was wrong about something structural — a
// wall, a death, a hull change — and easing there would fly the ship
// through whatever it got wrong. Snap instead.
const CORRECT_SNAP = 90;

let tick = 0;
let sinceSnapshot = 0;

/** Called once at boot with the attacker roster, for the wire codec. */
export function initCoop(kinds) { setKinds(kinds); }

/**
 * The second ship.
 *
 * A real player object, not a position: on the host it is simulated
 * by exactly the same code as the first one, which is what stops the
 * two ships behaving differently. On the guest it is a puppet with
 * the host's numbers in it.
 */
export function ensureMate(game) {
  if (!game.mate) {
    game.mate = makePlayer();
    game.mate.isMate = true;
  }
  return game.mate;
}

export function clearMate(game) { game.mate = null; }

/**
 * Where the camera should be with two ships in the world.
 *
 * The midpoint, so neither pilot is a passenger, clamped so that
 * neither can be pushed off the edge of the view by the other flying
 * away. That clamp is the whole rule: without it the faster pilot
 * drags the screen and the slower one is scrolled into the wall,
 * which is the oldest complaint about shared-screen co-op there is.
 */
export function coopCameraTarget(a, b, levelLen) {
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  const mid = (lo + hi) / 2;
  const maxX = Math.max(0, levelLen - VIEW_W);
  // The margin keeps a ship off the very edge, where it cannot see
  // what it is about to fly into.
  const margin = 56;
  let want = mid - VIEW_W / 2;
  // Both inside, if they fit. When they do not — they are further
  // apart than the screen is wide — the midpoint is the fairest
  // compromise and the leash below is what stops it mattering.
  if (hi - lo < VIEW_W - margin * 2) {
    want = Math.min(want, lo - margin);
    want = Math.max(want, hi + margin - VIEW_W);
  }
  return Math.max(0, Math.min(maxX, want));
}

/**
 * Keep both ships in the room.
 *
 * The camera cannot stretch, so past a point one of them has to stop.
 * A hard stop at the edge rather than a rubber band: a ship that
 * silently refuses to go further is confusing for a moment, and a
 * ship that is dragged backwards by its partner is confusing for the
 * whole run.
 */
export function leashShips(a, b, camX) {
  const lo = camX + SHIP.hitW;
  const hi = camX + VIEW_W - SHIP.hitW;
  for (const p of [a, b]) {
    if (!p || !p.alive) continue;
    if (p.x < lo) { p.x = lo; if (p.vx < 0) p.vx = 0; }
    if (p.x > hi) { p.x = hi; if (p.vx > 0) p.vx = 0; }
    p.y = Math.max(FIELD_TOP + SHIP.hitH, Math.min(FIELD_BOT - SHIP.hitH, p.y));
  }
}

// --- the host

/**
 * One frame on the host: fly the guest's ship from the input it sent,
 * keep both on screen, and send the world out at the snapshot rate.
 *
 * Called after the rest of the frame, so the snapshot describes the
 * world as it ended up rather than as it was halfway through.
 */
export function hostFrame(game, dt) {
  const mate = ensureMate(game);
  // The guest's buttons, as a stand-in for the keyboard. Exactly the
  // same update path as the host's own ship: a second code path for
  // the second player is a second set of bugs.
  updatePlayer(mate, game, dt, guestHeld());

  game.cam.x = coopCameraTarget(game.player, mate, game.level.length);
  leashShips(game.player, mate, game.cam.x);

  sinceSnapshot += dt;
  if (sinceSnapshot >= SNAPSHOT_EVERY) {
    sinceSnapshot = 0;
    tick = (tick + 1) & 0xffff;
    sendSnapshot(game, mate, tick, { foes, playerShots, enemyShots, pickups, interceptors });
  }
}

// --- the guest

/**
 * Before the frame: stop the guest's own world from running.
 *
 * The guest still runs the loop, because that is what flies its ship
 * and makes its particles. What it must not do is invent attackers
 * and loot of its own, because those would be replaced by the host's
 * a moment later and the only trace would be sounds for things that
 * never happened.
 */
export function guestPreFrame(game) {
  game.spawnCd = 1e9;
  game.foeCd = 1e9;
}

/**
 * After the frame: replace the world with the host's.
 *
 * Into the same pools the single-player renderer reads, which is why
 * none of the drawing code knows about any of this.
 */
export function guestApply(game) {
  const snap = coopSnapshot();
  if (!snap) return;

  // The guest is ships[1]; the host is ships[0].
  const mine = snap.ships[1];
  const theirs = snap.ships[0];
  const p = game.player;

  // Correct the prediction. Eased when close, snapped when not: past
  // the threshold the local guess was wrong about something
  // structural — a wall, a death — and easing there flies the ship
  // through whatever it got wrong.
  const dx = mine.x - p.x;
  const dy = mine.y - p.y;
  if (Math.hypot(dx, dy) > CORRECT_SNAP) {
    p.x = mine.x; p.y = mine.y;
  } else {
    p.x += dx * CORRECT;
    p.y += dy * CORRECT;
  }
  // Not predicted: these are the host's to decide, and a guest that
  // disagreed about its own shield would show a bar nobody else
  // could see.
  p.shield = mine.shield;
  p.alive = mine.alive;

  const mate = ensureMate(game);
  mate.x = theirs.x;
  mate.y = theirs.y;
  mate.vx = theirs.vx;
  mate.vy = theirs.vy;
  mate.facing = theirs.facing || 1;
  mate.alive = theirs.alive;
  mate.shield = theirs.shield;
  mate.flip = theirs.flip;

  game.cam.x = snap.camX;
  game.score = snap.score;
  game.lives = snap.lives;

  fillPools(snap);
}

// Copy the snapshot's lists into the pools the renderer reads.
//
// The pools are the game's own, and everything in them this frame
// came from the host. A field the drawing code reads and the wire
// does not carry has to be given something sensible here, or the
// guest's screen gets a flicker nobody can explain.
function fillPools(snap) {
  foes.clear();
  for (const f of snap.foes) {
    const o = foes.spawn();
    if (!o) break;
    o.kind = f.kind;
    o.x = f.x; o.y = f.y; o.baseY = f.y;
    o.vx = 0; o.vy = 0;
    o.facing = f.facing || -1;
    o.flash = f.flash;
    o.shield = f.shield;
    o.shieldMax = f.shield ? f.shield : 0;
    o.shieldFlash = 0;
    o.hp = 1;
    o.state = 0;
    o.t = 0;
    o.dead = false;
    o.held = 0;
    o.mate = null;
    o.parent = null;
  }

  for (const [pool, list] of [[playerShots, snap.playerShots], [enemyShots, snap.enemyShots]]) {
    pool.clear();
    for (const s of list) {
      const o = pool.spawn();
      if (!o) break;
      o.x = s.x; o.y = s.y;
      // Direction, not speed: all the renderer asks of vx is its sign.
      o.vx = s.dir * 100;
      o.vy = 0;
      o.r = s.r;
      o.seek = s.seek ? 1 : 0;
      o.life = 1;
      o.dmg = 0;
      o.hp = 0;
      o.t = 0;
      o.fx = '';
      o.fxFrom = null;
    }
  }

  interceptors.clear();
  for (const e of snap.interceptors || []) {
    const o = interceptors.spawn();
    if (!o) break;
    o.x = e.x; o.y = e.y; o.baseY = e.y;
    o.dirX = e.dirX;
    o.t = 0; o.hp = 1; o.fireCd = 1;
  }

  pickups.clear();
  for (const k of snap.pickups) {
    const o = pickups.spawn();
    if (!o) break;
    o.x = k.x; o.y = k.y; o.baseY = k.y;
    o.vx = 0; o.vy = 0;
    o.kind = k.kind;
    o.life = 10; o.maxLife = 10; o.t = 0;
  }
}

/**
 * The guest's input, sent every frame.
 *
 * Every frame rather than every snapshot: an input is five bytes and
 * a dropped one is a button press that did not happen.
 */
export function guestSendInput() {
  const set = new Set();
  for (const a of ['left', 'right', 'up', 'down', 'fire', 'secondary', 'cycle', 'jump']) {
    if (keyHeld(a)) set.add(a);
  }
  tick = (tick + 1) & 0xffff;
  sendInput(tick, set);
}

/**
 * The one call game.js makes. Returns true if the caller should skip
 * its own camera update, because co-op has already placed it.
 */
export function coopFrame(game, dt) {
  if (!isCoop()) return false;
  if (isHost()) { hostFrame(game, dt); return true; }
  if (isGuest()) { guestSendInput(); guestApply(game); return true; }
  return false;
}

export { isCoop, isHost, isGuest, coopState, DT };
