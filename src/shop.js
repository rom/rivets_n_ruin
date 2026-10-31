// The upgrade shop, between hulls, paid for in coins.
//
// Two kinds of thing are sold. Upgrades are quantities you can buy
// repeatedly until a cap — another gun level, more shield, more ammo. Mods
// are permanent changes to how the ship behaves, bought once, and they are
// where the interesting decisions are: a run with Scavenger plays
// differently from one with Afterburner, and coins only stretch to so many.

import { PICKUP, ARMORY } from './config.js';

// A mod is one or more tiers. Most are a single fitting; the two that
// change how the whole hull is flown — how far loot reaches and what it is
// worth — go up to three, each dearer than the last. A pilot who commits to
// one of those is choosing it over everything else in the shop, which is
// the only reason a tier list is more interesting than a bigger number.
export const MODS = {
  magnet: {
    name: 'LODESTONE',
    tiers: [
      { cost: 900, mul: 2, blurb: 'Pickups and coins pull toward you from twice as far.' },
      { cost: 1800, mul: 3.2, blurb: 'Reach again by half. Loot comes to you across a gap.' },
      { cost: 3200, mul: 4.8, blurb: 'If it is on your screen, it is already yours.' },
    ],
  },
  plating: {
    name: 'ABLATIVE PLATING',
    tiers: [{ cost: 1200, blurb: 'Hull scrapes cost 40% less shield.' }],
  },
  autoloader: {
    name: 'AUTOLOADER',
    tiers: [{ cost: 1000, blurb: 'Ordnance reloads 35% faster.' }],
  },
  scavenger: {
    name: 'SCAVENGER RIG',
    tiers: [
      { cost: 1100, mul: 2, blurb: 'Coins, bars, coffins and treasure are worth double.' },
      { cost: 2200, mul: 2.8, blurb: 'Everything you pick up is worth 2.8x.' },
      { cost: 3800, mul: 3.6, blurb: 'A picked-clean hull pays more than the boss on it.' },
    ],
  },
  afterburner: {
    name: 'AFTERBURNER',
    tiers: [{ cost: 1300, blurb: '+40 top speed and quicker acceleration.' }],
  },
  reclaimer: {
    name: 'RECLAIMER',
    tiers: [{ cost: 1500, blurb: 'Keep one gun level when a ship is lost.' }],
  },

  // --- frames and systems. These change what the ship *is* rather than
  // what a number on it says, and every one of them is visible on the hull.
  mount: {
    name: 'EXTRA MOUNT',
    tiers: [
      { cost: 1600, blurb: 'A third gun rail: one more level of speed and spread.' },
      { cost: 3000, blurb: 'A fourth rail. The nose is mostly gun now.' },
    ],
  },
  drone: {
    name: 'DRONE WING',
    tiers: [
      { cost: 1900, blurb: 'An escort drone flies your wing and fires with you.' },
      { cost: 3400, blurb: 'A second drone, on the other wing.' },
    ],
  },
  pointdef: {
    name: 'POINT DEFENCE',
    tiers: [{ cost: 2100, blurb: 'Shoots down enemy missiles that get close. Automatic.' }],
  },
  regen: {
    name: 'CELL REGENERATOR',
    tiers: [
      { cost: 1700, mul: 2.5, blurb: 'The shield comes back on its own, slowly.' },
      { cost: 3200, mul: 6, blurb: 'The shield comes back on its own, rather less slowly.' },
    ],
  },
  siege: {
    name: 'SIEGE FRAME',
    tiers: [{ cost: 2600, blurb: '+60 maximum shield and heavier plating. Slower to turn.' }],
  },
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

// How many tiers of a mod are fitted. Stored as a number; `true` from a
// save written before tiers existed reads as one.
export const modLevel = (game, id) => {
  const v = game.mods && game.mods[id];
  return v === true ? 1 : (Number(v) || 0);
};

export const maxLevel = (id) => MODS[id].tiers.length;

// The display name, with its tier when a mod has more than one.
export function modName(id, level) {
  const m = MODS[id];
  if (m.tiers.length === 1) return m.name;
  return m.name + ' ' + ROMAN[Math.max(1, level)];
}

// What a mod's numeric effect is at the level fitted, or 1 when unfitted.
function modMul(game, id) {
  const lvl = modLevel(game, id);
  if (!lvl) return 1;
  return MODS[id].tiers[Math.min(lvl, maxLevel(id)) - 1].mul || 1;
}

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
  // Not 'magnet': that is the Lodestone mod's id, and a shop row list that
  // holds two different things under one id hands the wrong one to anything
  // that looks a row up rather than indexing it.
  { id: 'coils', name: 'TRACTOR COILS', base: 600, step: 300,
    blurb: 'Pull loot in from further away.',
    can: (p) => (p.magnetLevel || 0) < PICKUP.magnetLevels.length - 1,
    buy: (p) => { p.magnetLevel = (p.magnetLevel || 0) + 1; },
    owned: (p) => p.magnetLevel || 0, max: () => PICKUP.magnetLevels.length - 1 },
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
    const lvl = modLevel(game, id);
    if (lvl >= m.tiers.length) continue;      // fully fitted
    const tier = m.tiers[lvl];
    out.push({
      kind: 'mod',
      id,
      name: modName(id, lvl + 1),
      blurb: tier.blurb,
      cost: tier.cost,
      affordable: false,
      detail: m.tiers.length > 1 ? `MOD ${lvl}/${m.tiers.length}` : 'MOD',
      available: true,
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
    const lvl = modLevel(game, row.id);
    if (lvl >= maxLevel(row.id)) return null;
    game.mods[row.id] = lvl + 1;
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
  // Coils bought in the shop stack multiplicatively with the Lodestone mod,
  // so a pilot who invests in both barely has to steer for loot at all.
  const coils = PICKUP.magnetLevels[Math.min(p.magnetLevel || 0, PICKUP.magnetLevels.length - 1)];
  p.magnetMul = coils * modMul(game, 'magnet');
  p.scrapeMul = modLevel(game, 'plating') ? 0.6 : 1;
  p.reloadMul = modLevel(game, 'autoloader') ? 0.65 : 1;
  p.coinMul = modMul(game, 'scavenger');
  p.keepGunOnDeath = modLevel(game, 'reclaimer') ? 1 : 0;
  if (m.afterburner && !p._afterburner) {
    p._afterburner = true;
    p.maxVXBonus += 40;
    p.accelMul *= 1.12;
  }

  // --- frames and systems
  //
  // These set fields the rest of the game already reads, the same way the
  // older mods do, rather than being checked for by name wherever they
  // happen to matter.
  // Mounts raise the ceiling the refit has been building toward, so the
  // base is tracked separately — adding the mod's bonus to the live cap
  // would stack it again on every call.
  const mounts = modLevel(game, 'mount');
  p.gunCap = Math.min(PICKUP.gunCapMax, (p.gunCapBase || PICKUP.gunLevels) + mounts);
  p.drones = modLevel(game, 'drone');
  p.pointDefence = modLevel(game, 'pointdef') > 0;
  p.shieldRegen = modLevel(game, 'regen') ? modMul(game, 'regen') : 0;
  if (modLevel(game, 'siege') && !p._siege) {
    p._siege = true;
    p.shieldMax += 60;
    p.shield = p.shieldMax;
    p.scrapeMul *= 0.75;
    p.accelMul *= 0.88;        // the armour has to cost something
  }
}

export const resetShop = (game) => {
  game.mods = {};
  game.bought = {};
  applyMods(game);
};
