// Laser gates.
//
// A wall of light across the hull that cannot be flown through, lit by an
// emitter clamped to the girder above or below it. The emitter is the only
// way past: shoot it out and the beam dies with it.
//
// This is the one obstacle in the game that is not about reflexes. Every
// other threat is dodged; this one has to be answered, and answering it
// costs you the seconds you spend lined up on the emitter with everything
// else on the hull still shooting at you.
//
// Shots pass through the beam on purpose. The emitter sits at one end of
// the very wall that guards it, so if the beam stopped bullets there would
// be no way to open it at all.

import {
  FIELD_TOP, FIELD_BOT, LASER, APRON, VIEW_W, clamp,
} from './config.js';
import { sparks, explode, addLight } from './particles.js';
import { kick } from './camera.js';
import { sfxExplode, sfxEnemyHit, sfxScrape } from './sfx.js';
import { spoils } from './pickups.js';
import { award } from './score.js';
import { diff } from './score.js';

// Deterministic from the hull's own rng, so a hull always has the same
// gates in the same places.
export function buildGates(r, spec, length, obstacles) {
  const n = spec.lasers || 0;
  if (!n) return [];
  const first = APRON * 1.6;
  const last = length - VIEW_W - APRON * 0.6;
  const span = last - first;
  const gates = [];

  // Minimum separation. Two gates a hundred pixels apart are one gate with
  // a bug in it, which is what the nudge below used to produce when it
  // walked a gate most of the way into its neighbour's slot.
  const MIN_GAP = 900;
  const slot = span / n;

  for (let i = 0; i < n; i++) {
    // Evenly spread, then jittered inside its own slot, so they are not
    // metronomic and cannot wander into each other.
    const centre = first + slot * (i + 0.5);
    const lo = Math.max(first, centre - slot * 0.35,
      gates.length ? gates[gates.length - 1].x + MIN_GAP : first);
    const hi = Math.min(last, centre + slot * 0.35);
    if (hi <= lo) continue;
    let x = Math.round(lo + (hi - lo) * r());
    // Nudge off any block: a beam inside solid hull cannot be seen, and an
    // emitter inside one cannot be shot. Bounded to this gate's own window,
    // and wrapped, so it can never arrive on top of the next one.
    for (let tries = 0; tries < 48; tries++) {
      const blocked = obstacles.some((o) => x > o.x - 30 && x < o.x + o.w + 30);
      if (!blocked) break;
      x += 46;
      if (x > hi) x = Math.round(lo);
    }
    if (x <= first || x >= last) continue;
    const top = r() < 0.5;
    gates.push({
      x,
      dir: top ? 1 : -1,                       // 1: clamped to the upper girder
      y: top ? FIELD_TOP : FIELD_BOT,
      hp: LASER.hp + Math.round(LASER.hpPerLevel * (spec.laserHp || 0)),
      maxHp: LASER.hp + Math.round(LASER.hpPerLevel * (spec.laserHp || 0)),
      dead: false,
      flash: 0,
      t: r() * 6,                              // so they do not pulse in step
    });
  }
  return gates;
}

export const liveGates = (level) =>
  (level.gates || []).filter((g) => !g.dead);

// The emitter's hit box, which is the part of it that sticks into the lane.
export function gateHit(g, x, y) {
  const cy = g.y + g.dir * (LASER.emitterH / 2);
  return Math.abs(x - g.x) < LASER.emitterW / 2 + 2
    && Math.abs(y - cy) < LASER.emitterH / 2 + 3;
}

export function hitGate(game, g, dmg) {
  if (g.dead) return false;
  g.hp -= dmg;
  g.flash = 0.08;
  if (g.hp > 0) {
    sfxEnemyHit();
    return true;
  }
  g.dead = true;
  const cy = g.y + g.dir * (LASER.emitterH / 2);
  explode(g.x, cy, 2.0, '#ffd0d4', LASER.colour);
  addLight(g.x, cy, 140, 0.4, LASER.colour);
  // the beam collapses in a line of sparks down the column it held
  for (let k = 0; k <= 10; k++) {
    sparks(g.x, FIELD_TOP + ((FIELD_BOT - FIELD_TOP) * k) / 10, 0, 0, 4, LASER.colour);
  }
  sfxExplode(1.6);
  kick(game.cam, 8);
  award(game, LASER.score);
  spoils(game, g.x, cy, 'turret');
  return true;
}

export function updateGates(game, dt) {
  const level = game.level;
  if (!level.gates || !level.gates.length) return;
  const p = game.player;
  const hw = LASER.shipClear;

  for (const g of level.gates) {
    g.t += dt;
    if (g.flash > 0) g.flash -= dt;
    if (g.dead || !p.alive) continue;
    if (Math.abs(g.x - p.x) > 300) continue;

    // A wall, not a hazard: the ship is stopped rather than allowed through
    // at the cost of shield. Letting it be tanked would make the emitter
    // optional, and then the gate is just a damage tile.
    const side = p.x < g.x ? -1 : 1;
    const edge = g.x + side * hw;
    const crossed = side < 0 ? p.x > edge : p.x < edge;
    if (!crossed) continue;

    p.x = edge;
    if (side < 0 ? p.vx > 0 : p.vx < 0) p.vx = -p.vx * 0.35;

    if (p.invuln <= 0 && g.burnCd === undefined) g.burnCd = 0;
    g.burnCd = (g.burnCd || 0) - dt;
    if (p.invuln <= 0 && g.burnCd <= 0) {
      g.burnCd = LASER.burnEvery;
      p.shield -= LASER.burn * diff().enemyDmg;
      game.flash = Math.max(game.flash, 0.35);
      kick(game.cam, 4);
      sparks(edge, p.y, -side, 0, 7, LASER.colour);
      sfxScrape(260);
    }
  }
}

export function drawGates(ctx, game, camX) {
  const level = game.level;
  if (!level.gates) return;
  for (const g of level.gates) {
    if (g.x < camX - 40 || g.x > camX + VIEW_W + 40) continue;
    const x = Math.round(g.x);
    const cy = g.y + g.dir * (LASER.emitterH / 2);

    if (!g.dead) {
      // the beam: a hot core inside a wider glow, flickering on its own clock
      const flick = 0.82 + 0.18 * Math.sin(g.t * 23);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.20 * flick;
      ctx.fillStyle = LASER.colour;
      ctx.fillRect(x - 9, FIELD_TOP, 18, FIELD_BOT - FIELD_TOP);
      ctx.globalAlpha = 0.5 * flick;
      ctx.fillRect(x - 4, FIELD_TOP, 8, FIELD_BOT - FIELD_TOP);
      ctx.globalAlpha = flick;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 1, FIELD_TOP, 2, FIELD_BOT - FIELD_TOP);
      // charge running along the beam, away from the emitter
      ctx.fillStyle = LASER.colour;
      for (let k = 0; k < 7; k++) {
        const phase = (g.t * 160 + k * 46) % (FIELD_BOT - FIELD_TOP);
        const by = g.dir === 1 ? FIELD_TOP + phase : FIELD_BOT - phase;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x - 3, by, 6, 7);
      }
      ctx.restore();
    }

    // the emitter, clamped to the girder
    ctx.save();
    ctx.translate(x, g.y);
    ctx.scale(1, g.dir);
    const hurt = g.dead ? 1 : 1 - g.hp / g.maxHp;
    ctx.fillStyle = '#10141b';
    ctx.fillRect(-LASER.emitterW / 2 - 2, -2, LASER.emitterW + 4, LASER.emitterH + 4);
    ctx.fillStyle = g.dead ? '#2a3038' : g.flash > 0 ? '#ffd24a' : '#454f5e';
    ctx.fillRect(-LASER.emitterW / 2, 0, LASER.emitterW, LASER.emitterH);
    ctx.fillStyle = g.dead ? '#20262e' : '#5f6b7c';
    ctx.fillRect(-LASER.emitterW / 2 + 2, 2, LASER.emitterW - 4, 3);
    // the aperture
    ctx.fillStyle = g.dead ? '#3a2226'
      : hurt > 0.6 ? '#ffd24a' : LASER.colour;
    ctx.fillRect(-4, LASER.emitterH - 4, 8, 4);
    if (!g.dead) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(g.t * 9);
      ctx.fillStyle = LASER.colour;
      ctx.beginPath(); ctx.arc(0, LASER.emitterH, 10, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // bolts, so it reads as clamped on rather than painted on
      ctx.fillStyle = '#8e9aa9';
      ctx.fillRect(-LASER.emitterW / 2 + 1, 1, 2, 2);
      ctx.fillRect(LASER.emitterW / 2 - 3, 1, 2, 2);
      // health, as a short bar on the girder beside it
      const w = LASER.emitterW;
      ctx.fillStyle = '#10141b';
      ctx.fillRect(-w / 2 - 1, -7, w + 2, 4);
      ctx.fillStyle = hurt > 0.6 ? '#e8434f' : LASER.colour;
      ctx.fillRect(-w / 2, -6, Math.round(w * clamp(g.hp / g.maxHp, 0, 1)), 2);
    } else {
      // a dead emitter stays on the hull, dark and smoking
      ctx.fillStyle = '#1a1014';
      ctx.fillRect(-LASER.emitterW / 2 + 3, 3, LASER.emitterW - 6, LASER.emitterH - 6);
    }
    ctx.restore();
  }
}
