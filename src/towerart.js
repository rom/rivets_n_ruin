// What the things bolted to the hull look like.
//
// Every tower used to be one drawing: a barrel, a trapezoid base and a
// coloured dot whose only job was to say which of six it was. That is
// fine for six guns that behave differently and look the same, and it
// stops being fine the moment the roster includes things that are not
// guns at all. A radar dish, a fuel tank and a parked lander have no
// business sharing a silhouette with a cannon.
//
// So the barrel and the base stay shared — they are the mounting, and
// everything is mounted the same way — and the housing above them is
// per kind. Each body is drawn in local coordinates with the deck at
// y=0 and `d` pointing away from it, so one function works on the
// ceiling and the floor without knowing which it is on.

import { COL } from './config.js';

const BODIES = {};

// --- the guns
//
// Three weights of the same idea. Size is the message: a popgun reads
// as something to drive past and a bastion as something to plan
// around, before either has fired.

function gunHousing(ctx, d, tw, r) {
  ctx.fillStyle = '#596372';
  ctx.beginPath();
  ctx.arc(0, d * 1, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tw.colour || COL.danger;
  ctx.fillRect(-1, d * 1 - 1, 2, 2);
}

BODIES.pop = (ctx, t, d, tw) => gunHousing(ctx, d, tw, 4);
BODIES.gun = (ctx, t, d, tw) => gunHousing(ctx, d, tw, 5.5);

BODIES.bastion = (ctx, t, d, tw) => {
  // A squat armoured drum with shoulders, so the heaviest gun is the
  // one you can pick out of a line at distance.
  ctx.fillStyle = '#434c59';
  ctx.beginPath();
  ctx.arc(0, d * 2, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a313b';
  ctx.fillRect(-12, d === 1 ? 0 : -5, 24, 5);
  ctx.fillStyle = '#5c6775';
  for (const sx of [-10, 7]) ctx.fillRect(sx, d === 1 ? 1 : -4, 3, 3);
  ctx.fillStyle = tw.colour || COL.danger;
  ctx.fillRect(-2, d * 2 - 2, 4, 4);
  ctx.fillStyle = COL.rivet;
  for (let i = -8; i <= 8; i += 8) ctx.fillRect(i, d === 1 ? 5 : -6, 2, 2);
};

// --- the ones that watch
//
// A dish and an array do the same job and must not look alike, so one
// turns and the other nods. The motion is the tell: the angle is set
// in enemies.js and simply used here.

BODIES.radar = (ctx, t, d, tw) => {
  ctx.fillStyle = '#39414e';
  ctx.fillRect(-3, d === 1 ? 0 : -11, 6, 11);           // mast
  ctx.save();
  ctx.translate(0, d * 11);
  ctx.rotate(t.angle || 0);
  // A parabola drawn as an arc, open on one side, so the spin reads
  // even when the dish is edge-on for a frame.
  ctx.strokeStyle = tw.colour;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 9, Math.PI * 0.35, Math.PI * 1.65);
  ctx.stroke();
  ctx.fillStyle = '#20262e';
  ctx.beginPath();
  ctx.arc(0, 0, 9, Math.PI * 0.35, Math.PI * 1.65);
  ctx.fill();
  ctx.fillStyle = tw.colour;
  ctx.fillRect(-1, -2, 7, 2);                            // feed horn
  ctx.restore();
  ctx.fillStyle = COL.rivet;
  ctx.fillRect(-4, d * 2, 8, 1);
};

BODIES.array = (ctx, t, d, tw) => {
  ctx.fillStyle = '#39414e';
  ctx.fillRect(-4, d === 1 ? 0 : -9, 8, 9);
  ctx.save();
  ctx.translate(0, d * 9);
  ctx.rotate(t.angle || 0);
  // A flat panel of elements rather than a dish: same job, different
  // shape, and it sweeps instead of spinning.
  ctx.fillStyle = '#2a313b';
  ctx.fillRect(-13, -4, 26, 8);
  ctx.fillStyle = tw.colour;
  for (let i = -11; i <= 9; i += 5) ctx.fillRect(i, -3, 3, 6);
  ctx.strokeStyle = '#5c6775';
  ctx.lineWidth = 1;
  ctx.strokeRect(-13, -4, 26, 8);
  ctx.restore();
};

BODIES.post = (ctx, t, d, tw) => {
  // A glazed box on a short stalk. Unarmed and obviously so: the thing
  // to notice is that it is looking at you.
  ctx.fillStyle = '#39414e';
  ctx.fillRect(-2, d === 1 ? 0 : -7, 4, 7);
  ctx.fillStyle = '#2a313b';
  ctx.fillRect(-7, d === 1 ? 6 : -13, 14, 7);
  ctx.fillStyle = tw.colour;
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin((t.t || 0) * 2.5);
  ctx.fillRect(-5, d === 1 ? 8 : -11, 10, 3);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#5c6775';
  ctx.fillRect(-7, d === 1 ? 6 : -7, 14, 1);
};

// --- the spaceport

BODIES.control = (ctx, t, d, tw) => {
  // A traffic control tower: tall, glazed at the top, with a light
  // that keeps turning whether or not anybody is listening.
  ctx.fillStyle = '#39414e';
  ctx.fillRect(-4, d === 1 ? 0 : -18, 8, 18);
  ctx.fillStyle = '#2a313b';
  ctx.fillRect(-10, d === 1 ? 14 : -22, 20, 8);
  ctx.fillStyle = tw.colour;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(-8, d === 1 ? 16 : -20, 16, 4);
  ctx.globalAlpha = 1;
  // the rotating beacon
  const a = (t.t || 0) * 2.0;
  ctx.fillStyle = tw.colour;
  ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(a));
  ctx.fillRect(-2, d === 1 ? 22 : -24, 4, 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = COL.rivet;
  ctx.fillRect(-10, d === 1 ? 14 : -15, 20, 1);
};

BODIES.tank = (ctx, t, d, tw) => {
  // A fat cylinder with a hazard band. It should look like the worst
  // thing to be standing next to, because it is.
  const top = d === 1 ? 0 : -16;
  ctx.fillStyle = '#4a5160';
  ctx.fillRect(-11, top, 22, 16);
  ctx.fillStyle = '#5c6775';
  ctx.fillRect(-11, top, 22, 3);
  ctx.fillStyle = '#2a313b';
  ctx.fillRect(-11, top + 13, 22, 3);
  // hazard stripes
  ctx.fillStyle = tw.colour;
  for (let i = -9; i < 9; i += 6) ctx.fillRect(i, top + 5, 3, 6);
  ctx.strokeStyle = '#20262e';
  ctx.lineWidth = 1;
  ctx.strokeRect(-11, top, 22, 16);
  ctx.fillStyle = COL.rivet;
  ctx.fillRect(-9, top + 1, 2, 2);
  ctx.fillRect(7, top + 1, 2, 2);
};

BODIES.lander = (ctx, t, d, tw) => {
  // Something parked: a hull on legs, nose toward the open end. Drawn
  // low and wide so it reads as sitting on the deck rather than
  // hovering over it.
  const up = -d;
  ctx.save();
  ctx.scale(1, d);
  ctx.fillStyle = '#39414e';
  for (const lx of [-9, 6]) { ctx.fillRect(lx, 2, 3, 5); }
  ctx.fillStyle = '#6a7484';
  ctx.beginPath();
  ctx.moveTo(-15, 7);
  ctx.lineTo(-11, 1);
  ctx.lineTo(9, 1);
  ctx.lineTo(15, 5);
  ctx.lineTo(13, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8e9aa9';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = COL.cool;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(4, 2, 6, 2);                   // canopy
  ctx.globalAlpha = 1;
  ctx.fillStyle = tw.colour;
  ctx.fillRect(-13, 3, 4, 2);                 // engine bell
  ctx.restore();
  void up;
};

BODIES.silo = (ctx, t, d, tw) => {
  // A buried launcher: hatch doors on the deck and tubes behind them,
  // open when it is loaded and shut when it is not.
  const top = d === 1 ? 0 : -13;
  ctx.fillStyle = '#434c59';
  ctx.fillRect(-14, top, 28, 13);
  ctx.fillStyle = '#20262e';
  for (let k = 0; k < 3; k++) ctx.fillRect(-11 + k * 8, top + 3, 6, 8);
  ctx.fillStyle = tw.colour;
  for (let k = 0; k < 3; k++) {
    if (t.burstLeft > 0 || t.cd < 0.7) ctx.fillRect(-11 + k * 8, top + 3, 6, 2);
  }
  ctx.fillStyle = '#5c6775';
  ctx.fillRect(-14, top, 28, 2);
  ctx.fillStyle = COL.rivet;
  ctx.fillRect(-12, top + 11, 2, 2);
  ctx.fillRect(10, top + 11, 2, 2);
};

// --- the launcher rack, unchanged in spirit from before
BODIES.rocket = (ctx, t, d, tw) => {
  ctx.fillStyle = '#596372';
  ctx.fillRect(-8, d === 1 ? 0 : -8, 16, 8);
  ctx.fillStyle = '#20262e';
  for (let k = 0; k < 4; k++) ctx.fillRect(-7 + k * 4, d === 1 ? 2 : -6, 3, 4);
  ctx.fillStyle = tw.colour;
  ctx.fillRect(-8, d === 1 ? 0 : -1, 16, 1);
  ctx.fillRect(-7 + (t.burstLeft > 0 ? 0 : 8), d === 1 ? 3 : -5, 3, 2);
};

BODIES.warden = (ctx, t, d, tw) => gunHousing(ctx, d, tw, 7);

// Whether this kind carries a barrel. A dish, a tank and a parked
// lander do not, and drawing one on them was the thing that made every
// installation look like a gun with a hat on.
export const hasBarrel = (kind) => !NO_BARREL.has(kind);
const NO_BARREL = new Set(['radar', 'array', 'post', 'control', 'tank', 'lander', 'silo']);

// Whether the mounting trapezoid is drawn. The port's structures sit
// flat on the deck and supply their own footprint.
export const hasMount = (kind) => !NO_MOUNT.has(kind);
const NO_MOUNT = new Set(['tank', 'lander', 'silo', 'control']);

export function drawTowerBody(ctx, t, d) {
  const tw = t.tower || {};
  const draw = BODIES[t.kind] || BODIES.gun;
  draw(ctx, t, d, tw);
}

export const TOWER_BODIES = BODIES;
