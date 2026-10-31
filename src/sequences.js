// Splash, launch, landing and ending.
//
// These are the seams of a run: the moment before it starts, the moment it
// commits, the moment it is over. Each is a small state with its own clock
// that locks out control, so none of them can be flown through or skipped
// by accident — but every one can be skipped deliberately, because the
// fiftieth launch should not cost what the first one did.

import { VERSION, BUILD, VIEW_W, FIELD_H, FIELD_TOP, FIELD_BOT, APRON, COL } from './config.js';

export const SPLASH_TIME = 3.4;
export const LAUNCH_TIME = 2.0;
export const LANDING_TIME = 2.6;
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

export function landingPose(k, fromX) {
  const e = 1 - (1 - k) * (1 - k);            // ease out: arrives slowly
  return {
    x: fromX + (APRON * 0.3 - fromX) * e,
    y: (FIELD_TOP + FIELD_BOT) / 2 + e * 54,  // settles onto the pad
    thrust: Math.max(0, 1 - k * 1.6),
    tilt: e * 0.1,
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
  ctx.fillText('SKIM THE HULL · BREAK THE GUNS · COME BACK ALIVE', cx, 218);

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
  ctx.globalAlpha = 1;
}

export function drawLandingBanner(ctx, game, k) {
  const a = Math.min(1, k * 4);
  ctx.globalAlpha = Math.max(0, a);
  ctx.font = 'bold 20px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COL.coolHi;
  ctx.fillText('DOCKING', VIEW_W / 2, 64);
  ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = COL.hudText;
  ctx.fillText(['APPROACH', 'GEAR DOWN', 'CLAMPS ON'][Math.min(2, (k * 3) | 0)],
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
