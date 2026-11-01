// Extra attacker types, introduced hull by hull.
//
// Interceptors teach dodging and turrets teach prioritising. These four each
// ask a different question, and which ones appear is listed per level in
// LEVELS[].foes, so the hulls escalate in kind as well as in number.

import {
  FIELD_TOP, FIELD_BOT, VIEW_W, APRON, clamp, CULL_MARGIN, FOE_PACE,
} from './config.js';
import { makePool } from './pool.js';
import { award, hurt } from './score.js';
import { enemyShots, fire } from './projectiles.js';
import { explode, sparks } from './particles.js';
import { sfxTurretShot, sfxEnemyHit, sfxExplode, sfxPlayerHit} from './sfx.js';
import { spoils } from './pickups.js';
import { kick } from './camera.js';

export const SPEC = {
  // Drifts at you and detonates. Cheap to kill, expensive to ignore.
  mine:    { hp: 2, speed: 54, score: 120, r: 9, blastR: 54, blastDmg: 26, fuse: 0.45 },
  // Telegraphs, then charges flat out. Punishes sitting in a lane.
  lancer:  { hp: 3, speed: 420, score: 220, r: 11, windup: 0.85, driftSpeed: 60 },
  // Parks and sprays radially. Forces you to close or leave.
  orbiter: { hp: 4, speed: 92, score: 260, r: 12, orbitR: 34, fireEvery: 1.25, bullets: 7 },
  // Frontal shield: only hurt from above, below or behind.
  warder:  { hp: 5, speed: 120, score: 320, r: 13, fireEvery: 1.5, arc: 1.05 },
  // Fast and erratic. Nothing to out-think, everything to out-aim.
  weaver:  { hp: 2, speed: 290, score: 180, r: 9, amp: 76, freq: 5.2 },
  // Breaks into two halves that keep coming. Killing it early is cheaper.
  splitter:{ hp: 6, speed: 130, score: 300, r: 15, fireEvery: 1.8, children: 2 },
  // A half-size splitter. Only ever spawned, never rolled for.
  shard:   { hp: 2, speed: 240, score: 90, r: 8, fireEvery: 2.4 },
  // Seeds mines along its path, so ignoring it costs you the lane.
  bomber:  { hp: 5, speed: 108, score: 340, r: 14, dropEvery: 1.15 },
  // Latches on and drains the shield until it is shot off.
  // holdTime: how long it can stay attached before it has had enough.
  // Unbounded, a grab in a corridor with nothing to scrape against was
  // a drain with no answer.
  leech:   { hp: 3, speed: 210, score: 260, r: 10, drain: 11, grabR: 15, holdTime: 4.5 },

  // --- three that ask something the nine above do not.
  //
  // A roster grows by adding questions, not by adding another thing with
  // more health. Each of these makes a different move the right one.

  // Reflects what you shoot at it. The answer is to stop shooting and go
  // round, which is the one thing a shoot 'em up never asks you to do.
  mirror:  { hp: 7, speed: 86, score: 380, r: 13, reflect: 0.75, fireEvery: 2.6 },
  // Launches weavers. The question is whether to spend the time on the
  // source or keep swatting what it sends.
  carrier: { hp: 9, speed: 72, score: 420, r: 17, launchEvery: 2.2, broodMax: 3 },
  // Spawns as a linked pair with a live tether between them. Flying
  // through the tether hurts; killing either end drops it. Go round, or
  // break a link.
  chainer: { hp: 4, speed: 128, score: 300, r: 10, tetherDmg: 22, tetherGap: 96 },

  // --- weight
  //
  // The twelve above are all roughly ship-sized, so the roster reads as
  // one fleet with twelve jobs. These four are the ends of a scale.
  //
  // Size here is not a difficulty knob with art attached: a thing twice
  // as big is twice as easy to hit, so weight has to buy something. A
  // GNAT is almost free to kill and arrives in numbers; a MONITOR is
  // slow enough to go round and punishing if you do not.

  // Tiny and quick. No gun at all — it exists to be in the way, and it
  // comes in threes.
  gnat:    { hp: 1, speed: 360, score: 60, r: 6, amp: 34, freq: 7.5, swarm: 3 },
  // A single strafing pass: lines up, runs flat out, empties its gun on
  // the way through and does not come back round.
  dart:    { hp: 2, speed: 330, score: 150, r: 8, strafeEvery: 0.22, strafeShots: 4 },
  // Slow and heavy, lobbing a wide spread. Nothing to out-think; the
  // answer is to not be in the fan when it opens.
  barge:   { hp: 14, speed: 54, score: 520, r: 21, fireEvery: 2.1, spread: 5, arcDeg: 46 },
  // The heaviest thing that is not a miniboss. Two firing positions
  // that alternate, so there is no safe side, and slow enough that
  // going round it is always available and always costs you ground.
  monitor: { hp: 22, speed: 38, score: 760, r: 25, fireEvery: 1.6, mounts: 2, burst: 3 },
};

// A deflector bubble, fitted to some attackers on later hulls. Unlike a
// warder's plate it covers every side: there is no angle to flank it from,
// only damage to put through it. It is drawn, because an enemy that eats
// shots for no visible reason is a bug as far as the player is concerned.
export const SHIELD = {
  hp: 9,                 // damage it absorbs before the hull is reachable
  r: 7,                  // how far outside the attacker it sits
  // Which kinds can carry one, and how likely that is per hull index. The
  // first hulls field none at all: a shield is a thing the campaign
  // introduces, not a thing it opens with.
  kinds: ['orbiter', 'warder', 'bomber', 'splitter', 'leech'],
  fromLevel: 3,
  chance: 0.22,          // on the first hull that fields them
  perLevel: 0.09,        // and this much more each hull after
  hpPerLevel: 2.5,       // tougher the deeper you go
};

export function shieldChanceFor(levelIndex) {
  if (levelIndex < SHIELD.fromLevel) return 0;
  return Math.min(0.75, SHIELD.chance + SHIELD.perLevel * (levelIndex - SHIELD.fromLevel));
}

// Flying into an attacker. Named rather than written into the collision
// check, where it was the only damage figure in the game that was not in
// config and not scaled by anything.
const RAM_DAMAGE = 18;

export const foes = makePool(26, () => ({
  kind: 'mine', x: 0, y: 0, baseY: 0, vx: 0, vy: 0,
  hp: 0, t: 0, cd: 0, state: 0, dead: false, flash: 0, facing: -1,
  shield: 0, shieldMax: 0, shieldFlash: 0,
  held: 0, fed: false,     // leech: how long attached, and whether it has
  mate: null, holdsLink: false, brood: 0, parent: null,
}));

export function resetFoes() { foes.clear(); }

// Anything riding the ship goes down with it.
//
// A leech latched on when a hull was lost used to survive the explosion and
// still be attached to the replacement — so one bad grab drained every
// remaining ship in turn and ended the run. The check inside the leech's
// own update (`if (!p.alive) kill`) could never fire: death switches the
// game to the 'dying' state in the same frame, and attackers are not
// updated in that state at all. It has to happen where the ship dies.
export function dropAttached(game) {
  for (let i = foes.count - 1; i >= 0; i--) {
    const f = foes.items[i];
    if (f.state !== 1 || !SPEC[f.kind] || !SPEC[f.kind].grabR) continue;
    explode(f.x, f.y, 0.9, '#d8ff9a', '#9ad94e');
    foes.kill(i);
  }
}

export function spawnFoe(game, kind) {
  const spec = SPEC[kind];
  if (!spec) return null;
  const f = foes.spawn();
  if (!f) return null;
  const p = game.player;
  const ahead = p.facing > 0;

  f.kind = kind;
  f.facing = ahead ? -1 : 1;
  f.x = ahead ? game.cam.x + VIEW_W + 26 : game.cam.x - 26;
  f.baseY = FIELD_TOP + 26 + Math.random() * (FIELD_BOT - FIELD_TOP - 52);
  f.y = f.baseY;
  f.vx = 0; f.vy = 0;
  f.hp = spec.hp;
  f.t = 0;
  f.cd = 0.4 + Math.random() * 0.8;
  f.state = 0;
  f.flash = 0;
  // Pooled: a slot that last held a fed leech must not hand a new one a
  // full stomach, or the next leech to spawn never attaches at all.
  f.held = 0;
  f.fed = false;
  f.mate = null;
  f.holdsLink = false;
  f.brood = 0;
  f.parent = null;

  // Deflector, on the kinds that can carry one, from the middle of the
  // campaign onward.
  f.shield = 0;
  f.shieldMax = 0;
  f.shieldFlash = 0;
  if (SHIELD.kinds.includes(kind) && Math.random() < shieldChanceFor(game.levelIndex || 0)) {
    f.shieldMax = Math.round(SHIELD.hp + SHIELD.hpPerLevel * (game.levelIndex || 0));
    f.shield = f.shieldMax;
  }
  return f;
}

// ------------------------------------------------------------- squadrons
//
// Attackers used to arrive one at a time, uniformly at random from the
// hull's roster. On a deep hull that is fifteen kinds all equally likely
// at every moment, which averages out: fifteen kinds shuffled that finely
// read as one kind. Nothing ever *arrived*, it just kept coming.
//
// A squadron is a composition with a shape — three gnats in a vee, a barge
// with darts screening it, a monitor on its own because that is what a
// monitor is. The gnat swarm and the chainer pair were already special
// cases of this written into the spawn path; they are entries in the table
// now, along with the rest.

// Where member i of n sits relative to the squadron's anchor. Offsets are
// in world pixels; dx is along the approach, so a positive dx is *behind*
// the leader whichever way the squadron is flying.
const FORMATION = {
  // Arrowhead. Alternates above and below, so it widens as it goes back.
  vee: (i) => ({ dx: Math.ceil(i / 2) * 22, dy: (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 25 }),
  // Nose to tail. The one that reads as a stream rather than a wall.
  column: (i) => ({ dx: i * 30, dy: (i % 2 ? 1 : -1) * 6 }),
  // Abreast, centred on the anchor: a wall you pick a side of.
  line: (i, n) => ({ dx: (i % 2) * 10, dy: (i - (n - 1) / 2) * 34 }),
  // A diagonal. Crosses your lane whatever altitude you hold.
  echelon: (i) => ({ dx: i * 24, dy: i * 22 }),
  // The leader out front, everything else tucked in behind it. Both the
  // stagger and the spread grow with each rank: at a flat 16px step the
  // first and third escorts came out on the same line 16px apart, which
  // is two sprites in one place rather than a formation.
  screen: (i) => (i === 0 ? { dx: 0, dy: 0 }
    : { dx: 34 + (i >> 1) * 26, dy: (i % 2 ? -1 : 1) * (26 + (i >> 1) * 10) }),
};

// A formation's offsets, with the leader's own offset taken out so the
// leader lands exactly where it was spawned and everything else is placed
// relative to it. Without this a centred formation — `line` — left the
// leader at dy 0 while its members sat at the centred offsets around it,
// so a line of four was unevenly spaced and its first two members came
// out 19.7px apart.
function offsets(form, n) {
  const base = form(0, n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = form(i, n);
    out.push({ dx: o.dx - base.dx, dy: o.dy - base.dy });
  }
  return out;
}

// `of` is [kind, count] pairs, in formation order. `link` wires the members
// together as a chainer pair. A squadron is eligible only if the hull
// fields every kind in it.
export const SQUADS = [
  // --- the light end: numbers, not weight
  { id: 'swarm', form: 'vee', of: [['gnat', 3]] },
  { id: 'cloud', form: 'echelon', of: [['gnat', 5]] },
  { id: 'runners', form: 'echelon', of: [['dart', 3]] },
  { id: 'pair', form: 'line', of: [['weaver', 2]] },
  { id: 'flight', form: 'vee', of: [['weaver', 2], ['gnat', 2]] },

  // --- something to kill, with something in the way of killing it
  { id: 'screened', form: 'screen', of: [['orbiter', 1], ['gnat', 3]] },
  { id: 'escorted', form: 'screen', of: [['barge', 1], ['dart', 2]] },
  { id: 'guarded', form: 'screen', of: [['carrier', 1], ['weaver', 2]] },
  { id: 'warded', form: 'line', of: [['warder', 2], ['lancer', 1]] },
  { id: 'minelayer', form: 'column', of: [['bomber', 1], ['mine', 2]] },

  // --- a line of one thing, which is a different problem from a mix
  { id: 'lances', form: 'line', of: [['lancer', 3]] },
  { id: 'battery', form: 'column', of: [['orbiter', 2]] },
  { id: 'drift', form: 'line', of: [['mine', 4]] },

  // --- the heavy end. One of these is the event.
  { id: 'monitor', form: 'column', of: [['monitor', 1]] },
  { id: 'siege', form: 'screen', of: [['monitor', 1], ['gnat', 3]] },
  { id: 'splitters', form: 'line', of: [['splitter', 2]] },

  // A chainer is half of a thing: the pair and the live tether between
  // them is the attacker. The gap is the tether's own, not a formation's.
  { id: 'chain', form: 'line', link: true, of: [['chainer', 2]] },
];

// A squadron's weight, in the only currency the roster already agrees on:
// what it is worth to kill. Used to pace the cadence, so a swarm of gnats
// comes round again quickly and a monitor buys itself a long quiet.
export function squadWeight(sq) {
  let total = 0;
  for (const [kind, n] of sq.of) total += (SPEC[kind] ? SPEC[kind].score : 0) * n;
  return total;
}

const squadKinds = (sq) => sq.of.flatMap(([kind, n]) => Array(n).fill(kind));

// Kinds that are only half an attacker on their own, and so never get a
// singleton. A chainer without its mate has no tether, which is the whole
// of what a chainer is; the old spawn path killed one that could not be
// paired rather than let it fly. A gnat alone is one hit point and no gun
// — nothing to make you move. Both were already group-only before
// squadrons existed, and generating a singleton for every roster kind
// quietly undid that for both of them.
export const NEVER_ALONE = new Set(['chainer', 'gnat']);

// Everything this hull can field: the squadrons whose every kind is on the
// roster, plus each kind on its own. Singletons stay in because a roster
// entry that only ever turns up in a group stops being its own answer to
// anything — and because a hull whose roster covers no squadron at all
// still has to spawn something.
export function squadsFor(spec) {
  const roster = spec.foes;
  if (!roster || !roster.length) return [];
  const has = new Set(roster);
  const out = SQUADS.filter((sq) => sq.of.every(([kind]) => has.has(kind)));
  for (const kind of roster) {
    if (NEVER_ALONE.has(kind)) continue;
    out.push({ id: 'lone-' + kind, form: 'column', of: [[kind, 1]] });
  }
  return out;
}

// The threat rate this hull should deliver, in points a second.
//
// Pinned to what the one-at-a-time cadence actually produced here: the
// mean worth of a roster pull, divided by the mean gap between pulls. The
// multipliers are the two kinds that never arrived alone even then.
// Squadrons change what arrives together, not how much arrives.
export function foeRateFor(spec) {
  const roster = spec.foes;
  if (!roster || !roster.length) return 0;
  let total = 0;
  for (const k of roster) {
    const together = k === 'gnat' ? (SPEC.gnat.swarm || 1) : k === 'chainer' ? 2 : 1;
    total += (SPEC[k] ? SPEC[k].score : 0) * together;
  }
  return total / roster.length / FOE_PACE.legacyGap;
}

// Cached per spec object: the filter is pure and the roster never changes
// under a hull, but this runs on a spawn timer with the game in flight.
const squadCache = new WeakMap();
function eligible(spec) {
  let list = squadCache.get(spec);
  if (!list) { list = squadsFor(spec); squadCache.set(spec, list); }
  return list;
}

// Spawns one squadron and returns it, or null. The members are placed
// relative to the leader, which is placed the way a lone attacker always
// was: off the edge the ship is facing.
export function spawnSquadron(game) {
  const list = eligible(game.level.spec);
  if (!list.length) return null;
  const sq = list[Math.floor(Math.random() * list.length)];
  const kinds = squadKinds(sq);
  const form = FORMATION[sq.form] || FORMATION.column;

  const lead = spawnFoe(game, kinds[0]);
  if (!lead) return null;
  const members = [lead];

  // Put the leader where the whole formation fits. Without this, a wide
  // one spawned near a girder had three of its members clamped onto the
  // same line — one object drawn three times rather than three things in
  // the way, which is the exact failure the gnat swarm was written to
  // avoid. If the formation is taller than the corridor the clamp below
  // still catches it; nothing in the table is.
  const place = sq.link
    ? kinds.map((_, i) => ({ dx: 0, dy: i * SPEC.chainer.tetherGap }))
    : offsets(form, kinds.length);
  let loDy = 0;
  let hiDy = 0;
  for (const o of place) {
    loDy = Math.min(loDy, o.dy);
    hiDy = Math.max(hiDy, o.dy);
  }
  const lo = FIELD_TOP + 20 - loDy;
  const hi = FIELD_BOT - 20 - hiDy;
  if (hi > lo) lead.baseY = clamp(lead.baseY, lo, hi);
  lead.y = lead.baseY;

  for (let i = 1; i < kinds.length; i++) {
    const f = spawnFoe(game, kinds[i]);
    if (!f) break;             // pool is full; however many arrived will do
    const { dx, dy } = place[i];
    // dx is along the approach: behind the leader, whichever way it flies.
    f.x = lead.x - lead.facing * dx;
    f.baseY = clamp(lead.baseY + dy, FIELD_TOP + 20, FIELD_BOT - 20);
    f.y = f.baseY;
    f.facing = lead.facing;
    // Out of phase, so a formation reads as several craft holding station
    // rather than as one shape repeated.
    f.t = lead.t + i * 0.4;
    members.push(f);
  }

  if (sq.link) {
    // A lone chainer is not an attacker, so it does not get to be one.
    if (members.length < 2) {
      foes.kill(foes.count - 1);
      return null;
    }
    members[0].mate = members[1];
    members[1].mate = members[0];
    members[0].holdsLink = true;      // only one end draws and bills it
  }

  return { squad: sq, members, weight: squadWeight(sq) };
}

// Picks one of the kinds this hull fields, on its own. The miniboss escort
// uses this: an escort is one more thing to deal with while you deal with
// the miniboss, and turning it into a five-ship formation would change
// what a miniboss is.
export function spawnFoeForLevel(game) {
  const list = game.level.spec.foes;
  if (!list || !list.length) return null;
  return spawnFoe(game, list[Math.floor(Math.random() * list.length)]);
}

// The live tether between a chainer pair. Billed from the end that holds
// the link so the player cannot be charged twice for one wire, and only
// while both ends are alive — killing either drops it, which is the
// second answer the pair offers.
function tetherHurts(game, f, dt) {
  const p = game.player;
  const m = f.mate;
  if (!f.holdsLink || !m || m.dead || m.hp <= 0 || !p.alive || p.invuln > 0) return;
  if (f.dead || f.hp <= 0) return;
  const dx = m.x - f.x;
  const dy = m.y - f.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return;
  // Distance from the ship to the segment between the two ends.
  let t = ((p.x - f.x) * dx + (p.y - f.y) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = f.x + dx * t;
  const cy = f.y + dy * t;
  if (Math.hypot(p.x - cx, p.y - cy) < 10) {
    hurt(game, SPEC.chainer.tetherDmg);
    game.flash = Math.max(game.flash, 0.4);
    kick(game.cam, 5);
    sparks(cx, cy, 0, -1, 7, '#ffd24a');
    p.invuln = 0.4;
    sfxPlayerHit();
  }
}

export function updateFoes(game, dt) {
  const p = game.player;

  for (let i = foes.count - 1; i >= 0; i--) {
    const f = foes.items[i];
    const spec = SPEC[f.kind];
    f.t += dt;
    if (f.flash > 0) f.flash -= dt;
    if (f.shieldFlash > 0) f.shieldFlash -= dt;

    switch (f.kind) {
      case 'mine': {
        // creeps toward the ship; detonates when close
        const dx = p.x - f.x;
        const dy = p.y - f.y;
        const d = Math.hypot(dx, dy) || 1;
        f.x += (dx / d) * spec.speed * dt;
        f.baseY += (dy / d) * spec.speed * dt;
        f.y = f.baseY;
        if (p.alive && d < spec.blastR * 0.42) { detonate(game, f, i); continue; }
        break;
      }

      case 'lancer': {
        if (f.state === 0) {
          // windup: drift and line up on the ship's altitude
          f.baseY += clamp(p.y - f.baseY, -spec.driftSpeed * dt, spec.driftSpeed * dt);
          f.y = f.baseY;
          f.x += f.facing * 42 * dt;
          if (f.t > spec.windup) { f.state = 1; sfxTurretShot(); }
        } else {
          f.x += f.facing * spec.speed * dt;
        }
        break;
      }

      case 'orbiter': {
        // slides to a station, then circles it and fires outward
        if (f.state === 0) {
          f.x += f.facing * spec.speed * dt;
          const target = game.cam.x + (f.facing < 0 ? VIEW_W * 0.68 : VIEW_W * 0.32);
          if ((f.facing < 0 && f.x <= target) || (f.facing > 0 && f.x >= target)) f.state = 1;
        } else {
          f.x += Math.cos(f.t * 1.7) * spec.orbitR * dt * 1.6;
          f.baseY += Math.sin(f.t * 1.7) * spec.orbitR * dt * 1.6;
        }
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.fireEvery;
          for (let k = 0; k < spec.bullets; k++) {
            const a = f.t + (k / spec.bullets) * Math.PI * 2;
            fire(enemyShots, f.x, f.y, Math.cos(a) * 150, Math.sin(a) * 150, 4, 8, 2);
          }
          sfxTurretShot();
        }
        break;
      }

      case 'weaver': {
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -70 * dt, 70 * dt);
        f.y = f.baseY + Math.sin(f.t * spec.freq) * spec.amp;
        break;
      }

      case 'splitter':
      case 'shard': {
        f.x += f.facing * spec.speed * dt;
        f.baseY += Math.sin(f.t * 1.3) * 42 * dt;
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.fireEvery;
          const a = Math.atan2(p.y - f.y, p.x - f.x);
          fire(enemyShots, f.x, f.y, Math.cos(a) * 185, Math.sin(a) * 185, 4, 9, 2);
          sfxTurretShot();
        }
        break;
      }

      case 'mirror': {
        // Closes slowly and side-on. The plate faces you, like a warder's,
        // but it answers shots by sending them back rather than eating
        // them — see hitFoe, where the reflection actually happens.
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -52 * dt, 52 * dt);
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.fireEvery;
          const a = Math.atan2(p.y - f.y, p.x - f.x);
          fire(enemyShots, f.x, f.y, Math.cos(a) * 170, Math.sin(a) * 170, 4, 9, 2);
          sfxTurretShot();
        }
        break;
      }

      case 'carrier': {
        // Keeps its distance and sends things. Its brood is counted so a
        // carrier left alone fills the screen but not the pool.
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -34 * dt, 34 * dt);
        f.y = f.baseY;
        f.cd -= dt;
        // Counted live each time rather than tallied: a counter that only
        // goes up means a carrier whose brood is shot down never launches
        // again, and an index into a swap-remove pool is a reference that
        // goes stale the first time anything else dies.
        f.brood = 0;
        for (let k = 0; k < foes.count; k++) if (foes.items[k].parent === f) f.brood++;
        if (f.cd <= 0 && game.state === 'play' && f.brood < spec.broodMax) {
          f.cd = spec.launchEvery;
          const child = spawnFoe(game, 'weaver');
          if (child) {
            child.x = f.x - f.facing * 14;
            child.baseY = f.y;
            child.y = f.y;
            child.parent = f;
            f.brood++;
            sparks(child.x, child.y, -f.facing, 0, 5, '#ff9f4a');
          }
        }
        break;
      }

      case 'chainer': {
        // Half of a pair. The tether is drawn and billed from the one
        // that holds the link, so only one of the two does the work.
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -44 * dt, 44 * dt);
        f.y = f.baseY + Math.sin(f.t * 1.9) * 16;
        break;
      }

      case 'bomber': {
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -30 * dt, 30 * dt);
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.dropEvery;
          const m = spawnFoe(game, 'mine');
          if (m) { m.x = f.x; m.baseY = f.y; m.y = f.y; }
        }
        break;
      }

      case 'leech': {
        if (f.state === 0) {
          // close on the ship
          const dx = p.x - f.x;
          const dy = p.y - f.y;
          const d = Math.hypot(dx, dy) || 1;
          f.x += (dx / d) * spec.speed * dt;
          f.baseY += (dy / d) * spec.speed * dt;
          f.y = f.baseY;
          // Not while the ship is invulnerable: a leech that grabbed
          // during respawn grace would start draining the instant it ran
          // out, which is indistinguishable from a respawn that does not
          // work.
          // A leech that has already fed does not come back for seconds:
          // it keeps its distance and is shot off at leisure or left
          // behind. Otherwise the hold timer buys nothing — it would
          // re-attach on the next frame.
          if (f.fed) {
            f.x -= (dx / d) * spec.speed * 1.6 * dt;
            f.baseY -= (dy / d) * spec.speed * 1.6 * dt;
            f.y = f.baseY;
          } else if (p.alive && p.invuln <= 0 && d < spec.grabR) {
            f.state = 1;
            f.held = 0;
          }
        } else {
          // Attached: rides along, draining, until shot off — or until it
          // has had its fill.
          //
          // It used to hold on forever. A leech that grabs while you are
          // in a corridor with nothing to shoot it off against is then a
          // drain you cannot answer, and the only move left is to fly
          // into the hull and hope. A grab should be a problem with a
          // shape, not a sentence; it lets go on its own and leaves.
          f.held = (f.held || 0) + dt;
          f.x = p.x - p.facing * 14;
          f.y = p.y;
          f.baseY = p.y;
          if (p.alive && p.invuln <= 0) {
            hurt(game, spec.drain * dt);
            if (Math.random() < dt * 8) sparks(f.x, f.y, 0, -1, 2, '#9ad94e');
          }
          if (f.held >= spec.holdTime) {
            // Full. Detaches and runs for the open hull rather than
            // vanishing, so the moment reads as the leech leaving.
            f.state = 0;
            f.held = 0;
            f.fed = true;
            f.baseY = p.y - 30;
            sparks(f.x, f.y, 0, -1, 8, '#9ad94e');
          }
          if (!p.alive) foes.kill(i);
        }
        break;
      }

        case 'gnat': {
        // A weaver with nothing on board. It does not shoot, so the
        // only thing it can do is be somewhere you wanted to be.
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -70 * dt, 70 * dt);
        f.y = f.baseY + Math.sin(f.t * spec.freq) * spec.amp;
        break;
      }

      case 'dart': {
        // One pass. It commits to a line, empties its gun along it and
        // leaves; it never turns round, which is what separates it
        // from everything else that chases.
        if (f.state === 0) {
          // Line up on the ship's height, then commit.
          f.baseY += clamp(p.y - f.baseY, -150 * dt, 150 * dt);
          f.y = f.baseY;
          f.x += f.facing * spec.speed * 0.3 * dt;
          if (Math.abs(p.y - f.baseY) < 10 || f.t > 1.6) {
            f.state = 1;
            f.shotsLeft = spec.strafeShots;
            f.cd = 0;
          }
        } else {
          f.x += f.facing * spec.speed * dt;
          f.y = f.baseY;
          f.cd -= dt;
          if (f.cd <= 0 && f.shotsLeft > 0 && game.state === 'play') {
            f.cd = spec.strafeEvery;
            f.shotsLeft--;
            fire(enemyShots, f.x, f.y, f.facing * 260, 0, 4, 8, 2);
            sfxTurretShot();
          }
        }
        break;
      }

      case 'barge': {
        // Heavy and slow, and it opens with a fan rather than an aimed
        // shot — so sitting still off its line does not work, and
        // neither does charging it down the middle.
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -22 * dt, 22 * dt);
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.fireEvery;
          const a = Math.atan2(p.y - f.y, p.x - f.x);
          const step = (spec.arcDeg * Math.PI / 180) / (spec.spread - 1);
          for (let k = 0; k < spec.spread; k++) {
            const ang = a - (spec.arcDeg * Math.PI / 180) / 2 + k * step;
            fire(enemyShots, f.x, f.y, Math.cos(ang) * 165, Math.sin(ang) * 165, 5, 10, 2);
          }
          sfxTurretShot();
        }
        break;
      }

      case 'monitor': {
        // Two mounts, fired alternately from opposite ends of the hull,
        // so there is no side of it that is quiet.
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -16 * dt, 16 * dt);
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.fireEvery;
          f.mount = ((f.mount || 0) + 1) % spec.mounts;
          const my = f.y + (f.mount === 0 ? -spec.r * 0.55 : spec.r * 0.55);
          const a = Math.atan2(p.y - my, p.x - f.x);
          for (let k = 0; k < spec.burst; k++) {
            const ang = a + (k - (spec.burst - 1) / 2) * 0.11;
            fire(enemyShots, f.x, my, Math.cos(ang) * 200, Math.sin(ang) * 200, 5, 11, 2);
          }
          sfxTurretShot();
        }
        break;
      }

    default: { // warder
        f.x += f.facing * spec.speed * dt;
        f.baseY += clamp(p.y - f.baseY, -46 * dt, 46 * dt);
        f.y = f.baseY;
        f.cd -= dt;
        if (f.cd <= 0 && game.state === 'play') {
          f.cd = spec.fireEvery;
          const a = Math.atan2(p.y - f.y, p.x - f.x);
          for (let k = -1; k <= 1; k++) {
            fire(enemyShots, f.x, f.y, Math.cos(a + k * 0.2) * 190, Math.sin(a + k * 0.2) * 190, 4, 9, 2);
          }
          sfxTurretShot();
        }
        break;
      }
    }

    f.y = clamp(f.y, FIELD_TOP + 8, FIELD_BOT - 8);
    f.baseY = clamp(f.baseY, FIELD_TOP + 8, FIELD_BOT - 8);

    if (f.x < game.cam.x - CULL_MARGIN || f.x > game.cam.x + VIEW_W + CULL_MARGIN) {
      foes.kill(i);
      continue;
    }

    // Ramming — but not for something already clamped on. An attached
    // leech rides at the ship's own position, so the generic ram fired
    // every time its 0.35s invulnerability lapsed: 18 damage three times a
    // second, about five times the drain it is specified to do, and the
    // invulnerability that ram sets then suppressed the drain entirely. It
    // has its own damage model; this one does not apply to it.
    if (f.kind === 'chainer') tetherHurts(game, f, dt);

    // Anything that grabs is excluded outright, attached or not. It was
    // excluded only while attached, which was right until a leech could
    // let go: on the frame it released it was still sitting at the ship's
    // position, no longer clamped, and took the ram path for a free 18 —
    // a parting shot for letting go.
    const grabber = !!spec.grabR;
    if (!grabber && p.alive && p.invuln <= 0
      && Math.abs(f.x - p.x) < spec.r + 9 && Math.abs(f.y - p.y) < spec.r + 5) {
      if (f.kind === 'mine') { detonate(game, f, i); continue; }
      // Through hurt(), so a collision costs what the hull and the
      // difficulty say it costs. This was a bare subtraction and was the
      // one source of damage to the player that ignored both.
      hurt(game, RAM_DAMAGE);
      game.flash = Math.max(game.flash, 0.35);
      kick(game.cam, 5);
      p.invuln = 0.35;
    }
  }
}

function detonate(game, f, i) {
  const spec = SPEC.mine;
  const p = game.player;
  explode(f.x, f.y, 1.7);
  sfxExplode(1.6);
  kick(game.cam, 7);
  if (p.alive && p.invuln <= 0 && Math.hypot(p.x - f.x, p.y - f.y) < spec.blastR) {
    p.shield -= spec.blastDmg;
    game.flash = Math.max(game.flash, 0.45);
  }
  foes.kill(i);
}

// A warder's frontal plate eats anything arriving within `arc` of head-on.
export function foeShielded(f, sx, sy) {
  if (f.kind !== 'warder') return false;
  const toward = Math.atan2(sy - f.y, sx - f.x);
  const front = f.facing < 0 ? Math.PI : 0;
  const d = Math.abs(((toward - front + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return d < SPEC.warder.arc;
}

// Returns true if the shot was consumed.
export function hitFoe(game, index, sx, sy, dmg) {
  const f = foes.items[index];
  const spec = SPEC[f.kind];

  if (foeShielded(f, sx, sy)) {
    sparks(sx, sy, -1, 0, 3, '#8e9aa9');
    return true;      // absorbed by the plate
  }

  // A mirror sends most of what you shoot at it back down the line it
  // came from. Not all of it: a weapon that is strictly a mistake to use
  // is not a decision, it is a rule you learn once and then obey.
  if (spec.reflect && Math.random() < spec.reflect) {
    const ang = Math.atan2(game.player.y - f.y, game.player.x - f.x);
    fire(enemyShots, f.x, f.y, Math.cos(ang) * 300, Math.sin(ang) * 300, 2.2, dmg * 2, 2);
    sparks(sx, sy, Math.sign(game.player.x - f.x), 0, 6, '#9fe8ff');
    f.flash = 0.1;
    sfxEnemyHit();
    return true;
  }

  // The deflector takes the hit first, from any angle. Overkill carries
  // through to the hull so a heavy shot is not wasted on the last point of
  // it — but the bubble has to be gone before the attacker can die.
  if (f.shield > 0) {
    const through = dmg - f.shield;
    f.shield = Math.max(0, f.shield - dmg);
    f.shieldFlash = 0.12;
    sparks(sx, sy, -1, 0, 5, f.shield > 0 ? '#4fd0e8' : '#b4f4ff');
    sfxEnemyHit();
    if (through <= 0) return true;
    dmg = through;
  }

  f.hp -= dmg;
  f.flash = 0.08;
  if (f.hp > 0) {
    sparks(sx, sy, -1, 0, 4, '#ffd24a');
    sfxEnemyHit();
    return true;
  }

  if (f.kind === 'mine') { detonate(game, f, index); }
  else {
    explode(f.x, f.y, 1.2);
    sfxExplode(1.1);
    spoils(game, f.x, f.y, f.kind);
    const wasSplitter = f.kind === 'splitter';
    const sx = f.x;
    const sy = f.y;
    const dir = f.facing;
    foes.kill(index);
    if (wasSplitter) {
      // halves peel off above and below, so killing it late is worse
      for (let k = 0; k < SPEC.splitter.children; k++) {
        const c = spawnFoe(game, 'shard');
        if (!c) break;
        c.x = sx;
        c.baseY = clamp(sy + (k ? 26 : -26), FIELD_TOP + 10, FIELD_BOT - 10);
        c.y = c.baseY;
        c.facing = dir;
      }
    }
  }
  award(game, spec.score);
  return true;
}
