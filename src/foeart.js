// Attacker bodies.
//
// These used to be the shapes their behaviour is written in: a circle with
// spokes, a triangle, a ring with four dots. That reads as a diagram of an
// enemy rather than as an enemy, and at 2x and up there is room for a great
// deal more than a diagram.
//
// Every one is now a vessel. The shared vocabulary, so a hull reads as one
// fleet rather than nine unrelated sprites:
//
//   · a dark hull (#1a2029-ish), never a saturated fill
//   · one lit upper surface, as though the hull above were a light source
//   · panel lines and rivets, because the dreadnought has them
//   · a canopy or a sensor eye, so you can tell which way it is looking
//   · engine bells with a plume that flickers on its own clock
//   · one accent colour per kind, carried on trim and running lights
//
// Drawn nose-right at facing +1; drawFoes applies the flip. Nothing here
// mutates state.

const HOT = '#ffd24a';          // the universal hit flash

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function hull(ctx, pts, body, rim, w = 1.5) {
  poly(ctx, pts);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = w;
  ctx.stroke();
}

// The lit top surface. Takes the same outline, squashed upward, so it
// always sits on the hull it belongs to.
function litTop(ctx, pts, colour) {
  poly(ctx, pts);
  ctx.fillStyle = colour;
  ctx.fill();
}

function rivets(ctx, x0, y, x1, n, colour = '#6b7682') {
  ctx.fillStyle = colour;
  for (let i = 0; i <= n; i++) {
    ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n) - 0.5, y - 0.5, 1, 1);
  }
}

// An engine bell with a plume. `t` keeps each ship's flicker out of step.
function engine(ctx, x, y, h, t, colour, power = 1) {
  ctx.fillStyle = '#20262e';
  ctx.fillRect(x, y - h / 2, 3, h);
  ctx.fillStyle = '#404a57';
  ctx.fillRect(x + 1, y - h / 2 + 1, 1, h - 2);
  const len = (3 + Math.abs(Math.sin(t * 19)) * 4) * power;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(x - len, y - h / 4, len, h / 2);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(x - len * 0.5, y - 1, len * 0.5, 2);
  ctx.restore();
}

// A canopy: dark glass with a highlight, so the ship has a crew and a front.
function canopy(ctx, x, y, w, h, tint = '#9ae8f8') {
  ctx.fillStyle = '#0a0d13';
  ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = tint;
  ctx.beginPath(); ctx.ellipse(x, y, w - 0.9, h - 0.9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.65;
  ctx.fillRect(x - w * 0.4, y - h * 0.55, w * 0.5, 0.9);
  ctx.globalAlpha = 1;
}

// A running light that blinks on its own phase.
function light(ctx, x, y, t, colour, rate = 4) {
  ctx.fillStyle = Math.sin(t * rate) > 0 ? colour : '#2a323c';
  ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
}

// ------------------------------------------------------------------ bodies

const BODIES = {
  // Drifting ordnance. A warhead in a frame, not a spiked ball: fins to
  // keep it pointed, a fuse that counts itself down, hazard stripes on the
  // casing because somebody meant this to be visible.
  mine(ctx, f, spec, lit) {
    ctx.rotate(f.t * 0.4);
    // The cage: four struts out to corner fins, so it reads as ordnance
    // somebody built and left here rather than as a spiked ball.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const kx = Math.cos(a);
      const ky = Math.sin(a);
      ctx.strokeStyle = '#59636f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(kx * 5, ky * 5);
      ctx.lineTo(kx * 11, ky * 11);
      ctx.stroke();
      ctx.save();
      ctx.translate(kx * 12, ky * 12);
      ctx.rotate(a);
      hull(ctx, [[-2, -4], [2, -3], [2, 3], [-2, 4]], '#39414e', '#7a8794', 1);
      ctx.fillStyle = '#e8434f';
      ctx.fillRect(0, -3, 1.2, 6);
      ctx.restore();
    }
    // warhead, with hazard banding round its waist
    ctx.fillStyle = lit ? HOT : '#2b323c';
    ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = lit ? HOT : '#3d4653';
    ctx.beginPath(); ctx.arc(-1, -1.2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.clip();
    for (let k = -8; k < 8; k += 3) {
      ctx.fillStyle = ((k + 9) / 3) % 2 < 1 ? '#c9a227' : '#20262e';
      ctx.fillRect(k, -2, 1.6, 4);
    }
    ctx.restore();
    ctx.strokeStyle = '#7a8794';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.stroke();
    // the fuse, counting itself down
    const hot = Math.sin(f.t * 11) > 0;
    ctx.fillStyle = hot ? '#ff6a6a' : '#5a2228';
    ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    if (hot) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#e8434f';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  },

  // A spinal railgun with a cockpit bolted behind it. Everything about the
  // silhouette points at the thing it is going to charge into.
  lancer(ctx, f, spec, lit) {
    const charging = f.state === 1;
    engine(ctx, -15, -3.5, 4, f.t, '#ff9a3a', charging ? 2.2 : 1);
    engine(ctx, -15, 3.5, 4, f.t + 1.3, '#ff9a3a', charging ? 2.2 : 1);
    // swept wings
    hull(ctx, [[-13, -2], [-3, -9], [4, -7], [-2, -2]], '#2a313b', '#4e5765');
    hull(ctx, [[-13, 2], [-3, 9], [4, 7], [-2, 2]], '#2a313b', '#4e5765');
    // fuselage
    hull(ctx, [[-14, -4], [-6, -5], [6, -3.5], [15, 0], [6, 3.5], [-6, 5], [-14, 4]],
      lit ? HOT : '#232a33', '#5c6775');
    litTop(ctx, [[-13, -3], [-6, -4], [6, -2.6], [13, -0.4], [-10, -1]], '#454f5d');
    rivets(ctx, -10, -2.6, 4, 4);
    // the rail itself, running the length of the spine
    ctx.fillStyle = charging ? '#ffd24a' : '#39414e';
    ctx.fillRect(-4, -1, 19, 2);
    ctx.fillStyle = charging ? '#fff0c0' : '#5c6775';
    ctx.fillRect(12, -1.4, 5, 2.8);
    if (charging) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + 0.4 * Math.sin(f.t * 30);
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.arc(15, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    canopy(ctx, -5, -0.4, 3, 2, charging ? '#ffd0a0' : '#9ae8f8');
    light(ctx, -12, -4, f.t, '#e8434f');
  },

  // A gun platform, not a ring: a sensor drum on a hub with three gun arms
  // swinging round it. It parks and sprays, and it looks like it.
  orbiter(ctx, f, spec, lit) {
    const r = spec.r;
    ctx.save();
    ctx.rotate(f.t * 1.1);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      // arm
      ctx.fillStyle = '#39414e';
      ctx.fillRect(r * 0.4, -2, r * 0.9, 4);
      ctx.fillStyle = '#4e5765';
      ctx.fillRect(r * 0.4, -2, r * 0.9, 1.2);
      // gun pod on the end
      hull(ctx, [[r * 1.3, -3.5], [r * 1.9, -2], [r * 1.9, 2], [r * 1.3, 3.5]],
        lit ? HOT : '#2b323c', '#5c6775', 1);
      ctx.fillStyle = '#4fd0e8';
      ctx.fillRect(r * 1.8, -1, 2, 2);
      ctx.restore();
    }
    ctx.restore();
    // hub
    ctx.fillStyle = lit ? HOT : '#242b35';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5c6775';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#39424f';
    ctx.beginPath(); ctx.arc(-1, -1.5, r * 0.5, 0, Math.PI * 2); ctx.fill();
    // sensor dome, scanning
    canopy(ctx, 0, 0, 3.6, 3.6, '#4fd0e8');
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#b4f4ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, f.t * 3, f.t * 3 + 1.2);
    ctx.stroke();
    ctx.restore();
  },

  // An assault shuttle with a blast shield bolted to its nose. The shield
  // is the point, so it is the biggest thing on it.
  warder(ctx, f, spec, lit) {
    engine(ctx, -16, -4, 5, f.t, '#9ad94e');
    engine(ctx, -16, 4, 5, f.t + 0.9, '#9ad94e');
    // thruster pods
    hull(ctx, [[-16, -8], [-6, -10], [-2, -6], [-14, -4]], '#242b35', '#4a5260', 1);
    hull(ctx, [[-16, 8], [-6, 10], [-2, 6], [-14, 4]], '#242b35', '#4a5260', 1);
    // fuselage
    hull(ctx, [[-15, -5], [-4, -8], [8, -6], [11, 0], [8, 6], [-4, 8], [-15, 5]],
      lit ? HOT : '#232c27', '#5a6a52');
    litTop(ctx, [[-14, -4], [-4, -7], [8, -5], [10, -1.5], [-12, -2]], '#415040');
    rivets(ctx, -10, -4, 5, 5, '#8aa07a');
    canopy(ctx, 2, -0.5, 3.2, 2.4, '#b8f09a');
    // the shield: layered plate, scorched where it has been shot
    ctx.fillStyle = '#6d7889';
    ctx.fillRect(9, -12, 5, 24);
    ctx.fillStyle = '#9fb0bd';
    ctx.fillRect(9, -12, 5, 3);
    ctx.fillStyle = '#d7e8ef';
    ctx.fillRect(9, -12, 2, 24);
    ctx.fillStyle = '#4a5260';
    for (let k = -9; k < 10; k += 6) ctx.fillRect(11, k, 3, 2);
    // the struts holding it on
    ctx.fillStyle = '#39414e';
    ctx.fillRect(6, -7, 4, 2);
    ctx.fillRect(6, 5, 4, 2);
    light(ctx, -13, -6, f.t, '#9ad94e', 3);
  },

  // A needle scout: all engine and canards, nothing you could call armour.
  weaver(ctx, f, spec, lit) {
    ctx.rotate(Math.cos(f.t * spec.freq) * 0.5);
    engine(ctx, -12, 0, 5, f.t, '#e8b4ff', 1.4);
    // canards
    hull(ctx, [[-2, -2], [5, -7], [8, -6], [3, -1.5]], '#2d2535', '#6b4f7a', 1);
    hull(ctx, [[-2, 2], [5, 7], [8, 6], [3, 1.5]], '#2d2535', '#6b4f7a', 1);
    // needle fuselage
    hull(ctx, [[-11, -3], [0, -3.5], [11, 0], [0, 3.5], [-11, 3]],
      lit ? HOT : '#241e2d', '#7a5c8a');
    litTop(ctx, [[-10, -2.2], [0, -2.6], [9, -0.4], [-9, -0.6]], '#453a52');
    ctx.fillStyle = '#b45ce0';
    ctx.fillRect(-7, -1, 10, 2);
    canopy(ctx, 2, -0.3, 2.4, 1.6, '#e8b4ff');
    ctx.fillStyle = '#e8b4ff';
    ctx.fillRect(8, -0.8, 3, 1.6);
  },

  // A two-section pod ship, clamped together along a seam it is designed
  // to come apart on. Two cockpits, because each half flies away.
  splitter(ctx, f, spec, lit) { pod(ctx, f, lit, true); },
  shard(ctx, f, spec, lit) { pod(ctx, f, lit, false); },

  // A hauler with its bay hanging open and the next mine already in it.
  bomber(ctx, f, spec, lit) {
    engine(ctx, -17, -4, 6, f.t, '#ff9a3a', 1.1);
    engine(ctx, -17, 4, 6, f.t + 1.6, '#ff9a3a', 1.1);
    // wing boxes
    hull(ctx, [[-14, -7], [-2, -11], [6, -9], [4, -5]], '#2f2a22', '#5e5240', 1);
    hull(ctx, [[-14, 7], [-2, 11], [6, 9], [4, 5]], '#2f2a22', '#5e5240', 1);
    // fuselage
    hull(ctx, [[-16, -5], [-4, -8], [9, -6], [14, 0], [9, 6], [-4, 8], [-16, 5]],
      lit ? HOT : '#2a2419', '#6e5a3e');
    litTop(ctx, [[-15, -4], [-4, -7], [9, -5], [12, -1.5], [-13, -2]], '#4e452f');
    rivets(ctx, -12, -4, 7, 6, '#b09060');
    // the open bay, with ordnance racked in it
    ctx.fillStyle = '#12100c';
    ctx.fillRect(-11, 4, 17, 6);
    ctx.fillStyle = '#5e5240';
    ctx.fillRect(-11, 4, 17, 1);
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = '#8a3a30';
      ctx.beginPath(); ctx.arc(-8 + k * 6, 7.5, 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = Math.sin(f.t * 6 + k) > 0 ? '#ff6a6a' : '#4a2026';
      ctx.fillRect(-8.6 + k * 6, 6.9, 1.2, 1.2);
    }
    // bay doors, hinged down
    ctx.fillStyle = '#46402f';
    ctx.fillRect(-12, 9, 7, 1.6);
    ctx.fillRect(1, 9, 6, 1.6);
    canopy(ctx, 6, -1.5, 3, 2.2, '#ffd0a0');
    light(ctx, -14, -6, f.t, '#ff9a3a', 2.5);
  },

  // A boarding pod. Grapple legs, a drill at the nose, and a viewport with
  // something in it. When it is on, the whole thing lights up.
  leech(ctx, f, spec, lit) {
    const on = f.state === 1;
    // Mechanical legs: a thigh, a shin and a claw, not a spoke. Splayed
    // while it hunts, drawn in tight once it is on.
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + (on ? 0.25 : f.t * 1.4);
      const kx = Math.cos(a);
      const ky = Math.sin(a);
      const reach = on ? 0.7 : 1 + Math.sin(f.t * 3 + k) * 0.08;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = '#39443c';
      ctx.fillRect(5, -1.4, 5 * reach, 2.8);
      ctx.fillStyle = '#54634f';
      ctx.fillRect(5, -1.4, 5 * reach, 1);
      ctx.save();
      ctx.translate(5 + 5 * reach, 0);
      ctx.rotate(on ? 0.9 : 0.45);
      ctx.fillStyle = '#2f3a33';
      ctx.fillRect(0, -1.1, 5, 2.2);
      ctx.fillStyle = on ? '#d8ff9a' : '#8aa07a';
      ctx.fillRect(4, -1.6, 2, 3.2);
      ctx.restore();
      ctx.restore();
      void kx; void ky;
    }
    // carapace
    ctx.fillStyle = lit ? HOT : '#1e2a23';
    ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = lit ? HOT : on ? '#3f6a42' : '#2c3e33';
    ctx.beginPath(); ctx.arc(-0.8, -1.2, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = on ? '#9ad94e' : '#56705a';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.stroke();
    // plating seams
    ctx.strokeStyle = '#18231c';
    ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5);
      ctx.stroke();
    }
    // the boring head, turning fast once it is through
    ctx.save();
    ctx.rotate(on ? f.t * 11 : f.t * 0.8);
    ctx.fillStyle = '#20262e';
    ctx.beginPath(); ctx.arc(0, 0, 4.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = on ? '#cfe2ee' : '#8d9aa6';
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      poly(ctx, [[Math.cos(a) * 4.2, Math.sin(a) * 4.2],
        [Math.cos(a + 0.9) * 4.2, Math.sin(a + 0.9) * 4.2], [0, 0]]);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = on ? '#ffffff' : '#5a7a5e';
    ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, Math.PI * 2); ctx.fill();
    // a viewport on the shoulder, with something behind it
    canopy(ctx, 4.2, 4.2, 2, 1.6, on ? '#d8ff9a' : '#7f9a76');
    light(ctx, -5, 5, f.t, '#9ad94e', 6);
    if (on) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.14 + 0.1 * Math.sin(f.t * 8);
      ctx.fillStyle = '#9ad94e';
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  },
};

// Splitter and shard share a frame: one is the whole pod, the other is the
// half that flies on after it comes apart.
function pod(ctx, f, lit, whole) {
  const r = whole ? 14 : 8;
  engine(ctx, -r - 3, 0, whole ? 6 : 4, f.t, '#b4f4ff', whole ? 1 : 1.5);
  if (whole) {
    hull(ctx, [[-r, -r * 0.6], [-2, -r], [r * 0.7, -r * 0.6], [r, 0],
      [r * 0.7, r * 0.6], [-2, r], [-r, r * 0.6]],
    lit ? HOT : '#232a33', '#7a8794');
    litTop(ctx, [[-r + 1, -r * 0.5], [-2, -r + 1], [r * 0.6, -r * 0.5],
      [r * 0.8, -1], [-r + 1, -1]], '#414b59');
    // the seam, and the clamps holding it shut
    ctx.strokeStyle = '#e8434f';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-r + 2, 0); ctx.lineTo(r - 1, 0); ctx.stroke();
    ctx.fillStyle = '#9fb0bd';
    for (const cx of [-7, 0, 7]) ctx.fillRect(cx - 1.5, -2.5, 3, 5);
    canopy(ctx, 4, -5, 2.6, 2, '#b4f4ff');
    canopy(ctx, 4, 5, 2.6, 2, '#b4f4ff');
    rivets(ctx, -9, -8, 6, 4);
    rivets(ctx, -9, 8, 6, 4);
  } else {
    // a half: flat where it tore away, ragged along that edge
    hull(ctx, [[-r, -r * 0.7], [-1, -r], [r * 0.8, -r * 0.5], [r, 0], [-r, 0]],
      lit ? HOT : '#232a33', '#7a8794');
    ctx.fillStyle = '#e8434f';
    for (let k = -r; k < r; k += 3) ctx.fillRect(k, -1.2, 2, 1.2);
    canopy(ctx, 2, -4, 2.2, 1.7, '#b4f4ff');
  }
  ctx.fillStyle = HOT;
  ctx.fillRect(-2, -2 - (whole ? 5 : 3), 3, 3);
}

// Which kinds have a body of their own. A kind missing from here still
// draws — as a warder — which is the right answer for something unknown
// and the wrong one for a leech, so it is asserted rather than left to be
// noticed on screen.
export const BODY_KINDS = Object.keys(BODIES);

export function drawFoeBody(ctx, f, spec, lit) {
  const draw = BODIES[f.kind] || BODIES.warder;
  draw(ctx, f, spec, lit);
}

// A fighter: swept wings, a canopy, twin exhausts. The thing you see most
// of in the whole game, and it was six line segments.
export function drawInterceptorBody(ctx, e, t) {
  engine(ctx, -12, -3, 4, t, '#ffb27a', 1.3);
  engine(ctx, -12, 3, 4, t + 1.1, '#ffb27a', 1.3);
  // wings, swept back, with a tip light on each
  hull(ctx, [[-10, -2], [0, -9], [6, -7.5], [1, -2]], '#2c2620', '#6b5a46', 1);
  hull(ctx, [[-10, 2], [0, 9], [6, 7.5], [1, 2]], '#2c2620', '#6b5a46', 1);
  ctx.fillStyle = '#e8434f';
  ctx.fillRect(5, -8.2, 1.6, 1.6);
  ctx.fillStyle = '#5fe08a';
  ctx.fillRect(5, 6.8, 1.6, 1.6);
  // fuselage
  hull(ctx, [[-11, -3.4], [-2, -4.6], [8, -3], [13, 0], [8, 3], [-2, 4.6], [-11, 3.4]],
    '#241f19', '#8a7560');
  litTop(ctx, [[-10, -2.6], [-2, -3.8], [8, -2.2], [11, -0.4], [-9, -0.8]], '#4f453a');
  rivets(ctx, -7, -2.4, 6, 4, '#a08a6a');
  // the gun pack under the nose
  ctx.fillStyle = '#39342c';
  ctx.fillRect(5, 1.6, 7, 2.2);
  ctx.fillStyle = '#ff9a3a';
  ctx.fillRect(11, 2.1, 2, 1.2);
  // spine stripe and canopy
  ctx.fillStyle = '#ff9a3a';
  ctx.fillRect(-7, -1, 10, 1.6);
  canopy(ctx, 3, -0.6, 2.8, 1.9, '#ffd0a0');
  ctx.fillStyle = '#ffd24a';
  ctx.fillRect(10.5, -0.8, 2.6, 1.6);
}
