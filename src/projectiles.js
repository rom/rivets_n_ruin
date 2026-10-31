import { makePool } from './pool.js';

const shot = () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, dmg: 1, r: 2 });

export const playerShots = makePool(90, shot);
export const enemyShots = makePool(160, shot);

export function fire(pool, x, y, vx, vy, life, dmg, r) {
  const s = pool.spawn();
  if (!s) return null;
  s.x = x; s.y = y; s.vx = vx; s.vy = vy;
  s.life = life; s.dmg = dmg; s.r = r;
  return s;
}

export function advance(pool, dt) {
  for (let i = pool.count - 1; i >= 0; i--) {
    const s = pool.items[i];
    s.life -= dt;
    if (s.life <= 0) { pool.kill(i); continue; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
}
