// Every tunable in one place. Change a number, reload, re-fly.

// Bumped by hand. Shown on the splash and in the backend's health response,
// so a player reporting a bug and the server they hit can be lined up.
export const VERSION = '0.9.0';
export const BUILD = 'RIVETS';

export const VIEW_W = 640;
export const VIEW_H = 360;

export const HUD_H = 36;
export const FIELD_H = VIEW_H - HUD_H;   // 324 — playfield height
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

// Each hull is guarded at its far end. The boss gates the turnaround, so a
// run is approach -> boss -> escape, and reaching the dock is earned twice.
export const BOSS = {
  arenaMargin: 40,
  entryTime: 2.2,
  deathTime: 2.6,
  hitFlash: 0.08,
  contactDamage: 34,
};

// Eight bosses, one per hull, each harder than the last. `kind` selects the
// behaviour in boss.js; the numbers here are the whole difficulty curve.
export const BOSSES = [
  { name: 'THE WARDEN', tag: 'EMPLACED FORTRESS — ARGENTUM', kind: 'warden',
    coreHp: 53, podHp: 13, score: 6000, podScore: 400,
    bulletSpeed: 180, burstGap: 0.128, cycle: 1.75 },

  { name: 'DRAYLINE', tag: 'LINE GUNSHIP — OSMIUM', kind: 'drayline',
    coreHp: 121, score: 9000,
    bulletSpeed: 205, burstGap: 0.080, cycle: 1.44, sweepSpeed: 128 },

  { name: 'THE RIVETER', tag: 'FLAGSHIP BATTERY — TANTALUM', kind: 'riveter',
    coreHp: 186, plateHp: 20, score: 14000, plateScore: 600,
    bulletSpeed: 225, burstGap: 0.064, cycle: 1.22 },

  { name: 'COLDFORGE', tag: 'MINELAYER — CUPRUM', kind: 'coldforge',
    coreHp: 256, podHp: 25, score: 19000, podScore: 700,
    bulletSpeed: 215, burstGap: 0.072, cycle: 1.29, mines: 3 },

  { name: 'SLAGHEART', tag: 'TWIN REACTOR — PYRITE', kind: 'slagheart',
    coreHp: 326, plateHp: 31, score: 25000, plateScore: 800,
    bulletSpeed: 240, burstGap: 0.056, cycle: 1.10 },

  { name: 'NIGHTFALL', tag: 'BLINK FRAME — WOLFRAM', kind: 'nightfall',
    coreHp: 403, score: 32000,
    bulletSpeed: 250, burstGap: 0.048, cycle: 0.99, blinkEvery: 2.6 },

  { name: 'THE SEXTON', tag: 'HULK TENDER — FERRUM', kind: 'sexton',
    coreHp: 496, plateHp: 36, score: 40000, plateScore: 900,
    bulletSpeed: 255, burstGap: 0.048, cycle: 0.91 },

  { name: 'GILTHAMMER', tag: 'ADMIRALTY GUARD — AURUM', kind: 'gilthammer',
    coreHp: 651, plateHp: 42, score: 60000, plateScore: 1100,
    bulletSpeed: 270, burstGap: 0.040, cycle: 0.80 },
];

export const LEVELS = [
  { name: 'ARGENTUM', subtitle: 'SILVER CLASS — PATROL HULL',
    theme: 'steel', seed: 0x5ca1ab1e, length: 12000,
    gapScale: 1.00, clearChance: 0.13,
    turretHp: 3, turretCooldown: 1.75, turretRange: 300,
    interceptorSpeed: 172, interceptorSpawn: 1.50, interceptorHp: 2,
    foes: [],
    towers: ['gun'], tune: 0 },

  { name: 'OSMIUM', subtitle: 'DENSEST ALLOY AFLOAT — LINE HULL',
    theme: 'conduit', seed: 0x051f1ed, length: 14500,
    gapScale: 0.86, clearChance: 0.09,
    turretHp: 4, turretCooldown: 1.45, turretRange: 330,
    interceptorSpeed: 196, interceptorSpawn: 1.20, interceptorHp: 3,
    foes: ['mine'],
    towers: ['gun'], tune: 1 },

  { name: 'TANTALUM', subtitle: 'CORROSION PROOF — FLAGSHIP HULL',
    theme: 'glacier', seed: 0x7a07a1, length: 17000,
    gapScale: 0.78, clearChance: 0.07,
    turretHp: 5, turretCooldown: 1.20, turretRange: 360,
    interceptorSpeed: 220, interceptorSpawn: 0.98, interceptorHp: 3,
    foes: ['mine', 'lancer', 'weaver'],
    towers: ['gun', 'flak'], tune: 2 },

  { name: 'CUPRUM', subtitle: 'OXIDISED — SALVAGE HULK',
    theme: 'desert', seed: 0xc0ffee, length: 18500,
    gapScale: 0.72, clearChance: 0.06,
    turretHp: 6, turretCooldown: 1.10, turretRange: 380,
    interceptorSpeed: 236, interceptorSpawn: 0.90, interceptorHp: 4,
    foes: ['mine', 'lancer', 'orbiter', 'weaver'],
    towers: ['gun', 'flak', 'lance'], tune: 1 },

  { name: 'PYRITE', subtitle: 'RUNNING HOT — FOUNDRY HULL',
    theme: 'foundry', seed: 0xf00dface, length: 20000,
    gapScale: 0.67, clearChance: 0.05,
    turretHp: 7, turretCooldown: 1.00, turretRange: 400,
    interceptorSpeed: 252, interceptorSpawn: 0.82, interceptorHp: 4,
    foes: ['lancer', 'orbiter', 'warder', 'weaver', 'splitter'],
    towers: ['gun', 'flak', 'lance', 'mortar'], tune: 2 },

  { name: 'WOLFRAM', subtitle: 'LIGHT SWALLOWING — SIEGE HULL',
    theme: 'void', seed: 0x0b51d1a, length: 21500,
    gapScale: 0.63, clearChance: 0.04,
    turretHp: 8, turretCooldown: 0.92, turretRange: 420,
    interceptorSpeed: 266, interceptorSpawn: 0.75, interceptorHp: 5,
    foes: ['mine', 'orbiter', 'warder', 'splitter', 'leech'],
    towers: ['gun', 'lance', 'mortar', 'warden'], tune: 2 },

  { name: 'FERRUM', subtitle: 'EATEN THROUGH — DERELICT HULL',
    theme: 'derelict', seed: 0xfe2211, length: 23000,
    gapScale: 0.59, clearChance: 0.035,
    turretHp: 9, turretCooldown: 0.86, turretRange: 440,
    interceptorSpeed: 280, interceptorSpawn: 0.70, interceptorHp: 5,
    foes: ['mine', 'lancer', 'orbiter', 'warder', 'bomber', 'leech'],
    towers: ['gun', 'flak', 'mortar', 'warden'], tune: 0 },

  { name: 'AURUM', subtitle: 'THE PRIZE — ADMIRALTY HULL',
    theme: 'admiralty', seed: 0xa17aa17a, length: 25000,
    gapScale: 0.55, clearChance: 0.03,
    turretHp: 10, turretCooldown: 0.80, turretRange: 460,
    interceptorSpeed: 294, interceptorSpawn: 0.64, interceptorHp: 6,
    foes: ['lancer', 'orbiter', 'warder', 'weaver', 'splitter', 'bomber', 'leech'],
    towers: ['gun', 'flak', 'lance', 'mortar', 'warden'], tune: 2 },
];

// Clearing a hull upgrades the ship permanently for the rest of the run.
// These stack, so arriving at TANTALUM you are flying a markedly different
// craft from the one that launched at ARGENTUM — which is the point: the
// difficulty curve is met with a power curve, not just better flying.
// Difficulty. One multiplier set, applied where the numbers are actually
// used, so changing it takes effect without rebuilding anything.
export const DIFFICULTY = [
  { id: 'cadet',   name: 'CADET',   enemyDmg: 0.6, bossHp: 0.7, spawn: 1.35, scrape: 0.6, scoreMul: 0.7 },
  { id: 'pilot',   name: 'PILOT',   enemyDmg: 1.0, bossHp: 1.0, spawn: 1.0,  scrape: 1.0, scoreMul: 1.0 },
  { id: 'veteran', name: 'VETERAN', enemyDmg: 1.4, bossHp: 1.3, spawn: 0.8,  scrape: 1.3, scoreMul: 1.3 },
  { id: 'ruin',    name: 'RUIN',    enemyDmg: 1.9, bossHp: 1.6, spawn: 0.62, scrape: 1.7, scoreMul: 1.7 },
];
export const DEFAULT_DIFFICULTY = 1;

export const LEVEL_UP = {
  shieldMax: 45,
  accelMul: 1.09,
  maxVXAdd: 24,
  maxVYAdd: 18,
  bulletSpeedAdd: 50,
  gunSpeed: 1,     // free levels granted
  gunBlaze: 1,
  gunCap: 1,       // and the ceiling rises with them
  lives: 1,
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
};

export const TURRET = {
  range: 300,
  wake: 430,            // starts tracking this far out
  hp: 3,
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
  shieldCeiling: 220,    // and stops here
  maxLives: 6,

  gunLevels: 3,          // base cap; LEVEL_UP.gunCap raises it each hull
  // The hard ceiling on gun upgrades, stated rather than falling out of an
  // array length. With eight hulls, +1 cap each would reach level 10: that
  // is 22 bullets a volley at 40 volleys a second, which starves the shot
  // pool and stops being a game. Five is the top.
  gunCapMax: 5,

  // Coins and coffins. Destroyed things scatter coins, which are small and
  // everywhere; a coffin is the rare one worth stopping for.
  coinValue: 25,
  coinLife: 7.0,
  coinScatter: 150,      // initial outward speed, px/s
  coinDrag: 2.4,
  coinsPerKill: [2, 5],  // inclusive range
  // A tier between coins and coffins: uncommon, clearly worth diverting for.
  barValue: 250,
  barLife: 10.0,
  barChance: 0.16,       // per destroyed thing
  coffinValue: 2500,
  coffinChance: 0.045,   // per destroyed thing
  coffinLife: 13.0,
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
export const ARMORY = {
  order: ['bomb', 'grenade', 'missile'],
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
