import { makePool } from './pool.js';
import { COL } from './config.js';
import { makePool as makePool2 } from './pool.js';

// Dynamic lights. An explosion should illuminate the hull around it, not just
// sit on top of it — this is the cheapest way to make the scene feel lit
// rather than composited.
export const lights = makePool2(40, () => ({ x: 0, y: 0, r: 0, life: 0, maxLife: 1, color: '#ffd24a' }));

export function addLight(x, y, r, life, color) {
  const l = lights.spawn();
  if (!l) return;
  l.x = x; l.y = y; l.r = r; l.life = life; l.maxLife = life; l.color = color;
}

export function updateLights(dt) {
  for (let i = lights.count - 1; i >= 0; i--) {
    const l = lights.items[i];
    l.life -= dt;
    if (l.life <= 0) lights.kill(i);
  }
}

export const particles = makePool(520, () => ({
  x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, color: '#fff', drag: 2,
}));

function emit(x, y, vx, vy, life, size, color, drag = 2.2) {
  const p = particles.spawn();
  if (!p) return;
  p.x = x; p.y = y; p.vx = vx; p.vy = vy;
  p.life = life; p.maxLife = life; p.size = size; p.color = color; p.drag = drag;
}

export function explode(x, y, scale = 1, hot = COL.warmHi, cool = COL.warm) {
  addLight(x, y, 60 * scale + 30, 0.34 * scale, hot);
  const n = Math.round(16 * scale);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = (40 + Math.random() * 190) * scale;
    emit(x, y, Math.cos(a) * s, Math.sin(a) * s,
      0.3 + Math.random() * 0.5 * scale,
      Math.random() < 0.3 ? 3 : 2,
      Math.random() < 0.45 ? hot : cool, 2.6);
  }
  // slower debris chunks
  for (let i = 0; i < Math.round(5 * scale); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 20 + Math.random() * 70;
    emit(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.6 + Math.random() * 0.6, 2, COL.hullHi, 1.1);
  }
}

export function sparks(x, y, dirX, dirY, n = 7, color = COL.warmHi) {
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 1.9;
    const s = 60 + Math.random() * 150;
    emit(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.14 + Math.random() * 0.22, 2, color, 3.4);
  }
}

export function thrust(x, y, dirX, vy) {
  emit(x, y + (Math.random() - 0.5) * 3,
    dirX * (70 + Math.random() * 70), vy * 0.25 + (Math.random() - 0.5) * 24,
    0.1 + Math.random() * 0.14, Math.random() < 0.4 ? 2 : 1,
    Math.random() < 0.5 ? COL.coolHi : COL.cool, 3);
}

export function updateParticles(dt) {
  updateLights(dt);
  for (let i = particles.count - 1; i >= 0; i--) {
    const p = particles.items[i];
    p.life -= dt;
    if (p.life <= 0) { particles.kill(i); continue; }
    const d = Math.exp(-p.drag * dt);
    p.vx *= d; p.vy *= d;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}
