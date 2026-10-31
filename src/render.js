import {
  VIEW_W, VIEW_H, FIELD_H, FIELD_TOP, FIELD_BOT, SHIP, COL, clamp,
} from './config.js';
import { interceptors } from './enemies.js';
import { playerShots, enemyShots } from './projectiles.js';
import { particles, lights } from './particles.js';
import { hash2 } from './rng.js';
import { hullChunk, warmChunks, CHUNK_W } from './level.js';
import { get as setting } from './settings.js';
import { renderScale, scaleGeneration, hullScale } from './display.js';
import { pickups, tint } from './pickups.js';
import { livingParts, shellUp } from './boss.js';
import { foes, SPEC as FOE_SPEC } from './foes.js';
import { drawOrdnance } from './armory.js';
import { PICKUP } from './config.js';

let scanlines = null;
let vignette = null;
let crt = null;            // vignette + scanlines, combined, device-res
let crtGen = -1;
let glow = null;           // half-res bright pass
let glowCtx = null;
let blur = null;           // quarter-res, for the blur bounce
let blurCtx = null;

const GLOW_SCALE = 0.5;

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

  glow = document.createElement('canvas');
  glow.width = Math.round(VIEW_W * GLOW_SCALE);
  glow.height = Math.round(FIELD_H * GLOW_SCALE);
  glowCtx = glow.getContext('2d');

  blur = document.createElement('canvas');
  blur.width = Math.round(glow.width / 2);
  blur.height = Math.round(glow.height / 2);
  blurCtx = blur.getContext('2d');
  blurCtx.imageSmoothingEnabled = true;
  glowCtx.imageSmoothingEnabled = true;
}

// Vignette and scanlines, rendered once per scale into a single bitmap sized
// to the backing store. Scanline pitch follows the scale so the effect keeps
// its apparent thickness instead of vanishing at high resolution.
function crtOverlay() {
  const scale = renderScale();
  const gen = scaleGeneration();
  if (crt && crtGen === gen) return crt;

  const w = Math.round(VIEW_W * scale);
  const h = Math.round(FIELD_H * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');

  const grad = g.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.34,
    w / 2, h / 2, Math.max(w, h) * 0.72,
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  const pitch = Math.max(2, Math.round(2 * scale));
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 1; y < h; y += pitch) g.fillRect(0, y, w, Math.max(1, pitch >> 1));

  crt = c;
  crtGen = gen;
  return crt;
}

export function drawWorld(ctx, game) {
  if (!scanlines) buildOverlays();

  const sh = setting('shake') ? game.cam.shake : 0;
  const ox = sh > 0 ? (Math.random() - 0.5) * sh : 0;
  const oy = sh > 0 ? (Math.random() - 0.5) * sh : 0;
  const camX = clamp(Math.round(game.cam.x + ox), 0, game.level.length - VIEW_W);
  const camY = Math.round(oy);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VIEW_W, FIELD_H);
  ctx.clip();

  ctx.fillStyle = COL.space;
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);

  // the hull: however many cached chunks cover the view
  drawHull(ctx, game.level, camX, camY);

  // lighting on the surface, under everything that sits on it
  drawLights(ctx, camX, camY);
  drawBeacons(ctx, camX, camY);

  ctx.translate(-camX, camY);

  drawTurrets(ctx, game, camX);
  drawInterceptors(ctx, game);
  drawFoes(ctx);
  if (game.boss) drawBoss(ctx, game.boss);
  drawPickups(ctx);
  drawOrdnance(ctx);
  drawShots(ctx);
  if (game.player.alive) drawShip(ctx, game.player);
  drawParticles(ctx);

  ctx.restore();

  // superstructure passing in front, scrolling faster than the hull
  if (setting('foreground')) drawForeground(ctx, camX, camY);

  // bloom: re-draw only the bright things small, blur, add back
  if (setting('bloom')) drawBloom(ctx, game, camX, camY);

  // CRT dressing: vignette and scanlines are pre-combined into one bitmap at
  // device resolution, so this is a single 1:1 blit rather than two
  // full-screen passes resampled every frame.
  if (setting('scanlines')) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(crtOverlay(), 0, 0);
    ctx.restore();
  }

  if (game.flash > 0) {
    ctx.globalAlpha = Math.min(0.6, game.flash);
    ctx.fillStyle = game.flash > 0.5 ? COL.coolHi : COL.danger;
    ctx.fillRect(0, 0, VIEW_W, FIELD_H);
    ctx.globalAlpha = 1;
  }
}

// Chunks are rendered at the display scale, so the hull is as sharp as
// everything else. Drawn with the transform temporarily reset to device
// pixels so a chunk lands exactly on the pixel grid and tiles seamlessly —
// at fractional scales, drawing them in logical units leaves hairline gaps.
function drawHull(ctx, level, camX, camY) {
  const scale = hullScale();          // texture caps lower than the rest
  const view = renderScale();
  const gen = scaleGeneration();
  const first = Math.floor(camX / CHUNK_W);
  const last = Math.floor((camX + VIEW_W - 1) / CHUNK_W);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = first; i <= last; i++) {
    if (i < 0 || i * CHUNK_W >= level.length) continue;
    const canvas = hullChunk(level, i, scale, gen);
    const dx = Math.round((i * CHUNK_W - camX) * view);
    const dy = Math.round(camY * view);
    const dw = Math.ceil(canvas.width * (view / scale));
    const dh = Math.ceil(canvas.height * (view / scale));
    ctx.drawImage(canvas, dx, dy, dw, dh);
  }
  ctx.restore();

  warmChunks(level, camX, VIEW_W, scale, gen);
}

// Explosions and muzzle flashes light the plating around them.
function drawLights(ctx, camX, camY) {
  if (!lights.count) return;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < lights.count; i++) {
    const l = lights.items[i];
    const sx = l.x - camX;
    if (sx < -l.r || sx > VIEW_W + l.r) continue;
    const a = Math.max(0, l.life / l.maxLife);
    const g = ctx.createRadialGradient(sx, l.y + camY, 0, sx, l.y + camY, l.r);
    g.addColorStop(0, l.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = a * a * 0.5;
    ctx.fillStyle = g;
    ctx.fillRect(sx - l.r, l.y + camY - l.r, l.r * 2, l.r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Deterministic beacons along the rim girders, so the hull looks powered.
function drawBeacons(ctx, camX, camY) {
  const SPACING = 260;
  const first = Math.floor(camX / SPACING) * SPACING;
  const t = performance.now() / 1000;
  for (let bx = first; bx < camX + VIEW_W + SPACING; bx += SPACING) {
    const n = hash2(bx, 31);
    const top = n > 0.5;
    const sx = bx - camX + (n * 60 | 0);
    if (sx < -6 || sx > VIEW_W + 6) continue;
    const phase = Math.sin(t * 2.2 + n * 9);
    if (phase < 0.2) continue;
    const y = (top ? FIELD_TOP - 7 : FIELD_BOT + 5) + camY;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (phase - 0.2) * 0.9;
    ctx.fillStyle = n > 0.82 ? COL.danger : COL.cool;
    ctx.fillRect(sx, y, 2, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(sx, y, 1, 1);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// Superstructure in front of the ship, scrolling faster than the hull so it
// reads as nearer. Kept to the girders and narrow, because a foreground that
// hides a threat is a foreground that loses runs.
function drawForeground(ctx, camX, camY) {
  const PAR = 1.32;
  const SPACING = 430;
  const fx = camX * PAR;
  const first = Math.floor(fx / SPACING) * SPACING;

  for (let gx = first; gx < fx + VIEW_W + SPACING; gx += SPACING) {
    const n = hash2(gx, 17);
    const sx = Math.round(gx - fx + n * 120);
    if (sx < -26 || sx > VIEW_W + 26) continue;

    const w = 7 + (n * 9 | 0);
    const fromTop = n > 0.5;
    const len = 44 + (hash2(gx, 23) * 78 | 0);
    const y0 = fromTop ? camY : FIELD_H - len + camY;

    ctx.globalAlpha = 0.72;
    ctx.fillStyle = '#05070b';
    ctx.fillRect(sx, y0, w, len);
    // a lit edge so it is structure, not a hole
    ctx.fillStyle = '#1d242e';
    ctx.fillRect(sx, y0, 1, len);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#2b3542';
    ctx.fillRect(sx + 2, fromTop ? y0 + len - 3 : y0 + 1, w - 4, 2);
    ctx.globalAlpha = 1;

    // an occasional cable swinging across the gap
    if (hash2(gx, 41) > 0.72) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#05070b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx + w / 2, fromTop ? y0 + len : y0);
      ctx.quadraticCurveTo(sx + w / 2 + 40, FIELD_H / 2 + camY, sx + w / 2 + 86, fromTop ? y0 + len - 20 : y0 + 20);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

// Cheap bloom: the bright elements are re-drawn at half scale into their own
// buffer, bounced through a quarter-size canvas to blur them, then added
// back. Everything neon in the scene picks up a halo without a shader.
function drawBloom(ctx, game, camX, camY) {
  glowCtx.setTransform(1, 0, 0, 1, 0, 0);
  glowCtx.clearRect(0, 0, glow.width, glow.height);
  glowCtx.save();
  glowCtx.scale(GLOW_SCALE, GLOW_SCALE);
  glowCtx.translate(-camX, camY);
  drawShots(glowCtx);
  drawParticles(glowCtx);
  if (game.player.alive) drawEngineGlow(glowCtx, game.player);
  glowCtx.restore();

  // two-tap blur
  for (let i = 0; i < 2; i++) {
    blurCtx.clearRect(0, 0, blur.width, blur.height);
    blurCtx.drawImage(glow, 0, 0, blur.width, blur.height);
    glowCtx.clearRect(0, 0, glow.width, glow.height);
    glowCtx.drawImage(blur, 0, 0, blur.width, blur.height, 0, 0, glow.width, glow.height);
  }

  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.85;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(glow, 0, 0, glow.width, glow.height, 0, 0, VIEW_W, FIELD_H);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawEngineGlow(g, p) {
  g.save();
  g.translate(Math.round(p.x), Math.round(p.y));
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = COL.cool;
  g.fillRect(-p.facing * 18 - 3, -3, 6, 6);
  g.fillStyle = COL.coolHi;
  g.fillRect(-p.facing * 16 - 2, -2, 4, 4);
  g.restore();
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
  // bank into vertical movement; the ship having a body makes the inertia
  // legible in a way a rigid sprite never does
  ctx.rotate(clamp(p.vy / 230, -1, 1) * 0.26 * (sx < 0 ? -1 : 1));
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

    // housing, tinted by kind so the gun you are approaching is identifiable
    const tw = t.tower || {};
    ctx.fillStyle = '#596372';
    ctx.beginPath();
    ctx.arc(0, d * 1, tw.aura ? 7 : 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tw.colour || COL.danger;
    ctx.fillRect(-1, d * 1 - 1, 2, 2);

    // a lance winding up: an unmissable tell, because the shot itself is
    // too fast to react to
    if (t.charge > 0) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t.charge * 40);
      ctx.fillStyle = tw.colour;
      ctx.beginPath(); ctx.arc(0, d * 1, 10, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // a warden's protective aura, and the shimmer on what it covers
    if (tw.aura) {
      ctx.globalAlpha = 0.10 + 0.05 * Math.sin(performance.now() / 300);
      ctx.fillStyle = tw.colour;
      ctx.beginPath(); ctx.arc(0, 0, tw.aura, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (t.shielded) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#b45ce0';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, d * 1, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = COL.rivet;
    ctx.fillRect(-7, d * 4, 2, 2);
    ctx.fillRect(5, d * 4, 2, 2);
    ctx.restore();
  }
}

// Each pickup carries a glyph, not just a colour: colour alone fails for
// anyone who cannot separate the cyan from the green, and these appear
// against a busy hull at speed.
function drawPickups(ctx) {
  for (let i = 0; i < pickups.count; i++) {
    const p = pickups.items[i];
    // flash out the last few seconds so an expiring pickup is obvious
    if (p.life < Math.min(PICKUP.blinkAt, p.maxLife * 0.3) && Math.floor(p.life * 7) % 2 === 0) continue;

    const c = tint(p.kind);
    const x = Math.round(p.x);
    const y = Math.round(p.y);

    // Coins are small, numerous and must not read as upgrades, so they skip
    // the cased look entirely: a spinning disc, nothing more.
    if (p.kind === 'coin') {
      const w = 1 + Math.abs(Math.cos(p.t * 5)) * 3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = c;
      ctx.fillRect(x - w, y - 3, w * 2, 6);
      ctx.fillStyle = '#fff6cf';
      ctx.fillRect(x - w * 0.4, y - 2, Math.max(1, w * 0.8), 4);
      ctx.globalCompositeOperation = 'source-over';
      continue;
    }

    const h = PICKUP.size / 2;
    ctx.save();
    ctx.translate(x, y);

    // casing
    ctx.fillStyle = '#10141b';
    ctx.fillRect(-h - 1, -h - 1, PICKUP.size + 2, PICKUP.size + 2);
    ctx.fillStyle = '#2b323c';
    ctx.fillRect(-h, -h, PICKUP.size, PICKUP.size);
    ctx.strokeStyle = c;
    ctx.lineWidth = 1;
    ctx.strokeRect(-h + 0.5, -h + 0.5, PICKUP.size - 1, PICKUP.size - 1);

    // a soft pulse so it reads as live, not scenery
    ctx.globalAlpha = 0.25 + 0.2 * Math.sin(p.t * 5);
    ctx.fillStyle = c;
    ctx.fillRect(-h, -h, PICKUP.size, PICKUP.size);
    ctx.globalAlpha = 1;

    ctx.fillStyle = c;
    switch (p.kind) {
      case 'coin':
        break;        // drawn above, before the casing
      case 'coffin':  // a small casket: lid, body, clasp
        ctx.fillRect(-4, -5, 8, 2);
        ctx.fillRect(-3, -3, 6, 8);
        ctx.fillStyle = '#8a6a1e';
        ctx.fillRect(-1, -1, 2, 4);
        break;
      case 'shield':      // a shield outline
        ctx.fillRect(-3, -4, 6, 1);
        ctx.fillRect(-3, -4, 1, 4);
        ctx.fillRect(2, -4, 1, 4);
        ctx.fillRect(-2, 0, 4, 1);
        ctx.fillRect(-1, 1, 2, 2);
        break;
      case 'life':        // a ship
        ctx.beginPath();
        ctx.moveTo(4, 0); ctx.lineTo(-3, -3); ctx.lineTo(-1, 0); ctx.lineTo(-3, 3);
        ctx.closePath(); ctx.fill();
        break;
      case 'healthbar':   // a bar being extended
        ctx.fillRect(-4, -1, 5, 3);
        ctx.fillRect(2, -3, 1, 7);
        ctx.fillRect(1, 0, 3, 1);
        break;
      case 'gunspeed':    // stacked chevrons
        for (let k = 0; k < 2; k++) {
          ctx.fillRect(-3 + k * 4, -3, 1, 2);
          ctx.fillRect(-2 + k * 4, -1, 1, 2);
          ctx.fillRect(-3 + k * 4, 1, 1, 2);
        }
        break;
      case 'gunblaze':    // a spreading fan
        ctx.fillRect(-4, -1, 3, 2);
        ctx.fillRect(0, -4, 2, 1);
        ctx.fillRect(0, -1, 2, 2);
        ctx.fillRect(0, 3, 2, 1);
        ctx.fillRect(3, -5, 1, 1);
        ctx.fillRect(3, 0, 1, 1);
        ctx.fillRect(3, 4, 1, 1);
        break;
      default:
        ctx.fillRect(-2, -2, 4, 4);
    }
    ctx.restore();
  }
}

// Bosses are drawn big and plated, so they read as structures rather than
// large enemies. Each silhouette is distinct enough to recognise from the
// edge of the arena.
function drawBoss(ctx, b) {
  const x = Math.round(b.x);
  const y = Math.round(b.y);
  ctx.save();
  ctx.translate(x, y);

  if (b.dead) {
    // coming apart: flicker and sink
    ctx.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(b.death * 22));
  }

  const lit = b.flash > 0;

  if (b.kind === 'warden') {
    // spine
    ctx.fillStyle = '#20252e';
    ctx.fillRect(-10, -96, 22, 192);
    ctx.fillStyle = '#39404c';
    ctx.fillRect(-8, -94, 18, 188);
    for (let ry = -90; ry < 90; ry += 14) {
      ctx.fillStyle = '#7b8795';
      ctx.fillRect(-6, ry, 2, 2);
      ctx.fillRect(6, ry, 2, 2);
    }
    // core, exposed only once the pods are gone
    const open = !shellUp(b);
    ctx.fillStyle = lit ? '#ffd24a' : open ? '#5b2730' : '#2a3038';
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = open ? '#e8434f' : '#4b5462';
    ctx.lineWidth = 3; ctx.stroke();
    if (open) {
      ctx.fillStyle = '#ff7a2f';
      ctx.beginPath(); ctx.arc(0, 0, 12 + Math.sin(b.t * 7) * 3, 0, Math.PI * 2); ctx.fill();
    }
  } else if (b.kind === 'drayline') {
    ctx.fillStyle = '#1b2029';
    ctx.beginPath();
    ctx.moveTo(-40, 0); ctx.lineTo(-14, -42); ctx.lineTo(34, -26);
    ctx.lineTo(34, 26); ctx.lineTo(-14, 42); ctx.closePath(); ctx.fill();
    ctx.fillStyle = lit ? '#ffd24a' : '#444d5a';
    ctx.beginPath();
    ctx.moveTo(-34, 0); ctx.lineTo(-12, -36); ctx.lineTo(28, -22);
    ctx.lineTo(28, 22); ctx.lineTo(-12, 36); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8e9aa9';
    ctx.fillRect(-36, -6, 16, 12);
    ctx.fillStyle = '#e8434f';
    ctx.fillRect(-4, -5, 10, 10);
    for (let ry = -30; ry < 30; ry += 12) {
      ctx.fillStyle = '#7b8795';
      ctx.fillRect(14, ry, 2, 2);
    }
  } else {
    // riveter: core plus rotating plates
    ctx.fillStyle = lit ? '#ffd24a' : '#333a45';
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#59636f'; ctx.lineWidth = 3; ctx.stroke();
    const open = !shellUp(b);
    ctx.fillStyle = open ? '#ff7a2f' : '#20262e';
    ctx.beginPath(); ctx.arc(0, 0, open ? 15 + Math.sin(b.t * 9) * 3 : 12, 0, Math.PI * 2); ctx.fill();
  }

  // destructible parts
  for (const part of b.parts) {
    if (part.dead) continue;
    const hurt = 1 - part.hp / part.maxHp;
    ctx.save();
    ctx.translate(part.dx, part.dy);
    ctx.fillStyle = '#161b22';
    ctx.fillRect(-part.r - 2, -part.r - 2, part.r * 2 + 4, part.r * 2 + 4);
    ctx.fillStyle = part.flash > 0 ? '#ffd24a' : '#4e5765';
    ctx.fillRect(-part.r, -part.r, part.r * 2, part.r * 2);
    ctx.fillStyle = '#9fadbd';
    ctx.fillRect(-part.r, -part.r, part.r * 2, 2);
    // damage shows as a reddening eye
    ctx.fillStyle = hurt > 0.6 ? '#e8434f' : hurt > 0.3 ? '#ff7a2f' : '#ffd24a';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillStyle = '#b4c0ce';
    ctx.fillRect(-part.r + 2, -part.r + 2, 2, 2);
    ctx.fillRect(part.r - 4, part.r - 4, 2, 2);
    ctx.restore();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// Each attacker type has a silhouette you can name at a glance: a mine is
// round and spiked, a lancer is a dart, an orbiter is a ring, a warder
// carries a visible plate on the side you cannot hurt it from.
function drawFoes(ctx) {
  for (let i = 0; i < foes.count; i++) {
    const f = foes.items[i];
    const spec = FOE_SPEC[f.kind];
    const lit = f.flash > 0;
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y));

    if (f.kind === 'mine') {
      ctx.fillStyle = lit ? '#ffd24a' : '#3a3038';
      ctx.beginPath(); ctx.arc(0, 0, spec.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e8434f'; ctx.lineWidth = 1.5;
      for (let k = 0; k < 8; k++) {
        const a = f.t * 1.2 + (k / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * spec.r, Math.sin(a) * spec.r);
        ctx.lineTo(Math.cos(a) * (spec.r + 4), Math.sin(a) * (spec.r + 4));
        ctx.stroke();
      }
      ctx.fillStyle = Math.sin(f.t * 9) > 0 ? '#e8434f' : '#5a2228';
      ctx.fillRect(-2, -2, 4, 4);
    } else if (f.kind === 'lancer') {
      ctx.scale(f.facing, 1);
      const charging = f.state === 1;
      ctx.fillStyle = lit ? '#ffd24a' : charging ? '#c4502a' : '#3e3a44';
      ctx.beginPath();
      ctx.moveTo(-15, 0); ctx.lineTo(7, -7); ctx.lineTo(13, 0); ctx.lineTo(7, 7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = charging ? '#ffd24a' : '#6e6a78';
      ctx.fillRect(7, -1, 9, 2);
      if (!charging) {   // telegraph: a lengthening aim line
        ctx.globalAlpha = 0.35 + 0.3 * Math.sin(f.t * 14);
        ctx.fillStyle = '#e8434f';
        ctx.fillRect(-15 - f.t * 70, -1, f.t * 70, 1);
        ctx.globalAlpha = 1;
      }
    } else if (f.kind === 'orbiter') {
      ctx.rotate(f.t * 1.4);
      ctx.strokeStyle = lit ? '#ffd24a' : '#4e6472';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, spec.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#2a3a44';
      ctx.beginPath(); ctx.arc(0, 0, spec.r - 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4fd0e8';
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        ctx.fillRect(Math.cos(a) * spec.r - 1.5, Math.sin(a) * spec.r - 1.5, 3, 3);
      }
    } else if (f.kind === 'weaver') {
      // a thin dart, banked into its own weave
      ctx.scale(f.facing, 1);
      ctx.rotate(Math.cos(f.t * FOE_SPEC.weaver.freq) * 0.5);
      ctx.fillStyle = lit ? '#ffd24a' : '#4a3a52';
      ctx.beginPath();
      ctx.moveTo(-11, 0); ctx.lineTo(2, -6); ctx.lineTo(10, 0); ctx.lineTo(2, 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b45ce0';
      ctx.fillRect(-2, -1.5, 7, 3);
      ctx.fillStyle = '#e8b4ff';
      ctx.fillRect(6, -1, 3, 2);
    } else if (f.kind === 'splitter' || f.kind === 'shard') {
      // a shell with a visible seam it will break along
      const big = f.kind === 'splitter';
      const r = big ? 14 : 8;
      ctx.scale(f.facing, 1);
      ctx.fillStyle = lit ? '#ffd24a' : '#3b4450';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8e9aa9'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      if (big) {
        ctx.strokeStyle = '#e8434f'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      }
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(-2, -2 - (big ? 5 : 3), 4, 4);
      ctx.fillRect(-2, -2 + (big ? 5 : 3), 4, 4);
    } else if (f.kind === 'bomber') {
      // a heavy fuselage with a visible bay underneath
      ctx.scale(f.facing, 1);
      ctx.fillStyle = lit ? '#ffd24a' : '#45392c';
      ctx.beginPath();
      ctx.moveTo(-15, -4); ctx.lineTo(8, -8); ctx.lineTo(14, 0);
      ctx.lineTo(8, 8); ctx.lineTo(-15, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6e5a3e';
      ctx.fillRect(-11, 4, 16, 5);
      ctx.fillStyle = '#e8434f';
      for (let k = 0; k < 3; k++) ctx.fillRect(-9 + k * 6, 6, 3, 3);
      ctx.fillStyle = '#d9a07a';
      ctx.fillRect(-15, -4, 4, 8);
    } else if (f.kind === 'leech') {
      // organic, with grabbing arms; glows while attached
      const on = f.state === 1;
      ctx.fillStyle = lit ? '#ffd24a' : on ? '#5fe08a' : '#2f4a38';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = on ? '#9ad94e' : '#4a6a52';
      ctx.lineWidth = 2;
      for (let k = 0; k < 5; k++) {
        const a = f.t * 2.4 + (k / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
        ctx.stroke();
      }
      ctx.fillStyle = on ? '#ffffff' : '#9ad94e';
      ctx.fillRect(-2, -2, 4, 4);
    } else {
      ctx.scale(f.facing, 1);
      ctx.fillStyle = lit ? '#ffd24a' : '#3f4a3a';
      ctx.beginPath();
      ctx.moveTo(-13, 0); ctx.lineTo(-4, -10); ctx.lineTo(9, -6);
      ctx.lineTo(9, 6); ctx.lineTo(-4, 10); ctx.closePath(); ctx.fill();
      // the plate, on the side shots bounce off
      ctx.fillStyle = '#9fb0bd';
      ctx.fillRect(10, -11, 4, 22);
      ctx.fillStyle = '#d7e8ef';
      ctx.fillRect(10, -11, 4, 2);
      ctx.fillStyle = '#9ad94e';
      ctx.fillRect(-2, -3, 6, 6);
    }
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
