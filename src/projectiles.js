import { makePool } from './pool.js';

const shot = () => ({
  x: 0, y: 0, vx: 0, vy: 0, life: 0, dmg: 1, r: 2,
  // A homing shot steers toward whatever advance() is given as a target, at
  // `seek` radians a second. hp > 0 makes it destructible: the player's
  // cannon can shoot a missile out of the air, which is the only answer to
  // a weapon that follows you.
  seek: 0, hp: 0, t: 0,
});

export const playerShots = makePool(340, shot);
export const enemyShots = makePool(160, shot);

export function fire(pool, x, y, vx, vy, life, dmg, r, opts = null) {
  const s = pool.spawn();
  if (!s) return null;
  s.x = x; s.y = y; s.vx = vx; s.vy = vy;
  s.life = life; s.dmg = dmg; s.r = r;
  s.seek = opts && opts.seek ? opts.seek : 0;
  s.hp = opts && opts.hp ? opts.hp : 0;
  s.t = 0;
  return s;
}

export function advance(pool, dt, target = null) {
  for (let i = pool.count - 1; i >= 0; i--) {
    const s = pool.items[i];
    s.life -= dt;
    if (s.life <= 0) { pool.kill(i); continue; }
    s.t += dt;
    if (s.seek > 0 && target) steer(s, target, dt);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
}

// Turn the velocity toward the target without changing its magnitude: a
// missile that accelerated as it turned would be unavoidable.
function steer(s, target, dt) {
  const speed = Math.hypot(s.vx, s.vy) || 1;
  const want = Math.atan2(target.y - s.y, target.x - s.x);
  const cur = Math.atan2(s.vy, s.vx);
  let d = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const max = s.seek * dt;
  if (d > max) d = max; else if (d < -max) d = -max;
  const a = cur + d;
  s.vx = Math.cos(a) * speed;
  s.vy = Math.sin(a) * speed;
}
