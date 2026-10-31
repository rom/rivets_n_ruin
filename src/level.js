import {
  FIELD_TOP, FIELD_BOT, FIELD_H, RIM, APRON, THEMES,
} from './config.js';
import { mulberry32, rr, ri, hash2 } from './rng.js';

const BUCKET = 256;

// ---------------------------------------------------------------- generation

// Obstacle patterns, chosen by a seeded roll. Every pattern leaves a
// navigable corridor; the x-gap that follows is always wide enough to
// reposition vertically at cruise speed.
function layout(r, spec) {
  const obstacles = [];
  const turrets = [];
  let advance = 0;

  const roll = r();
  if (roll < spec.clearChance) {
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

// Builds one hull from a level spec (see LEVELS in config.js). Everything
// that varies between hulls — length, obstacle density, turret toughness —
// comes from the spec, so the difficulty curve is data, not branches.
export function buildLevel(spec) {
  const r = mulberry32(spec.seed);
  const theme = THEMES[spec.theme] || THEMES.steel;
  const LEN = spec.length;
  const obstacles = [];
  const turretSpots = [];

  let x = APRON;
  while (x < LEN - APRON - 340) {
    const { obstacles: obs, turrets: tur, advance } = layout(r, spec);
    for (const o of obs) obstacles.push({ ...o, x: o.x + x });
    for (const t of tur) turretSpots.push({ ...t, x: t.x + x });
    x += advance + rr(r, 155, 330) * spec.gapScale;
  }

  // Rim-mounted turrets, sprinkled along the girders.
  let tx = rr(r, 900, 1500);
  while (tx < LEN - APRON) {
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
      hp: spec.turretHp, dead: false,
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

  return {
    obstacles, turrets, buckets,
    length: LEN,
    spec,
    // Hull texture is rendered per chunk, on demand, at the display scale.
    chunks: new Map(),
    chunkGen: -1,
    tick: 0,
  };
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
//
// The hull is rendered in chunks, on demand, at the current display scale,
// and cached with an LRU. One big bitmap was fine at 12,000px and 1x; it is
// not fine at 17,000px rendered at 3x, which would be a 150MB canvas and
// past what browsers will allocate. Chunks also mean a scale change costs a
// cache clear rather than a full re-render of the ship.

export const CHUNK_W = 512;
const MAX_CACHED = 14;
const PLATE_W = 48;
const PLATE_H = 36;

// Returns the canvas for chunk `i`, rendering it if needed.
export function hullChunk(level, i, scale, generation) {
  if (level.chunkGen !== generation) {
    level.chunks.clear();
    level.chunkGen = generation;
  }
  const hit = level.chunks.get(i);
  if (hit) {
    hit.used = ++level.tick;
    return hit.canvas;
  }
  const canvas = renderChunk(level, i, scale);
  level.chunks.set(i, { canvas, used: ++level.tick });

  if (level.chunks.size > MAX_CACHED) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [k, v] of level.chunks) {
      if (v.used < oldest) { oldest = v.used; oldestKey = k; }
    }
    if (oldestKey !== null) level.chunks.delete(oldestKey);
  }
  return canvas;
}

// Warms one uncached chunk near the camera per call, so scrolling into fresh
// hull does not hitch on a cold render mid-frame.
export function warmChunks(level, camX, viewW, scale, generation) {
  const first = Math.floor(camX / CHUNK_W) - 1;
  const last = Math.floor((camX + viewW) / CHUNK_W) + 2;
  for (let i = first; i <= last; i++) {
    if (i < 0 || i * CHUNK_W >= level.length) continue;
    if (level.chunkGen === generation && level.chunks.has(i)) continue;
    hullChunk(level, i, scale, generation);
    return;          // one per frame is enough to stay ahead
  }
}

function renderChunk(level, index, scale) {
  const t = THEMES[level.spec.theme] || THEMES.steel;
  const x0 = index * CHUNK_W;
  const w = Math.min(CHUNK_W, level.length - x0);

  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.round(FIELD_H * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.translate(-x0, 0);        // draw in world coordinates

  g.fillStyle = t.base;
  g.fillRect(x0, 0, w, FIELD_H);

  // Plating. The grid is indexed on absolute position so chunks tile without
  // a visible seam.
  const px0 = Math.floor(x0 / PLATE_W) * PLATE_W;
  for (let py = 0; py < FIELD_H; py += PLATE_H) {
    for (let px = px0; px < x0 + w; px += PLATE_W) {
      const gx = (px / PLATE_W) | 0;
      const gy = (py / PLATE_H) | 0;
      const n = hash2(gx, gy);

      g.fillStyle = t.tones[(n * t.tones.length) | 0];
      g.fillRect(px, py, PLATE_W, PLATE_H);

      g.fillStyle = t.seam;
      g.globalAlpha = 0.55;
      g.fillRect(px + PLATE_W - 1, py, 1, PLATE_H);
      g.fillRect(px, py + PLATE_H - 1, PLATE_W, 1);
      g.globalAlpha = 0.12;
      g.fillStyle = t.hi;
      g.fillRect(px, py, PLATE_W - 1, 1);
      g.globalAlpha = 1;

      // rivets — the namesake
      g.fillStyle = t.rivet;
      g.globalAlpha = 0.42 + n * 0.22;
      for (const [rx, ry] of [[4, 4], [PLATE_W - 6, 4], [4, PLATE_H - 6], [PLATE_W - 6, PLATE_H - 6]]) {
        g.fillRect(px + rx, py + ry, 2, 2);
      }
      g.globalAlpha = 1;

      if (n > 0.93) {
        g.fillStyle = t.seam;
        g.globalAlpha = 0.6;
        g.fillRect(px + 10, py + 9, PLATE_W - 22, PLATE_H - 20);
        g.globalAlpha = 0.25;
        g.fillStyle = t.hi;
        g.fillRect(px + 10, py + 9, PLATE_W - 22, 1);
        g.globalAlpha = 1;
      } else if (n < 0.045) {
        g.fillStyle = t.hazard;
        g.globalAlpha = 0.5;
        for (let sx = 0; sx < PLATE_W - 12; sx += 6) g.fillRect(px + 6 + sx, py + 14, 3, 7);
        g.globalAlpha = 1;
      } else if (n > 0.86 && n < 0.9) {
        g.fillStyle = t.seam;
        g.globalAlpha = 0.45;
        for (let k = 0; k < 4; k++) g.fillRect(px + 8, py + 10 + k * 5, PLATE_W - 18, 2);
        g.globalAlpha = 1;
      }
    }
  }

  // Longitudinal conduits running the length of the ship.
  for (const [cy, th] of [[FIELD_TOP + 46, 3], [FIELD_H / 2 - 1, 4], [FIELD_BOT - 50, 3]]) {
    g.fillStyle = t.seam;
    g.globalAlpha = 0.5;
    g.fillRect(x0, cy, w, th);
    g.globalAlpha = 0.18;
    g.fillStyle = t.hi;
    g.fillRect(x0, cy, w, 1);
    g.globalAlpha = 1;
  }

  // Rim girders: the hard boundary, heavily riveted so it reads as solid.
  for (const top of [true, false]) {
    const y = top ? 0 : FIELD_BOT;
    g.fillStyle = t.rimDark;
    g.fillRect(x0, y, w, RIM);
    g.fillStyle = t.mid;
    g.fillRect(x0, y + 3, w, RIM - 7);
    g.fillStyle = t.edgeHi;
    g.globalAlpha = 0.5;
    g.fillRect(x0, top ? y + RIM - 1 : y, w, 1);
    g.globalAlpha = 1;
    g.fillStyle = t.rivet;
    const rx0 = Math.floor(x0 / 16) * 16 + 6;
    for (let rx = rx0; rx < x0 + w; rx += 16) {
      g.globalAlpha = 0.35 + hash2(rx, top ? 1 : 2) * 0.35;
      g.fillRect(rx, top ? y + 6 : y + 7, 3, 3);
    }
    g.globalAlpha = 1;
  }

  // Surface shading, baked in rather than composited every frame: it never
  // changes, so a full-screen pass per frame was buying nothing.
  const grad = g.createLinearGradient(0, 0, 0, FIELD_H);
  grad.addColorStop(0, 'rgba(0,0,0,0.20)');
  grad.addColorStop(0.055, 'rgba(0,0,0,0.42)');
  grad.addColorStop(0.22, 'rgba(0,0,0,0.10)');
  grad.addColorStop(0.5, 'rgba(96,126,156,0.06)');
  grad.addColorStop(0.78, 'rgba(0,0,0,0.10)');
  grad.addColorStop(0.945, 'rgba(0,0,0,0.42)');
  grad.addColorStop(1, 'rgba(0,0,0,0.20)');
  g.fillStyle = grad;
  g.fillRect(x0, 0, w, FIELD_H);

  // Obstacles overlapping this chunk, including the ones whose shadow spills
  // into it from the left.
  for (const o of level.obstacles) {
    if (o.x + o.w + 10 < x0 || o.x > x0 + w) continue;
    drawBlock(g, o, t);
  }

  return c;
}

function drawBlock(g, o, t) {
  // Obstacles are the thing that kills you, so they get the strongest value
  // separation in the scene: a deep cast shadow, a body clearly lighter than
  // the surrounding plating, a hard dark outline, and a lit top-left bevel.
  g.fillStyle = '#05070a';
  g.globalAlpha = 0.7;
  g.fillRect(o.x + 7, o.y + 7, o.w, o.h);
  g.globalAlpha = 0.4;
  g.fillRect(o.x + 3, o.y + 3, o.w + 6, o.h + 6);
  g.globalAlpha = 1;

  g.fillStyle = t.blockEdge;
  g.fillRect(o.x - 1, o.y - 1, o.w + 2, o.h + 2);

  g.fillStyle = t.block;
  g.fillRect(o.x, o.y, o.w, o.h);

  for (let py = o.y; py < o.y + o.h; py += 18) {
    for (let px = o.x; px < o.x + o.w; px += 22) {
      const n = hash2(px * 3, py * 7);
      g.fillStyle = n > 0.66 ? t.blockHi : n > 0.33 ? t.block : t.blockLo;
      g.fillRect(px, py, Math.min(21, o.x + o.w - px), Math.min(17, o.y + o.h - py));
      g.fillStyle = t.seam;
      g.globalAlpha = 0.5;
      g.fillRect(px, py + Math.min(17, o.y + o.h - py) - 1, Math.min(21, o.x + o.w - px), 1);
      g.fillRect(px + Math.min(21, o.x + o.w - px) - 1, py, 1, Math.min(17, o.y + o.h - py));
      g.globalAlpha = 1;
    }
  }

  g.fillStyle = t.edgeHi;
  g.fillRect(o.x, o.y, o.w, 2);
  g.fillRect(o.x, o.y, 2, o.h);
  g.fillStyle = t.blockEdge;
  g.fillRect(o.x, o.y + o.h - 2, o.w, 2);
  g.fillRect(o.x + o.w - 2, o.y, 2, o.h);

  g.fillStyle = t.rivetHi;
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
  for (let sx = 0; sx < o.w - 4; sx += 8) {
    g.fillStyle = (sx / 8) % 2 ? '#15181e' : t.chevron;
    g.fillRect(o.x + 2 + sx, fy, 4, 3);
  }
}
