// The armory: bombs, grenades and homing missiles.
//
// The cannon is a line. Each of these answers a situation a line handles
// badly — something that got behind you, something behind cover, something
// you cannot line up on — so carrying them is a decision rather than a
// strict upgrade. All three are finite and all three are lost with a ship.

import {
  ARMORY, FIELD_TOP, FIELD_BOT, VIEW_W, clamp,
} from './config.js';
import { makePool } from './pool.js';
import { obstaclesNear } from './level.js';
import { explode, sparks, addLight } from './particles.js';
import { kick } from './camera.js';
import { sfxExplode, sfxTurretShot } from './sfx.js';

export const ordnance = makePool(60, () => ({
  kind: 'bomb', x: 0, y: 0, vx: 0, vy: 0, t: 0, fuse: 0, dead: false, target: null, facing: 1,
}));

export const resetOrdnance = () => ordnance.clear();

// Fires the player's selected ordnance. Returns true if something launched.
export function fireSecondary(game) {
  const p = game.player;
  const kind = p.secondary;
  const spec = ARMORY[kind];
  if (!spec || p.secondaryCd > 0) return false;
  if (!p.ammo[kind]) return false;

  const o = ordnance.spawn();
  if (!o) return false;

  p.ammo[kind]--;
  p.secondaryCd = spec.cooldown * (p.reloadMul || 1);
  o.kind = kind;
  o.x = p.x;
  o.y = p.y;
  o.t = 0;
  o.dead = false;
  o.facing = p.facing;
  o.target = null;

  if (kind === 'bomb') {
    // inherits your momentum and then settles: it lands where you were
    o.vx = p.vx * 0.5;
    o.vy = p.vy * 0.5;
    o.fuse = spec.fuse;
  } else if (kind === 'grenade') {
    o.vx = p.facing * spec.speed + p.vx * 0.3;
    o.vy = -110;
    o.fuse = spec.fuse;
  } else {
    o.vx = p.facing * spec.speed;
    o.vy = (Math.random() - 0.5) * 90;
    o.fuse = spec.life;
  }
  sfxTurretShot();
  return true;
}

function blast(game, o, spec) {
  explode(o.x, o.y, spec.blastR / 52);
  addLight(o.x, o.y, spec.blastR * 1.3, 0.3, spec.colour);
  sfxExplode(spec.blastR / 60);
  kick(game.cam, spec.blastR / 9);
  game.pendingBlast = game.pendingBlast || [];
  game.pendingBlast.push({ x: o.x, y: o.y, r: spec.blastR, dmg: spec.damage });
}

export function updateOrdnance(game, dt) {
  for (let i = ordnance.count - 1; i >= 0; i--) {
    const o = ordnance.items[i];
    const spec = ARMORY[o.kind];
    o.t += dt;
    o.fuse -= dt;

    if (o.kind === 'bomb') {
      const d = Math.exp(-spec.drag * dt);
      o.vx *= d; o.vy *= d;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
    } else if (o.kind === 'grenade') {
      o.vy += spec.gravity * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      // bounces off the rim girders and off hull structure
      if (o.y > FIELD_BOT - 4) { o.y = FIELD_BOT - 4; o.vy = -Math.abs(o.vy) * spec.bounce; }
      if (o.y < FIELD_TOP + 4) { o.y = FIELD_TOP + 4; o.vy = Math.abs(o.vy) * spec.bounce; }
      for (const b of obstaclesNear(game.level, o.x, o.x)) {
        if (o.x > b.x && o.x < b.x + b.w && o.y > b.y && o.y < b.y + b.h) {
          // push out of the block the short way and reflect
          const up = Math.abs(o.y - b.y);
          const down = Math.abs(b.y + b.h - o.y);
          if (up < down) { o.y = b.y - 4; o.vy = -Math.abs(o.vy) * spec.bounce; }
          else { o.y = b.y + b.h + 4; o.vy = Math.abs(o.vy) * spec.bounce; }
          o.vx *= 0.7;
        }
      }
    } else {
      // missile: find something, then steer at it
      if (!o.target || o.target.dead || o.target.hp <= 0) o.target = acquire(game, o, spec);
      let want = Math.atan2(o.vy, o.vx);
      if (o.target) {
        want = Math.atan2(o.target.y - o.y, o.target.x - o.x);
      }
      const cur = Math.atan2(o.vy, o.vx);
      let d = want - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const a = cur + clamp(d, -spec.turn * dt, spec.turn * dt);
      const sp = Math.min(spec.maxSpeed, Math.hypot(o.vx, o.vy) + spec.accel * dt);
      o.vx = Math.cos(a) * sp;
      o.vy = Math.sin(a) * sp;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (Math.random() < dt * 40) {
        sparks(o.x - Math.cos(a) * 8, o.y - Math.sin(a) * 8, -Math.cos(a), -Math.sin(a), 1, '#ffd24a');
      }
      // detonate on contact
      if (o.target && Math.hypot(o.target.x - o.x, o.target.y - o.y) < 16) o.fuse = 0;
    }

    o.y = clamp(o.y, FIELD_TOP + 3, FIELD_BOT - 3);

    const offscreen = o.x < game.cam.x - 200 || o.x > game.cam.x + VIEW_W + 200;
    if (o.fuse <= 0 || offscreen) {
      if (!offscreen) blast(game, o, spec);
      ordnance.kill(i);
    }
  }
}

// Nearest valid target in front of the missile.
function acquire(game, o, spec) {
  let best = null;
  let bestD = spec.seekRange;
  const consider = (e) => {
    const d = Math.hypot(e.x - o.x, e.y - o.y);
    if (d < bestD) { bestD = d; best = e; }
  };
  for (let i = 0; i < game._seekable.length; i++) consider(game._seekable[i]);
  return best;
}

export function drawOrdnance(ctx) {
  for (let i = 0; i < ordnance.count; i++) {
    const o = ordnance.items[i];
    const spec = ARMORY[o.kind];
    const x = Math.round(o.x);
    const y = Math.round(o.y);
    ctx.save();
    ctx.translate(x, y);

    if (o.kind === 'bomb') {
      const arm = o.fuse < 0.25 && Math.floor(o.t * 18) % 2 === 0;
      ctx.fillStyle = arm ? '#ffe8c0' : '#2b2320';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = spec.colour; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = spec.colour;
      ctx.fillRect(-1, -10, 2, 4);
    } else if (o.kind === 'grenade') {
      ctx.rotate(o.t * 9);
      ctx.fillStyle = '#2f3a24';
      ctx.fillRect(-5, -4, 10, 8);
      ctx.fillStyle = spec.colour;
      ctx.fillRect(-5, -4, 10, 2);
      ctx.fillRect(-5, 2, 10, 2);
    } else {
      ctx.rotate(Math.atan2(o.vy, o.vx));
      ctx.fillStyle = '#b9c6d2';
      ctx.fillRect(-7, -2, 12, 4);
      ctx.fillStyle = spec.colour;
      ctx.fillRect(4, -2, 4, 4);
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(-10, -1.5, 4, 3);
    }
    ctx.restore();
  }
}
