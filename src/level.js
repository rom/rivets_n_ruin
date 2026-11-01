import {
  FIELD_TOP, FIELD_BOT, FIELD_H, RIM, APRON, THEMES, TOWERS, clamp,
} from './config.js';
import { mulberry32, rr, ri, hash2 } from './rng.js';
import { buildGates } from './gates.js';

const BUCKET = 256;

// Folds a run seed into a hull seed. A plain XOR, and deliberately nothing
// more: mulberry32 avalanches its own seed before its first output, so
// consecutive run seeds already give uncorrelated hulls — measured at 7 of
// 8 distinct opening patterns for seeds 1..8, which is what an extra mixing
// step also gave. Zero returns the hull seed untouched, so FIXED layouts
// are bit-for-bit what they were before this argument existed.
export const mixSeed = (hullSeed, runSeed) => (hullSeed ^ runSeed) >>> 0;

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
  } else if (roll < 0.24) {
    const w = rr(r, 64, 132), h = rr(r, 52, 136);
    obstacles.push({ x: 0, y: FIELD_TOP, w, h, face: 1 });
    if (r() < 0.55) turrets.push({ x: w / 2, y: FIELD_TOP + h, dir: 1 });
    advance = w;
  } else if (roll < 0.40) {
    const w = rr(r, 64, 132), h = rr(r, 52, 136);
    obstacles.push({ x: 0, y: FIELD_BOT - h, w, h, face: -1 });
    if (r() < 0.55) turrets.push({ x: w / 2, y: FIELD_BOT - h, dir: -1 });
    advance = w;
  } else if (roll < 0.55) {
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
  } else if (roll < 0.64) {
    // free-standing pillar — pass above or below
    const w = rr(r, 52, 92), h = rr(r, 66, 118);
    const y = rr(r, FIELD_TOP + 58, FIELD_BOT - 58 - h);
    obstacles.push({ x: 0, y, w, h, face: 1 });
    if (r() < 0.45) turrets.push({ x: w / 2, y, dir: 1 });
    advance = w;
  } else if (roll < 0.72) {
    // Chicane: stubs from alternating surfaces, never overlapping in x,
    // so every slice is at least half open and the line through it is a
    // weave rather than a dodge. The first pattern that asks you to be
    // somewhere specific *next*, rather than not where you are.
    const n = ri(r, 3, 5);
    let sx = 0;
    let fromTop = r() < 0.5;
    for (let i = 0; i < n; i++) {
      const w = rr(r, 54, 86);
      const h = rr(r, 0.44, 0.58) * (FIELD_BOT - FIELD_TOP);
      obstacles.push({
        x: sx, y: fromTop ? FIELD_TOP : FIELD_BOT - h, w, h, face: fromTop ? 1 : -1,
      });
      if (r() < 0.4) {
        turrets.push({
          x: sx + w / 2, y: fromTop ? FIELD_TOP + h : FIELD_BOT - h, dir: fromTop ? 1 : -1,
        });
      }
      sx += w + rr(r, 18, 40);
      fromTop = !fromTop;
    }
    advance = sx;
  } else if (roll < 0.79) {
    // Comb: a row of fingers off one surface with clear water between
    // them. Flyable straight down the open side, or threaded if you want
    // what is parked in the teeth.
    const n = ri(r, 4, 7);
    const fromTop = r() < 0.5;
    const depth = rr(r, 0.42, 0.62) * (FIELD_BOT - FIELD_TOP);
    let sx = 0;
    for (let i = 0; i < n; i++) {
      const w = rr(r, 16, 28);
      obstacles.push({
        x: sx, y: fromTop ? FIELD_TOP : FIELD_BOT - depth, w, h: depth,
        face: fromTop ? 1 : -1,
      });
      sx += w + rr(r, 34, 52);
    }
    if (r() < 0.6) {
      turrets.push({
        x: sx / 2, y: fromTop ? FIELD_TOP + depth : FIELD_BOT - depth, dir: fromTop ? 1 : -1,
      });
    }
    advance = sx;
  } else if (roll < 0.85) {
    // Two walls in series, each with one slot, at different heights. The
    // first is a pincer; the second is a pincer you have to already be
    // moving toward. Nothing else in the set makes you commit twice.
    const span = FIELD_BOT - FIELD_TOP;
    const gap = rr(r, 74, 96);
    const w = rr(r, 40, 64);
    const firstY = rr(r, FIELD_TOP + 30, FIELD_BOT - 30 - gap);
    // The second slot is deliberately elsewhere, but never so far that
    // the move cannot be made in the run between them.
    const shift = (r() < 0.5 ? -1 : 1) * rr(r, span * 0.22, span * 0.34);
    const secondY = clamp(firstY + shift, FIELD_TOP + 24, FIELD_BOT - 24 - gap);
    const between = rr(r, 150, 230);
    for (const [sx, gy] of [[0, firstY], [w + between, secondY]]) {
      if (gy - FIELD_TOP > 8) {
        obstacles.push({ x: sx, y: FIELD_TOP, w, h: gy - FIELD_TOP, face: 1 });
      }
      if (FIELD_BOT - (gy + gap) > 8) {
        obstacles.push({ x: sx, y: gy + gap, w, h: FIELD_BOT - gy - gap, face: -1 });
      }
    }
    if (r() < 0.5) turrets.push({ x: w / 2, y: firstY, dir: 1 });
    advance = w * 2 + between;
  } else if (roll < 0.90) {
    // Islands: free-standing blocks at different heights, spread out. No
    // forced line at all — several work, and picking one is the whole of
    // it. The counterweight to the patterns above, which all insist.
    const n = ri(r, 3, 4);
    let sx = 0;
    for (let i = 0; i < n; i++) {
      const w = rr(r, 34, 58);
      const h = rr(r, 30, 62);
      const y = rr(r, FIELD_TOP + 26, FIELD_BOT - 26 - h);
      obstacles.push({ x: sx, y, w, h, face: 1 });
      if (r() < 0.3) turrets.push({ x: sx + w / 2, y, dir: 1 });
      sx += w + rr(r, 40, 76);
    }
    advance = sx;
  } else if (roll < 0.935) {
    // A spaceport: a place rather than a pattern.
    //
    // Everything else on a hull is something to get past. This is
    // somewhere to decide about — a flat apron with the port's traffic
    // control at one end, fuel standing in the middle and whatever was
    // parked when the shooting started. The tanks chain, so the whole
    // installation can come apart from one shot in the right place,
    // including around you if you take it at close range.
    const fromTop = r() < 0.5;
    const dir = fromTop ? 1 : -1;
    const deck = rr(r, 26, 40);
    const y = fromTop ? FIELD_TOP + deck : FIELD_BOT - deck;
    const w = rr(r, 250, 340);
    obstacles.push({
      x: 0, y: fromTop ? FIELD_TOP : FIELD_BOT - deck, w, h: deck,
      face: dir,
    });
    // Control at one end, so the port has a front door.
    turrets.push({ x: rr(r, 22, 40), y, dir, kind: 'control' });
    // Tanks in a cluster, close enough that one going up reaches the
    // next. Spaced by hand rather than randomly: a chain that only
    // sometimes chains is a mechanic nobody learns.
    const tanks = ri(r, 2, 3);
    const t0 = w * 0.34;
    for (let i = 0; i < tanks; i++) {
      turrets.push({ x: t0 + i * 54, y, dir, kind: 'tank' });
    }
    // ...and something parked at the far end, which is the reason to
    // come in rather than go round.
    turrets.push({ x: w - rr(r, 40, 70), y, dir, kind: 'lander' });
    if (r() < 0.5) turrets.push({ x: w * 0.6, y, dir, kind: 'post' });
    advance = w;
  } else if (roll < 0.96) {
    // A narrows: the corridor itself closes down for a long stretch and
    // opens again. Single obstacles are dodged; this has to be flown.
    const seg = ri(r, 5, 9);
    const segW = rr(r, 46, 68);
    const tightest = rr(r, 74, 104);
    const centre = rr(r, FIELD_TOP + 70, FIELD_BOT - 70);
    let sx = 0;
    for (let i = 0; i < seg; i++) {
      // taper in and back out again over the run
      const k = Math.sin((i / (seg - 1)) * Math.PI);
      const gap = (FIELD_BOT - FIELD_TOP) - k * ((FIELD_BOT - FIELD_TOP) - tightest);
      const top = clamp(centre - gap / 2, FIELD_TOP, FIELD_BOT - gap);
      if (top - FIELD_TOP > 8) {
        obstacles.push({ x: sx, y: FIELD_TOP, w: segW + 1, h: top - FIELD_TOP, face: 1 });
      }
      if (FIELD_BOT - (top + gap) > 8) {
        obstacles.push({ x: sx, y: top + gap, w: segW + 1, h: FIELD_BOT - top - gap, face: -1 });
      }
      sx += segW;
    }
    advance = sx;
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
//
// `runSeed` is folded into the hull's own seed, so one run's ARGENTUM is not
// the next one's. Zero — the default, and what the FIXED setting keeps —
// leaves the layout exactly as the spec's seed alone produced it, which is
// what makes a hull learnable and two scores on it comparable.
export function buildLevel(spec, runSeed = 0) {
  const r = mulberry32(mixSeed(spec.seed, runSeed));
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
    .map((t, i) => {
      const roster = spec.towers && spec.towers.length ? spec.towers : ['gun'];
      // A spot may name its own kind — a spaceport is an arrangement of
      // specific things, not a row of whatever the hull happens to
      // field. Everything else is deterministic from position, so a
      // hull always mounts the same guns in the same places.
      const kind = t.kind && TOWERS[t.kind]
        ? t.kind
        : roster[Math.floor(hash2(Math.round(t.x), 97) * roster.length)];
      const tw = TOWERS[kind] || TOWERS.gun;
      return {
      x: t.x, y: t.y, dir: t.dir, kind, tower: tw,
      angle: t.dir * Math.PI / 2,
      hp: Math.round(spec.turretHp * tw.hpMul), dead: false,
      charge: 0, shielded: false, painted: null,
      // Offset so a row of identical structures does not blink in
      // lockstep, which reads as one object repeated rather than
      // several standing near each other.
      t: hash2(Math.round(t.x), 31) * 6,
      cd: Math.random() * 0.8,
      burstLeft: 0, burstTimer: 0,
      };
    });

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
    // Laser gates, placed from the same rng so a hull always has the same
    // walls in the same places.
    gates: buildGates(r, spec, LEN, obstacles),
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
// Chunk memory grows with the square of the scale, so the cache shrinks as
// the scale rises. At 1x this holds a comfortable window either side of the
// camera; at 2x it holds enough to never stall, and no more.
const cacheLimit = (scale) => Math.max(5, Math.round(16 / (scale * scale)));
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

  if (level.chunks.size > cacheLimit(scale)) {
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

// --- surfaces
//
// Each hull is painted by a different routine. Swapping a palette was not
// enough: the hulls read as the same corridor in another colour, which is
// exactly the complaint. These change what the ground *is*.

const plate = (g, t, px, py, n) => {
  g.fillStyle = t.tones[(n * t.tones.length) | 0];
  g.fillRect(px, py, PLATE_W, PLATE_H);
  g.fillStyle = t.seam;
  g.globalAlpha = 0.55;
  g.fillRect(px + PLATE_W - 1, py, 1, PLATE_H);
  g.fillRect(px, py + PLATE_H - 1, PLATE_W, 1);
  g.globalAlpha = 1;
};

const SURFACE = {
  // riveted hull plating: the baseline
  plates(g, t, x0, w) {
    for (let py = 0; py < FIELD_H; py += PLATE_H) {
      for (let px = Math.floor(x0 / PLATE_W) * PLATE_W; px < x0 + w; px += PLATE_W) {
        const n = hash2((px / PLATE_W) | 0, (py / PLATE_H) | 0);
        plate(g, t, px, py, n);
        g.fillStyle = t.rivet;
        g.globalAlpha = 0.42 + n * 0.22;
        for (const [rx, ry] of [[4, 4], [PLATE_W - 6, 4], [4, PLATE_H - 6], [PLATE_W - 6, PLATE_H - 6]]) {
          g.fillRect(px + rx, py + ry, 2, 2);
        }
        g.globalAlpha = 1;
        if (n > 0.93) {
          g.fillStyle = t.seam; g.globalAlpha = 0.6;
          g.fillRect(px + 10, py + 9, PLATE_W - 22, PLATE_H - 20);
          g.globalAlpha = 1;
        } else if (n < 0.045) {
          g.fillStyle = t.hazard; g.globalAlpha = 0.5;
          for (let sx = 0; sx < PLATE_W - 12; sx += 6) g.fillRect(px + 6 + sx, py + 14, 3, 7);
          g.globalAlpha = 1;
        }
      }
    }
  },

  // deep machinery: fat pipe runs and junction boxes, almost no flat plate
  conduit(g, t, x0, w) {
    g.fillStyle = t.tones[2];
    g.fillRect(x0, 0, w, FIELD_H);
    for (let i = 0; i < 9; i++) {
      const cy = 14 + i * 34;
      const n = hash2(i, 5);
      const th = 9 + (n * 14 | 0);
      g.fillStyle = t.seam; g.globalAlpha = 0.8;
      g.fillRect(x0, cy, w, th);
      g.globalAlpha = 1;
      g.fillStyle = t.mid;
      g.fillRect(x0, cy + 1, w, th - 2);
      g.fillStyle = t.hi; g.globalAlpha = 0.5;
      g.fillRect(x0, cy + 1, w, 2);
      g.globalAlpha = 1;
      // flanges at intervals
      const step = 60 + (n * 50 | 0);
      for (let fx = Math.floor(x0 / step) * step; fx < x0 + w; fx += step) {
        g.fillStyle = t.rivet;
        g.fillRect(fx, cy - 2, 5, th + 4);
        g.fillStyle = t.rivetHi;
        g.fillRect(fx, cy - 2, 5, 1);
      }
    }
  },

  // frozen: cracked sheet ice with frost blooms, no rivets at all
  ice(g, t, x0, w) {
    for (let py = 0; py < FIELD_H; py += 26) {
      for (let px = Math.floor(x0 / 40) * 40; px < x0 + w; px += 40) {
        const n = hash2(px * 7, py * 3);
        g.fillStyle = t.tones[(n * t.tones.length) | 0];
        g.fillRect(px, py, 40, 26);
      }
    }
    // cracks
    g.strokeStyle = t.hi;
    g.lineWidth = 1;
    for (let i = Math.floor(x0 / 90); i < (x0 + w) / 90 + 1; i++) {
      const n = hash2(i, 11);
      g.globalAlpha = 0.25 + n * 0.3;
      g.beginPath();
      let cx = i * 90 + n * 40;
      let cy = 10;
      g.moveTo(cx, cy);
      for (let k = 0; k < 6; k++) {
        cx += (hash2(i, k) - 0.5) * 50;
        cy += 48;
        g.lineTo(cx, cy);
      }
      g.stroke();
      g.globalAlpha = 1;
    }
    // frost blooms
    for (let i = Math.floor(x0 / 70); i < (x0 + w) / 70 + 1; i++) {
      const n = hash2(i, 23);
      if (n < 0.55) continue;
      const bx = i * 70 + n * 30;
      const by = 24 + hash2(i, 29) * (FIELD_H - 60);
      g.fillStyle = t.rivetHi;
      g.globalAlpha = 0.14;
      g.beginPath(); g.arc(bx, by, 10 + n * 14, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
  },

  // desert: dune bands and scattered grit, nothing manufactured
  dunes(g, t, x0, w) {
    for (let band = 0; band < 7; band++) {
      const n = hash2(band, 3);
      const top = band * 46 - 10;
      g.fillStyle = t.tones[(n * t.tones.length) | 0];
      g.beginPath();
      g.moveTo(x0, top + 46);
      for (let px = x0; px <= x0 + w; px += 16) {
        const wave = Math.sin(px * 0.013 + band * 1.7) * 9 + Math.sin(px * 0.004 + band) * 13;
        g.lineTo(px, top + 26 + wave);
      }
      g.lineTo(x0 + w, top + 60);
      g.closePath();
      g.fill();
      // the lit crest of each dune
      g.strokeStyle = t.hi;
      g.globalAlpha = 0.3;
      g.beginPath();
      for (let px = x0; px <= x0 + w; px += 16) {
        const wave = Math.sin(px * 0.013 + band * 1.7) * 9 + Math.sin(px * 0.004 + band) * 13;
        if (px === x0) g.moveTo(px, top + 26 + wave); else g.lineTo(px, top + 26 + wave);
      }
      g.stroke();
      g.globalAlpha = 1;
    }
    g.fillStyle = t.rivetHi;
    for (let i = Math.floor(x0 / 7); i < (x0 + w) / 7; i++) {
      const n = hash2(i, 41);
      if (n < 0.88) continue;
      g.globalAlpha = 0.1 + n * 0.2;
      g.fillRect(i * 7, (hash2(i, 43) * FIELD_H) | 0, 1, 1);
    }
    g.globalAlpha = 1;
  },

  // foundry: dark slag with channels of molten metal running through it
  molten(g, t, x0, w) {
    for (let py = 0; py < FIELD_H; py += 22) {
      for (let px = Math.floor(x0 / 30) * 30; px < x0 + w; px += 30) {
        const n = hash2(px * 5, py * 11);
        g.fillStyle = t.tones[(n * t.tones.length) | 0];
        g.fillRect(px, py, 30, 22);
      }
    }
    for (let i = 0; i < 5; i++) {
      const cy = 26 + i * 60 + hash2(i, 7) * 20;
      g.globalAlpha = 0.85;
      g.fillStyle = '#2a0f06';
      g.beginPath();
      for (let px = x0; px <= x0 + w; px += 12) {
        g.lineTo(px, cy + Math.sin(px * 0.02 + i) * 7);
      }
      for (let px = x0 + w; px >= x0; px -= 12) {
        g.lineTo(px, cy + 9 + Math.sin(px * 0.02 + i) * 7);
      }
      g.closePath(); g.fill();
      // the glow inside the channel
      g.globalAlpha = 1;
      g.fillStyle = '#ff6a18';
      for (let px = x0; px <= x0 + w; px += 4) {
        const yy = cy + 3 + Math.sin(px * 0.02 + i) * 7;
        g.globalAlpha = 0.5 + Math.sin(px * 0.07 + i * 2) * 0.35;
        g.fillRect(px, yy, 4, 3);
      }
      g.globalAlpha = 1;
    }
  },

  // open space: the hull falls away, leaving stars and dust
  void(g, t, x0, w) {
    g.fillStyle = t.base;
    g.fillRect(x0, 0, w, FIELD_H);
    for (let i = Math.floor(x0 / 5); i < (x0 + w) / 5; i++) {
      const n = hash2(i, 61);
      if (n < 0.955) continue;
      const sy = (hash2(i, 67) * FIELD_H) | 0;
      const b = (n - 0.955) / 0.045;
      g.fillStyle = b > 0.7 ? '#dfe6ff' : b > 0.4 ? '#8d97c4' : '#565e80';
      g.fillRect(i * 5, sy, b > 0.7 ? 2 : 1, b > 0.7 ? 2 : 1);
    }
    // faint nebula banding, so it is not a flat black field
    for (let i = 0; i < 3; i++) {
      const cy = 50 + i * 90;
      g.fillStyle = ['#1a1440', '#101a38', '#201230'][i];
      g.globalAlpha = 0.10;
      g.beginPath();
      for (let px = x0; px <= x0 + w; px += 20) g.lineTo(px, cy + Math.sin(px * 0.006 + i * 2) * 26);
      for (let px = x0 + w; px >= x0; px -= 20) g.lineTo(px, cy + 46 + Math.sin(px * 0.006 + i * 2) * 26);
      g.closePath(); g.fill();
      g.globalAlpha = 1;
    }
  },

  // derelict: plating with holes torn through it, stars showing beneath
  broken(g, t, x0, w) {
    SURFACE.plates(g, t, x0, w);
    for (let i = Math.floor(x0 / 110); i < (x0 + w) / 110 + 1; i++) {
      const n = hash2(i, 13);
      if (n < 0.45) continue;
      const hx = i * 110 + n * 60;
      const hy = 30 + hash2(i, 17) * (FIELD_H - 80);
      const r = 14 + n * 26;
      g.fillStyle = '#04050a';
      g.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const rr = r * (0.65 + hash2(i, k) * 0.6);
        g.lineTo(hx + Math.cos(a) * rr, hy + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
      // stars through the hole
      for (let k = 0; k < 5; k++) {
        g.fillStyle = k % 2 ? '#9aa4cc' : '#dfe6ff';
        g.fillRect(hx + (hash2(i, k * 3) - 0.5) * r, hy + (hash2(i, k * 7) - 0.5) * r, 1, 1);
      }
      g.strokeStyle = t.rivetHi; g.globalAlpha = 0.3; g.lineWidth = 1;
      g.beginPath(); g.arc(hx, hy, r * 0.9, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
  },

  // admiralty: polished panels, inlay and fluting
  ornate(g, t, x0, w) {
    for (let py = 0; py < FIELD_H; py += 54) {
      for (let px = Math.floor(x0 / 72) * 72; px < x0 + w; px += 72) {
        const n = hash2(px, py);
        g.fillStyle = t.tones[(n * t.tones.length) | 0];
        g.fillRect(px, py, 72, 54);
        g.strokeStyle = t.rivet; g.globalAlpha = 0.5; g.lineWidth = 1;
        g.strokeRect(px + 6.5, py + 6.5, 59, 41);
        g.globalAlpha = 0.28;
        g.strokeRect(px + 12.5, py + 12.5, 47, 29);
        g.globalAlpha = 1;
        // a medallion in the richer panels
        if (n > 0.7) {
          g.fillStyle = t.rivetHi; g.globalAlpha = 0.35;
          g.beginPath(); g.arc(px + 36, py + 27, 7, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
        }
      }
    }
    // vertical fluting
    g.fillStyle = t.hi; g.globalAlpha = 0.14;
    for (let px = Math.floor(x0 / 18) * 18; px < x0 + w; px += 18) g.fillRect(px, 0, 2, FIELD_H);
    g.globalAlpha = 1;
  },
};

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

  SURFACE[t.surface || 'plates'](g, t, x0, w);

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

// --- obstacle shapes
//
// The silhouette changes with the hull, not just the fill. A crystal field
// and a dune field play differently because the collision boxes are the
// same but the read is not, and a player steers by what they see.

function bevelBody(g, o, t) {
  g.fillStyle = t.block;
  g.fillRect(o.x, o.y, o.w, o.h);
  for (let py = o.y; py < o.y + o.h; py += 18) {
    for (let px = o.x; px < o.x + o.w; px += 22) {
      const n = hash2(px * 3, py * 7);
      g.fillStyle = n > 0.66 ? t.blockHi : n > 0.33 ? t.block : t.blockLo;
      g.fillRect(px, py, Math.min(21, o.x + o.w - px), Math.min(17, o.y + o.h - py));
    }
  }
}

const SHAPE = {
  // riveted steel box
  block(g, o, t) {
    bevelBody(g, o, t);
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
    g.globalAlpha = 1;
  },

  // a capped cylinder: machinery, not architecture
  pipe(g, o, t) {
    const r = Math.min(o.w, o.h) / 2;
    bevelBody(g, o, t);
    g.fillStyle = t.blockEdge;
    g.fillRect(o.x, o.y, o.w, 2);
    g.fillRect(o.x, o.y + o.h - 2, o.w, 2);
    g.fillStyle = t.hi;
    g.globalAlpha = 0.45;
    g.fillRect(o.x, o.y + r * 0.4, o.w, 3);     // specular line along the barrel
    g.globalAlpha = 1;
    g.fillStyle = t.rivet;
    for (let rx = o.x + 7; rx < o.x + o.w - 4; rx += 16) g.fillRect(rx, o.y, 3, o.h);
    g.fillStyle = t.edgeHi;
    g.fillRect(o.x, o.y, 3, o.h);
    g.fillRect(o.x + o.w - 3, o.y, 3, o.h);
  },

  // angular ice, faceted and translucent at the tip
  crystal(g, o, t) {
    const up = o.face === 1 ? 1 : -1;
    const tipY = up === 1 ? o.y + o.h : o.y;
    const baseY = up === 1 ? o.y : o.y + o.h;
    g.fillStyle = t.block;
    g.beginPath();
    g.moveTo(o.x, baseY);
    g.lineTo(o.x + o.w, baseY);
    g.lineTo(o.x + o.w * 0.72, tipY);
    g.lineTo(o.x + o.w * 0.28, tipY);
    g.closePath();
    g.fill();
    g.fillStyle = t.blockHi;
    g.globalAlpha = 0.6;
    g.beginPath();
    g.moveTo(o.x + o.w * 0.1, baseY);
    g.lineTo(o.x + o.w * 0.44, baseY);
    g.lineTo(o.x + o.w * 0.38, tipY);
    g.lineTo(o.x + o.w * 0.3, tipY);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = t.rivetHi;
    g.lineWidth = 1;
    g.globalAlpha = 0.5;
    g.beginPath();
    g.moveTo(o.x + o.w * 0.28, tipY); g.lineTo(o.x, baseY);
    g.moveTo(o.x + o.w * 0.72, tipY); g.lineTo(o.x + o.w, baseY);
    g.stroke();
    g.globalAlpha = 1;
  },

  // a sand mound with a wind-scoured lee side
  dune(g, o, t) {
    const up = o.face === 1 ? 1 : -1;
    const crest = up === 1 ? o.y + o.h : o.y;
    const base = up === 1 ? o.y : o.y + o.h;
    g.fillStyle = t.block;
    g.beginPath();
    g.moveTo(o.x, base);
    g.quadraticCurveTo(o.x + o.w * 0.3, crest, o.x + o.w * 0.62, crest);
    g.lineTo(o.x + o.w, base);
    g.closePath();
    g.fill();
    g.fillStyle = t.blockHi;
    g.globalAlpha = 0.5;
    g.beginPath();
    g.moveTo(o.x + o.w * 0.1, base);
    g.quadraticCurveTo(o.x + o.w * 0.34, crest, o.x + o.w * 0.6, crest);
    g.lineTo(o.x + o.w * 0.5, base);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = t.rivetHi;
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(o.x, base);
    g.quadraticCurveTo(o.x + o.w * 0.3, crest, o.x + o.w * 0.62, crest);
    g.stroke();
    g.globalAlpha = 1;
  },

  // cooled slag, cracked, still glowing underneath
  slag(g, o, t) {
    bevelBody(g, o, t);
    g.fillStyle = '#ff6a18';
    for (let i = 0; i < 5; i++) {
      const n = hash2(o.x + i * 13, o.y);
      g.globalAlpha = 0.25 + n * 0.5;
      g.fillRect(o.x + 3 + n * (o.w - 8), o.y + 3 + hash2(o.x, i) * (o.h - 8), 2 + n * 3, 2);
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#1a0a05';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(o.x, o.y + o.h * 0.4);
    g.lineTo(o.x + o.w * 0.45, o.y + o.h * 0.6);
    g.lineTo(o.x + o.w, o.y + o.h * 0.35);
    g.stroke();
    g.fillStyle = t.edgeHi;
    g.globalAlpha = 0.4;
    g.fillRect(o.x, o.y, o.w, 2);
    g.globalAlpha = 1;
  },

  // irregular rock, lit from one side
  asteroid(g, o, t) {
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;
    g.fillStyle = t.block;
    g.beginPath();
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2;
      const rr = 0.52 + hash2(o.x + k, o.y) * 0.5;
      g.lineTo(cx + Math.cos(a) * o.w * rr, cy + Math.sin(a) * o.h * rr);
    }
    g.closePath();
    g.fill();
    g.fillStyle = t.blockHi;
    g.globalAlpha = 0.45;
    g.beginPath();
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2 - 0.4;
      const rr = 0.3 + hash2(o.x + k, o.y + 3) * 0.3;
      g.lineTo(cx + Math.cos(a) * o.w * rr - o.w * 0.12, cy + Math.sin(a) * o.h * rr - o.h * 0.12);
    }
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = t.blockEdge;
    for (let k = 0; k < 4; k++) {
      const n = hash2(o.x, k * 5);
      g.beginPath();
      g.arc(o.x + 6 + n * (o.w - 12), o.y + 6 + hash2(o.y, k) * (o.h - 12), 2 + n * 3, 0, Math.PI * 2);
      g.fill();
    }
    // A hard rim. Against a star field a soft-edged rock reads as haze, and
    // the player needs to know instantly where the thing that kills them
    // begins — the same reason every other hull has a lit bevel.
    g.strokeStyle = t.edgeHi;
    g.lineWidth = 2;
    g.beginPath();
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2;
      const rr = 0.52 + hash2(o.x + k, o.y) * 0.5;
      g.lineTo(cx + Math.cos(a) * o.w * rr, cy + Math.sin(a) * o.h * rr);
    }
    g.closePath();
    g.stroke();
  },

  // torn plating with exposed ribs
  wreck(g, o, t) {
    bevelBody(g, o, t);
    g.fillStyle = t.blockEdge;
    // a bitten edge on the playfield-facing side
    const fy = o.face === 1 ? o.y + o.h : o.y;
    const dir = o.face === 1 ? -1 : 1;
    g.beginPath();
    g.moveTo(o.x, fy);
    for (let px = o.x; px <= o.x + o.w; px += 9) {
      g.lineTo(px, fy + dir * hash2(px, o.y) * 11);
    }
    g.lineTo(o.x + o.w, fy - dir * 2);
    g.lineTo(o.x, fy - dir * 2);
    g.closePath();
    g.fill();
    g.strokeStyle = t.rivet;
    g.lineWidth = 2;
    g.globalAlpha = 0.6;
    for (let rx = o.x + 8; rx < o.x + o.w - 4; rx += 15) {
      g.beginPath(); g.moveTo(rx, o.y + 2); g.lineTo(rx, o.y + o.h - 2); g.stroke();
    }
    g.globalAlpha = 1;
  },

  // a fluted column with a capital
  pillar(g, o, t) {
    bevelBody(g, o, t);
    g.fillStyle = t.hi;
    g.globalAlpha = 0.3;
    for (let px = o.x + 4; px < o.x + o.w - 2; px += 7) g.fillRect(px, o.y, 2, o.h);
    g.globalAlpha = 1;
    // capital and base
    const capH = Math.min(10, o.h * 0.18);
    g.fillStyle = t.blockHi;
    g.fillRect(o.x - 3, o.y, o.w + 6, capH);
    g.fillRect(o.x - 3, o.y + o.h - capH, o.w + 6, capH);
    g.fillStyle = t.rivetHi;
    g.globalAlpha = 0.7;
    g.fillRect(o.x - 3, o.y, o.w + 6, 2);
    g.fillRect(o.x - 3, o.y + o.h - 2, o.w + 6, 2);
    g.globalAlpha = 1;
  },
};

// Shapes that fill their whole bounding box. The others are silhouettes, so
// a rectangular shadow and outline would frame them in black — which is
// exactly what a dune looked like before this existed.
const FILLS_BOX = new Set(['block', 'pipe', 'slag', 'wreck', 'pillar']);

function drawBlock(g, o, t) {
  const shape = SHAPE[t.shape] ? t.shape : 'block';
  const draw = SHAPE[shape];

  if (FILLS_BOX.has(shape)) {
    // cast shadow, offset down-right: cheap depth, big readability win
    g.fillStyle = '#05070a';
    g.globalAlpha = 0.7;
    g.fillRect(o.x + 7, o.y + 7, o.w, o.h);
    g.globalAlpha = 0.4;
    g.fillRect(o.x + 3, o.y + 3, o.w + 6, o.h + 6);
    g.globalAlpha = 1;
    g.fillStyle = t.blockEdge;
    g.fillRect(o.x - 1, o.y - 1, o.w + 2, o.h + 2);
    draw(g, o, t);
  } else {
    // silhouette shadow: draw the shape itself, offset and darkened
    g.save();
    g.translate(6, 6);
    g.globalAlpha = 0.55;
    const flat = { ...t, block: '#05070a', blockHi: '#05070a', blockLo: '#05070a',
      edgeHi: '#05070a', rivetHi: '#05070a', blockEdge: '#05070a', hi: '#05070a' };
    draw(g, o, flat);
    g.restore();
    g.globalAlpha = 1;
    draw(g, o, t);
  }

  // Hazard chevrons on the face that points into the playfield. Only on
  // shapes that fill their box: on a silhouette they float in empty space
  // away from the edge they are supposed to mark. Those shapes draw their
  // own lit crest instead.
  if (!FILLS_BOX.has(shape)) return;
  const fy = o.face === 1 ? o.y + o.h - 5 : o.y + 2;
  for (let sx = 0; sx < o.w - 4; sx += 8) {
    g.fillStyle = (sx / 8) % 2 ? '#15181e' : t.chevron;
    g.fillRect(o.x + 2 + sx, fy, 4, 3);
  }
}

// ------------------------------------------------------------------ radar
//
// A column-per-pixel picture of where the hull is solid, for the minimap.
// Computed once per hull and cached on the level: walking a few thousand
// obstacles every frame to draw a 640px strip would be absurd.
//
// Each column holds two nibbles: how far the structure reaches down from
// the top girder, and how far it reaches up from the bottom one, both as
// 0..15 of the playfield height. That is enough to show a pincer as a
// pinch and a clear run as a gap, which is what a radar is for.
export function radarProfile(level, cols) {
  if (level._radar && level._radar.cols === cols) return level._radar;
  const top = new Uint8Array(cols);
  const bot = new Uint8Array(cols);
  const H = FIELD_BOT - FIELD_TOP;
  for (const o of level.obstacles) {
    const c0 = Math.max(0, Math.floor((o.x / level.length) * cols));
    const c1 = Math.min(cols - 1, Math.ceil(((o.x + o.w) / level.length) * cols));
    const fromTop = Math.round(((o.y + o.h - FIELD_TOP) / H) * 15);
    const fromBot = Math.round(((FIELD_BOT - o.y) / H) * 15);
    const hangsFromTop = o.y <= FIELD_TOP + 2;
    const sitsOnBot = o.y + o.h >= FIELD_BOT - 2;
    for (let c = c0; c <= c1; c++) {
      if (hangsFromTop && fromTop > top[c]) top[c] = Math.min(15, fromTop);
      if (sitsOnBot && fromBot > bot[c]) bot[c] = Math.min(15, fromBot);
      // a block floating clear of both girders still has to show up
      if (!hangsFromTop && !sitsOnBot) {
        const mid = Math.round(((o.y + o.h / 2 - FIELD_TOP) / H) * 15);
        if (mid < 8 && fromTop > top[c]) top[c] = Math.min(15, fromTop);
        else if (mid >= 8 && fromBot > bot[c]) bot[c] = Math.min(15, fromBot);
      }
    }
  }
  level._radar = { cols, top, bot };
  return level._radar;
}
