// Every tunable in one place. Change a number, reload, re-fly.

export const VIEW_W = 640;
export const VIEW_H = 360;

export const HUD_H = 36;
export const FIELD_H = VIEW_H - HUD_H;   // 324 — playfield height
export const RIM = 16;                   // structural girder along each hull edge
export const FIELD_TOP = RIM;            // 16
export const FIELD_BOT = FIELD_H - RIM;  // 308

export const APRON = 560;                // clear launch/landing zone at each end

// Three hulls, named for metals — Uridium's stage-naming ritual. Each is
// longer, denser and better defended than the last. Everything that scales
// difficulty lives here, so the curve can be read in one place.
export const LEVELS = [
  {
    name: 'ARGENTUM',
    subtitle: 'SILVER CLASS — PATROL HULL',
    seed: 0x5ca1ab1e,
    length: 12000,
    gapScale: 1.0,        // multiplier on the space between obstacle groups
    clearChance: 0.13,    // how often a stretch is left empty
    turretHp: 3,
    turretCooldown: 1.75,
    turretRange: 300,
    interceptorSpeed: 172,
    interceptorSpawn: 1.5,
    interceptorHp: 2,
    tune: 0,
  },
  {
    name: 'OSMIUM',
    subtitle: 'DENSEST ALLOY AFLOAT — LINE HULL',
    seed: 0x051f1ed,
    length: 14500,
    gapScale: 0.82,
    clearChance: 0.08,
    turretHp: 4,
    turretCooldown: 1.45,
    turretRange: 330,
    interceptorSpeed: 196,
    interceptorSpawn: 1.2,
    interceptorHp: 3,
    tune: 1,
  },
  {
    name: 'TANTALUM',
    subtitle: 'CORROSION PROOF — FLAGSHIP HULL',
    seed: 0x7a07a1,
    length: 17000,
    gapScale: 0.68,
    clearChance: 0.05,
    turretHp: 5,
    turretCooldown: 1.2,
    turretRange: 360,
    interceptorSpeed: 220,
    interceptorSpawn: 0.98,
    interceptorHp: 3,
    tune: 2,
  },
];

// Each hull is guarded at its far end. The boss gates the turnaround, so a
// run is approach -> boss -> escape, and reaching the dock is earned twice.
export const BOSS = {
  arenaMargin: 40,      // how far inside the hull end the arena wall sits
  entryTime: 2.2,       // boss slides in over this long; you cannot be hit yet
  deathTime: 2.6,       // explosion chain before the way home opens
  hitFlash: 0.08,
  contactDamage: 34,
};

export const BOSSES = [
  {
    name: 'THE WARDEN',
    tag: 'EMPLACED FORTRESS — ARGENTUM',
    kind: 'warden',
    coreHp: 34,
    podHp: 9,
    score: 6000,
    podScore: 400,
    bulletSpeed: 180,
    burstGap: 0.16,
    cycle: 2.3,          // seconds between attack cycles
  },
  {
    name: 'DRAYLINE',
    tag: 'LINE GUNSHIP — OSMIUM',
    kind: 'drayline',
    coreHp: 78,
    score: 9000,
    bulletSpeed: 205,
    burstGap: 0.1,
    cycle: 1.9,
    sweepSpeed: 128,
  },
  {
    name: 'THE RIVETER',
    tag: 'FLAGSHIP BATTERY — TANTALUM',
    kind: 'riveter',
    coreHp: 120,
    plateHp: 14,
    score: 14000,
    plateScore: 600,
    bulletSpeed: 225,
    burstGap: 0.08,
    cycle: 1.6,
  },
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
  // gunspeed: fire interval multiplier per level. Sized past the reachable
  // maximum (3 base + 2 from clearing hulls) so an index can never fall off.
  speedScale: [1.0, 0.76, 0.58, 0.44, 0.34, 0.27, 0.22],
  // gunblaze: extra barrel angles (radians, mirrored) per level
  blazeAngles: [
    [],
    [0.13],
    [0.13, 0.26],
    [0.13, 0.26, 0.4],
    [0.10, 0.20, 0.31, 0.43],
    [0.09, 0.18, 0.28, 0.38, 0.50],
    [0.08, 0.16, 0.25, 0.34, 0.44, 0.56],
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
// frame-rate independent exponential smoothing
export const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);
