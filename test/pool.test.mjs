import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePool } from '../src/pool.js';

test('pool hands out up to capacity then refuses', () => {
  const p = makePool(3, () => ({ v: 0 }));
  assert.ok(p.spawn());
  assert.ok(p.spawn());
  assert.ok(p.spawn());
  assert.equal(p.spawn(), null);
  assert.equal(p.count, 3);
});

test('kill is swap-remove and keeps every object reachable', () => {
  const p = makePool(4, () => ({ v: 0 }));
  for (let i = 0; i < 4; i++) p.spawn().v = i;
  p.kill(1);
  assert.equal(p.count, 3);
  const live = new Set();
  for (let i = 0; i < p.count; i++) live.add(p.items[i].v);
  assert.ok(!live.has(1), 'killed item still live');
  assert.equal(live.size, 3);
});

test('downward iteration with kill visits every element exactly once', () => {
  const p = makePool(10, () => ({ v: 0 }));
  for (let i = 0; i < 10; i++) p.spawn().v = i;
  const seen = [];
  for (let i = p.count - 1; i >= 0; i--) {
    seen.push(p.items[i].v);
    if (p.items[i].v % 2 === 0) p.kill(i);
  }
  assert.equal(seen.length, 10);
  assert.equal(new Set(seen).size, 10, 'an element was visited twice or skipped');
  assert.equal(p.count, 5);
});

test('clear resets without discarding the backing objects', () => {
  const p = makePool(3, () => ({ v: 0 }));
  p.spawn(); p.spawn();
  p.clear();
  assert.equal(p.count, 0);
  assert.ok(p.spawn(), 'pool unusable after clear');
});
