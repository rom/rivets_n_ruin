import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hash2, rr, ri, pick } from '../src/rng.js';

test('mulberry32 is deterministic for a seed', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 200; i++) assert.equal(a(), b());
});

test('mulberry32 differs across seeds', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  let same = 0;
  for (let i = 0; i < 100; i++) if (a() === b()) same++;
  assert.ok(same < 3, `seeds produced ${same} identical draws`);
});

test('mulberry32 stays in [0,1)', () => {
  const r = mulberry32(99);
  for (let i = 0; i < 5000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('hash2 is stable and order-dependent', () => {
  assert.equal(hash2(3, 7), hash2(3, 7));
  assert.notEqual(hash2(3, 7), hash2(7, 3));
  for (let x = 0; x < 50; x++) {
    const v = hash2(x, x * 3);
    assert.ok(v >= 0 && v < 1);
  }
});

test('rr and ri respect their bounds', () => {
  const r = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const f = rr(r, 10, 20);
    assert.ok(f >= 10 && f <= 20);
    const n = ri(r, 3, 6);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 6);
  }
});

test('pick returns a member of the array', () => {
  const r = mulberry32(5);
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(pick(r, arr)));
});
