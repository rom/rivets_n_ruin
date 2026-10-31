// The player's ship, as it actually is at this moment.
//
// It was one sprite for the whole campaign. Eight refits, six mods, three
// kinds of ordnance and two gun lines all happened entirely in the numbers:
// the thing on screen at the end of AURUM was the thing that launched off
// ARGENTUM. The one object you look at for the entire run never changed.
//
// Everything here is read from state, nothing is stored:
//
//   MARK    one per hull cleared — a bigger airframe, more engines, more
//           structure, and gilding on the last two
//   GUNS    a barrel on the nose per gunspeed level, an angled pod pair
//           per gunblaze level
//   ORDNANCE a rack under the belly for each kind you are carrying
//   MODS    a coil ring, armour slabs, a feed drum, a scoop, bigger bells,
//           a salvage claw — one visible fitting each, tiered where the
//           mod is tiered
//
// Drawn nose-right; drawShip applies the flip and the bank.

import { PICKUP, COL } from './config.js';
import { modLevel } from './shop.js';

// Eight airframes. Written as a table rather than eight functions so the
// progression is legible as a progression: every column only goes up.
// The drawn ship has to stay honest about the box it collides with
// (SHIP.hitW 19 x hitH 9). Mark VIII is 33x18 of airframe against Mark I's
// 26x14 — visibly a bigger machine, without the sprite claiming space the
// hitbox does not occupy. Wings and fins reach past that, which is what
// wings do, and they are not what you collide with either.
const CORE_MARKS = [
  { nose: 13, tail: -12, half: 7.0, engines: 1, wing: 0, armour: 0, fins: 0, gild: 0 },
  { nose: 14, tail: -12, half: 7.3, engines: 1, wing: 1, armour: 0, fins: 0, gild: 0 },
  { nose: 14, tail: -13, half: 7.6, engines: 2, wing: 1, armour: 1, fins: 0, gild: 0 },
  { nose: 15, tail: -13, half: 7.9, engines: 2, wing: 2, armour: 1, fins: 1, gild: 0 },
  { nose: 16, tail: -14, half: 8.2, engines: 3, wing: 2, armour: 2, fins: 1, gild: 0 },
  { nose: 16, tail: -14, half: 8.5, engines: 3, wing: 3, armour: 2, fins: 1, gild: 1 },
  { nose: 17, tail: -15, half: 8.7, engines: 4, wing: 3, armour: 3, fins: 2, gild: 1 },
  { nose: 18, tail: -15, half: 9.0, engines: 4, wing: 4, armour: 3, fins: 2, gild: 2 },
];

// Seventeen more airframes for the deep campaign. The first eight are the
// shape of the game being taught; past that the airframe is near the limit
// of what it may be without lying about the hitbox, so the later marks add
// engines, wings and gilding rather than bulk. Every column still only
// goes one way.
const DEEP_MARKS = Array.from({ length: 17 }, (_, i) => {
  const k = i + 1;
  const last = CORE_MARKS[CORE_MARKS.length - 1];
  return {
    nose: Math.min(21, last.nose + Math.ceil(k / 5)),
    tail: Math.max(-18, last.tail - Math.floor(k / 6)),
    half: Math.min(10.4, +(last.half + k * 0.08).toFixed(2)),
    engines: Math.min(6, last.engines + Math.floor(k / 7)),
    wing: Math.min(7, last.wing + Math.floor(k / 5)),
    armour: 3,
    fins: Math.min(3, last.fins + Math.floor(k / 9)),
    gild: Math.min(3, last.gild + Math.floor(k / 8)),
  };
});

export const MARKS = [...CORE_MARKS, ...DEEP_MARKS];

export const markOf = (levelIndex) => MARKS[Math.max(0, Math.min(MARKS.length - 1, levelIndex | 0))];
// Up to twenty-five, because the campaign is.
const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII',
  'XXIII', 'XXIV', 'XXV',
];
export const markName = (levelIndex) =>
  'MARK ' + ROMAN[Math.max(0, Math.min(ROMAN.length - 1, levelIndex | 0))];

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function plate(ctx, pts, fill, rim, w = 1) {
  poly(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = w;
  ctx.stroke();
}

// --------------------------------------------------------------- the ship

export function drawShipBody(ctx, p, game) {
  const m = markOf(game ? game.levelIndex : 0);
  const mods = game ? game : { mods: {} };
  const burner = modLevel(mods, 'afterburner') > 0;

  drawEngines(ctx, p, m, burner);
  drawWings(ctx, m);
  drawHull(ctx, m);
  drawArmour(ctx, m, modLevel(mods, 'plating') > 0);
  drawFins(ctx, m);
  drawGuns(ctx, p, m);
  drawOrdnance(ctx, p, m);
  drawMods(ctx, p, m, mods);
  drawCockpit(ctx, m);
}

function drawEngines(ctx, p, m, burner) {
  const n = m.engines;
  const spread = m.half * 0.78;
  const bell = burner ? 1.45 : 1;
  const thrusting = Math.abs(p.vx) > 20 || Math.abs(p.vy) > 20;
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : -spread + (i * spread * 2) / (n - 1);
    const h = (n <= 2 ? 5.5 : 4.2) * bell;
    ctx.fillStyle = '#20262e';
    ctx.fillRect(m.tail - 3, y - h / 2, 4, h);
    ctx.fillStyle = burner ? '#6a5a2a' : '#3d4653';
    ctx.fillRect(m.tail - 2, y - h / 2 + 1, 2, h - 2);
    // plume
    const len = (burner ? 7 : 4) + Math.abs(Math.sin(p.fireCd * 31 + i * 2)) * 3
      + (thrusting ? 4 : 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = burner ? '#ffd24a' : COL.cool;
    ctx.fillRect(m.tail - 3 - len, y - h / 4, len, h / 2);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = burner ? '#fff0c0' : COL.coolHi;
    ctx.fillRect(m.tail - 3 - len * 0.5, y - 0.9, len * 0.5, 1.8);
    ctx.restore();
  }
}

function drawWings(ctx, m) {
  if (!m.wing) return;
  const span = m.half * 0.95 + m.wing * 1.5;
  const root = m.tail + 4;
  for (const s of [-1, 1]) {
    // Swept back from a root on the hull, not standing off it.
    plate(ctx, [
      [root + 6, s * m.half * 0.45],
      [root + 1, s * span],
      [root + 7 + m.wing * 1.6, s * span],
      [root + 11, s * m.half * 0.5],
    ], '#4b5664', '#0b0e13', 1.1);
    ctx.fillStyle = '#8c99a8';
    ctx.fillRect(root + 1, s * span - (s > 0 ? 1.1 : 0), 6 + m.wing * 1.6, 1.1);
  }
}

function drawHull(ctx, m) {
  const h = m.half;
  const body = [
    [m.nose, 0],
    [m.nose * 0.2, -h * 0.6],
    [m.tail + 5, -h],
    [m.tail, -h * 0.7],
    [m.tail + 1, 0],
    [m.tail, h * 0.7],
    [m.tail + 5, h],
    [m.nose * 0.2, h * 0.6],
  ];
  plate(ctx, body, '#5e6b7a', '#0b0e13', 1.2);
  // the lit upper surface
  poly(ctx, [
    [m.nose - 1, 0],
    [m.nose * 0.2, -h * 0.52],
    [m.tail + 5.5, -h * 0.88],
    [m.tail + 1.5, -h * 0.55],
    [m.tail + 2, -h * 0.1],
  ]);
  ctx.fillStyle = '#aab7c7';
  ctx.fill();
  // panel lines
  ctx.strokeStyle = '#48525f';
  ctx.lineWidth = 0.8;
  for (let k = 1; k <= 2; k++) {
    const x = m.tail + 4 + ((m.nose - m.tail - 6) * k) / 3;
    ctx.beginPath();
    ctx.moveTo(x, -h * 0.72);
    ctx.lineTo(x, h * 0.62);
    ctx.stroke();
  }
  // spine stripe, gilded on the last marks
  ctx.fillStyle = m.gild ? '#d9a62e' : COL.cool;
  ctx.fillRect(m.tail + 3, -1.1, (m.nose - m.tail) * 0.55, 2.2);
  if (m.gild > 1) {
    ctx.fillStyle = '#ffd24a';
    ctx.fillRect(m.tail + 4, -h * 0.9, (m.nose - m.tail) * 0.4, 1);
  }
}

function drawArmour(ctx, m, plating) {
  const n = m.armour + (plating ? 1 : 0);
  if (!n) return;
  for (const s of [-1, 1]) {
    for (let k = 0; k < Math.min(3, n); k++) {
      const x = m.tail + 4 + k * 5;
      plate(ctx, [
        [x, s * m.half * 0.55],
        [x + 4, s * m.half * 0.72],
        [x + 4, s * m.half * 0.96],
        [x, s * m.half * 0.82],
      ], plating ? '#93a2b1' : '#6a7786', '#0b0e13', 0.9);
    }
  }
}

function drawFins(ctx, m) {
  if (!m.fins) return;
  for (const s of [-1, 1]) {
    plate(ctx, [
      [m.tail + 3, s * m.half * 0.65],
      [m.tail + 1, s * (m.half + 1.5 + m.fins)],
      [m.tail + 5, s * (m.half + 1 + m.fins)],
      [m.tail + 7, s * m.half * 0.72],
    ], '#55606e', '#0b0e13', 0.9);
  }
}

// One barrel per gunspeed level on the nose; one angled pod pair per
// gunblaze level above and below it. So the gun you have is the gun you
// can see, and a maxed ship bristles.
function drawGuns(ctx, p, m) {
  const speed = Math.min(PICKUP.gunCapMax, p.gunSpeed || 0);
  const blaze = Math.min(PICKUP.gunCapMax, p.gunBlaze || 0);

  for (let k = 0; k <= speed; k++) {
    const y = speed === 0 ? 0 : -2 + (k * 4) / speed;
    const len = 2.5 + k * 0.4;
    ctx.fillStyle = '#39414e';
    ctx.fillRect(m.nose - 3, y - 1, len + 3, 2);
    ctx.fillStyle = '#9fadbd';
    ctx.fillRect(m.nose + len - 1.2, y - 1, 1.2, 2);
  }

  for (let k = 0; k < blaze; k++) {
    const off = m.half * 0.5 + k * 1.9;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(m.nose * 0.3 - k * 1.2, s * off);
      ctx.rotate(s * (0.08 + k * 0.04));
      plate(ctx, [[-3.5, -1.5], [3.5, -1.1], [5, 0], [3.5, 1.1], [-3.5, 1.5]],
        '#5a6775', '#0b0e13', 0.8);
      ctx.fillStyle = COL.coolHi;
      ctx.fillRect(3.2, -0.6, 1.6, 1.2);
      ctx.restore();
    }
  }
}

// What you are carrying, racked where you would rack it.
function drawOrdnance(ctx, p, m) {
  const a = p.ammo || {};
  let x = m.tail + 6;
  const y = m.half * 0.72;
  if (a.bomb > 0) {
    ctx.fillStyle = '#2a313b';
    ctx.fillRect(x, y, 7, 1.4);
    for (let k = 0; k < Math.min(3, Math.ceil(a.bomb / 3)); k++) {
      ctx.fillStyle = '#8a3a30';
      ctx.beginPath(); ctx.arc(x + 1.6 + k * 2.4, y + 2.6, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    x += 9;
  }
  if (a.grenade > 0) {
    ctx.fillStyle = '#2a313b';
    ctx.fillRect(x, y, 6, 1.4);
    for (let k = 0; k < Math.min(3, Math.ceil(a.grenade / 4)); k++) {
      ctx.fillStyle = '#9ad94e';
      ctx.fillRect(x + 0.8 + k * 2, y + 1.6, 1.4, 2.6);
    }
    x += 8;
  }
  if (a.missile > 0) {
    ctx.fillStyle = '#2a313b';
    ctx.fillRect(x, y, 8, 1.4);
    for (let k = 0; k < Math.min(2, Math.ceil(a.missile / 3)); k++) {
      const my = y + 1.8 + k * 2.4;
      ctx.fillStyle = '#ff5fa8';
      poly(ctx, [[x + 7, my], [x + 1, my - 0.9], [x + 1, my + 0.9]]);
      ctx.fill();
    }
  }
}

// One visible fitting per mod, tiered where the mod is.
function drawMods(ctx, p, m, game) {
  const coil = modLevel(game, 'magnet');
  const scav = modLevel(game, 'scavenger');
  const loader = modLevel(game, 'autoloader');
  const claw = modLevel(game, 'reclaimer');

  // LODESTONE: a coil ring round the nose, one loop per tier, humming
  if (coil) {
    // Coil stacks on the spine, not a hoop round the nose: one ring per
    // tier, each small enough to leave the guns readable.
    const t = (p.fireCd || 0) * 9;
    for (let k = 0; k < coil; k++) {
      const cx = m.tail + 9 + k * 3.4;
      ctx.fillStyle = '#2b323c';
      ctx.fillRect(cx - 1.2, -m.half * 0.5, 2.4, m.half);
      ctx.strokeStyle = k === coil - 1 ? '#b4f4ff' : '#4fd0e8';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(cx, 0, 1.6, m.half * 0.52, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.09 + 0.06 * Math.sin(t);
    ctx.fillStyle = '#4fd0e8';
    ctx.beginPath();
    ctx.arc(m.tail + 10 + coil * 1.6, 0, 4 + coil * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // SCAVENGER RIG: a collector scoop slung under the nose, wider per tier
  if (scav) {
    const w = 5 + scav * 2;
    plate(ctx, [
      [m.nose * 0.3, m.half * 0.5],
      [m.nose * 0.3 + w, m.half * 0.75],
      [m.nose * 0.3 + w, m.half * 1.15],
      [m.nose * 0.3 - 1, m.half * 0.95],
    ], '#6a5a2a', '#d9a62e', 0.9);
    ctx.fillStyle = '#ffd24a';
    ctx.fillRect(m.nose * 0.3 + w - 1.4, m.half * 0.78, 1.4, m.half * 0.34);
  }

  // AUTOLOADER: a feed drum on the spine, turning
  if (loader) {
    const dx = m.tail + 7;
    ctx.fillStyle = '#39414e';
    ctx.beginPath(); ctx.arc(dx, -m.half * 0.72, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8e9aa9';
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(dx, -m.half * 0.72, 2.6, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.translate(dx, -m.half * 0.72);
    ctx.rotate((p.fireCd || 0) * 14);
    ctx.fillStyle = '#ff9a3a';
    for (let k = 0; k < 3; k++) {
      const an = (k / 3) * Math.PI * 2;
      ctx.fillRect(Math.cos(an) * 1.5 - 0.5, Math.sin(an) * 1.5 - 0.5, 1.2, 1.2);
    }
    ctx.restore();
  }

  // RECLAIMER: a salvage claw folded under the belly
  if (claw) {
    const cx = m.tail + 3;
    ctx.strokeStyle = '#8e9aa9';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx, m.half * 0.6);
    ctx.lineTo(cx + 3, m.half * 1.25);
    ctx.lineTo(cx + 7, m.half * 1.05);
    ctx.stroke();
    ctx.fillStyle = '#5fe08a';
    ctx.fillRect(cx + 6, m.half * 0.8, 1.6, 1.6);
  }
}

function drawCockpit(ctx, m) {
  const x = m.nose * 0.42;
  ctx.fillStyle = '#0a0d13';
  ctx.beginPath(); ctx.ellipse(x, -0.4, 3.2, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COL.coolHi;
  ctx.beginPath(); ctx.ellipse(x, -0.4, 2.4, 1.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.7;
  ctx.fillRect(x - 1.4, -1.5, 1.8, 0.8);
  ctx.globalAlpha = 1;
}
