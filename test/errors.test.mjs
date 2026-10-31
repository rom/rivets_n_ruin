import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  report, flush, redact, errorState, resetErrorReporting, installErrorReporting,
} from '../src/errors.js';
import { startLoop } from '../src/loop.js';

// The reporter exists because the frame loop swallows exceptions: a draw
// path that throws sixty times a second presents as a frozen picture with
// a healthy score, a moving camera and a plausible frame rate. Three
// things therefore have to hold, and each is tested here.
//
//   1. Reporting cannot affect the game.
//   2. One fault cannot become a thousand reports.
//   3. The auth token cannot leave in one.

test.beforeEach(() => resetErrorReporting());

function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  const done = () => { globalThis.fetch = real; };
  const out = fn();
  return out && typeof out.then === 'function' ? out.finally(done) : (done(), out);
}

const ok = () => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });

// --- 3. nothing sensitive leaves

test('a token never leaves in a report', () => {
  const token = 'tok_ABCdef123456789_SECRET';
  const shapes = [
    `Failed to fetch: Authorization: Bearer ${token}`,
    `{"token":"${token}"}`,
    `token=${token}`,
    `GET /api/me?token=${token}&x=1`,
    `password: ${token}`,
    `secret = "${token}"`,
    `sig=${token}&points=10`,
  ];
  for (const s of shapes) {
    const out = redact(s);
    assert.ok(!out.includes(token), `the token survived redaction of: ${s}\n  -> ${out}`);
    assert.match(out, /redacted/, `nothing was marked as redacted in: ${s}`);
  }
});

test('redaction runs on the message and the stack, not just one of them', () => {
  const err = new Error('failed with Bearer tok_SECRET_VALUE');
  err.stack = 'Error: failed\n  at call (/src/net.js:1:1) token=tok_SECRET_VALUE';
  const entry = report('test', err);
  assert.ok(!entry.message.includes('tok_SECRET_VALUE'), 'the message leaked it');
  assert.ok(!entry.stack.includes('tok_SECRET_VALUE'), 'the stack leaked it');
});

test('redaction survives anything that is not a string', () => {
  for (const v of [null, undefined, 42, {}, [], true]) {
    assert.equal(redact(v), '');
  }
});

// --- 2. one fault is not a thousand reports

test('the same fault repeating is counted, not resent', () => {
  for (let i = 0; i < 500; i++) {
    const err = new Error('the renderer is unhappy');
    err.stack = 'Error: the renderer is unhappy\n  at drawWorld (/src/render.js:120:9)';
    report('frame', err);
  }
  const S = errorState();
  assert.equal(S.queue.length, 1, `queued ${S.queue.length} reports for one repeating fault`);
  assert.equal(S.queue[0].count, 500, 'the repeats were not counted');
});

// A message that interpolates a changing value would otherwise be a brand
// new fault every frame and blow the session cap in a second.
test('a fault whose message carries changing numbers is still one fault', () => {
  for (let i = 0; i < 100; i++) {
    const err = new Error(`foe ${i} is at ${i * 1.5}, which is not finite`);
    err.stack = 'Error\n  at updateFoes (/src/foes.js:88:3)';
    report('frame', err);
  }
  assert.equal(errorState().queue.length, 1,
    'a changing number in the message made each frame a separate fault');
});

test('the session has a hard cap, and says how many it dropped', () => {
  for (let i = 0; i < 500; i++) {
    const err = new Error('distinct fault');
    err.stack = `Error\n  at site${i} (/src/x.js:${i}:1)`;
    report('frame', err);
  }
  const S = errorState();
  assert.ok(S.queue.length <= 40, `queued ${S.queue.length}, over the cap`);
  assert.ok(S.dropped > 0, 'nothing was recorded as dropped despite hitting the cap');
});

// --- 1. reporting cannot affect the game

test('reporting never throws, whatever it is handed', async () => {
  const nasty = [
    undefined, null, 0, '', 'a string', { a: 1 }, [1, 2],
    new Error('ordinary'), Symbol('sym'), () => {},
  ];
  // An object that cannot be stringified at all.
  const circular = {};
  circular.self = circular;
  nasty.push(circular);
  const thrower = { get message() { throw new Error('even reading me throws'); } };
  nasty.push(thrower);

  for (const v of nasty) {
    assert.doesNotThrow(() => report('odd', v), `report() threw on ${String(v)}`);
  }
});

// The guard above only exercises inputs that describe() already handles.
// This one breaks the reporter's own internals, which is what the outer
// catch is actually for: whatever goes wrong in here, the caller is a
// catch block in the frame loop and must not be handed a second error.
test('reporting survives its own internals being broken', () => {
  const S = errorState();
  const realSeen = S.seen;
  S.seen = { get() { throw new Error('the map is gone'); },
    set() { throw new Error('this too'); }, get size() { return 0; } };
  try {
    assert.doesNotThrow(() => report('frame', new Error('something')),
      'a broken reporter threw back into the frame loop');
  } finally {
    S.seen = realSeen;
  }
});

test('a context callback that throws does not stop the report', () => {
  resetErrorReporting();
  errorState().context = () => { throw new Error('the game is too broken to say where it is'); };
  const entry = report('frame', new Error('something'));
  assert.ok(entry, 'a broken context callback lost the report entirely');
  errorState().context = () => ({});
});

test('a backend that is down is not an error the player ever sees', async () => {
  report('frame', new Error('something'));
  const sent = await withFetch(() => Promise.reject(new Error('offline')), () => flush());
  assert.equal(sent, false);
  // ...and it does not retry forever: the queue is drained either way.
  assert.equal(errorState().queue.length, 0, 'failed reports are being retried indefinitely');
});

test('a backend that answers gets the batch', async () => {
  let body = null;
  report('frame', new Error('one'));
  const err2 = new Error('two');
  err2.stack = 'Error\n  at elsewhere (/src/y.js:1:1)';
  report('window', err2);

  const sent = await withFetch((url, opts) => { body = JSON.parse(opts.body); return ok(); },
    () => flush());
  assert.equal(sent, true);
  assert.equal(body.errors.length, 2);
  for (const e of body.errors) {
    assert.ok(e.kind && e.message, 'a report went out with no kind or message');
  }
});

test('flushing nothing sends nothing', async () => {
  let called = false;
  await withFetch(() => { called = true; return ok(); }, () => flush());
  assert.equal(called, false, 'an empty flush still hit the network');
});

// --- the frame loop hands its exceptions over
//
// This is the whole reason the reporter exists, so it is worth asserting
// the wiring and not just the parts.

test('the frame loop reports what it swallows, and keeps running', () => {
  const realRaf = globalThis.requestAnimationFrame;
  const realPerf = globalThis.performance;
  let raf = null;
  let clock = 0;
  globalThis.requestAnimationFrame = (fn) => { raf = fn; };
  globalThis.performance = { now: () => clock };

  const seen = [];
  let updates = 0;
  try {
    startLoop(() => {
      updates++;
      throw new Error('every single frame');
    }, () => {}, null, (err) => seen.push(err));
    for (let i = 0; i < 40; i++) {
      clock += 1000 / 60;
      const fn = raf; raf = null; fn(clock);
    }
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.performance = realPerf;
  }

  assert.ok(updates > 1, 'the loop stopped after the first throw');
  assert.ok(seen.length > 1, `the loop reported ${seen.length} of ${updates} failures`);
  assert.ok(seen[0] instanceof Error);
});

test('a reporter that throws does not kill the frame loop', () => {
  const realRaf = globalThis.requestAnimationFrame;
  const realPerf = globalThis.performance;
  let raf = null;
  let clock = 0;
  globalThis.requestAnimationFrame = (fn) => { raf = fn; };
  globalThis.performance = { now: () => clock };

  let updates = 0;
  try {
    startLoop(() => { updates++; throw new Error('boom'); }, () => {}, null,
      () => { throw new Error('and the reporter is broken too'); });
    for (let i = 0; i < 20; i++) {
      clock += 1000 / 60;
      const fn = raf; raf = null; fn(clock);
    }
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.performance = realPerf;
  }
  assert.ok(updates > 1, 'a broken reporter took the frame loop with it');
});

// --- what a report carries

test('a report says where the game was when it happened', () => {
  resetErrorReporting();
  let state = 'title';
  errorState().context = () => ({ state, hull: 3, build: 'RIVETS' });
  state = 'play';
  const entry = report('frame', new Error('mid-flight'));
  assert.equal(entry.state, 'play', 'the context was captured when the reporter was set up');
  assert.equal(entry.hull, 3);
  errorState().context = () => ({});
});

test('a thrown non-Error is reported as what it was, not as "undefined"', () => {
  const a = report('odd', undefined);
  assert.match(a.message, /non-Error/);
  assert.match(a.message, /undefined/);
  const b = report('odd', { reason: 'a plain object' });
  assert.match(b.message, /a plain object/);
});

test('long messages and stacks are cut before they are sent', () => {
  const err = new Error('x'.repeat(5000));
  err.stack = 'y'.repeat(9000);
  const entry = report('frame', err);
  assert.ok(entry.message.length <= 401, `message is ${entry.message.length} chars`);
  assert.ok(entry.stack.length <= 1201, `stack is ${entry.stack.length} chars`);
});

test('installing twice is a no-op rather than two sets of handlers', () => {
  resetErrorReporting();
  errorState().installed = false;
  assert.equal(installErrorReporting({ context: () => ({}) }), true);
  assert.equal(installErrorReporting({ context: () => ({}) }), false);
});

test('reporting can be turned off entirely', () => {
  resetErrorReporting(false);
  assert.equal(report('frame', new Error('nope')), null);
  assert.equal(errorState().queue.length, 0);
  resetErrorReporting(true);
});
