import {
  FIELD_TOP, FIELD_BOT, FIELD_H, LEVEL_LEN, RIM, APRON, COL,
} from './config.js';
import { mulberry32, rr, ri, hash2 } from './rng.js';

const BUCKET = 256;
const PLATE_W = 48;
const PLATE_H = 36;

// ---------------------------------------------------------------- generation

// Obstacle patterns, chosen by a seeded roll. Every pattern leaves a
// navigable corridor; the x-gap that follows is always wide enough to
// reposition vertically at cruise speed.
function layout(r) {
  const obstacles = [];
  const turrets = [];
  let advance = 0;

  const roll = r();
  if (roll < 0.13) {
    // clear run — the breathing room that makes the dense parts read
  } else if (roll < 0.33) {
    const w = rr(r, 64, 132), h = rr(r, 52, 136);
    obstacles.push({ x: 0, y: FIELD_TOP, w, h, face: 1 });
    if (r() < 0.55) turrets.push({ x: w / 2, y: FIELD_TOP + h, dir: 1 });
    advance = w;
  } else if (roll < 0.53) {
    const w = rr(r, 64, 132), h = rr(r, 52, 136);
    obstacles.push({ x: 0, y: FIELD_BOT - h, w, h, face: -1 });
    if (r() < 0.55) turrets.push({ x: w / 2, y: FIELD_BOT - h, dir: -1 });
    advance = w;
  } else if (roll < 0.73) {
    // pincer — a forced corridor, the signature Uridium threat
    const gap = rr(r, 88, 118);
    const gapY = rr(r, FIELD_TOP + 44, FIELD_BOT - 44 - gap);
    const w = rr(r, 72, 124);
    obstacles.push({ x: 0, y: FIELD_TOP, w, h: gapY - FIELD_TOP, face: 1 });
    obstacles.push({ x: 0, y: gapY + gap, w, h: FIELD_BOT - gapY - gap, face: -1 });
    const t = r();
    if (t < 0.35) turrets.push({ x: w / 2, y: gapY, dir: 1 });
    else if (t < 0.7) turrets.push({ x: w / 2, y: gapY + gap, dir: -1 });
    advance = w;
  } else if (roll < 0.88) {
    // free-standing pillar — pass above or below
    const w = rr(r, 52, 92), h = rr(r, 66, 118);
    const y = rr(r, FIELD_TOP + 58, FIELD_BOT - 58 - h);
    obstacles.push({ x: 0, y, w, h, face: 1 });
    if (r() < 0.45) turrets.push({ x: w / 2, y, dir: 1 });
    advance = w;
  } else {
    // stepped stack — climbs, so you have to commit to a line early
    const n = ri(r, 2, 3);
    const fromTop = r() < 0.5;
    let sx = 0;
    for (let i = 0; i < n; i++) {
      const w = rr(r, 44, 72);
      const h = rr(r, 34, 54) + i * 20;
      obstacles.push({ x: sx, y: fromTop ? FIELD_TOP : FIELD_BOT - h, w, h, face: fromTop ? 1 : -1 });
      sx += w;
    }
    advance = sx;
  }
  return { obstacles, turrets, advance };
}

export function buildLevel(seed) {
  const r = mulberry32(seed);
  const obstacles = [];
  const turretSpots = [];

  let x = APRON;
  while (x < LEVEL_LEN - APRON - 340) {
    const { obstacles: obs, turrets: tur, advance } = layout(r);
    for (const o of obs) obstacles.push({ ...o, x: o.x + x });
    for (const t of tur) turretSpots.push({ ...t, x: t.x + x });
    x += advance + rr(r, 155, 330);
  }

  // Rim-mounted turrets, sprinkled along the girders.
  let tx = rr(r, 900, 1500);
  while (tx < LEVEL_LEN - APRON) {
    const onTop = r() < 0.5;
    turretSpots.push({ x: tx, y: onTop ? FIELD_TOP : FIELD_BOT, dir: onTop ? 1 : -1 });
    tx += rr(r, 620, 1250);
  }

  // Drop any turret whose muzzle is buried inside a block.
  const buried = (px, py) =>
    obstacles.some((o) => px > o.x - 3 && px < o.x + o.w + 3 && py > o.y && py < o.y + o.h);
  const turrets = turretSpots
    .filter((t) => !buried(t.x, t.y + t.dir * 6))
    .map((t) => ({
      x: t.x, y: t.y, dir: t.dir,
      angle: t.dir * Math.PI / 2,
      hp: 3, dead: false,
      cd: Math.random() * 0.8,
      burstLeft: 0, burstTimer: 0,
    }));

  obstacles.sort((a, b) => a.x - b.x);

  // Broad-phase buckets for collision queries.
  const buckets = new Map();
  for (const o of obstacles) {
    const b0 = Math.floor(o.x / BUCKET);
    const b1 = Math.floor((o.x + o.w) / BUCKET);
    for (let b = b0; b <= b1; b++) {
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(o);
    }
  }

  return { obstacles, turrets, buckets, bg: renderHull(obstacles), length: LEVEL_LEN };
}

export function obstaclesNear(level, x0, x1) {
  const out = new Set();
  const b0 = Math.floor(x0 / BUCKET);
  const b1 = Math.floor(x1 / BUCKET);
  for (let b = b0; b <= b1; b++) {
    const list = level.buckets.get(b);
    if (list) for (const o of list) out.add(o);
  }
  return out;
}

export function pointBlocked(level, x, y) {
  if (y < FIELD_TOP || y > FIELD_BOT) return true;
  for (const o of obstaclesNear(level, x, x)) {
    if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) return true;
  }
  return false;
}

// -------------------------------------------------------------- hull texture

// The whole hull is drawn once into an offscreen canvas and then blitted
// per frame. 12000x324 is ~15MB and ~25k fill ops, a one-time ~200ms cost;
// chunked lazy tiles are the move if the level grows much past this.
function renderHull(obstacles) {
  const c = document.createElement('canvas');
  c.width = LEVEL_LEN;
  c.height = FIELD_H;
  const g = c.getContext('2d');

  const tones = ['#1d2128', '#21262d', '#252a32', '#282e36', '#1f242b', '#262b33'];

  g.fillStyle = COL.hullBase;
  g.fillRect(0, 0, LEVEL_LEN, FIELD_H);

  // Plating: one quad per plate, seam on two sides, rivets at the corners.
  for (let py = 0; py < FIELD_H; py += PLATE_H) {
    for (let px = 0; px < LEVEL_LEN; px += PLATE_W) {
      const gx = (px / PLATE_W) | 0;
      const gy = (py / PLATE_H) | 0;
      const n = hash2(gx, gy);

      g.fillStyle = tones[(n * tones.length) | 0];
      g.fillRect(px, py, PLATE_W, PLATE_H);

      // seams
      g.fillStyle = COL.edgeLo;
      g.globalAlpha = 0.55;
      g.fillRect(px + PLATE_W - 1, py, 1, PLATE_H);
      g.fillRect(px, py + PLATE_H - 1, PLATE_W, 1);
      g.globalAlpha = 1;

      // a faint top-left catchlight, so plates read as raised
      g.fillStyle = COL.hullHi;
      g.globalAlpha = 0.12;
      g.fillRect(px, py, PLATE_W - 1, 1);
      g.globalAlpha = 1;

      // rivets — the namesake
      g.fillStyle = COL.rivet;
      g.globalAlpha = 0.42 + n * 0.22;
      for (const [rx, ry] of [[4, 4], [PLATE_W - 6, 4], [4, PLATE_H - 6], [PLATE_W - 6, PLATE_H - 6]]) {
        g.fillRect(px + rx, py + ry, 2, 2);
      }
      g.globalAlpha = 1;

      // sparse surface detail: hatches, vents, hazard panels
      if (n > 0.93) {
        g.fillStyle = COL.edgeLo;
        g.globalAlpha = 0.6;
        g.fillRect(px + 10, py + 9, PLATE_W - 22, PLATE_H - 20);
        g.globalAlpha = 1;
        g.fillStyle = COL.hullHi;
        g.globalAlpha = 0.25;
        g.fillRect(px + 10, py + 9, PLATE_W - 22, 1);
        g.globalAlpha = 1;
      } else if (n < 0.045) {
        g.fillStyle = COL.hazard;
        g.globalAlpha = 0.5;
        for (let s = 0; s < PLATE_W - 12; s += 6) g.fillRect(px + 6 + s, py + 14, 3, 7);
        g.globalAlpha = 1;
      } else if (n > 0.86 && n < 0.9) {
        g.fillStyle = COL.edgeLo;
        g.globalAlpha = 0.45;
        for (let s = 0; s < 4; s++) g.fillRect(px + 8, py + 10 + s * 5, PLATE_W - 18, 2);
        g.globalAlpha = 1;
      }
    }
  }

  // Longitudinal conduits running the length of the ship.
  for (const [cy, th] of [[FIELD_TOP + 46, 3], [FIELD_H / 2 - 1, 4], [FIELD_BOT - 50, 3]]) {
    g.fillStyle = COL.edgeLo;
    g.globalAlpha = 0.5;
    g.fillRect(0, cy, LEVEL_LEN, th);
    g.globalAlpha = 0.18;
    g.fillStyle = COL.hullHi;
    g.fillRect(0, cy, LEVEL_LEN, 1);
    g.globalAlpha = 1;
  }

  // Rim girders: the hard boundary, heavily riveted so it reads as solid.
  for (const top of [true, false]) {
    const y = top ? 0 : FIELD_BOT;
    g.fillStyle = '#191d24';
    g.fillRect(0, y, LEVEL_LEN, RIM);
    g.fillStyle = COL.hullMid;
    g.fillRect(0, top ? y + 3 : y + 3, LEVEL_LEN, RIM - 7);
    // inner lip — bright, so the edge of the playfield is unmistakable
    g.fillStyle = COL.edgeHi;
    g.globalAlpha = 0.5;
    g.fillRect(0, top ? y + RIM - 1 : y, LEVEL_LEN, 1);
    g.globalAlpha = 1;
    g.fillStyle = COL.rivet;
    for (let rx = 6; rx < LEVEL_LEN; rx += 16) {
      g.globalAlpha = 0.35 + hash2(rx, top ? 1 : 2) * 0.35;
      g.fillRect(rx, top ? y + 6 : y + 7, 3, 3);
    }
    g.globalAlpha = 1;
  }

  for (const o of obstacles) drawBlock(g, o);
  return c;
}

function drawBlock(g, o) {
  // Obstacles are the thing that kills you, so they get the strongest value
  // separation in the scene: a deep cast shadow, a body clearly lighter than
  // the surrounding plating, a hard dark outline, and a lit top-left bevel.
  g.fillStyle = '#05070a';
  g.globalAlpha = 0.7;
  g.fillRect(o.x + 7, o.y + 7, o.w, o.h);
  g.globalAlpha = 0.4;
  g.fillRect(o.x + 3, o.y + 3, o.w + 6, o.h + 6);
  g.globalAlpha = 1;

  // hard outline — stops the block blending into the plating behind it
  g.fillStyle = '#0d1016';
  g.fillRect(o.x - 1, o.y - 1, o.w + 2, o.h + 2);

  // body, a full step lighter than the hull
  g.fillStyle = '#4e5765';
  g.fillRect(o.x, o.y, o.w, o.h);

  // plating on the raised face
  for (let py = o.y; py < o.y + o.h; py += 18) {
    for (let px = o.x; px < o.x + o.w; px += 22) {
      const n = hash2(px * 3, py * 7);
      g.fillStyle = n > 0.66 ? '#5a6472' : n > 0.33 ? '#4a5260' : '#434b58';
      g.fillRect(px, py, Math.min(21, o.x + o.w - px), Math.min(17, o.y + o.h - py));
      g.fillStyle = '#2b313b';
      g.globalAlpha = 0.5;
      g.fillRect(px, py + Math.min(17, o.y + o.h - py) - 1, Math.min(21, o.x + o.w - px), 1);
      g.fillRect(px + Math.min(21, o.x + o.w - px) - 1, py, 1, Math.min(17, o.y + o.h - py));
      g.globalAlpha = 1;
    }
  }

  // bevel: lit from the top-left
  g.fillStyle = '#9fadbd';
  g.fillRect(o.x, o.y, o.w, 2);
  g.fillRect(o.x, o.y, 2, o.h);
  g.fillStyle = '#20262e';
  g.fillRect(o.x, o.y + o.h - 2, o.w, 2);
  g.fillRect(o.x + o.w - 2, o.y, 2, o.h);

  // rivets around the perimeter
  g.fillStyle = '#b4c0ce';
  g.globalAlpha = 0.8;
  for (let rx = o.x + 5; rx < o.x + o.w - 5; rx += 11) {
    g.fillRect(rx, o.y + 4, 2, 2);
    g.fillRect(rx, o.y + o.h - 6, 2, 2);
  }
  for (let ry = o.y + 5; ry < o.y + o.h - 5; ry += 11) {
    g.fillRect(o.x + 4, ry, 2, 2);
    g.fillRect(o.x + o.w - 6, ry, 2, 2);
  }
  g.globalAlpha = 1;

  // hazard chevrons on the face that points into the playfield
  const fy = o.face === 1 ? o.y + o.h - 5 : o.y + 2;
  for (let s2 = 0; s2 < o.w - 4; s2 += 8) {
    g.fillStyle = (s2 / 8) % 2 ? '#15181e' : '#d9a62e';
    g.fillRect(o.x + 2 + s2, fy, 4, 3);
  }
}
