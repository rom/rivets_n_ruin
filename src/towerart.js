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

// --- the installations
//
// Buildings, not weapons. They share the deck and nothing else: no
// barrel, no mounting trapezoid, and a silhouette that says what the
// thing is for from across the hull.

BODIES.barracks = (ctx, t, d, tw) => {
  // A block with a pitched roof and lit windows. People live here, and
  // that is the whole of why it reads differently from a shed.
  const top = d === 1 ? 0 : -22;
  ctx.fillStyle = '#39414e';
  ctx.fillRect(-15, top + 4, 30, 18);
  ctx.fillStyle = '#4b5564';
  ctx.fillRect(-15, top + 4, 30, 3);
  // roof, pitched away from the deck
  ctx.fillStyle = '#2b323c';
  ctx.beginPath();
  ctx.moveTo(-17, top + 4);
  ctx.lineTo(0, top - 2);
  ctx.lineTo(17, top + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tw.colour;
  for (let i = -10; i <= 8; i += 9) {
    ctx.globalAlpha = 0.55 + ((i + 10) % 7) * 0.05;
    ctx.fillRect(i, top + 10, 4, 5);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#20262e';
  ctx.lineWidth = 1;
  ctx.strokeRect(-15, top + 4, 30, 18);
};

BODIES.depot = (ctx, t, d, tw) => {
  // A curved-roof store shed with a door at one end.
  const top = d === 1 ? 0 : -15;
  ctx.fillStyle = '#434c59';
  ctx.beginPath();
  ctx.moveTo(-13, top + 15);
  ctx.lineTo(-13, top + 6);
  ctx.quadraticCurveTo(0, top - 3, 13, top + 6);
  ctx.lineTo(13, top + 15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#525d6c';
  for (let i = -11; i < 12; i += 5) ctx.fillRect(i, top + 7, 1, 8);
  ctx.fillStyle = tw.colour;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(7, top + 9, 5, 6);
  ctx.globalAlpha = 1;
};

BODIES.cistern = (ctx, t, d, tw) => {
  // A bulk tank: taller than a fuel drum, banded, and marked up the
  // way something you should not shoot next to would be.
  const top = d === 1 ? 0 : -24;
  ctx.fillStyle = '#4a5160';
  ctx.fillRect(-13, top + 2, 26, 22);
  ctx.fillStyle = '#5c6775';
  ctx.fillRect(-13, top + 2, 26, 3);
  ctx.fillStyle = '#343c47';
  for (const by of [top + 9, top + 16]) ctx.fillRect(-13, by, 26, 2);
  ctx.fillStyle = tw.colour;
  for (let i = -10; i < 10; i += 7) ctx.fillRect(i, top + 11, 4, 5);
  // the dome on top
  ctx.fillStyle = '#525b6a';
  ctx.beginPath();
  ctx.arc(0, top + 2, 9, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = '#20262e';
  ctx.lineWidth = 1;
  ctx.strokeRect(-13, top + 2, 26, 22);
};

BODIES.pump = (ctx, t, d, tw) => {
  // A pump island: a stubby column with a hose arm off it.
  const top = d === 1 ? 0 : -14;
  ctx.fillStyle = '#434c59';
  ctx.fillRect(-5, top + 2, 10, 12);
  ctx.fillStyle = tw.colour;
  ctx.fillRect(-3, top + 4, 6, 4);
  ctx.strokeStyle = '#596372';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(4, top + 5);
  ctx.lineTo(10, top + 5);
  ctx.lineTo(10, top + 12);
  ctx.stroke();
};

BODIES.reactor = (ctx, t, d, tw) => {
  // A containment drum with a lit core and cooling fins. It is the
  // thing on a power plant worth breaking first, so it is the thing on
  // a power plant you can see first.
  const top = d === 1 ? 0 : -26;
  ctx.fillStyle = '#39414e';
  ctx.fillRect(-16, top + 6, 32, 20);
  for (const fx of [-16, 12]) {
    ctx.fillStyle = '#2b323c';
    ctx.fillRect(fx, top + 2, 4, 24);
  }
  ctx.fillStyle = '#4b5564';
  ctx.fillRect(-16, top + 6, 32, 3);
  // the core, pulsing on its own clock
  const glow = 0.45 + Math.abs(Math.sin((t.t || 0) * 2.2)) * 0.55;
  ctx.globalAlpha = glow;
  ctx.fillStyle = tw.colour;
  ctx.beginPath();
  ctx.arc(0, top + 16, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#d8fff2';
  ctx.beginPath();
  ctx.arc(0, top + 16, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#20262e';
  ctx.lineWidth = 1;
  ctx.strokeRect(-16, top + 6, 32, 20);
};

BODIES.pylon = (ctx, t, d, tw) => {
  // A lattice mast with cross-arms. The line between them is drawn by
  // the hull, not by the pylon — see drawPowerLines.
  const h = 22;
  const top = d === 1 ? 0 : -h;
  ctx.strokeStyle = '#6b7682';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-6, top + h); ctx.lineTo(-2, top);
  ctx.moveTo(6, top + h); ctx.lineTo(2, top);
  for (let i = 1; i < 4; i++) {
    const yy = top + h - (i * h) / 4;
    const w = 6 - i * 1.1;
    ctx.moveTo(-w, yy); ctx.lineTo(w, yy);
  }
  ctx.stroke();
  // cross-arms, where the line hangs
  ctx.strokeStyle = '#8894a2';
  ctx.beginPath();
  ctx.moveTo(-8, top + 3); ctx.lineTo(8, top + 3);
  ctx.stroke();
  ctx.fillStyle = tw.colour;
  for (const ix of [-8, 8]) ctx.fillRect(ix - 1, top + 2, 2, 3);
};

BODIES.watchtower = (ctx, t, d, tw) => {
  // A legged tower with a glazed cab on top: taller than a post, and
  // obviously looking at you.
  const h = 24;
  const top = d === 1 ? 0 : -h;
  ctx.strokeStyle = '#596372';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-7, top + h); ctx.lineTo(-3, top + 8);
  ctx.moveTo(7, top + h); ctx.lineTo(3, top + 8);
  ctx.moveTo(-5, top + 15); ctx.lineTo(5, top + 15);
  ctx.stroke();
  ctx.fillStyle = '#434c59';
  ctx.fillRect(-8, top + 1, 16, 8);
  ctx.fillStyle = tw.colour;
  ctx.globalAlpha = 0.6 + Math.abs(Math.sin((t.t || 0) * 1.6)) * 0.4;
  ctx.fillRect(-6, top + 3, 12, 4);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2b323c';
  ctx.fillRect(-9, top, 18, 2);
};

BODIES.searchlight = (ctx, t, d, tw) => {
  // A lamp in a yoke, pointing wherever it is currently sweeping. The
  // beam itself is drawn with the hull, because it is long and belongs
  // in world space — see drawBeams. The angle here is beamAim, the same
  // number the beam uses: a lamp aimed anywhere else is a lamp that
  // disagrees with its own light.
  const top = d === 1 ? 0 : -13;
  ctx.fillStyle = '#434c59';
  ctx.fillRect(-7, top + 6, 14, 7);
  ctx.strokeStyle = '#6b7682';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-5, top + 6); ctx.lineTo(-5, top + 1);
  ctx.moveTo(5, top + 6); ctx.lineTo(5, top + 1);
  ctx.stroke();
  // the lamp, tilted to where it is looking
  ctx.save();
  ctx.translate(0, top + 2);
  ctx.rotate((t.beamAim || 0) * (d === 1 ? 1 : -1));
  ctx.fillStyle = '#2b323c';
  ctx.fillRect(-5, -4, 10, 8);
  ctx.fillStyle = t.dead ? '#2b323c' : tw.colour;
  ctx.fillRect(3, -3, 3, 6);
  ctx.restore();
};

// Whether this kind carries a barrel. A dish, a tank and a parked
// lander do not, and drawing one on them was the thing that made every
// installation look like a gun with a hat on.
export const hasBarrel = (kind) => !NO_BARREL.has(kind);
const NO_BARREL = new Set(['radar', 'array', 'post', 'control', 'tank', 'lander', 'silo',
  'barracks', 'depot', 'cistern', 'pump', 'reactor', 'pylon', 'watchtower', 'searchlight']);

// Whether the mounting trapezoid is drawn. The port's structures sit
// flat on the deck and supply their own footprint.
export const hasMount = (kind) => !NO_MOUNT.has(kind);
const NO_MOUNT = new Set(['tank', 'lander', 'silo', 'control',
  'barracks', 'depot', 'cistern', 'reactor', 'pylon', 'watchtower']);

export function drawTowerBody(ctx, t, d) {
  const tw = t.tower || {};
  const draw = BODIES[t.kind] || BODIES.gun;
  draw(ctx, t, d, tw);
}

export const TOWER_BODIES = BODIES;
