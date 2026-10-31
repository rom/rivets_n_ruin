import {
  VIEW_W, VIEW_H, FIELD_H, FIELD_TOP, FIELD_BOT, LEVEL_LEN, SHIP, COL, clamp,
} from './config.js';
import { interceptors } from './enemies.js';
import { playerShots, enemyShots } from './projectiles.js';
import { particles } from './particles.js';

let scanlines = null;
let vignette = null;

function buildOverlays() {
  // 2px scanline pattern, tiled — cheaper than 180 strokes a frame
  const s = document.createElement('canvas');
  s.width = 1; s.height = 2;
  const sg = s.getContext('2d');
  sg.fillStyle = 'rgba(0,0,0,0.22)';
  sg.fillRect(0, 1, 1, 1);
  scanlines = sg.createPattern(s, 'repeat');

  const v = document.createElement('canvas');
  v.width = VIEW_W; v.height = FIELD_H;
  const vg = v.getContext('2d');
  const grad = vg.createRadialGradient(
    VIEW_W / 2, FIELD_H / 2, Math.min(VIEW_W, FIELD_H) * 0.34,
    VIEW_W / 2, FIELD_H / 2, Math.max(VIEW_W, FIELD_H) * 0.72,
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  vg.fillStyle = grad;
  vg.fillRect(0, 0, VIEW_W, FIELD_H);
  vignette = v;
}

export function drawWorld(ctx, game) {
  if (!scanlines) buildOverlays();

  const sh = game.cam.shake;
  const ox = sh > 0 ? (Math.random() - 0.5) * sh : 0;
  const oy = sh > 0 ? (Math.random() - 0.5) * sh : 0;
  const camX = clamp(Math.round(game.cam.x + ox), 0, LEVEL_LEN - VIEW_W);
  const camY = Math.round(oy);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VIEW_W, FIELD_H);
  ctx.clip();

  ctx.fillStyle = COL.space;
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);

  // the hull itself: one blit from the pre-rendered strip
  ctx.drawImage(game.level.bg, camX, 0, VIEW_W, FIELD_H, 0, camY, VIEW_W, FIELD_H);

  ctx.translate(-camX, camY);

  drawTurrets(ctx, game, camX);
  drawInterceptors(ctx, game);
  drawShots(ctx);
  if (game.player.alive) drawShip(ctx, game.player);
  drawParticles(ctx);

  ctx.restore();

  // CRT dressing
  ctx.drawImage(vignette, 0, 0);
  ctx.fillStyle = scanlines;
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);

  if (game.flash > 0) {
    ctx.globalAlpha = Math.min(0.6, game.flash);
    ctx.fillStyle = game.flash > 0.5 ? COL.coolHi : COL.danger;
    ctx.fillRect(0, 0, VIEW_W, FIELD_H);
    ctx.globalAlpha = 1;
  }
}

// ----------------------------------------------------------------- entities

function drawShip(ctx, p) {
  // the flip: scaleX sweeps -facing -> +facing through zero
  let sx = p.facing;
  if (p.flip > 0) {
    const t = 1 - p.flip / SHIP.flipTime;
    sx = p.facing * (2 * t - 1);
    if (Math.abs(sx) < 0.1) sx = 0.1 * (sx < 0 ? -1 : 1);
  }

  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.scale(sx, 1);

  if (p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0) ctx.globalAlpha = 0.4;

  // engine glow
  ctx.fillStyle = COL.cool;
  ctx.globalAlpha *= 0.85;
  ctx.fillRect(-15, -2, 4, 4);
  ctx.globalAlpha = p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0 ? 0.4 : 1;

  // hull
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(3, -4);
  ctx.lineTo(-6, -7);
  ctx.lineTo(-12, -5);
  ctx.lineTo(-11, 0);
  ctx.lineTo(-12, 5);
  ctx.lineTo(-6, 7);
  ctx.lineTo(3, 4);
  ctx.closePath();
  ctx.fillStyle = '#6e7b8a';
  ctx.fill();
  ctx.strokeStyle = '#0b0e13';
  ctx.lineWidth = 1;
  ctx.stroke();

  // top-lit panel
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(3, -3);
  ctx.lineTo(-6, -6);
  ctx.lineTo(-11, -4);
  ctx.lineTo(-10, -1);
  ctx.closePath();
  ctx.fillStyle = '#aab7c7';
  ctx.fill();

  // cockpit + accent stripe
  ctx.fillStyle = COL.coolHi;
  ctx.fillRect(1, -2, 4, 3);
  ctx.fillStyle = COL.cool;
  ctx.fillRect(-9, -1, 8, 2);

  // cannon mounts
  ctx.fillStyle = '#30363f';
  ctx.fillRect(5, -6, 7, 2);
  ctx.fillRect(5, 4, 7, 2);

  ctx.restore();
}

function drawInterceptors(ctx, game) {
  for (let i = 0; i < interceptors.count; i++) {
    const e = interceptors.items[i];
    ctx.save();
    ctx.translate(Math.round(e.x), Math.round(e.y));
    ctx.scale(e.dirX, 1);

    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-2, -6);
    ctx.lineTo(-10, -4);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-10, 4);
    ctx.lineTo(-2, 6);
    ctx.closePath();
    ctx.fillStyle = '#4a4038';
    ctx.fill();

    ctx.fillStyle = COL.warm;
    ctx.fillRect(-2, -2, 7, 4);
    ctx.fillStyle = COL.warmHi;
    ctx.fillRect(4, -1, 3, 2);
    ctx.fillStyle = '#7d6a55';
    ctx.fillRect(-9, -5, 4, 2);
    ctx.fillRect(-9, 3, 4, 2);
    ctx.restore();
  }
}

function drawTurrets(ctx, game, camX) {
  for (const t of game.level.turrets) {
    if (t.dead) continue;
    if (t.x < camX - 30 || t.x > camX + VIEW_W + 30) continue;

    ctx.save();
    ctx.translate(Math.round(t.x), Math.round(t.y));

    // barrel
    ctx.save();
    ctx.rotate(t.angle);
    ctx.fillStyle = '#3c4450';
    ctx.fillRect(0, -2, 13, 4);
    ctx.fillStyle = COL.edgeHi;
    ctx.fillRect(10, -2, 3, 1);
    ctx.fillStyle = COL.warm;
    ctx.fillRect(12, -1, 2, 2);
    ctx.restore();

    // base, seated on the mounting surface
    const d = t.dir;
    ctx.fillStyle = '#272d36';
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.lineTo(6, d * 7);
    ctx.lineTo(-6, d * 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4b5462';
    ctx.fillRect(-7, d === 1 ? 0 : -1, 14, 1);

    // housing + damage-state eye
    ctx.fillStyle = '#596372';
    ctx.beginPath();
    ctx.arc(0, d * 1, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.hp === 3 ? COL.danger : t.hp === 2 ? COL.warm : COL.warmHi;
    ctx.fillRect(-1, d * 1 - 1, 2, 2);

    ctx.fillStyle = COL.rivet;
    ctx.fillRect(-7, d * 4, 2, 2);
    ctx.fillRect(5, d * 4, 2, 2);
    ctx.restore();
  }
}

function drawShots(ctx) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < playerShots.count; i++) {
    const s = playerShots.items[i];
    const dir = Math.sign(s.vx) || 1;
    ctx.fillStyle = COL.cool;
    ctx.fillRect(Math.round(s.x) - dir * 5, Math.round(s.y) - 1, 9, 3);
    ctx.fillStyle = COL.coolHi;
    ctx.fillRect(Math.round(s.x) - dir * 2, Math.round(s.y) - 1, 5, 2);
  }
  for (let i = 0; i < enemyShots.count; i++) {
    const s = enemyShots.items[i];
    ctx.fillStyle = COL.warm;
    ctx.fillRect(Math.round(s.x) - 3, Math.round(s.y) - 3, 6, 6);
    ctx.fillStyle = COL.warmHi;
    ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 2, 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawParticles(ctx) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < particles.count; i++) {
    const p = particles.items[i];
    ctx.globalAlpha = Math.min(1, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
