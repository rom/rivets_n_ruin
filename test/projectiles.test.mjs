import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { playerShots, enemyShots, fire, advance } from '../src/projectiles.js';
import { TOWERS } from '../src/config.js';

test.beforeEach(() => { playerShots.clear(); enemyShots.clear(); });

test('a plain shot flies straight and expires', () => {
  const s = fire(playerShots, 0, 0, 100, 0, 0.5, 1, 2);
  assert.equal(s.seek, 0);
  assert.equal(s.hp, 0);
  advance(playerShots, 0.25);
  assert.ok(Math.abs(s.x - 25) < 1e-6, `drifted to ${s.x}`);
  assert.equal(s.y, 0);
  advance(playerShots, 0.3);
  assert.equal(playerShots.count, 0, 'it outlived its life');
});

test('a homing shot turns toward the target at its stated rate', () => {
  // launched straight up, target to the right: it must turn clockwise
  const s = fire(enemyShots, 0, 0, 0, -100, 9, 1, 2, { seek: 1, hp: 1 });
  advance(enemyShots, 0.5, { x: 1000, y: 0 });
  const turned = Math.abs(Math.atan2(s.vy, s.vx) - (-Math.PI / 2));
  assert.ok(Math.abs(turned - 0.5) < 1e-6, `turned ${turned} rad in 0.5s at 1 rad/s`);
});

test('homing never changes a missile into a faster missile', () => {
  const s = fire(enemyShots, 0, 0, 0, -140, 9, 1, 2, { seek: 3 });
  for (let i = 0; i < 240; i++) advance(enemyShots, 1 / 120, { x: 400, y: 400 });
  assert.ok(Math.abs(Math.hypot(s.vx, s.vy) - 140) < 1e-6,
    `speed drifted to ${Math.hypot(s.vx, s.vy)}`);
});

test('a homing shot with no target flies straight', () => {
  const s = fire(enemyShots, 0, 0, 100, 0, 9, 1, 2, { seek: 5 });
  advance(enemyShots, 0.5, null);
  assert.equal(s.vy, 0);
  assert.ok(Math.abs(s.x - 50) < 1e-6);
});

// The whole counterplay to a weapon that follows you.
test('a missile is destructible and a bullet is not', () => {
  const m = fire(enemyShots, 0, 0, -100, 0, 9, 14, 3, { seek: 1.45, hp: 2 });
  assert.equal(m.hp, 2);
  const b = fire(enemyShots, 0, 0, -100, 0, 9, 9, 2);
  assert.equal(b.hp, 0, 'an ordinary bullet must not be shootable');
});

test('a reused pool slot does not inherit the last shot\'s homing', () => {
  fire(enemyShots, 0, 0, 0, -100, 9, 1, 2, { seek: 3, hp: 2 });
  enemyShots.clear();
  const s = fire(enemyShots, 0, 0, 100, 0, 9, 1, 2);
  assert.equal(s.seek, 0, 'the slot kept its old seek and the bullet now homes');
  assert.equal(s.hp, 0, 'the slot kept its old hp and the bullet is now shootable');
});

test('the rocket tower is configured to launch something that can be answered', () => {
  const t = TOWERS.rocket;
  assert.ok(t, 'there is no rocket tower');
  assert.ok(t.seek > 0.5 && t.seek < 3,
    `a turn rate of ${t.seek} rad/s is either dodgeable by standing still or impossible`);
  assert.ok(t.seekHp >= 1, 'a missile that cannot be shot down has no answer');
  assert.ok(t.seekLife > 2 && t.seekLife < 8, 'fuel load is out of range');
  assert.ok(t.cooldownMul > 1.5, 'a launcher firing as often as a gun is not a launcher');
  assert.ok(/^#[0-9a-f]{6}$/i.test(t.colour));
});
