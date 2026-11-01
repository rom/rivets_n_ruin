// Every tunable in one place. Change a number, reload, re-fly.

// Bumped by hand, and shown on the splash. The backend does not report it:
// /api/health answers {"ok":true} and nothing else, so a player reporting a
// bug and the server they hit cannot yet be lined up. This comment used to
// claim otherwise.
export const VERSION = '1.1.0';
export const BUILD = 'RIVETS';

export const VIEW_W = 640;

// Three stacked bands, in this order, and none of them overlaps another.
//
// The radar used to be drawn over the top of the playfield, faded out when
// the ship flew under it. That was never quite honest, and it was plainly
// wrong for anything that is not the ship: a gun mounted on the upper
// girder sits at y=16 with its barrel reaching to about y=29, entirely
// behind a strip that ran from 0 to 22. Half the hull's guns were hidden
// behind the thing that was supposed to be showing you where they were.
//
// So the frame is taller instead. The playfield keeps every pixel it had,
// which means no gameplay constant moves; the window simply shows a band
// more. HUD overlays still cover the radar, because a menu should not have
// a live radar running underneath it.
export const FIELD_H = 324;              // playfield height, unchanged
export const RADAR_H = 24;               // the radar strip, its own band
export const HUD_H = 36;
export const VIEW_H = FIELD_H + RADAR_H + HUD_H;   // 384

export const RADAR_Y = FIELD_H;          // top of the radar band
export const HUD_Y = FIELD_H + RADAR_H;  // top of the HUD panel

export const RIM = 16;                   // structural girder along each hull edge
export const FIELD_TOP = RIM;            // 16
export const FIELD_BOT = FIELD_H - RIM;  // 308

export const APRON = 560;                // clear launch/landing zone at each end

// Hull themes. Each level is a visibly different place: palette, plating
// tone, corrosion, the colour the seams glow. Everything renderChunk needs
// lives in one slot here, so a new theme is an entry rather than a branch.
// Hull themes. Each level is a different *place*, not the same place in
// another colour: the surface is painted by a different routine, obstacles
// are a different shape, and the palette follows. `surface` and `shape`
// select those routines in level.js.
export const THEMES = {
  steel: {
    name: 'STEEL', surface: 'plates', shape: 'block',
    base: '#171a20', mid: '#30363f', hi: '#464e5a', seam: '#12161e',
    rivet: '#737d8c', rivetHi: '#b4c0ce', edgeHi: '#8e9aa9', rimDark: '#191d24',
    hazard: '#6b5a28', chevron: '#d9a62e',
    block: '#4e5765', blockHi: '#5a6472', blockLo: '#434b58', blockEdge: '#0d1016',
    tones: ['#1d2128', '#21262d', '#252a32', '#282e36', '#1f242b', '#262b33'],
  },
  conduit: {
    name: 'CONDUIT', surface: 'conduit', shape: 'pipe',
    base: '#0d1420', mid: '#243449', hi: '#36506e', seam: '#070c14',
    rivet: '#5d7c9a', rivetHi: '#9fc2e0', edgeHi: '#6f94b8', rimDark: '#0f1725',
    hazard: '#285a6b', chevron: '#3fb0c9',
    block: '#3a5068', blockHi: '#466079', blockLo: '#30435a', blockEdge: '#060a11',
    tones: ['#111a27', '#15202e', '#192536', '#1c293c', '#131c2a', '#172331'],
  },
  glacier: {
    name: 'GLACIER', surface: 'ice', shape: 'crystal',
    base: '#121c24', mid: '#35525f', hi: '#5d8798', seam: '#0c141b',
    rivet: '#9fc8d8', rivetHi: '#e2f4fb', edgeHi: '#b2d9e8', rimDark: '#15212b',
    hazard: '#3f6f80', chevron: '#8fe2f2',
    block: '#507c8e', blockHi: '#68a0b4', blockLo: '#3f6476', blockEdge: '#0a1218',
    tones: ['#16222c', '#1a2833', '#1e2e3a', '#223440', '#182530', '#1c2b36'],
  },
  desert: {
    name: 'DESERT', surface: 'dunes', shape: 'dune',
    base: '#231a12', mid: '#6b5033', hi: '#9c7746', seam: '#17100a',
    rivet: '#c9a269', rivetHi: '#f0d9a8', edgeHi: '#d4b071', rimDark: '#261c13',
    hazard: '#7a5a1e', chevron: '#e8bb4a',
    block: '#8a6a40', blockHi: '#a8854f', blockLo: '#6e5333', blockEdge: '#140e08',
    tones: ['#2b2017', '#31251a', '#372a1e', '#3d2f21', '#2e2219', '#34271c'],
  },
  foundry: {
    name: 'FOUNDRY', surface: 'molten', shape: 'slag',
    base: '#1a0f0b', mid: '#43241a', hi: '#6b3620', seam: '#0f0705',
    rivet: '#9a5a36', rivetHi: '#ffb070', edgeHi: '#c06a38', rimDark: '#1d110c',
    hazard: '#8a3a10', chevron: '#ff8a2e',
    block: '#5c3020', blockHi: '#7a4128', blockLo: '#47251a', blockEdge: '#0c0605',
    tones: ['#22130d', '#281710', '#2e1b13', '#341f16', '#241510', '#2a1912'],
  },
  void: {
    name: 'VOID', surface: 'void', shape: 'asteroid',
    base: '#04050a', mid: '#161a28', hi: '#2a3048', seam: '#020306',
    rivet: '#4a5270', rivetHi: '#9aa4cc', edgeHi: '#5e688c', rimDark: '#070910',
    hazard: '#3a2a6a', chevron: '#8a6ae0',
    block: '#232a40', blockHi: '#2f3852', blockLo: '#1b2033', blockEdge: '#020308',
    tones: ['#06070e', '#080a12', '#0a0c16', '#0c0f1a', '#07080f', '#090b14'],
  },
  derelict: {
    name: 'DERELICT', surface: 'broken', shape: 'wreck',
    base: '#1a120e', mid: '#45291d', hi: '#653d27', seam: '#0f0a07',
    rivet: '#96694a', rivetHi: '#d49a6e', edgeHi: '#a3714c', rimDark: '#1c140f',
    hazard: '#6b4418', chevron: '#d4883a',
    block: '#573525', blockHi: '#6d4530', blockLo: '#452a1e', blockEdge: '#0d0806',
    tones: ['#211711', '#271c15', '#2d2119', '#32251c', '#241a13', '#2a1e17'],
  },
  admiralty: {
    name: 'ADMIRALTY', surface: 'ornate', shape: 'pillar',
    base: '#1c1708', mid: '#4f4418', hi: '#786425', seam: '#120e05',
    rivet: '#c2a44a', rivetHi: '#ffeba0', edgeHi: '#d4b85c', rimDark: '#1f1a0a',
    hazard: '#85661a', chevron: '#ffd84a',
    block: '#6b5a22', blockHi: '#86722e', blockLo: '#55471b', blockEdge: '#0f0c04',
    tones: ['#241d0c', '#2a230f', '#302811', '#352d14', '#261f0d', '#2c2510'],
  },
};

// Each hull is guarded at its far end. The boss gates the way out, so a
// hull is approach -> boss -> escape and the dock is earned, not reached.
export const BOSS = {
  arenaMargin: 40,
  // How long the arena stays open after the boss dies. Its hold scatters
  // bars, coffins, treasure and a cloud of coins across a room the ship was
  // walled into a moment ago; leaving the instant it died threw most of
  // that away. ENTER skips it.
  lootWindow: 10,
  entryTime: 2.2,
  deathTime: 2.6,
  hitFlash: 0.08,
  contactDamage: 34,
};

// Eight bosses, one per hull, each harder than the last. `kind` selects the
// behaviour in boss.js; the numbers here are the whole difficulty curve.
// Names are still written down, because a hull called LEVEL 19 is not a
// place.
const DEEP_HULLS = [
  ['PLUMBUM', 'DEAD WEIGHT — BALLAST HULL'],
  ['STANNUM', 'COLD SHORT — TENDER HULL'],
  ['ZINCUM', 'SACRIFICIAL — ANODE HULL'],
  ['NICCOLUM', 'DEVIL\u2019S COPPER — SURVEY HULL'],
  ['COBALTUM', 'GOBLIN ORE — PICKET HULL'],
  ['CHROMIUM', 'MIRROR FINISH — PARADE HULL'],
  ['VANADIUM', 'TOUGH AS TOLD — ARMOUR HULL'],
  ['TITANIUM', 'UNBOWED — ASSAULT HULL'],
  ['IRIDIUM', 'FROM THE SKY — RELIC HULL'],
  ['PLATINUM', 'LITTLE SILVER — TREASURY HULL'],
  ['RHODIUM', 'ROSE ASH — COURIER HULL'],
  ['PALLADIUM', 'THE WARD — GUARDIAN HULL'],
  ['OSMIRIDIUM', 'HEAVIEST THING AFLOAT — ANVIL HULL'],
  ['THORIUM', 'SLOW FIRE — REACTOR HULL'],
  ['URANIUM', 'THE LONG HALF — WARHEAD HULL'],
  ['ADAMAS', 'UNCONQUERABLE — SIEGE CARRIER'],
  ['ORICHALCUM', 'THE LAST NAME — FLAGSHIP OF THE LINE'],
];

const CORE_BOSSES = [
  { name: 'THE WARDEN', tag: 'EMPLACED FORTRESS — ARGENTUM', kind: 'warden',
    coreHp: 82, podHp: 18, score: 6000, podScore: 400,
    bulletSpeed: 194, burstGap: 0.100, cycle: 1.33 },

  { name: 'DRAYLINE', tag: 'LINE GUNSHIP — OSMIUM', kind: 'drayline',
    coreHp: 188, score: 9000,
    bulletSpeed: 221, burstGap: 0.062, cycle: 1.09, sweepSpeed: 128 },

  { name: 'THE RIVETER', tag: 'FLAGSHIP BATTERY — TANTALUM', kind: 'riveter',
    coreHp: 288, plateHp: 28, score: 14000, plateScore: 600,
    bulletSpeed: 243, burstGap: 0.050, cycle: 0.93 },

  { name: 'COLDFORGE', tag: 'MINELAYER — CUPRUM', kind: 'coldforge',
    coreHp: 397, podHp: 35, score: 19000, podScore: 700,
    bulletSpeed: 232, burstGap: 0.056, cycle: 0.98, mines: 3 },

  { name: 'SLAGHEART', tag: 'TWIN REACTOR — PYRITE', kind: 'slagheart',
    coreHp: 505, plateHp: 43, score: 25000, plateScore: 800,
    bulletSpeed: 259, burstGap: 0.044, cycle: 0.84 },

  { name: 'NIGHTFALL', tag: 'BLINK FRAME — WOLFRAM', kind: 'nightfall',
    coreHp: 625, score: 32000,
    bulletSpeed: 270, burstGap: 0.037, cycle: 0.75, blinkEvery: 2.6 },

  { name: 'THE SEXTON', tag: 'HULK TENDER — FERRUM', kind: 'sexton',
    coreHp: 769, plateHp: 50, score: 40000, plateScore: 900,
    bulletSpeed: 275, burstGap: 0.037, cycle: 0.69 },

  { name: 'GILTHAMMER', tag: 'ADMIRALTY GUARD — AURUM', kind: 'gilthammer',
    coreHp: 1009, plateHp: 59, score: 60000, plateScore: 1100,
    bulletSpeed: 292, burstGap: 0.031, cycle: 0.61 },
];

// One guard per hull, so the deep campaign needs seventeen more. Their
// behaviours cycle the eight that exist — a ninth pattern invented to fill
// a table is a worse boss than a known one at a harder tempo — but every
// one has its own name, its own numbers and its own place in the curve.
const DEEP_BOSS_NAMES = [
  ['THE BALLASTER', 'DEAD WEIGHT'],
  ['COLDSHORT', 'TENDER GUN'],
  ['ANODE', 'SACRIFICIAL FRAME'],
  ['KOBOLD', 'SURVEY PREDATOR'],
  ['PICKETMASTER', 'LINE WARDEN'],
  ['THE MIRROR', 'PARADE GUARD'],
  ['TOLDHAMMER', 'ARMOUR TEST RIG'],
  ['UNBOWED', 'ASSAULT PRIME'],
  ['SKYFALL', 'RELIC ENGINE'],
  ['LITTLE SILVER', 'TREASURY LOCK'],
  ['ROSE ASH', 'COURIER ESCORT'],
  ['THE WARD', 'GUARDIAN ABSOLUTE'],
  ['ANVILHEAD', 'HEAVIEST THING AFLOAT'],
  ['SLOWFIRE', 'REACTOR CORE'],
  ['THE LONG HALF', 'WARHEAD MIND'],
  ['ADAMANT', 'SIEGE CARRIER PRIME'],
  ['THE LAST NAME', 'FLAGSHIP OF THE LINE'],
];

const BOSS_KINDS = ['warden', 'drayline', 'riveter', 'coldforge',
  'slagheart', 'nightfall', 'sexton', 'gilthammer'];

const DEEP_BOSSES = DEEP_BOSS_NAMES.map(([name, tag], i) => {
  const n = CORE_BOSSES.length + i;        // 8..24
  const k = i + 1;
  const kind = BOSS_KINDS[n % BOSS_KINDS.length];
  // Gentle: GILTHAMMER at 1009 was already the tuned end of an eight-hull
  // campaign, and a last boss nineteen times that is not harder, it is
  // longer. The deep run ends at roughly four times it.
  const scale = Math.pow(1.083, k);
  const spec = {
    name,
    tag: tag + ' — ' + DEEP_HULLS[i][0],
    kind,
    coreHp: Math.round(1009 * scale),
    score: Math.round(60000 * Math.pow(1.10, k)),
    bulletSpeed: Math.min(360, Math.round(292 + k * 3)),
    burstGap: Math.max(0.020, +(0.031 - k * 0.0006).toFixed(4)),
    cycle: Math.max(0.42, +(0.61 - k * 0.011).toFixed(3)),
  };
  // Only the kinds that have sections get section numbers, and they are
  // the same fields the core bosses use.
  if (kind === 'warden' || kind === 'coldforge') {
    spec.podHp = Math.round(35 * scale);
    spec.podScore = 700 + k * 90;
  } else if (kind === 'riveter' || kind === 'slagheart'
    || kind === 'sexton' || kind === 'gilthammer') {
    spec.plateHp = Math.round(45 * scale);
    spec.plateScore = 900 + k * 110;
  }
  if (kind === 'coldforge') spec.mines = 3 + Math.floor(k / 5);
  if (kind === 'nightfall') spec.blinkEvery = Math.max(1.4, 2.6 - k * 0.07);
  if (kind === 'drayline') spec.sweepSpeed = 128 + k * 6;
  return spec;
});

export const BOSSES = [...CORE_BOSSES, ...DEEP_BOSSES];

const CORE_LEVELS = [
  { name: 'ARGENTUM', subtitle: 'SILVER CLASS — PATROL HULL',
    theme: 'steel', seed: 0x5ca1ab1e, length: 12000,
    gapScale: 1.00, clearChance: 0.13,
    turretHp: 6, turretCooldown: 1.75, turretRange: 300,
    interceptorSpeed: 172, interceptorSpawn: 1.50, interceptorHp: 2,
    foes: [],
    enemyDmg: 1.00,
    towers: ['gun'], lasers: 0, laserHp: 0, press: false, tune: 0 },

  { name: 'OSMIUM', subtitle: 'DENSEST ALLOY AFLOAT — LINE HULL',
    theme: 'conduit', seed: 0x051f1ed, length: 14500,
    gapScale: 0.86, clearChance: 0.09,
    turretHp: 8, turretCooldown: 1.45, turretRange: 330,
    interceptorSpeed: 196, interceptorSpawn: 1.20, interceptorHp: 3,
    foes: ['mine'],
    enemyDmg: 1.05,
    towers: ['gun', 'pop'], lasers: 0, laserHp: 1, press: false, tune: 1 },

  { name: 'TANTALUM', subtitle: 'CORROSION PROOF — FLAGSHIP HULL',
    theme: 'glacier', seed: 0x7a07a1, length: 17000,
    gapScale: 0.78, clearChance: 0.07,
    turretHp: 9, turretCooldown: 1.20, turretRange: 360,
    interceptorSpeed: 220, interceptorSpawn: 0.98, interceptorHp: 3,
    foes: ['mine', 'lancer', 'weaver', 'gnat'],
    enemyDmg: 1.10,
    towers: ['gun', 'pop', 'flak', 'post'], lasers: 1, laserHp: 2, press: false, tune: 4 },

  { name: 'CUPRUM', subtitle: 'OXIDISED — SALVAGE HULK',
    theme: 'desert', seed: 0xc0ffee, length: 18500,
    gapScale: 0.72, clearChance: 0.06,
    turretHp: 11, turretCooldown: 1.10, turretRange: 380,
    interceptorSpeed: 236, interceptorSpawn: 0.90, interceptorHp: 4,
    foes: ['mine', 'lancer', 'orbiter', 'weaver', 'gnat', 'dart'],
    enemyDmg: 1.16,
    towers: ['gun', 'pop', 'flak', 'lance', 'rocket', 'radar'], lasers: 2, laserHp: 3, press: true, tune: 2 },

  { name: 'PYRITE', subtitle: 'RUNNING HOT — FOUNDRY HULL',
    theme: 'foundry', seed: 0xf00dface, length: 20000,
    gapScale: 0.67, clearChance: 0.05,
    turretHp: 13, turretCooldown: 1.00, turretRange: 400,
    interceptorSpeed: 252, interceptorSpawn: 0.82, interceptorHp: 4,
    foes: ['lancer', 'orbiter', 'warder', 'weaver', 'splitter', 'dart', 'barge'],
    enemyDmg: 1.22,
    towers: ['gun', 'flak', 'lance', 'mortar', 'rocket', 'radar', 'bastion'], lasers: 2, laserHp: 4, press: true, tune: 5 },

  { name: 'WOLFRAM', subtitle: 'LIGHT SWALLOWING — SIEGE HULL',
    theme: 'void', seed: 0x0b51d1a, length: 21500,
    gapScale: 0.63, clearChance: 0.04,
    turretHp: 15, turretCooldown: 0.92, turretRange: 420,
    interceptorSpeed: 266, interceptorSpawn: 0.75, interceptorHp: 5,
    foes: ['mine', 'orbiter', 'warder', 'splitter', 'leech', 'mirror', 'barge'],
    enemyDmg: 1.28,
    towers: ['gun', 'lance', 'mortar', 'warden', 'rocket', 'bastion', 'array'], lasers: 3, laserHp: 5, press: true, tune: 3 },

  { name: 'FERRUM', subtitle: 'EATEN THROUGH — DERELICT HULL',
    theme: 'derelict', seed: 0xfe2211, length: 23000,
    gapScale: 0.59, clearChance: 0.035,
    turretHp: 16, turretCooldown: 0.86, turretRange: 440,
    interceptorSpeed: 280, interceptorSpawn: 0.70, interceptorHp: 5,
    foes: ['mine', 'lancer', 'orbiter', 'warder', 'bomber', 'leech', 'chainer', 'monitor'],
    enemyDmg: 1.34,
    towers: ['gun', 'flak', 'mortar', 'warden', 'rocket', 'array', 'silo'], lasers: 3, laserHp: 6, press: true, tune: 6 },

  { name: 'AURUM', subtitle: 'THE PRIZE — ADMIRALTY HULL',
    theme: 'admiralty', seed: 0xa17aa17a, length: 25000,
    gapScale: 0.55, clearChance: 0.03,
    turretHp: 18, turretCooldown: 0.80, turretRange: 460,
    interceptorSpeed: 294, interceptorSpawn: 0.64, interceptorHp: 6,
    foes: ['lancer', 'orbiter', 'warder', 'weaver', 'splitter', 'bomber', 'leech', 'carrier',
      'gnat', 'dart', 'barge', 'monitor'],
    enemyDmg: 1.40,
    towers: ['gun', 'flak', 'lance', 'mortar', 'warden', 'rocket', 'bastion', 'array', 'silo'], lasers: 4, laserHp: 7, press: true, tune: 7 },
];

// The campaign past the admiralty hull.
//
// The first eight are hand-authored: they are the tutorial, and each one
// introduces something. Past that the job is a curve rather than a
// sequence of ideas, so the rest are generated from one — every column
// only goes one way, and nothing can be left out of a hull by accident.
//

const THEME_CYCLE = Object.keys(THEMES);
const ALL_FOES = ['mine', 'lancer', 'orbiter', 'warder', 'weaver', 'splitter',
  'bomber', 'leech', 'mirror', 'carrier', 'chainer',
  'gnat', 'dart', 'barge', 'monitor'];
const ALL_TOWERS = ['gun', 'pop', 'bastion', 'flak', 'lance', 'mortar', 'warden', 'rocket',
  'radar', 'array', 'post', 'silo'];

// Binary floating point gives 0.64 - 3 * 0.018 as 0.5860000000000001, and
// those digits escaped into the README's hull table, where they read as a
// bug in the game rather than in the arithmetic. Rounded at the source, so
// anything generated from these is clean too.
const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;

const DEEP_LEVELS = DEEP_HULLS.map(([name, subtitle], i) => {
  const n = CORE_LEVELS.length + i;        // campaign index, 8..24
  const k = i + 1;                         // how far past the core, 1..17
  return {
    name,
    subtitle,
    theme: THEME_CYCLE[n % THEME_CYCLE.length],
    // Distinct, stable, and nothing to do with the index: a seed derived
    // from the position would make neighbouring hulls look related.
    seed: (0x9e3779b1 * (n + 1)) >>> 0 ^ 0x5bf03635,
    // No cap: two hulls of the same length read as a mistake, and the
    // texture is chunked so length costs nothing it did not already cost.
    length: 25000 + k * 950,
    gapScale: r3(Math.max(0.40, 0.55 - k * 0.009)),
    clearChance: r3(Math.max(0.015, 0.03 - k * 0.001)),
    turretHp: 18 + k * 2,
    turretCooldown: r3(Math.max(0.52, 0.80 - k * 0.017)),
    turretRange: Math.min(580, 460 + k * 7),
    interceptorSpeed: Math.min(400, 294 + k * 6),
    interceptorSpawn: r3(Math.max(0.34, 0.64 - k * 0.018)),
    interceptorHp: 6 + Math.floor(k / 3),
    // What a hit costs on this hull. Everything else about an enemy
    // scaled with depth — health 8.7x, spawn rate 4.4x — but the damage
    // it did was flat, 9 for a turret bullet on the first hull and 9 on
    // the last. Against a shield that grew the ship got steadily harder
    // to kill while the enemies only got harder to kill back, which is
    // why the deep hulls read as long rather than dangerous.
    enemyDmg: r2(1.40 + k * 0.05),
    foes: ALL_FOES,
    towers: ALL_TOWERS,
    lasers: Math.min(8, 4 + Math.floor(k / 3)),
    laserHp: 7 + k,
    press: true,
    tune: n % 8,
  };
});

export const LEVELS = [...CORE_LEVELS, ...DEEP_LEVELS];

// Clearing a hull upgrades the ship permanently for the rest of the run.
// These stack, so arriving at TANTALUM you are flying a markedly different
// craft from the one that launched at ARGENTUM — which is the point: the
// difficulty curve is met with a power curve, not just better flying.
// Difficulty. One multiplier set, applied where the numbers are actually
// used, so changing it takes effect without rebuilding anything.
// How often a squadron arrives.
//
// The gap after one is paced by what arrived, measured in what it was
// worth to kill — the only currency the roster already agrees on:
//
//   gap = max(floor, weight / rate) * jitter
//
// A swarm of gnats comes round again quickly; a monitor buys itself a long
// quiet. `rate` is per hull and is not a new difficulty knob: it is set to
// exactly what the old one-at-a-time cadence delivered on that hull — one
// roster pull every `legacyGap` seconds — so composition changed and the
// pressure did not. See foeRateFor in foes.js.
//
// A single global rate was tried first and cannot work. The old cadence's
// threat rate climbed with roster depth, from 47 points a second on
// TANTALUM to 97 on FERRUM, because a deeper roster holds heavier kinds
// and it still spawned one of anything every 3.7 seconds. Weight pacing
// against one number flattens that curve by design: the best fit over all
// twenty-five hulls still left the deep ones 40% quieter than they were.
export const FOE_PACE = {
  floor: 1.2,         // shortest breath between squadrons, whatever arrives
  jitter: 0.8,        // multiplies the gap by 0.8..1.2, mean 1
  legacyGap: 3.7,     // the old cadence's mean gap: 2.6 + 2.2 / 2
  assumed: 240,       // the weight to assume when nothing spawned (off the hull)
};

export const DIFFICULTY = [
  { id: 'cadet',   name: 'CADET',   enemyDmg: 0.6, bossHp: 0.7, spawn: 1.35, scrape: 0.6, scoreMul: 0.7 },
  { id: 'pilot',   name: 'PILOT',   enemyDmg: 1.0, bossHp: 1.0, spawn: 1.0,  scrape: 1.0, scoreMul: 1.0 },
  { id: 'veteran', name: 'VETERAN', enemyDmg: 1.4, bossHp: 1.3, spawn: 0.8,  scrape: 1.3, scoreMul: 1.3 },
  { id: 'ruin',    name: 'RUIN',    enemyDmg: 1.9, bossHp: 1.6, spawn: 0.62, scrape: 1.7, scoreMul: 1.7 },
];
export const DEFAULT_DIFFICULTY = 1;

// What clearing a hull pays beyond the flat completion bonus. Three
// questions, each about a different way of playing it: did you break the
// guns, did you keep your ships, did you pick the hull clean.
export const HULL_BONUS = {
  towers: 5000,        // x the fraction of the hull's guns destroyed
  fullSweep: 4000,     // every gun on the hull, on top of the above
  perLife: 1800,       // per ship still in the hangar
  haulPct: 0.3,        // of the loot value collected on this hull
  noLoss: 2500,        // the hull flown without losing a ship
};

export const LEVEL_UP = {
  // Smaller per hull than it was, and now bounded by SHIP.shieldCap: +45
  // reached the old unbounded ceiling in four hulls and kept going. At +15
  // the hull is still visibly tougher every time, and the cap arrives at
  // hull twenty-one rather than never.
  shieldMax: 15,
  accelMul: 1.09,
  maxVXAdd: 24,
  maxVYAdd: 18,
  bulletSpeedAdd: 50,
  lives: 1,

  // Free gun levels for clearing a hull, and how fast the ceiling rises.
  //
  // These used to be +1 of each, every hull. Combined with a cap that also
  // rose every hull, the free grants alone drove both guns to their
  // ceiling by hull five of twenty-five whatever the drops did — so making
  // the drops rarer just moved the point where the grants took over.
  // Spaced out, they are a thing that happens a few times in a campaign
  // rather than a tick-over, and the drops and the armourer decide the
  // rest.
  //
  // Over twenty-five hulls: gun speed at 5, 10, 15, 20, 25; blaze at 6,
  // 12, 18, 24; the cap at 7 and 14, which is where it reaches its hard
  // maximum of PICKUP.gunCapMax.
  gunSpeedEvery: 5,
  gunBlazeEvery: 6,
  gunCapEvery: 7,
};

export const DT = 1 / 120;               // fixed physics step
export const MAX_FRAME = 0.25;

export const SHIP = {
  w: 26, h: 15,
  hitW: 19, hitH: 9,
  accelX: 950,          // thrust along facing
  brakeX: 1750,         // reverse thrust — deliberately stronger, so flips feel decisive
  accelY: 1150,
  dragX: 1.5,           // low: you coast a long way (Uridium)
  dragY: 7.0,           // high: vertical is responsive and settles
  maxVX: 310,
  maxVY: 230,
  flipTime: 0.17,
  fireRate: 0.115,
  bulletSpeed: 545,
  shieldMax: 100,
  // The ceiling on what the *refit* builds into the hull. Upgrades add on
  // top of it; see PICKUP.shieldBonusMax.
  //
  // There was no ceiling, and the refit's +45 a hull took the ship to 1180
  // by the end of the campaign. Enemy damage is flat — a turret bullet is
  // 9 on the first hull and 9 on the last — so the ship got twelve times
  // harder to kill while the enemies only got harder to kill back. That is
  // the wrong way round, and it is what made the deep hulls long rather
  // than dangerous.
  shieldCap: 400,
  lives: 3,
  invuln: 1.7,
  scrapeCd: 0.28,
  grindDamage: 2.5,      // flat cost of touching the hull at all
  impactDamage: 0.045,   // extra per px/s of closing speed -> ~16 at full tilt
};

// Gun towers. The basic emplacement is on every hull; the rest are
// introduced later, and a hull's `towers` list says which it may mount.
// Each is a different problem rather than a tougher version of the same one.
export const TOWERS = {
  gun: {
    name: 'GUN', hpMul: 1.0, score: 150,
    burst: 3, burstGap: 0.13, cooldownMul: 1.0, bulletSpeed: 195, spread: 0,
    colour: '#e8434f',
  },
  flak: {
    // Fires a wide fan rather than an aimed burst: cannot be beaten by
    // sitting still off its line, has to be approached or destroyed.
    name: 'FLAK', hpMul: 1.3, score: 260,
    burst: 1, burstGap: 0.1, cooldownMul: 1.25, bulletSpeed: 165, spread: 0.26, fan: 5,
    colour: '#ff9a3a',
  },
  lance: {
    // Charges visibly, then fires one very fast shot. Punishes standing in
    // the open; trivial if you respect the tell.
    name: 'LANCE', hpMul: 1.1, score: 300,
    burst: 1, burstGap: 0.1, cooldownMul: 1.9, bulletSpeed: 560, spread: 0,
    charge: 0.85, colour: '#4fd0e8',
  },
  mortar: {
    // Lobs slow heavy shells on an arc that ignores your altitude, so
    // hugging the opposite rim does not help.
    name: 'MORTAR', hpMul: 1.6, score: 340,
    burst: 2, burstGap: 0.3, cooldownMul: 1.6, bulletSpeed: 120, spread: 0.1,
    arc: true, colour: '#9ad94e',
  },
  warden: {
    // Shields its neighbours. While it lives, nearby towers take no damage,
    // so it changes the order you have to kill things in.
    name: 'WARDEN', hpMul: 2.0, score: 420,
    burst: 2, burstGap: 0.18, cooldownMul: 1.4, bulletSpeed: 180, spread: 0.12,
    aura: 150, colour: '#b45ce0',
  },
  // --- sizes
  //
  // The same gun at three weights, so a hull can vary its pressure
  // without varying what it asks of you. A popgun is a speed bump; a
  // bastion is a wall you plan around. `r` drives the art, the hitbox
  // and nothing else: the behaviour differences are the numbers above
  // it, so a size is not a different tower pretending.
  pop: {
    name: 'POPGUN', hpMul: 0.45, score: 70, r: 6,
    burst: 2, burstGap: 0.1, cooldownMul: 0.65, bulletSpeed: 210, spread: 0.05,
    turnMul: 1.5,
    colour: '#e8746f',
  },
  bastion: {
    // Slow to come round, so it can be beaten by crossing its face
    // quickly — and punishing if you loiter in front of it.
    name: 'BASTION', hpMul: 3.2, score: 520, r: 15,
    burst: 4, burstGap: 0.16, cooldownMul: 1.5, bulletSpeed: 230, spread: 0.07,
    turnMul: 0.45, dmgMul: 1.6,
    colour: '#c0392b',
  },

  // --- the ones that do not shoot at you
  //
  // Every tower before these answered the same question: how do I not be
  // in front of it. These ask a different one — whether it is worth
  // spending time on something that is not shooting at you. Each makes
  // the things that ARE shooting better, so the answer is usually yes
  // and never obvious.
  radar: {
    // A spinning dish. While it lives, every tower near it wakes early
    // and comes round faster: you are seen before you arrive.
    name: 'RADAR', hpMul: 0.9, score: 240, r: 11,
    inert: true, spin: 2.2, paint: 230, paintWake: 190, paintTurn: 1.5,
    colour: '#67d9b8',
  },
  array: {
    // The same job at longer reach, and it sweeps rather than spins, so
    // the two read apart at a glance even in silhouette.
    name: 'ARRAY', hpMul: 1.2, score: 330, r: 13,
    inert: true, sweep: 1.1, paint: 360, paintWake: 300, paintTurn: 1.25,
    colour: '#7fb2ff',
  },
  post: {
    // An observation post calls the interceptors in. Cheap to kill and
    // easy to ignore, which is the trap: leave it and the stream never
    // thins.
    name: 'POST', hpMul: 0.7, score: 210, r: 9,
    inert: true, watch: 0.55,
    colour: '#c9e86b',
  },

  // --- the spaceport
  //
  // A place rather than a gun. The control tower directs, the tanks are
  // the reason to be careful, and the landed craft are parked targets
  // that pay. Together they are the one installation where the right
  // move is sometimes a single shot in the right place.
  control: {
    name: 'CONTROL', hpMul: 1.8, score: 400, r: 14,
    inert: true, watch: 0.4, paint: 200, paintWake: 150, paintTurn: 1.2,
    colour: '#ffd24a',
  },
  tank: {
    // Does nothing until it is hit, and then does a great deal. The
    // blast reaches other tanks, so a port can be taken apart with one
    // well-placed shot — or taken apart around you if you are close.
    name: 'FUEL', hpMul: 0.8, score: 180, r: 13,
    inert: true, volatile: { r: 96, dmg: 40 },
    colour: '#ff7a2f',
  },
  lander: {
    // Parked, unarmed, and worth more than it looks. Something to shoot
    // while the tanks are deciding whether to kill you.
    name: 'LANDER', hpMul: 1.4, score: 290, r: 16,
    inert: true,
    colour: '#8e9aa9',
  },

  silo: {
    // Long-range missiles. Everything else has to let you come to it;
    // this one opens from the far side of the screen, and the shots are
    // slow enough to shoot down if you see them leave.
    name: 'SILO', hpMul: 1.7, score: 560, r: 14,
    burst: 1, burstGap: 0.5, cooldownMul: 3.2, bulletSpeed: 96, spread: 0.1,
    seek: 0.95, seekLife: 7.5, seekHp: 3,
    range: 760, wake: 900,      // opens long before anything else does
    colour: '#d94f8c',
  },

  rocket: {
    // Launches slow homing missiles. Every other tower is beaten by not
    // being on its line; this one follows, so it has to be out-turned or
    // shot down. Missiles are the only enemy ordnance the cannon can
    // destroy, which is the whole counterplay.
    name: 'ROCKET', hpMul: 1.5, score: 480,
    burst: 2, burstGap: 0.46, cooldownMul: 2.6, bulletSpeed: 112, spread: 0.3,
    seek: 1.45,            // rad/s: outrunnable by turning, not by sitting
    seekLife: 4.4,         // and it runs out of fuel
    seekHp: 2,
    colour: '#ff5fa8',
  },
};

// Laser gates: a wall of light with an emitter clamped to one girder. The
// only obstacle in the game that must be answered rather than dodged.
export const LASER = {
  hp: 14,
  hpPerLevel: 3,
  score: 900,
  colour: '#ff4d6d',
  emitterW: 22,
  emitterH: 14,
  shipClear: 15,        // how close the ship gets before the beam stops it
  burn: 16,             // shield cost per touch
  burnEvery: 0.28,      // and how often that can happen
};

export const TURRET = {
  range: 300,
  wake: 430,            // starts tracking this far out
  // Only a fallback: every hull states its own turretHp. Guns went down to
  // a sneeze, which made breaking them a formality rather than the thing
  // the end-of-hull bonus is paid on.
  hp: 6,
  turnRate: 2.6,        // rad/s
  aimTol: 0.26,
  burst: 3,
  burstGap: 0.13,
  cooldown: 1.75,
  bulletSpeed: 195,
  score: 150,
};

export const INTERCEPTOR = {
  hp: 2,
  speed: 172,
  weaveAmp: 54,
  weaveFreq: 2.1,
  trackRate: 58,        // px/s of vertical homing on the weave centreline
  fireEvery: 1.2,
  bulletSpeed: 220,
  w: 21, h: 13,
  score: 100,
  spawnEvery: 1.5,
  maxActive: 7,
  ramDamage: 26,
};

// Pickups. Dropped by things you destroy, so shooting is rewarded beyond
// score, and the run has an upgrade curve rather than a flat difficulty line.
export const PICKUP = {
  size: 12,
  life: 11.0,            // seconds on the hull before it expires
  blinkAt: 3.0,          // starts flashing with this long left
  // Magnetism. Generous by default: chasing a coin across the hull is not
  // interesting, and the old radius was small enough that flying fast lost
  // most of a kill's loot. Loot reaches further than upgrades do.
  magnet: 74,
  magnetLoot: 118,
  magnetLevels: [1, 1.45, 1.95, 2.6],   // what the shop sells
  magnetPull: 320,
  drift: 13,
  bob: 9,                // vertical bob amplitude, px
  score: 50,

  dropFromTurret: 0.6,
  dropFromInterceptor: 0.17,

  shieldRefill: 40,      // shields-refill: restores this much
  healthBarBonus: 25,    // healthbars: raises MAX shield by this much

  // How much maximum shield the *upgrades* can add, across healthbars and
  // HULL PLATING together.
  //
  // This used to be an absolute ceiling on shieldMax of 220, which looked
  // reasonable against a starting 100 and was in fact dead by the fourth
  // hull of twenty-five: the refit adds LEVEL_UP.shieldMax every hull on
  // its own, so shieldMax passes 220 at hull four and reaches 1180 by the
  // end. Past that point every healthbar printed "HEALTHBAR FULL" and did
  // nothing but refill, and HULL PLATING could not be bought at all — a
  // pickup and a whole shop row, dead for twenty-two hulls.
  //
  // Counting the bonus instead of the total means the upgrade is worth
  // the same on the first hull and the last, which is what a pickup that
  // keeps dropping ought to be.
  shieldBonusMax: 150,   // six healthbars, or six platings, or a mix
  maxLives: 6,

  gunLevels: 3,          // base cap; LEVEL_UP.gunCapEvery raises it
  // The hard ceiling on gun upgrades, stated rather than falling out of an
  // array length. With eight hulls, +1 cap each would reach level 10: that
  // is 22 bullets a volley at 40 volleys a second, which starves the shot
  // pool and stops being a game. Five is the top.
  gunCapMax: 5,

  // What a crate holds. Weights, not probabilities: the roll is over their
  // sum, so one can be raised without rebalancing the rest.
  //
  // The two gun upgrades used to be a flat 42 of 100 between them, which
  // against a cap of three each and some seventy crates on a hull meant
  // both were maxed before the first boss. A fully pimped gun by the
  // quarter mark is not a reward, it is the end of a progression that was
  // supposed to last twenty-five hulls.
  dropWeights: {
    shield: 34,
    healthbar: 16,
    gunspeed: 14,
    gunblaze: 12,
    life: 8,
  },

  // ...and the odds of a gun upgrade fall away with every level already
  // held. The first is common enough to arrive early — the opening minute
  // should still feel generous — the third is something you fly for, and a
  // level already at its cap is never rolled at all.
  //
  //   held:   0      1      2      3      4
  //   weight: 1.00   0.45   0.20   0.09   0.04
  gunDropFalloff: 0.45,

  // Coins and coffins. Destroyed things scatter coins, which are small and
  // everywhere; a coffin is the rare one worth stopping for.
  coinValue: 25,
  coinLife: 7.0,
  coinScatter: 150,      // initial outward speed, px/s
  coinDrag: 2.4,
  coinsPerKill: [2, 5],  // inclusive range
  // A tier between coins and coffins: uncommon, clearly worth diverting for.
  barValue: 250,
  barCoins: 10,          // and what it is worth at the armourer
  barLife: 10.0,
  barChance: 0.16,       // per destroyed thing
  coffinValue: 2500,
  coffinCoins: 60,
  coffinChance: 0.045,   // per destroyed thing
  coffinLife: 13.0,

  // Treasure. Four tiers above the gold bar, rare enough that seeing one is
  // an event and each is worth breaking formation for. Unlike coins these
  // are not scattered by every kill: they come from the things that are
  // hard to kill, and the odds improve with the hull.
  treasure: {
    gem:    { value: 900,   coins: 24,  life: 13.0, weight: 46, colour: '#59e6c3', label: 'CUT GEM' },
    idol:   { value: 2000,  coins: 52,  life: 14.0, weight: 28, colour: '#c08cff', label: 'ALIEN IDOL' },
    crown:  { value: 4500,  coins: 110, life: 15.0, weight: 18, colour: '#ffd24a', label: 'PIRATE CROWN' },
    reliquary: { value: 9000, coins: 230, life: 16.0, weight: 8, colour: '#ff6ad5', label: 'RELIQUARY' },
  },
  treasureChance: 0.022,       // per destroyed thing, on the first hull
  treasureHullBonus: 0.006,    // and this much more per hull after it
  treasureFromBoss: 7,         // bosses and minibosses roll this many times

  // A boss carries a hold, and a hold is not a dice roll. Killing one always
  // sheds this much, on top of the ordinary coin scatter and the treasure
  // rolls — the wreck is worth flying into because of what is in it, not
  // because of what might be.
  bossBars: [3, 6],            // inclusive range
  bossCoffins: [1, 2],
  miniBars: [1, 3],
  miniCoffins: [1, 1],
  // gunspeed: fire interval multiplier per level. Sized past the reachable
  // maximum (3 base + 2 from clearing hulls) so an index can never fall off.
  // Flattening curve: each level is a real gain but the top is ~2.4x base
  // rather than 4.5x, which the projectile budget cannot actually service.
  speedScale: [1.0, 0.80, 0.66, 0.56, 0.48, 0.42],
  // gunblaze: extra barrel angles (radians, mirrored) per level
  blazeAngles: [
    [],
    [0.13],
    [0.13, 0.26],
    [0.13, 0.26, 0.40],
    [0.10, 0.20, 0.31, 0.43],
    [0.09, 0.18, 0.28, 0.38, 0.50],
  ],
};

// The armory: ordnance you carry a finite amount of, fired separately from
// the cannon. Each answers a situation the cannon handles badly.
// The two bought weapons that are not ordnance: a gun on the tail and a
// beam down the centreline. Both are mods rather than consumables —
// permanent, visible on the hull, and fired by the ship rather than by
// you, because a third and fourth thing to aim is not more interesting
// than the two there already are.
export const REAR = {
  fireEvery: 0.55,
  bulletSpeed: 420,
  damage: 7,
  range: 360,           // only bothers when something is actually behind
};

export const LANCE = {
  // Charges, then puts a beam through everything in a line. Tier two is
  // heavier and comes round faster.
  cycle: [4.2, 2.8],
  charge: 0.55,
  dwell: 0.22,
  damage: [26, 44],
  halfHeight: 5,
  colour: '#8fd8ff',
};

export const ARMORY = {
  order: ['bomb', 'grenade', 'missile', 'mine'],
  fireKeyRate: 0.28,        // floor on how fast any of them can be thrown

  bomb: {
    name: 'BOMB', short: 'BMB',
    // Dropped in place, detonates after a fuse. Clears everything around
    // you, which is what you want when something got close.
    fuse: 0.65, blastR: 96, damage: 26, drag: 2.6,
    ammoPerCrate: 2, maxAmmo: 9, cooldown: 0.75,
    colour: '#ff7a2f',
  },
  grenade: {
    name: 'GRENADE', short: 'GRN',
    // Lobbed on an arc and bounces off the hull, so it reaches around
    // cover the cannon cannot shoot through.
    speed: 300, gravity: 420, bounce: 0.55, fuse: 1.5,
    blastR: 70, damage: 20,
    ammoPerCrate: 3, maxAmmo: 12, cooldown: 0.45,
    colour: '#9ad94e',
  },
  mine: {
    name: 'SPIKE MINE', short: 'MNE',
    // Left behind rather than thrown. The cannon points where you are
    // going; this is the only thing in the armory that answers what is
    // following you, and the only one you place before you need it.
    // Arms after a moment so you cannot drop one onto your own nose, then
    // sits on the hull until something touches it or its timer runs out.
    arm: 0.5, life: 14.0, drift: 0.9,
    blastR: 82, damage: 30, trigger: 26,
    ammoPerCrate: 2, maxAmmo: 10, cooldown: 0.55,
    colour: '#c08cff',
  },
  missile: {
    name: 'MISSILE', short: 'MSL',
    // Finds its own target. Expensive, and the answer to a boss section you
    // cannot line up on.
    speed: 190, accel: 340, maxSpeed: 430, turn: 3.4,
    seekRange: 420, life: 4.0, blastR: 48, damage: 34,
    ammoPerCrate: 2, maxAmmo: 8, cooldown: 0.5,
    colour: '#4fd0e8',
  },
};

export const CAM = {
  lead: 116,            // ship sits this far behind centre, so you see where you're going
  lerp: 5.4,
};

// How far outside the view a pooled thing must be before its slot is
// recycled.
//
// This used to be a different magic number in each module — 90 for
// interceptors, 140 for loot, 160 for attackers, 200 for your own
// ordnance — and every one of them was smaller than the distance the
// camera travels when you turn around. CAM.lead is 116, so reversing
// slides the view 232px, and anything in the trailing third of the screen
// you were just looking at was destroyed before the ship had moved at
// all. Turning back for a coffin was what destroyed the coffin.
//
// Derived rather than picked: the swing, plus half a screen of backtrack,
// so changing your mind and going back for something cannot be the thing
// that loses it. Nothing depends on this margin to stay bounded — loot and
// ordnance expire on their own timers, attackers chase you rather than
// piling up out of frame, and every pool refuses to overfill — so it only
// decides when a slot is reused.
export const CULL_MARGIN = CAM.lead * 2 + VIEW_W / 2;

export const COL = {
  space:     '#06080c',
  hullBase:  '#171a20',
  hullMid:   '#30363f',
  hullHi:    '#464e5a',
  rivet:     '#737d8c',
  edgeHi:    '#8e9aa9',
  edgeLo:    '#12161e',
  hazard:    '#6b5a28',
  cool:      '#4fd0e8',
  coolHi:    '#b4f4ff',
  warm:      '#ff7a2f',
  warmHi:    '#ffd24a',
  danger:    '#e8434f',
  hudBg:     '#0a0d13',
  hudLine:   '#232b36',
  hudText:   '#7d8797',
  hudBright: '#cfe2ee',
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential smoothing.
//
// Guards a non-finite dt rather than propagating it. A bad dt once reached
// here through a mis-ordered argument and turned the camera into NaN, which
// silently drew a black screen while the score, the ship and the frame rate
// all still looked healthy. Returning 0 means "do not move this frame",
// which is visible as a stutter and recoverable, instead of poisoning
// whatever the result is assigned to.
export const smooth = (rate, dt) => (Number.isFinite(dt) ? 1 - Math.exp(-rate * dt) : 0);
