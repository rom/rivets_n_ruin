import {
  VIEW_W, VIEW_H, FIELD_H, FIELD_TOP, FIELD_BOT, SHIP, COL, clamp,
} from './config.js';
import { interceptors } from './enemies.js';
import { playerShots, enemyShots } from './projectiles.js';
import { particles, lights } from './particles.js';
import { hash2 } from './rng.js';
import { hullChunk, warmChunks, CHUNK_W } from './level.js';
import { get as setting } from './settings.js';
import { renderScale, scaleGeneration, hullScale, isStatic } from './display.js';
import { pickups, tint, isTreasure } from './pickups.js';

import { drawBossBody, drawBossParts } from './bossart.js';
import { drawGates } from './gates.js';
import { drawFoeBody, drawInterceptorBody } from './foeart.js';
import { drawShipBody, markOf } from './shipart.js';
import { foes, SPEC as FOE_SPEC, SHIELD as FOE_SHIELD } from './foes.js';
import { drawMinis } from './miniboss.js';
import { drawOrdnance } from './armory.js';
import { drawPad } from './sequences.js';
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
  drawGates(ctx, game, camX);
  drawInterceptors(ctx, game);
  drawFoes(ctx);
  drawMinis(ctx);
  if (game.boss) drawBoss(ctx, game.boss);
  drawPickups(ctx);
  drawOrdnance(ctx);
  drawShots(ctx);
  drawPad(ctx, camX, camY);
  if (game.player.alive) drawShip(ctx, game.player, game.seqTilt, game);
  drawParticles(ctx);

  ctx.restore();

  // superstructure passing in front, scrolling faster than the hull
  if (setting('foreground')) drawForeground(ctx, camX, camY);

  // bloom: re-draw only the bright things small, blur, add back.
  //
  // Skipped behind a menu. The world there is under an 80% dim rect, so the
  // glow is invisible — and the menu is rendered at the full window scale
  // rather than gameplay's cap, which makes the full-screen passes the most
  // expensive thing on the frame for no visible gain.
  if (setting('bloom') && !isStatic()) drawBloom(ctx, game, camX, camY);

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
  if (game.player.alive) drawEngineGlow(glowCtx, game.player, game);
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

function drawEngineGlow(g, p, game) {
  const m = markOf(game ? game.levelIndex : 0);
  const n = m.engines;
  const spread = m.half * 0.78;
  g.save();
  g.translate(Math.round(p.x), Math.round(p.y));
  g.globalCompositeOperation = 'lighter';
  // One bloom source per bell, so a four-engine ship glows like one.
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : -spread + (i * spread * 2) / (n - 1);
    g.fillStyle = COL.cool;
    g.fillRect(-p.facing * (-m.tail + 6) - 3, y - 3, 6, 6);
    g.fillStyle = COL.coolHi;
    g.fillRect(-p.facing * (-m.tail + 4) - 2, y - 2, 4, 4);
  }
  g.restore();
}

// ----------------------------------------------------------------- entities

function drawShip(ctx, p, seqTilt, game) {
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
  ctx.rotate((seqTilt ?? clamp(p.vy / 230, -1, 1) * 0.26) * (sx < 0 ? -1 : 1));
  ctx.scale(sx, 1);

  if (p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0) ctx.globalAlpha = 0.4;
  drawShipBody(ctx, p, game);
  ctx.restore();
}

function drawInterceptors(ctx, game) {
  for (let i = 0; i < interceptors.count; i++) {
    const e = interceptors.items[i];
    ctx.save();
    ctx.translate(Math.round(e.x), Math.round(e.y));
    ctx.scale(e.dirX, 1);
    drawInterceptorBody(ctx, e, e.t || (game.time + i));
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
    if (tw.seek) {
      // a launcher rack: four tubes, so it is obvious at a glance that this
      // one does not fire bullets
      ctx.fillStyle = '#596372';
      ctx.fillRect(-8, d === 1 ? 0 : -8, 16, 8);
      ctx.fillStyle = '#20262e';
      for (let k = 0; k < 4; k++) ctx.fillRect(-7 + k * 4, d === 1 ? 2 : -6, 3, 4);
      ctx.fillStyle = tw.colour;
      ctx.fillRect(-8, d === 1 ? 0 : -1, 16, 1);
      ctx.fillRect(-7 + (t.burstLeft > 0 ? 0 : 8), d === 1 ? 3 : -5, 3, 2);
    } else {
      ctx.fillStyle = '#596372';
      ctx.beginPath();
      ctx.arc(0, d * 1, tw.aura ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tw.colour || COL.danger;
      ctx.fillRect(-1, d * 1 - 1, 2, 2);
    }

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

function drawTreasure(ctx, p, x, y, c) {
  const bob = Math.sin(p.t * 3) * 1.5;
  ctx.save();
  ctx.translate(x, y + bob);

  // halo, so it is visible against busy plating from a long way off
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.13 + 0.07 * Math.sin(p.t * 4);
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  ctx.strokeStyle = '#0a0d13';
  ctx.lineWidth = 2;
  ctx.fillStyle = c;

  if (p.kind === 'gem') {
    // a cut stone: crown facets above a pavilion
    const w = 3 + Math.abs(Math.cos(p.t * 2.2)) * 4;    // turns slowly
    ctx.beginPath();
    ctx.moveTo(0, 8); ctx.lineTo(-w, -1); ctx.lineTo(-w * 0.55, -6);
    ctx.lineTo(w * 0.55, -6); ctx.lineTo(w, -1);
    ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(0, 8); ctx.lineTo(-w * 0.3, -1); ctx.lineTo(w * 0.3, -1);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (p.kind === 'idol') {
    // a squat alien figure: broad head, three eyes, folded arms
    ctx.beginPath();
    ctx.moveTo(-5, 8); ctx.lineTo(-4, -1); ctx.lineTo(-6, -4);
    ctx.lineTo(0, -8); ctx.lineTo(6, -4); ctx.lineTo(4, -1); ctx.lineTo(5, 8);
    ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#1a0f28';
    for (let k = -1; k <= 1; k++) ctx.fillRect(k * 3 - 1, -5, 2, 2);
    ctx.fillRect(-3, 1, 6, 1);
  } else if (p.kind === 'crown') {
    // five points on a jewelled band
    ctx.beginPath();
    ctx.moveTo(-7, 6); ctx.lineTo(-7, -2); ctx.lineTo(-4, 1); ctx.lineTo(-2, -6);
    ctx.lineTo(0, 1); ctx.lineTo(2, -6); ctx.lineTo(4, 1); ctx.lineTo(7, -2);
    ctx.lineTo(7, 6);
    ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#e8434f';
    ctx.fillRect(-1, 3, 2, 2);
    ctx.fillStyle = '#4fd0e8';
    ctx.fillRect(-5, 3, 2, 2); ctx.fillRect(3, 3, 2, 2);
  } else {
    // reliquary: a sealed alien casket with something lit inside it
    ctx.beginPath();
    ctx.moveTo(-6, -3); ctx.lineTo(0, -9); ctx.lineTo(6, -3);
    ctx.lineTo(6, 7); ctx.lineTo(-6, 7);
    ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#19061a';
    ctx.fillRect(-4, -2, 8, 7);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#fff0ff';
    ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(p.t * 5));
    ctx.beginPath(); ctx.arc(0, 1.5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // The glint: a star of light crossing the piece itself. It used to orbit
  // out at nine pixels, which at this size read as a separate "+" floating
  // next to the treasure rather than as light on it.
  const ga = p.t * 2.1;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.5 + 0.4 * Math.sin(p.t * 6);
  const gx = Math.round(Math.cos(ga) * 3);
  const gy = Math.round(Math.sin(ga) * 2) - 2;
  ctx.fillRect(gx - 4, gy, 9, 1);
  ctx.fillRect(gx, gy - 4, 1, 9);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// An enemy missile is drawn as a missile, nose-on to its heading, with a
// flaring exhaust — it has to read as a thing that can be shot down rather
// than as a bullet that happens to curve.
function drawMissile(ctx, s) {
  const a = Math.atan2(s.vy, s.vx);
  ctx.save();
  ctx.translate(Math.round(s.x), Math.round(s.y));
  ctx.rotate(a);
  const flare = 5 + Math.random() * 6;
  ctx.fillStyle = '#ff9a3a';
  ctx.fillRect(-5 - flare, -1.5, flare, 3);
  ctx.fillStyle = '#ffd24a';
  ctx.fillRect(-5 - flare * 0.5, -1, flare * 0.5, 2);
  ctx.fillStyle = '#ff5fa8';
  ctx.beginPath();
  ctx.moveTo(7, 0); ctx.lineTo(-2, -3.5); ctx.lineTo(-5, -2);
  ctx.lineTo(-5, 2); ctx.lineTo(-2, 3.5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd0e8';
  ctx.fillRect(0, -1, 5, 2);
  ctx.restore();
}

// A deflector bubble. Drawn as a faceted shell that thins and reddens as
// it is worn down, because an attacker that eats shots for no visible
// reason reads as a bug rather than as a thing to shoot harder.
function drawDeflector(ctx, f, spec) {
  const k = f.shield / f.shieldMax;
  const r = spec.r + FOE_SHIELD.r;
  const hit = f.shieldFlash > 0;
  const colour = hit ? '#ffffff' : k > 0.6 ? '#4fd0e8' : k > 0.3 ? '#ffd24a' : '#ff7a2f';

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = (hit ? 0.5 : 0.13 + 0.07 * Math.sin(f.t * 5)) * (0.45 + k * 0.55);
  ctx.fillStyle = colour;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // the shell itself: six facets, turning, brighter where it is still whole
  ctx.globalAlpha = hit ? 1 : 0.45 + k * 0.45;
  ctx.strokeStyle = colour;
  ctx.lineWidth = hit ? 2.5 : 1.5;
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2 + f.t * 0.7;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // the remaining strength, as an arc off the top
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r + 3, -Math.PI / 2 - Math.PI * k, -Math.PI / 2 + Math.PI * k);
  ctx.stroke();
  ctx.restore();
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

    // Treasure is not cargo in a crate. It gets its own silhouette, a halo
    // and a turning glint, because the whole point of it is that you see it
    // across the hull and decide to go.
    if (isTreasure(p.kind)) { drawTreasure(ctx, p, x, y, c); continue; }

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
      case 'goldbar': {  // an ingot, drawn with a little perspective
        ctx.fillStyle = '#8a6a1e';
        ctx.beginPath();
        ctx.moveTo(-6, 2); ctx.lineTo(6, 2); ctx.lineTo(4, 5); ctx.lineTo(-4, 5);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(-5, -3); ctx.lineTo(5, -3); ctx.lineTo(6, 2); ctx.lineTo(-6, 2);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff3c4';
        ctx.fillRect(-4, -2, 8, 1);
        break;
      }
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
  ctx.save();
  ctx.translate(Math.round(b.x), Math.round(b.y));
  // coming apart: flicker and sink
  if (b.dead) ctx.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(b.death * 22));
  drawBossBody(ctx, b);
  drawBossParts(ctx, b);
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
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y));
    if (f.shield > 0) drawDeflector(ctx, f, spec);
    // Mines, orbiters and leeches have no front: they are drawn in their
    // own rotation. Everything else is a ship and faces where it is going.
    if (f.kind !== 'mine' && f.kind !== 'orbiter' && f.kind !== 'leech') {
      ctx.scale(f.facing, 1);
    }
    drawFoeBody(ctx, f, spec, f.flash > 0);
    ctx.restore();

    // A lancer's telegraph is a line on the hull, not on the ship, so it
    // is drawn outside the ship's own transform.
    if (f.kind === 'lancer' && f.state !== 1) {
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(f.t * 14);
      ctx.fillStyle = '#e8434f';
      const len = Math.min(170, f.t * 70);
      ctx.fillRect(Math.round(f.x) + f.facing * 16, Math.round(f.y) - 0.5,
        f.facing * len, 1);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
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
    if (s.seek > 0) { drawMissile(ctx, s); continue; }
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
