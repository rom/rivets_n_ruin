import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCamera, updateCamera, kick } from '../src/camera.js';
import { VIEW_W } from '../src/config.js';

const LEN = 12000;
const settle = (cam, player, steps = 400) => {
  for (let i = 0; i < steps; i++) updateCamera(cam, player, LEN, 1 / 120);
};

test('camera stays finite with a sane dt', () => {
  const cam = makeCamera();
  settle(cam, { x: 4000, facing: 1 });
  assert.ok(Number.isFinite(cam.x), `cam.x went ${cam.x}`);
});

// This is the bug that shipped: a wrong argument made dt undefined and the
// camera became NaN, which drew a black screen while every other signal
// looked healthy.
test('an undefined dt does not poison the camera', () => {
  const cam = makeCamera();
  updateCamera(cam, { x: 4000, facing: 1 }, LEN, undefined);
  assert.ok(Number.isFinite(cam.x), 'cam.x became NaN from a bad dt');
});

test('camera never leaves the hull', () => {
  const cam = makeCamera();
  settle(cam, { x: -500, facing: -1 });
  assert.ok(cam.x >= 0, `cam.x = ${cam.x}`);
  settle(cam, { x: LEN + 5000, facing: 1 });
  assert.ok(cam.x <= LEN - VIEW_W, `cam.x = ${cam.x}`);
});

test('camera leads the direction of travel', () => {
  const right = makeCamera();
  const left = makeCamera();
  settle(right, { x: 5000, facing: 1 });
  settle(left, { x: 5000, facing: -1 });
  assert.ok(right.x > left.x, 'facing right should show more of what is ahead');
});

test('camera follows the ship', () => {
  const cam = makeCamera();
  settle(cam, { x: 2000, facing: 1 });
  const near = cam.x;
  settle(cam, { x: 8000, facing: 1 });
  assert.ok(cam.x > near + 3000, 'camera did not follow');
});

test('a locked camera pins to the given x', () => {
  const cam = makeCamera();
  for (let i = 0; i < 600; i++) updateCamera(cam, { x: 0, facing: 1 }, LEN, 1 / 120, 9000);
  assert.ok(Math.abs(cam.x - 9000) < 1, `locked camera sat at ${cam.x}`);
});

test('shake decays to zero', () => {
  const cam = makeCamera();
  kick(cam, 10);
  assert.ok(cam.shake > 0);
  settle(cam, { x: 1000, facing: 1 });
  assert.equal(cam.shake, 0);
});

test('shake is bounded however hard it is kicked', () => {
  const cam = makeCamera();
  for (let i = 0; i < 50; i++) kick(cam, 100);
  assert.ok(cam.shake <= 14, `shake reached ${cam.shake}`);
});
