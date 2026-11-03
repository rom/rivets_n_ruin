// Splash, launch, landing and ending.
//
// These are the seams of a run: the moment before it starts, the moment it
// commits, the moment it is over. Each is a small state with its own clock
// that locks out control, so none of them can be flown through or skipped
// by accident — but every one can be skipped deliberately, because the
// fiftieth launch should not cost what the first one did.

import { VERSION, BUILD, VIEW_W, FIELD_H, FIELD_TOP, FIELD_BOT, APRON, COL,
  THEMES } from './config.js';

export const SPLASH_TIME = 3.4;
export const LAUNCH_TIME = 2.0;
// The hull does not get flown back any more: breaking the boss opens the far
// end and the ship runs out through it. This is how long that takes.
export const EXIT_TIME = 2.4;
export const ENDING_TIME = 15.0;

// --- the ship's own path through each sequence, as a function of progress.
// Kept here rather than in the renderer so the state and the picture cannot
// disagree about where the ship is.

export function launchPose(k) {
  // k: 0..1. Clamped out of the dock, accelerating, levelling off.
  const e = k * k * (3 - 2 * k);              // smoothstep
  return {
    x: -40 + e * (APRON * 0.55 + 220),
    y: (FIELD_TOP + FIELD_BOT) / 2 + (1 - e) * 28,
    thrust: Math.min(1, k * 2.2),
    tilt: (1 - e) * -0.22,
  };
}

// Out through the far end, under power. The opposite shape to the landing
// it replaces: this one accelerates the whole way and leaves the screen.
export function exitPose(k, fromX, fromY) {
  const e = k * k;                            // ease in: still accelerating
  const mid = (FIELD_TOP + FIELD_BOT) / 2;
  return {
    x: fromX + e * 1100,
    y: fromY + (mid - fromY) * Math.min(1, k * 2),   // levels out as it goes
    thrust: Math.min(1, 0.4 + k * 1.8),
    tilt: -k * 0.1,
  };
}

// --- drawing

export function drawSplash(ctx, t) {
  const fade = Math.min(1, t / 0.6) * Math.min(1, (SPLASH_TIME - t) / 0.7);
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);
  ctx.globalAlpha = Math.max(0, fade);

  const cx = VIEW_W / 2;
  const cy = 118;

  // The logo: the ship over a riveted plate, the same motif as the favicon.
  const grow = Math.min(1, t / 0.5);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(grow, grow);

  ctx.fillStyle = '#191d24';
  ctx.fillRect(-54, -34, 108, 68);
  ctx.fillStyle = '#30363f';
  ctx.fillRect(-50, -30, 100, 60);
  ctx.fillStyle = '#464e5a';
  ctx.fillRect(-50, -30, 100, 6);
  ctx.fillRect(-50, 24, 100, 6);
  ctx.fillStyle = '#737d8c';
  for (let i = -44; i < 50; i += 12) {
    ctx.fillRect(i, -29, 3, 3);
    ctx.fillRect(i, 26, 3, 3);
  }
  // the ship, sweeping in as the logo lands
  const sx = -90 + Math.min(1, t / 0.9) * 90;
  ctx.save();
  ctx.translate(sx, 0);
  ctx.fillStyle = '#6e7b8a';
  ctx.beginPath();
  ctx.moveTo(22, 0); ctx.lineTo(4, -7); ctx.lineTo(-10, -11);
  ctx.lineTo(-19, -8); ctx.lineTo(-17, 0); ctx.lineTo(-19, 8);
  ctx.lineTo(-10, 11); ctx.lineTo(4, 7);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#aab7c7';
  ctx.beginPath();
  ctx.moveTo(20, 0); ctx.lineTo(4, -5); ctx.lineTo(-10, -9); ctx.lineTo(-16, -6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = COL.coolHi;
  ctx.fillRect(2, -3, 6, 4);
  if (t < 1.1) {
    ctx.fillStyle = COL.cool;
    ctx.fillRect(-26 - (1 - t) * 20, -3, 10, 6);
  }
  ctx.restore();
  ctx.restore();

  ctx.font = 'bold 34px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#cfe2ee';
  ctx.fillText("RIVETS 'N RUIN", cx, 178);

  ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = COL.cool;
  ctx.fillText('SKIM THE HULL · BREAK THE GUNS · RUN IT THROUGH', cx, 218);

  ctx.fillStyle = COL.hudLine;
  ctx.fillText(`${BUILD}  v${VERSION}`, cx, 246);
  ctx.fillText('GPL-3.0  ·  NO ASSETS, NO DEPENDENCIES', cx, 260);

  if (t > 1.2) {
    ctx.globalAlpha = Math.max(0, fade) * (0.4 + 0.4 * Math.sin(t * 4));
    ctx.fillStyle = COL.warmHi;
    ctx.fillText('PRESS ANY KEY', cx, 288);
  }
  ctx.globalAlpha = 1;
}

export function drawLaunchBanner(ctx, game, k) {
  const spec = game.level.spec;
  const a = Math.min(1, k * 3) * Math.min(1, (1 - k) * 3.5);
  ctx.globalAlpha = Math.max(0, a);
  ctx.font = 'bold 20px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COL.hudBright;
  ctx.fillText(spec.name, VIEW_W / 2, 60);
  ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = COL.cool;
  ctx.fillText(spec.subtitle, VIEW_W / 2, 86);
  ctx.fillStyle = COL.warmHi;
  ctx.fillText(['CLAMPS OFF', 'THRUSTERS LIT', 'RUN THE HULL'][Math.min(2, (k * 3) | 0)],
    VIEW_W / 2, 108);

  // The hull's rule, if it has one. A modifier the pilot is not told about
  // is not a modifier, it is the game behaving strangely — so it is named
  // on the way in, and the line under it says what it actually does.
  if (game.hullMod) {
    ctx.fillStyle = COL.danger;
    ctx.fillText(game.hullMod.name, VIEW_W / 2, 136);
    ctx.fillStyle = COL.hudText;
    ctx.fillText(game.hullMod.blurb.toUpperCase(), VIEW_W / 2, 150);
  }
  ctx.globalAlpha = 1;
}

export function drawExitBanner(ctx, game, k) {
  ctx.globalAlpha = Math.max(0, Math.min(1, k * 4) * (1 - Math.max(0, (k - 0.75) * 4)));
  ctx.font = 'bold 20px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COL.coolHi;
  ctx.fillText('WAY CLEAR', VIEW_W / 2, 64);
  ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = COL.warmHi;
  ctx.fillText(['GUNS DOWN', 'FULL BURN', 'OUT THE FAR END'][Math.min(2, (k * 3) | 0)],
    VIEW_W / 2, 90);
  ctx.globalAlpha = 1;
}

// The landing pad, drawn under the ship during a landing or a launch.
export function drawPad(ctx, camX, camY) {
  const px = APRON * 0.3 - camX;
  if (px < -120 || px > VIEW_W + 120) return;
  const py = (FIELD_TOP + FIELD_BOT) / 2 + 66 + camY;
  ctx.fillStyle = '#12161e';
  ctx.fillRect(px - 54, py, 108, 10);
  ctx.fillStyle = '#464e5a';
  ctx.fillRect(px - 54, py, 108, 2);
  for (let i = -48; i < 50; i += 14) {
    ctx.fillStyle = '#737d8c';
    ctx.fillRect(px + i, py + 4, 4, 3);
  }
  const blink = (performance.now() / 320) % 2 < 1;
  ctx.fillStyle = blink ? COL.warmHi : '#5a4a1e';
  ctx.fillRect(px - 56, py - 4, 4, 4);
  ctx.fillRect(px + 52, py - 4, 4, 4);
}

// ------------------------------------------------------- the title backdrop
//
// The title used to be a wall of text over a dimmed frame of whatever the
// last run had left on screen. It is a menu, so it gets a backdrop of its
// own: deep stars, the dreadnought itself passing below, and a patrol
// crossing in front of it.
//
// Everything is a function of one clock, so it needs no state and cannot
// drift out of step with anything.

const STARS = 110;

// ------------------------------------------------------- the launch gantry
//
// The frame around the title screen, and deliberately not the hangar's.
//
// The hangar is where the ship is worked on: flat trussed roof, ribbed
// wall panels, a plated deck, warm lamps overhead, and THEMES.steel
// throughout. This is where it is sent out from, so it is built the
// other way — an arched mouth in deep conduit blue, ribs running over
// the opening instead of girders across a ceiling, cold strip lighting
// down the inside edges instead of lamps above, and open grating
// underfoot instead of plate. Two rooms on the same ship, built by the
// same yard, for different jobs.
//
// It is a portal: everything outside the arch is structure, and the
// starfield and the dreadnought show through the opening, which is what
// makes the title a view out of somewhere rather than a picture.
export const GANTRY = {
  top: 30, bottom: 26, side: 28, radius: 30,
};

function portalPath(ctx, o) {
  const H = FIELD_H;
  const x0 = o.side;
  const y0 = o.top;
  const x1 = VIEW_W - o.side;
  const y1 = H - o.bottom;
  const r = o.radius;
  ctx.beginPath();
  ctx.rect(0, 0, VIEW_W, H);
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x1 - r, y0);
  ctx.quadraticCurveTo(x1, y0, x1, y0 + r);
  ctx.lineTo(x1, y1 - r);
  ctx.quadraticCurveTo(x1, y1, x1 - r, y1);
  ctx.lineTo(x0 + r, y1);
  ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
  ctx.lineTo(x0, y0 + r);
  ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
}

export function drawTitleFrame(ctx, t) {
  const o = GANTRY;
  const H = FIELD_H;
  const T = THEMES.conduit;
  const x0 = o.side;
  const y0 = o.top;
  const x1 = VIEW_W - o.side;
  const y1 = H - o.bottom;

  // the structure: everything the arch does not cut out
  ctx.save();
  portalPath(ctx, o);
  ctx.fillStyle = T.base;
  ctx.fill('evenodd');

  // Clip to the structure so the ribs and the grating cannot stray over
  // the opening — the starfield is the point of the opening.
  ctx.clip('evenodd');

  // ribs running over the mouth, nested, narrowing as they recede
  ctx.strokeStyle = T.mid;
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const k = i * 6;
    ctx.globalAlpha = 0.9 - i * 0.14;
    ctx.beginPath();
    ctx.moveTo(x0 - k, H);
    ctx.lineTo(x0 - k, y0 - k + o.radius);
    ctx.quadraticCurveTo(x0 - k, y0 - k, x0 - k + o.radius, y0 - k);
    ctx.lineTo(x1 + k - o.radius, y0 - k);
    ctx.quadraticCurveTo(x1 + k, y0 - k, x1 + k, y0 - k + o.radius);
    ctx.lineTo(x1 + k, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // open grating underfoot: slats with the dark between them
  ctx.fillStyle = T.seam;
  ctx.fillRect(0, y1, VIEW_W, H - y1);
  ctx.fillStyle = T.mid;
  for (let gx = 0; gx < VIEW_W; gx += 9) ctx.fillRect(gx, y1 + 3, 5, H - y1 - 3);
  ctx.fillStyle = T.hi;
  ctx.globalAlpha = 0.3;
  ctx.fillRect(0, y1 + 3, VIEW_W, 1);
  ctx.globalAlpha = 1;

  // cable runs down the side walls, because a gantry is a thing with
  // services in it
  ctx.strokeStyle = T.seam;
  ctx.lineWidth = 2;
  for (const cx of [10, 18, VIEW_W - 10, VIEW_W - 18]) {
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();
  }
  ctx.restore();

  // --- the lip of the opening, and the light coming off it
  ctx.save();
  portalPath(ctx, o);
  ctx.strokeStyle = T.edgeHi;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // Cold strip lighting down the inside edges. A hangar lamp hangs and
  // throws a pool; this is set into the structure and reads as a line.
  const pulse = 0.55 + Math.abs(Math.sin(t * 0.9)) * 0.3;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const sx of [x0 - 6, x1 + 4]) {
    const g = ctx.createLinearGradient(sx, 0, sx + 2, 0);
    g.addColorStop(0, 'rgba(63,176,201,0)');
    g.addColorStop(0.5, `rgba(63,176,201,${0.5 * pulse})`);
    g.addColorStop(1, 'rgba(63,176,201,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - 3, y0 + 10, 8, y1 - y0 - 20);
    ctx.fillStyle = T.chevron;
    ctx.globalAlpha = pulse;
    ctx.fillRect(sx, y0 + 14, 2, y1 - y0 - 28);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // corner brackets, bolted across the arch
  ctx.fillStyle = T.block;
  for (const [bx, by, w, h] of [
    [x0 - 10, y0 - 8, 26, 8], [x1 - 16, y0 - 8, 26, 8],
    [x0 - 10, y1, 26, 8], [x1 - 16, y1, 26, 8],
  ]) {
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = T.rivet;
    for (let k = 3; k < w - 2; k += 7) ctx.fillRect(bx + k, by + 3, 2, 2);
    ctx.fillStyle = T.block;
  }
}

export function drawTitleBackdrop(ctx, t) {
  const H = FIELD_H;

  // deep space
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, VIEW_W, H);

  // three parallax star layers, the near ones brighter and faster
  for (let i = 0; i < STARS; i++) {
    const layer = i % 3;
    const speed = 3 + layer * 7;
    const x = VIEW_W - ((i * 97.3 + t * speed) % (VIEW_W + 20));
    const y = (i * 53.7) % H;
    ctx.fillStyle = ['#2b3346', '#4a5470', '#cfd8f0'][layer];
    const s = layer === 2 ? 1.5 : 1;
    ctx.fillRect(x, y, s, s);
  }

  // a nebula wash, so the field is not evenly black
  const g = ctx.createRadialGradient(VIEW_W * 0.72, H * 0.22, 10,
    VIEW_W * 0.72, H * 0.22, VIEW_W * 0.55);
  g.addColorStop(0, 'rgba(60,40,90,0.30)');
  g.addColorStop(1, 'rgba(10,12,24,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, H);

  // The dreadnought, passing below: a long plated band with lit windows and
  // the occasional tower. It is the thing the whole game happens on, so it
  // ought to be on the title.
  const scroll = (t * 11) % 160;
  const topY = H - 46;
  ctx.fillStyle = '#0a0e15';
  ctx.fillRect(0, topY - 6, VIEW_W, H - topY + 6);
  ctx.fillStyle = '#141b25';
  ctx.fillRect(0, topY, VIEW_W, H - topY);
  ctx.fillStyle = '#1d2733';
  ctx.fillRect(0, topY, VIEW_W, 3);

  for (let x = -scroll; x < VIEW_W + 160; x += 40) {
    ctx.fillStyle = '#19222e';
    ctx.fillRect(x + 2, topY + 6, 36, H - topY - 10);
    ctx.fillStyle = '#242f3d';
    ctx.fillRect(x + 2, topY + 6, 36, 1);
    // lit windows, on a pattern that does not read as a pattern
    for (let k = 0; k < 4; k++) {
      const on = ((Math.floor((x + scroll) / 40) * 7 + k * 13) % 11) < 4;
      if (!on) continue;
      ctx.fillStyle = k % 2 ? '#4fd0e8' : '#ffd24a';
      ctx.globalAlpha = 0.4;
      ctx.fillRect(x + 7 + k * 8, topY + 12 + (k % 2) * 12, 3, 4);
      ctx.globalAlpha = 1;
    }
  }
  // towers and masts on the skyline
  for (let x = -scroll; x < VIEW_W + 160; x += 120) {
    const h = 14 + ((Math.floor((x + scroll) / 120) * 37) % 20);
    ctx.fillStyle = '#19222e';
    ctx.fillRect(x + 30, topY - h, 10, h);
    ctx.fillStyle = Math.sin(t * 3 + x) > 0 ? '#e8434f' : '#4a2026';
    ctx.fillRect(x + 33, topY - h - 3, 3, 3);
  }

  // a patrol crossing, right to left, with a trail
  const px = VIEW_W + 40 - ((t * 46) % (VIEW_W + 220));
  const py = H * 0.42 + Math.sin(t * 0.7) * 22;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#4fd0e8';
  ctx.fillRect(px + 6, py - 1, 34, 2);
  ctx.restore();
  ctx.fillStyle = '#6e7b8a';
  ctx.beginPath();
  ctx.moveTo(px - 9, py); ctx.lineTo(px + 5, py - 3);
  ctx.lineTo(px + 8, py); ctx.lineTo(px + 5, py + 3);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = COL.coolHi;
  ctx.fillRect(px + 1, py - 1, 3, 2);

  // a dim vignette, so the text on top always has something to sit against
  const v = ctx.createRadialGradient(VIEW_W / 2, H * 0.42, 40,
    VIEW_W / 2, H * 0.42, VIEW_W * 0.62);
  v.addColorStop(0, 'rgba(4,6,10,0.55)');
  v.addColorStop(1, 'rgba(4,6,10,0.86)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, VIEW_W, H);
}
