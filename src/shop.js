// The upgrade shop, between hulls, paid for in coins.
//
// Two kinds of thing are sold. Upgrades are quantities you can buy
// repeatedly until a cap — another gun level, more shield, more ammo. Mods
// are permanent changes to how the ship behaves, bought once, and they are
// where the interesting decisions are: a run with Scavenger plays
// differently from one with Afterburner, and coins only stretch to so many.

import { PICKUP, ARMORY } from './config.js';

export const MODS = {
  magnet: {
    name: 'LODESTONE', cost: 900,
    blurb: 'Pickups and coins pull toward you from twice as far.',
  },
  plating: {
    name: 'ABLATIVE PLATING', cost: 1200,
    blurb: 'Hull scrapes cost 40% less shield.',
  },
  autoloader: {
    name: 'AUTOLOADER', cost: 1000,
    blurb: 'Ordnance reloads 35% faster.',
  },
  scavenger: {
    name: 'SCAVENGER RIG', cost: 1100,
    blurb: 'Coins are worth double.',
  },
  afterburner: {
    name: 'AFTERBURNER', cost: 1300,
    blurb: '+40 top speed and quicker acceleration.',
  },
  reclaimer: {
    name: 'RECLAIMER', cost: 1500,
    blurb: 'Keep one gun level when a ship is lost.',
  },
};

// Priced so a careful hull funds roughly one good purchase. Upgrades get
// dearer each time so the shop cannot simply be drained into one stat.
export const ITEMS = [
  { id: 'gunspeed', name: 'GUN SPEED', base: 420, step: 180,
    blurb: 'One more level of fire rate.',
    can: (p) => p.gunSpeed < p.gunCap,
    buy: (p) => { p.gunSpeed++; },
    owned: (p) => p.gunSpeed, max: (p) => p.gunCap },
  { id: 'gunblaze', name: 'GUN SPREAD', base: 420, step: 180,
    blurb: 'One more mirrored pair of barrels.',
    can: (p) => p.gunBlaze < p.gunCap,
    buy: (p) => { p.gunBlaze++; },
    owned: (p) => p.gunBlaze, max: (p) => p.gunCap },
  { id: 'shield', name: 'HULL PLATING', base: 500, step: 200,
    blurb: '+25 maximum shield, filled.',
    can: (p) => p.shieldMax < PICKUP.shieldCeiling,
    buy: (p) => { p.shieldMax += 25; p.shield = p.shieldMax; },
    owned: (p) => p.shieldMax, max: () => PICKUP.shieldCeiling },
  { id: 'life', name: 'SPARE SHIP', base: 1400, step: 700,
    blurb: 'One more ship in the hangar.',
    can: (p) => p.lives < PICKUP.maxLives,
    buy: (p) => { p.lives++; },
    owned: (p) => p.lives, max: () => PICKUP.maxLives },
  { id: 'bomb', name: 'BOMBS', base: 180, step: 40,
    blurb: 'Two more bombs.',
    can: (p) => p.ammo.bomb < ARMORY.bomb.maxAmmo,
    buy: (p) => { p.ammo.bomb = Math.min(ARMORY.bomb.maxAmmo, p.ammo.bomb + 2); },
    owned: (p) => p.ammo.bomb, max: () => ARMORY.bomb.maxAmmo },
  { id: 'grenade', name: 'GRENADES', base: 150, step: 35,
    blurb: 'Three more grenades.',
    can: (p) => p.ammo.grenade < ARMORY.grenade.maxAmmo,
    buy: (p) => { p.ammo.grenade = Math.min(ARMORY.grenade.maxAmmo, p.ammo.grenade + 3); },
    owned: (p) => p.ammo.grenade, max: () => ARMORY.grenade.maxAmmo },
  { id: 'missile', name: 'MISSILES', base: 260, step: 60,
    blurb: 'Two more homing missiles.',
    can: (p) => p.ammo.missile < ARMORY.missile.maxAmmo,
    buy: (p) => { p.ammo.missile = Math.min(ARMORY.missile.maxAmmo, p.ammo.missile + 2); },
    owned: (p) => p.ammo.missile, max: () => ARMORY.missile.maxAmmo },
];


// Mods appear as rows too, but each only once and only if unowned.
export function rows(game) {
  const p = game.player;
  const out = ITEMS.map((it) => ({
    kind: 'item', id: it.id, name: it.name, blurb: it.blurb,
    cost: price(game, it), affordable: false,
    detail: `${it.owned(p)}/${it.max(p)}`,
    available: it.can(p),
  }));
  for (const [id, m] of Object.entries(MODS)) {
    if (game.mods && game.mods[id]) continue;
    out.push({
      kind: 'mod', id, name: m.name, blurb: m.blurb,
      cost: m.cost, affordable: false, detail: 'MOD', available: true,
    });
  }
  for (const r of out) r.affordable = r.available && game.coins >= r.cost;
  return out;
}

export function price(game, it) {
  const bought = (game.bought && game.bought[it.id]) || 0;
  return it.base + bought * it.step;
}

// Returns a short result string for the UI, or null if nothing happened.
export function buy(game, row) {
  if (!row || !row.available || game.coins < row.cost) return null;

  if (row.kind === 'mod') {
    game.mods = game.mods || {};
    game.mods[row.id] = true;
    game.coins -= row.cost;
    applyMods(game);
    return 'FITTED ' + row.name;
  }

  const it = ITEMS.find((x) => x.id === row.id);
  if (!it || !it.can(game.player)) return null;
  game.coins -= row.cost;
  it.buy(game.player);
  game.bought = game.bought || {};
  game.bought[it.id] = (game.bought[it.id] || 0) + 1;
  return 'BOUGHT ' + it.name;
}

// Mods act by setting fields the rest of the game already reads, rather than
// by being checked for by name all over the codebase.
export function applyMods(game) {
  const p = game.player;
  const m = game.mods || {};
  p.magnetMul = m.magnet ? 2 : 1;
  p.scrapeMul = m.plating ? 0.6 : 1;
  p.reloadMul = m.autoloader ? 0.65 : 1;
  p.coinMul = m.scavenger ? 2 : 1;
  p.keepGunOnDeath = m.reclaimer ? 1 : 0;
  if (m.afterburner && !p._afterburner) {
    p._afterburner = true;
    p.maxVXBonus += 40;
    p.accelMul *= 1.12;
  }
}

export const resetShop = (game) => {
  game.mods = {};
  game.bought = {};
  applyMods(game);
};
