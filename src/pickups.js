// Pickups: the upgrade curve.
//
// Everything you destroy may drop one, so shooting has a reward beyond score
// and a long run gets meaningfully stronger rather than just longer.

import {
  PICKUP, SHIP, FIELD_TOP, FIELD_BOT, VIEW_W, clamp,
} from './config.js';
import { makePool } from './pool.js';
import { award } from './score.js';
import { pointBlocked } from './level.js';
import { sparks } from './particles.js';

export const TREASURES = Object.keys(PICKUP.treasure);

export const KINDS = ['shield', 'life', 'healthbar', 'gunspeed', 'gunblaze',
  'coin', 'goldbar', 'coffin', 'bomb', 'grenade', 'missile', ...TREASURES];

// Everything that is loot rather than an upgrade. One list, so the HUD, the
// minimap, the end-of-hull bonus and the drop code cannot disagree about
// what counts as treasure.
export const LOOT = new Set(['coin', 'goldbar', 'coffin', ...TREASURES]);
export const isTreasure = (kind) => kind in PICKUP.treasure;

// Run totals and this-hull totals, in one place. The end-of-hull bonus asks
// what was collected on this hull, the overview asks what the run has
// collected in all, and keeping two counters in step by hand is how one of
// them ends up wrong.
export const freshHaul = () => ({ coins: 0, bars: 0, coffins: 0, treasures: 0, value: 0 });

function haul(game, kind, value, coins = 0) {
  game.coins = (game.coins || 0) + coins;
  for (const h of [game.haul, game.hullHaul]) {
    if (!h) continue;
    h.value += value;
    h.coins += coins;
    if (kind === 'goldbar') h.bars++;
    else if (kind === 'coffin') h.coffins++;
    else if (isTreasure(kind)) h.treasures++;
  }
  // kept for the HUD and the backend, which have always read these
  if (kind === 'goldbar') game.bars = (game.bars || 0) + 1;
  else if (kind === 'coffin') game.coffins = (game.coffins || 0) + 1;
  else if (isTreasure(kind)) game.treasures = (game.treasures || 0) + 1;
}

const TREASURE_WEIGHT = TREASURES.reduce((a, k) => a + PICKUP.treasure[k].weight, 0);

// Which treasure a roll produces. The tiers are weighted, so a reliquary is
// something you tell someone about.
export function rollTreasure() {
  let r = Math.random() * TREASURE_WEIGHT;
  for (const k of TREASURES) {
    r -= PICKUP.treasure[k].weight;
    if (r <= 0) return k;
  }
  return TREASURES[0];
}

// Weighted drop table. Shield refills are the backbone; an extra ship is the
// rare one, because handing them out freely removes the run's whole tension.
const TABLE = [
  ['shield', 34],
  ['gunspeed', 22],
  ['gunblaze', 20],
  ['healthbar', 16],
  ['life', 8],
];
const TOTAL_WEIGHT = TABLE.reduce((a, [, w]) => a + w, 0);

function rollKind() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const [kind, w] of TABLE) {
    r -= w;
    if (r <= 0) return kind;
  }
  return 'shield';
}

// Sized for a boss death scattering coins from several kills at once.
export const pickups = makePool(160, () => ({
  x: 0, y: 0, baseY: 0, vx: 0, vy: 0, kind: 'shield', life: 0, maxLife: 1, t: 0,
}));

// Nudge a drop out of solid hull, so a pickup is never unreachable inside a
// block. Searches outward vertically, then gives up and refuses the drop.
function freeSpot(level, x, y) {
  if (!pointBlocked(level, x, y)) return y;
  for (let d = 10; d <= 150; d += 10) {
    if (!pointBlocked(level, x, y - d)) return y - d;
    if (!pointBlocked(level, x, y + d)) return y + d;
  }
  return null;
}

export function spawnPickup(game, x, y, kind = rollKind()) {
  const sy = freeSpot(game.level, x, clamp(y, FIELD_TOP + 10, FIELD_BOT - 10));
  if (sy === null) return null;
  const p = pickups.spawn();
  if (!p) return null;
  p.x = x;
  p.baseY = sy;
  p.y = sy;
  p.vx = (Math.random() - 0.5) * PICKUP.drift;
  p.vy = 0;
  p.kind = kind;
  p.life = kind === 'coin' ? PICKUP.coinLife
    : kind === 'goldbar' ? PICKUP.barLife
      : kind === 'coffin' ? PICKUP.coffinLife
        : isTreasure(kind) ? PICKUP.treasure[kind].life
          : PICKUP.life;
  p.maxLife = p.life;
  p.t = Math.random() * 6;
  return p;
}

// Called when something is destroyed. Turrets are worth stopping for.
// Scatters coins outward from a kill. They fly apart, slow down, and then
// behave like any other pickup — so a good kill leaves a payday on screen
// rather than a number ticking up somewhere.
export function scatterCoins(game, x, y, count) {
  for (let i = 0; i < count; i++) {
    const p = spawnPickup(game, x, y, 'coin');
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    const s = PICKUP.coinScatter * (0.35 + Math.random() * 0.8);
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
  }
}

// Called wherever something is destroyed: coins always, a coffin rarely,
// and the existing upgrade drops on their own roll.
// Scatters a fixed number of a kind outward from a wreck, the way coins
// are scattered. Used for the guaranteed contents of a boss's hold.
function shed(game, x, y, kind, range) {
  const [lo, hi] = range;
  const n = lo + Math.floor(Math.random() * (hi - lo + 1));
  for (let i = 0; i < n; i++) {
    const p = spawnPickup(game, x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 40, kind);
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 70;
    p.vx = Math.cos(a) * sp;
    p.vy = Math.sin(a) * sp;
  }
}

export function spoils(game, x, y, source) {
  const [lo, hi] = PICKUP.coinsPerKill;
  let n = lo + Math.floor(Math.random() * (hi - lo + 1));
  if (source === 'turret') n += 2;
  if (source === 'mini') n += 8;
  if (source === 'boss') n += 14;
  scatterCoins(game, x, y, n);

  if (Math.random() < PICKUP.barChance * (source === 'boss' ? 6 : 1)) {
    const bar = spawnPickup(game, x + (Math.random() - 0.5) * 20, y, 'goldbar');
    if (bar) {
      const a = Math.random() * Math.PI * 2;
      bar.vx = Math.cos(a) * 90;
      bar.vy = Math.sin(a) * 90;
    }
  }
  if (Math.random() < PICKUP.coffinChance * (source === 'boss' ? 8 : 1)) {
    spawnPickup(game, x + (Math.random() - 0.5) * 24, y, 'coffin');
  }

  // The hold. Bosses and minibosses always carry bars and coffins.
  if (source === 'boss' || source === 'mini') {
    const boss = source === 'boss';
    shed(game, x, y, 'goldbar', boss ? PICKUP.bossBars : PICKUP.miniBars);
    shed(game, x, y, 'coffin', boss ? PICKUP.bossCoffins : PICKUP.miniCoffins);
  }

  // Treasure. Rarer than a coffin and worth more, with the odds improving
  // hull by hull so the late game pays for the trouble it causes. A boss
  // rolls several times, which is why its wreck is worth flying into.
  const odds = PICKUP.treasureChance + PICKUP.treasureHullBonus * (game.levelIndex || 0);
  const rolls = source === 'boss' ? PICKUP.treasureFromBoss
    : source === 'mini' ? Math.ceil(PICKUP.treasureFromBoss / 2) : 1;
  for (let i = 0; i < rolls; i++) {
    if (Math.random() >= odds) continue;
    const t = spawnPickup(game, x + (Math.random() - 0.5) * 36, y, rollTreasure());
    if (t) {
      const a = Math.random() * Math.PI * 2;
      t.vx = Math.cos(a) * 70;
      t.vy = Math.sin(a) * 70;
    }
  }
  return maybeDrop(game, x, y, source);
}

export function maybeDrop(game, x, y, source) {
  const chance = source === 'turret' ? PICKUP.dropFromTurret : PICKUP.dropFromInterceptor;
  if (Math.random() > chance) return null;
  return spawnPickup(game, x, y);
}

export function updatePickups(game, dt) {
  const pl = game.player;
  for (let i = pickups.count - 1; i >= 0; i--) {
    const p = pickups.items[i];
    p.life -= dt;
    if (p.life <= 0) { pickups.kill(i); continue; }

    p.t += dt;
    p.x += p.vx * dt;
    if (p.vy) {
      // scattered coins fly apart and settle
      p.baseY += p.vy * dt;
      const d = Math.exp(-PICKUP.coinDrag * dt);
      p.vx *= d;
      p.vy *= d;
      if (Math.abs(p.vy) < 2) p.vy = 0;
    }
    p.baseY = clamp(p.baseY, FIELD_TOP + 8, FIELD_BOT - 8);
    const bob = p.kind === 'coin' ? 4 : PICKUP.bob;
    p.y = p.baseY + Math.sin(p.t * 2.2) * bob;

    // despawn well off-screen rather than hoarding pool slots
    if (p.x < game.cam.x - 140 || p.x > game.cam.x + VIEW_W + 140) {
      pickups.kill(i);
      continue;
    }

    if (!pl.alive) continue;

    // soft magnet: a near miss at speed should still be collected, or
    // pickups become a tax on flying fast
    const dx = pl.x - p.x;
    const dy = pl.y - p.y;
    const d = Math.hypot(dx, dy);
    // Loot is pulled from further than upgrade crates: a coin you flew past
    // is a coin you earned, and chasing it back is not gameplay.
    const loot = LOOT.has(p.kind);
    const base = loot ? PICKUP.magnetLoot : PICKUP.magnet;
    const magnet = base * (pl.magnetMul || 1);
    if (d < magnet && d > 0.01) {
      const pull = (1 - d / magnet) * PICKUP.magnetPull * dt;
      p.x += (dx / d) * pull;
      p.baseY += (dy / d) * pull;
    }

    if (Math.abs(dx) < SHIP.hitW / 2 + PICKUP.size / 2
      && Math.abs(dy) < SHIP.hitH / 2 + PICKUP.size / 2) {
      collect(game, p);
      pickups.kill(i);
    }
  }
}

// Applies the effect and returns a short label for the HUD toast, so every
// pickup tells you what it did.
function collect(game, p) {
  const pl = game.player;
  let label = '';
  // Loot carries its own value; everything else pays the flat pickup score
  // on top of its effect.
  if (!LOOT.has(p.kind)) award(game, PICKUP.score);

  // Treasure: value, coins at the armourer, and a toast loud enough that
  // you know something unusual just happened.
  if (isTreasure(p.kind)) {
    const t = PICKUP.treasure[p.kind];
    // Scavenger lifts what loot is worth, not just how many coins it yields:
    // it used to leave coffins and treasure untouched, which made the mod
    // worth less exactly where the loot was worth most.
    const mul = pl.coinMul || 1;
    award(game, Math.round(t.value * mul));
    haul(game, p.kind, Math.round(t.value * mul), Math.round(t.coins * mul));
    game.onHaul?.(p.kind);
    game.toast = { text: t.label + '  +' + t.value, kind: p.kind, t: 2.4 };
    sparks(p.x, p.y, 0, -1, 18, t.colour);
    game.onPickup?.(p.kind);
    return;
  }

  switch (p.kind) {
    case 'goldbar': {
      const v = Math.round(PICKUP.barValue * (pl.coinMul || 1));
      award(game, v);
      haul(game, 'goldbar', v, Math.round(PICKUP.barCoins * (pl.coinMul || 1)));
      game.onHaul?.('goldbar');
      label = 'GOLD BAR  +' + v;
      break;
    }
    case 'coin':
      award(game, Math.round(PICKUP.coinValue * (pl.coinMul || 1)));
      haul(game, 'coin', Math.round(PICKUP.coinValue * (pl.coinMul || 1)),
        Math.max(1, Math.round(pl.coinMul || 1)));
      game.onHaul?.('coin');
      return;                       // no toast: coins are constant background
    case 'coffin': {
      const v = Math.round(PICKUP.coffinValue * (pl.coinMul || 1));
      award(game, v);
      haul(game, 'coffin', v, Math.round(PICKUP.coffinCoins * (pl.coinMul || 1)));
      game.onHaul?.('coffin');
      label = 'GOLD COFFIN  +' + v;
      break;
    }
    case 'shield':
      pl.shield = Math.min(pl.shieldMax, pl.shield + PICKUP.shieldRefill);
      label = 'SHIELDS REFILLED';
      break;
    case 'life':
      if (pl.lives < PICKUP.maxLives) {
        pl.lives++;
        label = 'LIFESAVER  +1 SHIP';
      } else {
        award(game, 500);
        label = 'LIFESAVER  +500';
      }
      break;
    case 'healthbar':
      if (pl.shieldMax < PICKUP.shieldCeiling) {
        pl.shieldMax = Math.min(PICKUP.shieldCeiling, pl.shieldMax + PICKUP.healthBarBonus);
        pl.shield = Math.min(pl.shieldMax, pl.shield + PICKUP.healthBarBonus);
        label = 'HEALTHBAR  MAX ' + pl.shieldMax;
      } else {
        pl.shield = pl.shieldMax;
        award(game, 300);
        label = 'HEALTHBAR  FULL';
      }
      break;
    case 'gunspeed':
      if (pl.gunSpeed < pl.gunCap) {
        pl.gunSpeed++;
        label = 'GUNSPEED  ' + pl.gunSpeed + '/' + pl.gunCap;
      } else {
        award(game, 300);
        label = 'GUNSPEED  MAX';
      }
      break;
    case 'gunblaze':
      if (pl.gunBlaze < pl.gunCap) {
        pl.gunBlaze++;
        label = 'GUNBLAZE  ' + pl.gunBlaze + '/' + pl.gunCap;
      } else {
        award(game, 300);
        label = 'GUNBLAZE  MAX';
      }
      break;
    default:
      label = 'PICKUP';
  }

  game.toast = { text: label, kind: p.kind, t: 1.9 };
  sparks(p.x, p.y, 0, -1, 10, tint(p.kind));
  game.onPickup?.(p.kind);
}

export function tint(kind) {
  if (isTreasure(kind)) return PICKUP.treasure[kind].colour;
  switch (kind) {
    case 'coin': return '#ffd24a';
    case 'goldbar': return '#ffc93a';
    case 'coffin': return '#ffe88a';
    case 'shield': return '#4fd0e8';
    case 'life': return '#b4f4ff';
    case 'healthbar': return '#5fe08a';
    case 'gunspeed': return '#ffd24a';
    case 'gunblaze': return '#ff7a2f';
    default: return '#ffffff';
  }
}

export const resetPickups = () => pickups.clear();
