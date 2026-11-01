// Miniboss bodies.
//
// These were drawn inline in miniboss.js out of polygons and quadratic
// curves, and read as what they were: a diagram of a ship rather than a
// ship. A slab with a notch is a *shape*; what makes something look like
// a vessel is the same handful of details on every one of them — a dark
// hull with one lit upper surface, panel lines and rivets so there is a
// scale to read it against, engine bells with plumes on their own clock,
// a canopy or a sensor eye so you can tell which way it is looking, and
// one accent colour per kind carried on the trim and the running lights.
//
// That vocabulary already existed for the attackers, so it is imported
// rather than rewritten: a miniboss should read as the same navy at four
// times the size, not as a different art style that happens to be
// nearby. The only thing added here is that these are big enough to show
// interior structure, so they do — hoppers with ore in them, armour in
// layers you can see the edges of, a gun deck with individual mounts.

import { HOT, poly, hull, litTop, rivets, engine, canopy, light } from './foeart.js';

// Panel lines: the single cheapest thing that turns a filled shape into a
// built object. Drawn as a sparse grid clipped to the body.
function panels(ctx, x, y, w, h, colour = '#0d1016', step = 11) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = colour;
  for (let px = x + step; px < x + w; px += step) ctx.fillRect(Math.round(px), y, 1, h);
  for (let py = y + step; py < y + h; py += step) ctx.fillRect(x, Math.round(py), w, 1);
  ctx.restore();
}

// A row of gun mounts along an edge, so a thing that shoots looks like it.
function guns(ctx, x0, x1, y, dir, n, colour) {
  for (let i = 0; i < n; i++) {
    const gx = x0 + ((x1 - x0) * (i + 0.5)) / n;
    ctx.fillStyle = '#2a313c';
    ctx.fillRect(gx - 2, y, 4, dir * 5);
    ctx.fillStyle = colour;
    ctx.fillRect(gx - 1, y + dir * 4, 2, dir * 2);
  }
}

const BODIES = {
  // A bulk ore freighter that fell in with pirates: a long slab with
  // open hoppers down the spine, a bridge aft, bolted-on armour that
  // does not match, and colours flown off the stern.
  hauler(ctx, m, spec, lit, core) {
    const r = spec.r;
    const body = lit ? HOT : '#1b2029';
    const deck = lit ? HOT : '#333c49';

    // keel and hull
    const pts = [[-r * 1.15, -r * 0.42], [-r * 0.8, -r * 0.72], [r * 0.72, -r * 0.72],
      [r * 1.05, -r * 0.34], [r * 1.05, r * 0.34], [r * 0.72, r * 0.72],
      [-r * 0.8, r * 0.72], [-r * 1.15, r * 0.42]];
    hull(ctx, pts, body, spec.colour, 2);
    litTop(ctx, pts, deck);
    panels(ctx, -r * 1.1, -r * 0.7, r * 2.1, r * 1.4);

    // open hoppers, with ore in them that goes out as it is damaged
    const full = m.hp / m.maxHp;
    for (let k = -2; k <= 1; k++) {
      const hx = k * (r * 0.44) + 4;
      ctx.fillStyle = '#0c0f14';
      ctx.fillRect(hx, -r * 0.5, r * 0.34, r);
      ctx.fillStyle = (k + 3) / 4 <= full ? '#c98f27' : '#20242c';
      ctx.fillRect(hx + 2, -r * 0.5 + 3, r * 0.34 - 4, r - 6);
      ctx.fillStyle = '#6b7682';
      ctx.fillRect(hx, -r * 0.5, r * 0.34, 2);
    }
    rivets(ctx, -r, -r * 0.66, r * 0.9, 9, '#7d6a3f');

    // bridge tower, aft, with lit windows
    ctx.fillStyle = body;
    ctx.strokeStyle = spec.colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 1.0, -r * 0.72);
    ctx.lineTo(-r * 0.96, -r * 1.15);
    ctx.lineTo(-r * 0.5, -r * 1.15);
    ctx.lineTo(-r * 0.44, -r * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#9ae8f8';
    for (let k = 0; k < 3; k++) ctx.fillRect(-r * 0.9 + k * 6, -r * 1.05, 4, 3);

    guns(ctx, -r * 0.6, r * 0.6, r * 0.72, 1, 3, core);
    engine(ctx, r * 1.02, -r * 0.2, 9, m.t, spec.colour);
    engine(ctx, r * 1.02, r * 0.2, 9, m.t + 0.5, spec.colour);

    // pirate colours off the stern
    ctx.fillStyle = '#b02a3a';
    for (let k = 0; k <= 4; k++) {
      ctx.fillRect(-r * 1.2 - k * 2, -10 + Math.sin(m.t * 5 + k) * 2, 2, 7);
    }
    light(ctx, r * 0.9, -r * 0.5, m.t, core, 2);
  },

  // Alien. Nothing on it is bolted to anything: a ray with a chitin
  // shell, veins that pulse with its remaining health, and two horn
  // emitters with the cutting arc strung between them.
  cutter(ctx, m, spec, lit, core) {
    const r = spec.r;
    ctx.fillStyle = lit ? HOT : '#101c22';
    ctx.strokeStyle = spec.colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 1.1, 0);
    ctx.quadraticCurveTo(-r * 0.2, -r * 1.2, r * 1.0, -r * 0.5);
    ctx.quadraticCurveTo(r * 0.45, 0, r * 1.0, r * 0.5);
    ctx.quadraticCurveTo(-r * 0.2, r * 1.2, -r * 1.1, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // a lit dorsal ridge rather than a flat fill
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = lit ? HOT : '#1d3b45';
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, -r * 0.05);
    ctx.quadraticCurveTo(-r * 0.2, -r * 0.95, r * 0.8, -r * 0.42);
    ctx.quadraticCurveTo(-r * 0.1, -r * 0.42, -r * 0.9, -r * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // veins: bio-luminescence that dims as it is hurt
    const full = m.hp / m.maxHp;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.5 * full;
    ctx.strokeStyle = core;
    ctx.lineWidth = 1.4;
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, sy * r * 0.1);
      ctx.quadraticCurveTo(0, sy * r * 0.62, r * 0.75, sy * r * 0.2);
      ctx.stroke();
    }
    ctx.restore();

    // horns, and the arc between them
    ctx.strokeStyle = spec.colour;
    ctx.lineWidth = 3;
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.85, sy * r * 0.45);
      ctx.quadraticCurveTo(r * 1.35, sy * r * 0.3, r * 1.3, sy * r * 0.02);
      ctx.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(m.t * 9);
    ctx.strokeStyle = core;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r * 1.3, -r * 0.02);
    ctx.lineTo(r * 1.3, r * 0.02);
    ctx.stroke();
    ctx.restore();

    // the eye: an alien has one, and it says which way it is looking
    ctx.fillStyle = '#04080a';
    ctx.beginPath(); ctx.ellipse(r * 0.42, 0, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = core;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(m.t * 3);
    ctx.beginPath(); ctx.ellipse(r * 0.46, 0, 4, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  },

  // A siege barge. Armour in visible layers with the edges showing, a
  // blunt prow meant for taking fire rather than giving it, and a
  // projector ring amidships that is plainly where the walls come from.
  bulwark(ctx, m, spec, lit, core) {
    const r = spec.r;
    const body = lit ? HOT : '#191520';
    // layered plate, back to front, each a little smaller
    for (let k = 3; k >= 1; k--) {
      const sc = 0.6 + k * 0.14;
      ctx.fillStyle = lit ? HOT : ['#2a2233', '#231d2b', '#1c1724'][k - 1];
      poly(ctx, [[-r * sc, -r * sc * 0.72], [r * sc * 0.82, -r * sc * 0.82],
        [r * sc, 0], [r * sc * 0.82, r * sc * 0.82], [-r * sc, r * sc * 0.72]]);
      ctx.fill();
      ctx.strokeStyle = '#0d0a12';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const pts = [[-r * 1.02, -r * 0.62], [r * 0.7, -r * 0.8], [r * 1.1, 0],
      [r * 0.7, r * 0.8], [-r * 1.02, r * 0.62]];
    ctx.strokeStyle = spec.colour;
    ctx.lineWidth = 2;
    poly(ctx, pts); ctx.stroke();
    panels(ctx, -r, -r * 0.6, r * 1.9, r * 1.2, '#120e18', 13);
    rivets(ctx, -r * 0.9, -r * 0.66, r * 0.7, 8, '#5c4a6e');

    // the projector ring: three arcs that turn
    ctx.save();
    ctx.rotate(m.t * 0.8);
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = core;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.45 + 0.35 * Math.sin(m.t * 4 + k);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.52, (k / 3) * Math.PI * 2, (k / 3) * Math.PI * 2 + 1.3);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a0710';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2); ctx.fill();

    guns(ctx, -r * 0.7, r * 0.5, -r * 0.7, -1, 4, core);
    guns(ctx, -r * 0.7, r * 0.5, r * 0.7, 1, 4, core);
    engine(ctx, r * 1.06, -r * 0.3, 8, m.t, spec.colour);
    engine(ctx, r * 1.06, r * 0.3, 8, m.t + 0.3, spec.colour);
    void body;
  },

  // The fast one, and the one that brings friends: a swept interceptor
  // with launch rails under the wings and four engines it plainly does
  // not need.
  harrier(ctx, m, spec, lit, core) {
    const r = spec.r;
    const body = lit ? HOT : '#241519';
    const pts = [[-r * 0.95, -r * 0.3], [-r * 0.3, -r * 0.5], [r * 1.25, -r * 0.14],
      [r * 1.25, r * 0.14], [-r * 0.3, r * 0.5], [-r * 0.95, r * 0.3]];
    hull(ctx, pts, body, spec.colour, 2);
    litTop(ctx, pts, lit ? HOT : '#51303a');

    // swept wings, well past the body, which is what says "fast"
    for (const sy of [-1, 1]) {
      ctx.fillStyle = lit ? HOT : '#1b1014';
      ctx.strokeStyle = spec.colour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(r * 0.25, sy * r * 0.3);
      ctx.lineTo(-r * 0.55, sy * r * 1.15);
      ctx.lineTo(-r * 0.95, sy * r * 1.05);
      ctx.lineTo(-r * 0.2, sy * r * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // launch rail with escorts still on it
      ctx.fillStyle = '#3a2228';
      ctx.fillRect(-r * 0.7, sy * r * 0.78, r * 0.55, 3);
      ctx.fillStyle = m.escorts > 0 ? core : '#2a1a1e';
      for (let k = 0; k < 2; k++) {
        ctx.fillRect(-r * 0.66 + k * r * 0.26, sy * r * 0.78 - 1, r * 0.16, 2);
      }
    }

    panels(ctx, -r * 0.9, -r * 0.4, r * 2.0, r * 0.8, '#140c0f', 9);
    canopy(ctx, r * 0.55, -r * 0.08, 5, 3.4, '#ffd9a8');
    guns(ctx, r * 0.5, r * 1.1, -r * 0.14, -1, 2, core);

    for (const sy of [-1, 1]) {
      engine(ctx, r * 0.9, sy * r * 0.2, 7, m.t + sy * 0.2, spec.colour, 1.2);
      engine(ctx, r * 0.6, sy * r * 0.55, 5, m.t + sy * 0.4, spec.colour, 0.9);
    }
    light(ctx, -r * 0.8, 0, m.t, core, 6);
  },
};

export const MINI_BODY_KINDS = Object.keys(BODIES);

// `core` is the damage tell: the accent colour while healthy, warming to
// orange and then red as it comes apart. Passed in rather than computed
// here so the caller keeps one definition of what "hurt" looks like.
export function drawMiniBody(ctx, m, spec, lit, core) {
  const draw = BODIES[m.kind];
  if (!draw) return false;
  draw(ctx, m, spec, lit, core);
  return true;
}
