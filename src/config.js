// Every tunable in one place. Change a number, reload, re-fly.

export const VIEW_W = 640;
export const VIEW_H = 360;

export const HUD_H = 36;
export const FIELD_H = VIEW_H - HUD_H;   // 324 — playfield height
export const RIM = 16;                   // structural girder along each hull edge
export const FIELD_TOP = RIM;            // 16
export const FIELD_BOT = FIELD_H - RIM;  // 308

export const LEVEL_LEN = 12000;          // length of the dreadnought's dorsal hull, px
export const LEVEL_SEED = 0x5ca1ab1e;
export const APRON = 560;                // clear launch/landing zone at each end

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
