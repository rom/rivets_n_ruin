// Boss and miniboss bodies.
//
// Eight bosses shared three drawings: five of them were the same grey disc
// with plates round it. A boss is the thing a whole hull is built toward,
// so each one now has a silhouette you could pick out of a line-up, and
// each belongs to a faction you can read at a glance:
//
//   emplacement · pirate · assault · alien · monster
//
// Everything is drawn facing LEFT, because a boss faces the ship and the
// ship comes from the left. Nothing here mutates state: it is given a boss
// and a context and draws.

import { shellUp } from './boss.js';

const HOT = '#ffd24a';

// --- small shared parts, so eight bodies do not repeat the same ten lines

function poly(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}

function plated(ctx, pts, body, rim, w = 2) {
  poly(ctx, pts);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = w;
  ctx.stroke();
}

function rivets(ctx, x0, y0, x1, y1, n, colour = '#7b8795') {
  ctx.fillStyle = colour;
  for (let i = 0; i <= n; i++) {
    const k = n ? i / n : 0;
    ctx.fillRect(Math.round(x0 + (x1 - x0) * k) - 1, Math.round(y0 + (y1 - y0) * k) - 1, 2, 2);
  }
}

// The thing you are actually trying to destroy. Dim while plated, lit and
// pulsing once the shell is off, so "can I hurt it yet" is never a guess.
function core(ctx, b, r, shutColour, openColour) {
  const open = !shellUp(b);
  ctx.fillStyle = b.flash > 0 ? HOT : open ? openColour.dark : shutColour;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = open ? openColour.rim : '#4b5462';
  ctx.lineWidth = 3;
  ctx.stroke();
  if (open) {
    ctx.fillStyle = openColour.hot;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45 + Math.sin(b.t * 7) * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A banner, because a pirate flies one and a cloth edge is the cheapest
// thing on screen that says "not navy".
function banner(ctx, x, y, w, h, t, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i <= 6; i++) {
    ctx.lineTo(x + (w * i) / 6, y + Math.sin(t * 4 + i * 0.8) * 3);
  }
  for (let i = 6; i >= 0; i--) {
    ctx.lineTo(x + (w * i) / 6, y + h + Math.sin(t * 4 + i * 0.8) * 3);
  }
  ctx.closePath();
  ctx.fill();
}

// ------------------------------------------------------------------ bodies

const BODIES = {
  // 1 · THE WARDEN — an emplaced boarding rig. Armoured spine, clamp arms
  // reaching for anything that comes close.
  warden(ctx, b, lit) {
    ctx.fillStyle = '#20252e';
    ctx.fillRect(-12, -98, 26, 196);
    ctx.fillStyle = lit ? HOT : '#39404c';
    ctx.fillRect(-9, -94, 20, 188);
    rivets(ctx, -5, -88, -5, 88, 12);
    rivets(ctx, 7, -88, 7, 88, 12);
    // clamp arms, opening and closing
    const grip = 10 + Math.sin(b.t * 1.6) * 7;
    for (const sy of [-1, 1]) {
      ctx.save();
      ctx.scale(1, sy);
      plated(ctx, [[-10, 26], [-40, 20 + grip], [-52, 34 + grip], [-44, 40 + grip], [-10, 44]],
        '#2c333d', '#5a6472');
      ctx.fillStyle = '#8e9aa9';
      ctx.fillRect(-52, 30 + grip, 7, 4);
      ctx.restore();
    }
    core(ctx, b, 26, '#2a3038', { dark: '#5b2730', rim: '#e8434f', hot: '#ff7a2f' });
  },

  // 2 · DRAYLINE — a pirate gunship. Ram prow, broadside ports, colours
  // flown openly.
  drayline(ctx, b, lit) {
    plated(ctx, [[-52, 0], [-18, -44], [36, -28], [40, 0], [36, 28], [-18, 44]],
      '#1b2029', '#5a6472', 3);
    plated(ctx, [[-44, 0], [-16, -36], [28, -23], [31, 0], [28, 23], [-16, 36]],
      lit ? HOT : '#3c4553', '#6d7889');
    // ram prow
    plated(ctx, [[-52, 0], [-34, -11], [-30, 0], [-34, 11]], '#9aa6b5', '#cdd7e3', 1);
    // broadside gun ports, muzzle-lit on the beat
    const hot = Math.sin(b.t * 5) > 0.6;
    for (let ry = -26; ry <= 26; ry += 13) {
      ctx.fillStyle = '#10141b';
      ctx.fillRect(16, ry - 2, 12, 5);
      ctx.fillStyle = hot ? '#ffd24a' : '#6d4a2a';
      ctx.fillRect(25, ry - 1, 3, 3);
    }
    banner(ctx, 30, -46, 26, 13, b.t, '#b02a3a');
    ctx.fillStyle = '#20252e';
    ctx.fillRect(30, -48, 2, 24);
    // bridge glass
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(-34, -8, 14, 16);
    ctx.fillStyle = '#4fd0e8';
    ctx.fillRect(-32, -6, 10, 12);
    core(ctx, b, 15, '#2a3038', { dark: '#5b2730', rim: '#e8434f', hot: '#ff7a2f' });
  },

  // 3 · THE RIVETER — the assault ship. Blunt, bolted, and built to go
  // through things rather than round them.
  riveter(ctx, b, lit) {
    plated(ctx, [[-54, -20], [-34, -42], [30, -46], [48, -20], [48, 20], [30, 46], [-34, 42], [-54, 20]],
      '#242a34', '#6d7889', 3);
    ctx.fillStyle = lit ? HOT : '#39414e';
    ctx.fillRect(-40, -34, 76, 68);
    rivets(ctx, -36, -30, 32, -30, 9);
    rivets(ctx, -36, 30, 32, 30, 9);
    // the hammer face
    plated(ctx, [[-54, -20], [-64, -12], [-64, 12], [-54, 20]], '#8e9aa9', '#cdd7e3', 1);
    ctx.fillStyle = '#20262e';
    for (let ry = -24; ry <= 24; ry += 16) ctx.fillRect(-58, ry - 3, 4, 6);
    core(ctx, b, 30, '#333a45', { dark: '#5b2730', rim: '#ff7a2f', hot: '#ffd24a' });
  },

  // 4 · COLDFORGE — alien minelayer. Segmented, legged, and laying its
  // eggs along the hull behind it.
  coldforge(ctx, b, lit) {
    // legs, treading the air
    ctx.strokeStyle = '#49757f';
    ctx.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      const sy = i < 3 ? -1 : 1;
      const k = i % 3;
      const sw = Math.sin(b.t * 2.2 + i) * 9;
      ctx.beginPath();
      ctx.moveTo(-18 + k * 20, sy * 16);
      ctx.lineTo(-26 + k * 22 + sw, sy * 44);
      ctx.lineTo(-14 + k * 22 + sw * 1.6, sy * 64);
      ctx.stroke();
    }
    // segmented abdomen
    for (let i = 0; i < 4; i++) {
      const sx = 34 - i * 22;
      const r = 14 + i * 3;
      ctx.fillStyle = lit ? HOT : i % 2 ? '#2d5560' : '#376975';
      ctx.beginPath(); ctx.ellipse(sx, 0, r * 0.8, r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#4fd0e8';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // head, with eyes
    plated(ctx, [[-52, 0], [-30, -24], [-6, -18], [-6, 18], [-30, 24]],
      lit ? HOT : '#3b7482', '#9ae8f8', 2);
    ctx.fillStyle = Math.sin(b.t * 3) > 0 ? '#b4f4ff' : '#2d7f93';
    for (let i = 0; i < 4; i++) ctx.fillRect(-42 + (i % 2) * 10, -9 + ((i / 2) | 0) * 12, 4, 4);
    core(ctx, b, 18, '#2d5560', { dark: '#0f6274', rim: '#4fd0e8', hot: '#b4f4ff' });
  },

  // 5 · SLAGHEART — a space monster. No panels: a ribbed carapace over
  // something that is plainly alive and running hot.
  slagheart(ctx, b, lit) {
    const pulse = 0.5 + 0.5 * Math.sin(b.t * 3);
    // outer carapace, breathing
    ctx.fillStyle = lit ? HOT : '#3a1c1c';
    ctx.beginPath();
    ctx.ellipse(0, 0, 50 + pulse * 3, 62 + pulse * 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7a2f22';
    ctx.lineWidth = 3;
    ctx.stroke();
    // ribs
    ctx.strokeStyle = '#a6442c';
    ctx.lineWidth = 2;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-14, i * 15);
      ctx.quadraticCurveTo(28, i * 17, 44, i * 9);
      ctx.stroke();
    }
    // the maw
    ctx.fillStyle = '#140808';
    ctx.beginPath();
    ctx.ellipse(-34, 0, 14, 22 + pulse * 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffb27a';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-40, i * 9 - 4); ctx.lineTo(-48, i * 9); ctx.lineTo(-40, i * 9 + 4);
      ctx.closePath(); ctx.fill();
    }
    // veins of heat running back from the core
    ctx.strokeStyle = 'rgba(255,122,47,' + (0.3 + pulse * 0.4).toFixed(2) + ')';
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + b.t * 0.3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 44, Math.sin(a) * 54);
      ctx.stroke();
    }
    core(ctx, b, 24, '#52201c', { dark: '#7a2410', rim: '#ff7a2f', hot: '#ffe9a8' });
  },

  // 6 · NIGHTFALL — alien, and barely here. A dark frame around a hole,
  // with a phase ghost of itself trailing the last blink.
  nightfall(ctx, b, lit) {
    const ghost = Math.max(0, 1 - (b.blinkT || 0) * 2);
    if (ghost > 0) {
      ctx.globalAlpha *= ghost * 0.4;
      ctx.fillStyle = '#6a4fd0';
      ctx.beginPath(); ctx.arc(-26, 0, 42, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha /= ghost * 0.4;
    }
    // frame: six struts around nothing
    ctx.strokeStyle = lit ? HOT : '#5b4a8a';
    ctx.lineWidth = 5;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2 + b.t * 0.4;
      const a1 = ((i + 1) / 6) * Math.PI * 2 + b.t * 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * 46, Math.sin(a0) * 52);
      ctx.lineTo(Math.cos(a1) * 46, Math.sin(a1) * 52);
      ctx.stroke();
    }
    ctx.fillStyle = '#120a22';
    ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2); ctx.fill();
    // whatever is inside, turning
    ctx.strokeStyle = '#b48cff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, 30 - i * 8, 12 + i * 6, b.t * (0.8 + i * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    }
    core(ctx, b, 16, '#1d1430', { dark: '#3a1b56', rim: '#b48cff', hot: '#f0d8ff' });
  },

  // 7 · THE SEXTON — a scavenger barge, dragging what it has taken. The
  // plates around it are salvage, bolted on where it needed armour.
  sexton(ctx, b, lit) {
    // towed wreckage, swinging behind on cables
    ctx.strokeStyle = '#3a424e';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const sw = Math.sin(b.t * 1.2 + i * 2) * 10;
      ctx.beginPath();
      ctx.moveTo(40, -18 + i * 18);
      ctx.lineTo(74 + sw, -30 + i * 30);
      ctx.stroke();
      ctx.fillStyle = '#2b323c';
      ctx.fillRect(70 + sw, -36 + i * 30, 14, 12);
      ctx.fillStyle = '#4b5462';
      ctx.fillRect(72 + sw, -34 + i * 30, 10, 3);
    }
    plated(ctx, [[-48, -14], [-30, -46], [34, -38], [44, 0], [34, 38], [-30, 46], [-48, 14]],
      '#242a34', '#6d7889', 3);
    ctx.fillStyle = lit ? HOT : '#3a4350';
    ctx.fillRect(-36, -30, 66, 60);
    // mismatched salvage panels, obviously cut from other ships
    const panels = [['#4e5765', -30, -24, 22, 16], ['#5a4a34', -4, -26, 26, 14],
      ['#3f5a4a', -32, 4, 18, 22], ['#5a3a3a', -8, 6, 30, 20]];
    for (const [c, px, py, pw, ph] of panels) {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = '#1a1f27';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    }
    // the grapple it takes things with
    plated(ctx, [[-48, -6], [-70, -16], [-78, -4], [-62, 0], [-78, 4], [-70, 16], [-48, 6]],
      '#8e9aa9', '#cdd7e3', 1);
    banner(ctx, 26, -54, 22, 11, b.t, '#5a7a3a');
    core(ctx, b, 20, '#2a3038', { dark: '#4a4420', rim: '#9ad94e', hot: '#d8ff9a' });
  },

  // 8 · GILTHAMMER — the admiralty's own, and the biggest thing on the
  // hull. A gilded assault dreadnought with a hammer for a bow.
  gilthammer(ctx, b, lit) {
    // engine bank
    ctx.fillStyle = '#ffb27a';
    ctx.globalAlpha *= 0.4 + 0.3 * Math.sin(b.t * 9);
    ctx.fillRect(48, -30, 22, 60);
    ctx.globalAlpha /= 0.4 + 0.3 * Math.sin(b.t * 9);
    ctx.fillStyle = '#20252e';
    for (let ry = -28; ry < 28; ry += 14) ctx.fillRect(44, ry, 12, 10);

    plated(ctx, [[-62, -22], [-40, -56], [30, -52], [52, -26], [52, 26], [30, 52], [-40, 56], [-62, 22]],
      '#26231a', '#d9a62e', 3);
    ctx.fillStyle = lit ? HOT : '#3e4450';
    ctx.fillRect(-46, -44, 90, 88);
    // gilding
    ctx.fillStyle = '#d9a62e';
    ctx.fillRect(-46, -44, 90, 3);
    ctx.fillRect(-46, 41, 90, 3);
    rivets(ctx, -42, -36, 40, -36, 11, '#ffd24a');
    rivets(ctx, -42, 36, 40, 36, 11, '#ffd24a');
    // the hammer head
    plated(ctx, [[-62, -22], [-86, -30], [-92, 0], [-86, 30], [-62, 22]],
      '#8e9aa9', '#ffd24a', 2);
    ctx.fillStyle = '#20262e';
    for (let ry = -20; ry <= 20; ry += 13) ctx.fillRect(-82, ry - 3, 6, 6);
    // the flag of an admiralty that no longer exists
    banner(ctx, 34, -70, 30, 15, b.t, '#d9a62e');
    ctx.fillStyle = '#20252e';
    ctx.fillRect(34, -72, 2, 30);
    core(ctx, b, 30, '#2f3540', { dark: '#6a4a10', rim: '#ffd24a', hot: '#fff0c0' });
  },
};

// ------------------------------------------------------------------- parts
//
// The destructible sections. A pod on an alien is an egg sac; a plate on a
// warship is armour. Drawing all of them as the same grey square threw away
// the only chance to say which faction you are shooting at.

const PART_STYLE = {
  warden: 'pod', drayline: 'plate', riveter: 'plate', coldforge: 'sac',
  slagheart: 'heart', nightfall: 'plate', sexton: 'salvage', gilthammer: 'gilt',
};

function drawPart(ctx, b, part) {
  const style = PART_STYLE[b.kind] || 'plate';
  // A mount, drawn from the body out to the section, so armour reads as
  // bolted on rather than orbiting.
  if (part.a !== undefined) {
    ctx.save();
    ctx.strokeStyle = style === 'gilt' ? '#6a5520' : '#39414e';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(part.dx * 0.25, part.dy * 0.25);
    ctx.lineTo(part.dx, part.dy);
    ctx.stroke();
    ctx.restore();
  }
  const r = part.r;
  const hurt = 1 - part.hp / part.maxHp;
  const eye = hurt > 0.6 ? '#e8434f' : hurt > 0.3 ? '#ff7a2f' : HOT;
  const lit = part.flash > 0;

  ctx.save();
  ctx.translate(part.dx, part.dy);

  if (style === 'sac' || style === 'heart') {
    // alive: a sac that swells, with something moving inside it
    const swell = 1 + Math.sin(b.t * 3 + part.dy) * 0.07;
    const cold = style === 'sac';
    ctx.fillStyle = lit ? HOT : cold ? '#13343d' : '#4a1a14';
    ctx.beginPath(); ctx.ellipse(0, 0, r * swell, r * 1.15 * swell, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = cold ? '#4fd0e8' : '#a6442c';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = eye;
    ctx.globalAlpha *= 0.55 + 0.45 * Math.sin(b.t * 6 + part.dy);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha /= 0.55 + 0.45 * Math.sin(b.t * 6 + part.dy);
    ctx.restore();
    return;
  }

  if (style === 'pod') {
    // a gun pod: a barrel aimed off the spine
    ctx.fillStyle = '#161b22';
    ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
    ctx.fillStyle = lit ? HOT : '#4e5765';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.fillStyle = '#2b323c';
    ctx.fillRect(-r - 9, -4, 10, 8);
    ctx.fillStyle = '#9fadbd';
    ctx.fillRect(-r - 9, -3, 3, 6);
    ctx.fillStyle = eye;
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }

  if (style === 'salvage') {
    ctx.fillStyle = '#12161d';
    ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
    ctx.fillStyle = lit ? HOT : '#4a4238';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.fillStyle = '#5f6a52';
    ctx.fillRect(-r + 2, -r + 2, r, r - 2);
    ctx.strokeStyle = '#9ad94e';
    ctx.lineWidth = 1;
    ctx.strokeRect(-r + 0.5, -r + 0.5, r * 2 - 1, r * 2 - 1);
    ctx.fillStyle = eye;
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
    return;
  }

  // plate / gilt: bolted armour. Not rotated — a square turned 45 degrees
  // reads as a floating diamond rather than as a slab bolted to a hull.
  const gold = style === 'gilt';
  ctx.fillStyle = '#12161d';
  ctx.fillRect(-r - 2, -r - 2, r * 2 + 4, r * 2 + 4);
  ctx.fillStyle = lit ? HOT : gold ? '#4a4230' : '#4e5765';
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.fillStyle = gold ? '#d9a62e' : '#9fadbd';
  ctx.fillRect(-r, -r, r * 2, 3);
  rivets(ctx, -r + 3, -r + 4, r - 3, -r + 4, 3, gold ? '#ffd24a' : '#7b8795');
  ctx.fillStyle = eye;
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();
}

// ------------------------------------------------------------------- tiers
//
// Twenty-five bosses, eight ships. Through the first sixteen hulls every
// silhouette comes round exactly twice, and drawn identically the second
// one reads as the first turning up again under a new name — reported
// from play as "all bosses occur twice".
//
// A tier does not redraw the ship. It refits it: ribs that break the
// outline, bands of plating bolted across the hull, and a livery colour
// on both. Same class, visibly a different vessel, and the eight bodies
// below did not have to be written four times. The colour is drawn, not
// composited — see the note on the table below.

// No tinting pass. The obvious implementation washes the livery over the
// hull with source-atop, which clips to pixels already drawn — and the
// world canvas is opaque, so that tints a 300x300 block of dreadnought
// instead of the boss. The colour is carried by hardware drawn on top of
// the body instead, which costs nothing and cannot bleed.
const TIERS = [
  null,
  { rim: '#6f8fd0', lamp: '#b4d2ff', spines: 3, bands: 1, name: 'line' },
  { rim: '#c4663c', lamp: '#ffb089', spines: 5, bands: 2, name: 'siege' },
  { rim: '#9a6fd0', lamp: '#d9b4ff', spines: 7, bands: 3, name: 'flag' },
];

export const tierOf = (b) => TIERS[Math.min(b.tier || 0, TIERS.length - 1)];

// Dorsal and ventral hardware: ribs along the spine that break the
// silhouette, so a tier reads before the colour does — which matters for
// anyone who cannot rely on the colour.
function tierSpines(ctx, b, tier) {
  const n = tier.spines;
  // Rooted well inside the hull and run outward past it. Started at the
  // outer edge instead, they read as marks floating near the ship rather
  // than hardware bolted to it — which is what the first version looked
  // like, and the bodies are different enough sizes that there is no one
  // edge to start from.
  const root = 18;
  const reach = 52 + n * 4;
  const wasCap = ctx.lineCap;
  ctx.strokeStyle = tier.rim;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    const x = -34 + k * 68;
    const lean = Math.sin(b.t * 0.8 + i) * 2;
    ctx.moveTo(x, -root);
    ctx.lineTo(x + lean, -reach);
    ctx.moveTo(x, root);
    ctx.lineTo(x + lean, reach);
  }
  ctx.stroke();
  ctx.lineCap = wasCap;

  // Caps, so the ribs end in something rather than fraying out.
  ctx.fillStyle = tier.lamp;
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    const x = Math.round(-34 + k * 68);
    ctx.fillRect(x - 3, -reach - 4, 6, 5);
    ctx.fillRect(x - 3, reach - 1, 6, 5);
  }
}

// Refit plating across the hull, in the tier's colour: bands bolted over
// whatever the body underneath happens to be, with a marker lamp on each.
function tierBands(ctx, b, tier) {
  for (let i = 0; i < tier.bands; i++) {
    const x = -26 + i * 22;
    ctx.fillStyle = tier.rim;
    ctx.fillRect(x - 3, -40, 6, 80);
    ctx.fillStyle = '#1b2029';
    ctx.fillRect(x - 1, -38, 2, 76);
    rivets(ctx, x, -36, x, 36, 5, tier.lamp);
  }
  // One lamp, pulsing, so the tier is legible even on a dark hull.
  //
  // Multiplied into whatever alpha the caller had, and put back to that
  // rather than to 1. drawBoss dims the whole boss while it is coming
  // apart, and assigning 1 here threw that away: the plating stopped
  // fading and drawBossParts, which runs next, drew the surviving
  // sections at full strength over a flickering hull.
  const was = ctx.globalAlpha;
  const pulse = 0.55 + 0.45 * Math.sin(b.t * 3 + tier.spines);
  ctx.globalAlpha = was * pulse;
  ctx.fillStyle = tier.lamp;
  ctx.fillRect(-4, -52, 8, 5);
  ctx.globalAlpha = was;
}

export function drawBossBody(ctx, b) {
  const draw = BODIES[b.kind] || BODIES.riveter;
  const tier = tierOf(b);

  if (!tier) { draw(ctx, b, b.flash > 0); return; }

  // Spines behind the hull, plating in front of it, so the refit reads as
  // bolted onto a ship rather than floating near one.
  tierSpines(ctx, b, tier);
  draw(ctx, b, b.flash > 0);
  // Not on a hit frame: the white flash is damage feedback and the
  // plating drawn over it would punch holes in the one frame that has to
  // read instantly.
  if (b.flash <= 0) tierBands(ctx, b, tier);
}

export function drawBossParts(ctx, b) {
  for (const part of b.parts) {
    if (part.dead) continue;
    drawPart(ctx, b, part);
  }
}
