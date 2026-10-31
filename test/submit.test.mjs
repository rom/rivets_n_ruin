import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankLine } from '../src/hud.js';
import { hullsFlown } from '../src/game.js';
import { netState, submitRun, startRun } from '../src/net.js';

// The run that was thrown away.
//
// A player restarted on AURUM, flew that one hull, scored 4,650,367 in
// 256.8s — and it never reached the board. Three separate things had to be
// wrong for that, and all three are covered here:
//
//   1. the client reported "levels: 8" and the server read it as eight
//      hulls flown, so it demanded 370s;
//   2. the points ceiling was built before coins, bars, coffins and
//      treasure existed, so it sat at a third of what a hull pays;
//   3. the end screen said SENDING RUN... whatever the answer was, so the
//      rejection was invisible and looked like a slow network.
//
// (1) and (2) are bounded on the Go side too; see internal/validate.

// --- 1. hulls flown is not hulls reached

test('a run that starts on a later hull reports the hulls it flew', () => {
  // started on AURUM, finished AURUM: one hull, reached eight
  assert.equal(hullsFlown({ levelIndex: 7, startAt: 7 }), 1);
  // a full campaign from the first hull
  assert.equal(hullsFlown({ levelIndex: 24, startAt: 0 }), 25);
  // started late, kept going
  assert.equal(hullsFlown({ levelIndex: 12, startAt: 8 }), 5);
});

test('hulls flown is never zero or negative, whatever the fields say', () => {
  for (const g of [{}, { levelIndex: 0 }, { startAt: 9 }, { levelIndex: 2, startAt: 9 }]) {
    assert.ok(hullsFlown(g) >= 1,
      `hullsFlown(${JSON.stringify(g)}) = ${hullsFlown(g)}; the server reads 0 as "all of them"`);
  }
});

// --- 3. the end screen has to say what happened

test('the end screen only says SENDING while the answer is genuinely pending', () => {
  const pending = rankLine({ online: true, submitState: 'sending' });
  assert.match(pending.head, /SENDING/);
  assert.equal(pending.settled, false);

  // Every other state is an answer, and must not read as "wait".
  const answered = [
    { online: false },
    { online: true, submitState: 'refused' },
    { online: true, submitState: 'recorded' },
    { online: true, submitState: 'recorded', rank: { position: 1 }, stats: { players: 40 } },
  ];
  for (const net of answered) {
    const line = rankLine(net);
    assert.equal(line.settled, true, `${JSON.stringify(net)} still reads as pending`);
    assert.doesNotMatch(line.head, /SENDING/,
      `${JSON.stringify(net)} says "${line.head}", which a player will read as "wait"`);
  }
});

test('a refused run says so, in the backend\'s own words', () => {
  const line = rankLine({
    online: true,
    submitState: 'refused',
    submitError: 'score 4650367 exceeds the maximum 1744776 attainable in 256.8s',
  });
  assert.match(line.head, /NOT RECORDED/);
  assert.ok(line.sub, 'a refusal with no reason is barely better than none');
  assert.match(line.sub, /1744776/, 'the reason does not carry the numbers the player can report');
  assert.ok(line.sub.length <= 64, 'the reason will not fit on one line');
});

test('a refusal with no reason still says it was refused', () => {
  const line = rankLine({ online: true, submitState: 'refused', submitError: null });
  assert.match(line.head, /NOT RECORDED/);
  assert.ok(line.sub && line.sub.length > 0);
});

test('a placed run reports the field size from stats, not the visible rows', () => {
  // The board shows six rows; the field is fifty. Counting rows said "3 OF 6".
  const line = rankLine({ online: true, rank: { position: 3 }, stats: { players: 50 } });
  assert.equal(line.head, 'YOU PLACE 3 OF 50');
  // And a stale stats count must never put you behind the field.
  const stale = rankLine({ online: true, rank: { position: 9 }, stats: { players: 4 } });
  assert.equal(stale.head, 'YOU PLACE 9 OF 9');
});

test('being offline outranks everything else the screen could say', () => {
  const line = rankLine({ online: false, submitState: 'sending', rank: { position: 1 } });
  assert.match(line.head, /UNREACHABLE/);
});

// --- the submit path itself

function withFetch(fn, impl) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => { globalThis.fetch = real; });
}

const reply = (status, body) => () => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
});

test('a submission carries hullsFlown to the server', async () => {
  const S = netState();
  S.player = { id: 'p1', name: 'TEST', token: 't' };
  S.run = null;
  let sent = null;
  await withFetch(() => submitRun({
    points: 4650367, timeSec: 256.8, turrets: 314, deaths: 1,
    completed: true, levels: 8, hullsFlown: 1,
  }), (url, opts) => {
    sent = JSON.parse(opts.body);
    return reply(201, { score: { points: 4650367 }, rank: { position: 1 } })();
  });
  assert.equal(sent.hullsFlown, 1, 'the server cannot tell one hull from eight without this');
  assert.equal(sent.levels, 8, 'the board still wants to know how far the run got');
});

test('a refused submission leaves the state refused, with the reason', async () => {
  const S = netState();
  S.player = { id: 'p1', name: 'TEST', token: 't' };
  S.run = null;
  S.rank = null;
  await withFetch(
    () => submitRun({ points: 9e9, timeSec: 1, turrets: 0, deaths: 0, completed: true, levels: 1 }),
    reply(422, { error: 'score 9000000000 exceeds the maximum 18011911 attainable in 1.0s' }));
  assert.equal(S.submitState, 'refused');
  assert.match(S.submitError, /exceeds the maximum/);
  // And the screen built from that state must show it.
  assert.match(rankLine(S).head, /NOT RECORDED/);
});

test('an accepted submission leaves the state recorded', async () => {
  const S = netState();
  S.player = { id: 'p1', name: 'TEST', token: 't' };
  S.run = null;
  S.best = 0;
  await withFetch(
    () => submitRun({ points: 5000, timeSec: 60, turrets: 1, deaths: 0, completed: false, levels: 1 }),
    reply(201, { score: { points: 5000 }, rank: { position: 2 } }));
  assert.equal(S.submitState, 'recorded');
  assert.equal(S.submitError, null);
  assert.equal(S.best, 5000, 'an accepted run did not update the cached best');
});

test('an unreachable backend is a refusal, not a run still sending', async () => {
  const S = netState();
  S.player = { id: 'p1', name: 'TEST', token: 't' };
  S.run = null;
  await withFetch(
    () => submitRun({ points: 5000, timeSec: 60, turrets: 1, deaths: 0, completed: false, levels: 1 }),
    () => Promise.reject(new Error('boom')));
  assert.equal(S.submitState, 'refused');
  assert.equal(S.online, false);
});

test('starting a run clears the previous run\'s verdict', async () => {
  const S = netState();
  S.player = null;              // no player: startRun bails after resetting
  S.submitState = 'refused';
  S.submitError = 'something from last time';
  await startRun();
  assert.equal(S.submitState, 'idle', 'the last run\'s refusal would show on this one');
  assert.equal(S.submitError, null);
});
