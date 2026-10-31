// Every tunable in one place. Change a number, reload, re-fly.

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
export const THEMES = {
  steel: {
    name: 'STEEL',
    base: '#171a20', mid: '#30363f', hi: '#464e5a', seam: '#12161e',
    rivet: '#737d8c', rivetHi: '#b4c0ce', edgeHi: '#8e9aa9', rimDark: '#191d24',
    hazard: '#6b5a28', chevron: '#d9a62e',
    block: '#4e5765', blockHi: '#5a6472', blockLo: '#434b58', blockEdge: '#0d1016',
    tones: ['#1d2128', '#21262d', '#252a32', '#282e36', '#1f242b', '#262b33'],
  },
  abyssal: {
    name: 'ABYSSAL',
    base: '#0d1420', mid: '#243449', hi: '#36506e', seam: '#070c14',
    rivet: '#5d7c9a', rivetHi: '#9fc2e0', edgeHi: '#6f94b8', rimDark: '#0f1725',
    hazard: '#285a6b', chevron: '#3fb0c9',
    block: '#3a5068', blockHi: '#466079', blockLo: '#30435a', blockEdge: '#060a11',
    tones: ['#111a27', '#15202e', '#192536', '#1c293c', '#131c2a', '#172331'],
  },
  cryolite: {
    name: 'CRYOLITE',
    base: '#1a2026', mid: '#3d4a52', hi: '#5f727c', seam: '#141a1f',
    rivet: '#9db4bf', rivetHi: '#d7e8ef', edgeHi: '#a8c2cc', rimDark: '#1c242b',
    hazard: '#4a6a72', chevron: '#8fd6e2',
    block: '#5a6d78', blockHi: '#6b808c', blockLo: '#4c5e68', blockEdge: '#101519',
    tones: ['#222b32', '#27323a', '#2c3841', '#303d47', '#242e36', '#29343d'],
  },
  verdigris: {
    name: 'VERDIGRIS',
    base: '#12201c', mid: '#2a4a40', hi: '#3e6b5c', seam: '#0a1511',
    rivet: '#6f9c8a', rivetHi: '#a8d8c4', edgeHi: '#79ab98', rimDark: '#132420',
    hazard: '#5f6b28', chevron: '#9ad94e',
    block: '#3c6155', blockHi: '#487264', blockLo: '#325349', blockEdge: '#081210',
    tones: ['#16271f', '#1a2d25', '#1e332a', '#21382f', '#182a22', '#1c3027'],
  },
  pyrite: {
    name: 'PYRITE',
    base: '#1d1310', mid: '#43281f', hi: '#5f392b', seam: '#120a07',
    rivet: '#9a6a4c', rivetHi: '#e0ab7e', edgeHi: '#b07a56', rimDark: '#1f1512',
    hazard: '#7a3a16', chevron: '#ff8a2e',
    block: '#5c3729', blockHi: '#6e4232', blockLo: '#4c2d22', blockEdge: '#0f0806',
    tones: ['#241713', '#2a1b16', '#301f19', '#35231c', '#261915', '#2c1d18'],
  },
  obsidian: {
    name: 'OBSIDIAN',
    base: '#0a0a0e', mid: '#1e1e26', hi: '#32323f', seam: '#050508',
    rivet: '#5a5a6e', rivetHi: '#a8a8c4', edgeHi: '#6e6e88', rimDark: '#0c0c11',
    hazard: '#4a2a5e', chevron: '#b45ce0',
    block: '#2c2c38', blockHi: '#383846', blockLo: '#24242e', blockEdge: '#040406',
    tones: ['#0d0d12', '#101016', '#13131a', '#16161e', '#0f0f14', '#121218'],
  },
  rust: {
    name: 'RUST',
    base: '#1e1512', mid: '#4a2f24', hi: '#6b4432', seam: '#120b08',
    rivet: '#a07a5c', rivetHi: '#d9a07a', edgeHi: '#a87a5c', rimDark: '#201713',
    hazard: '#6b4a1e', chevron: '#d98e3e',
    block: '#5e3e2e', blockHi: '#704a37', blockLo: '#4e3326', blockEdge: '#0f0907',
    tones: ['#251a15', '#2b1f19', '#31231c', '#36271f', '#271c17', '#2d211a'],
  },
  aurum: {
    name: 'AURUM',
    base: '#1f1a0e', mid: '#4d4120', hi: '#6e5c2d', seam: '#130f07',
    rivet: '#b39a4e', rivetHi: '#f0dc96', edgeHi: '#c4ab5e', rimDark: '#211c10',
    hazard: '#7a641e', chevron: '#ffd84a',
    block: '#63532a', blockHi: '#766333', blockLo: '#524524', blockEdge: '#100c06',
    tones: ['#262010', '#2c2513', '#322a16', '#372f19', '#282213', '#2e2716'],
  },
};

// Three hulls, named for metals — Uridium's stage-naming ritual. Each is
// longer, denser and better defended than the last. Everything that scales
// difficulty lives here, so the curve can be read in one place.
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
    coreHp: 34, podHp: 9, score: 6000, podScore: 400,
    bulletSpeed: 180, burstGap: 0.16, cycle: 2.30 },

  { name: 'DRAYLINE', tag: 'LINE GUNSHIP — OSMIUM', kind: 'drayline',
    coreHp: 78, score: 9000,
    bulletSpeed: 205, burstGap: 0.10, cycle: 1.90, sweepSpeed: 128 },

  { name: 'THE RIVETER', tag: 'FLAGSHIP BATTERY — TANTALUM', kind: 'riveter',
    coreHp: 120, plateHp: 14, score: 14000, plateScore: 600,
    bulletSpeed: 225, burstGap: 0.08, cycle: 1.60 },

  { name: 'COLDFORGE', tag: 'MINELAYER — CUPRUM', kind: 'coldforge',
    coreHp: 165, podHp: 18, score: 19000, podScore: 700,
    bulletSpeed: 215, burstGap: 0.09, cycle: 1.70, mines: 3 },

  { name: 'SLAGHEART', tag: 'TWIN REACTOR — PYRITE', kind: 'slagheart',
    coreHp: 210, plateHp: 22, score: 25000, plateScore: 800,
    bulletSpeed: 240, burstGap: 0.07, cycle: 1.45 },

  { name: 'NIGHTFALL', tag: 'BLINK FRAME — WOLFRAM', kind: 'nightfall',
    coreHp: 260, score: 32000,
    bulletSpeed: 250, burstGap: 0.06, cycle: 1.30, blinkEvery: 2.6 },

  { name: 'THE SEXTON', tag: 'HULK TENDER — FERRUM', kind: 'sexton',
    coreHp: 320, plateHp: 26, score: 40000, plateScore: 900,
    bulletSpeed: 255, burstGap: 0.06, cycle: 1.20 },

  { name: 'GILTHAMMER', tag: 'ADMIRALTY GUARD — AURUM', kind: 'gilthammer',
    coreHp: 420, plateHp: 30, score: 60000, plateScore: 1100,
    bulletSpeed: 270, burstGap: 0.05, cycle: 1.05 },
];

export const LEVELS = [
  { name: 'ARGENTUM', subtitle: 'SILVER CLASS — PATROL HULL',
    theme: 'steel', seed: 0x5ca1ab1e, length: 12000,
    gapScale: 1.00, clearChance: 0.13,
    turretHp: 3, turretCooldown: 1.75, turretRange: 300,
    interceptorSpeed: 172, interceptorSpawn: 1.50, interceptorHp: 2,
    foes: [], tune: 0 },

  { name: 'OSMIUM', subtitle: 'DENSEST ALLOY AFLOAT — LINE HULL',
    theme: 'abyssal', seed: 0x051f1ed, length: 14500,
    gapScale: 0.86, clearChance: 0.09,
    turretHp: 4, turretCooldown: 1.45, turretRange: 330,
    interceptorSpeed: 196, interceptorSpawn: 1.20, interceptorHp: 3,
    foes: ['mine'], tune: 1 },

  { name: 'TANTALUM', subtitle: 'CORROSION PROOF — FLAGSHIP HULL',
    theme: 'cryolite', seed: 0x7a07a1, length: 17000,
    gapScale: 0.78, clearChance: 0.07,
    turretHp: 5, turretCooldown: 1.20, turretRange: 360,
    interceptorSpeed: 220, interceptorSpawn: 0.98, interceptorHp: 3,
    foes: ['mine', 'lancer'], tune: 2 },

  { name: 'CUPRUM', subtitle: 'OXIDISED — SALVAGE HULK',
    theme: 'verdigris', seed: 0xc0ffee, length: 18500,
    gapScale: 0.72, clearChance: 0.06,
    turretHp: 6, turretCooldown: 1.10, turretRange: 380,
    interceptorSpeed: 236, interceptorSpawn: 0.90, interceptorHp: 4,
    foes: ['mine', 'lancer', 'orbiter'], tune: 1 },

  { name: 'PYRITE', subtitle: 'RUNNING HOT — FOUNDRY HULL',
    theme: 'pyrite', seed: 0xf00dface, length: 20000,
    gapScale: 0.67, clearChance: 0.05,
    turretHp: 7, turretCooldown: 1.00, turretRange: 400,
    interceptorSpeed: 252, interceptorSpawn: 0.82, interceptorHp: 4,
    foes: ['lancer', 'orbiter', 'warder'], tune: 2 },

  { name: 'WOLFRAM', subtitle: 'LIGHT SWALLOWING — SIEGE HULL',
    theme: 'obsidian', seed: 0x0b51d1a, length: 21500,
    gapScale: 0.63, clearChance: 0.04,
    turretHp: 8, turretCooldown: 0.92, turretRange: 420,
    interceptorSpeed: 266, interceptorSpawn: 0.75, interceptorHp: 5,
    foes: ['mine', 'orbiter', 'warder'], tune: 2 },

  { name: 'FERRUM', subtitle: 'EATEN THROUGH — DERELICT HULL',
    theme: 'rust', seed: 0xfe2211, length: 23000,
    gapScale: 0.59, clearChance: 0.035,
    turretHp: 9, turretCooldown: 0.86, turretRange: 440,
    interceptorSpeed: 280, interceptorSpawn: 0.70, interceptorHp: 5,
    foes: ['mine', 'lancer', 'orbiter', 'warder'], tune: 0 },

  { name: 'AURUM', subtitle: 'THE PRIZE — ADMIRALTY HULL',
    theme: 'aurum', seed: 0xa17aa17a, length: 25000,
    gapScale: 0.55, clearChance: 0.03,
    turretHp: 10, turretCooldown: 0.80, turretRange: 460,
    interceptorSpeed: 294, interceptorSpawn: 0.64, interceptorHp: 6,
    foes: ['mine', 'lancer', 'orbiter', 'warder'], tune: 2 },
];

// Clearing a hull upgrades the ship permanently for the rest of the run.
// These stack, so arriving at TANTALUM you are flying a markedly different
// craft from the one that launched at ARGENTUM — which is the point: the
// difficulty curve is met with a power curve, not just better flying.
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
  magnet: 38,            // soft attraction, so near-misses still count
  magnetPull: 210,
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
