#!/usr/bin/env node
/**
 * Two real browsers, one room.
 *
 * The co-op tests in test/coop.test.mjs cover the codec and the state
 * machine, and neither can see the thing co-op actually is: two
 * browsers, two sockets and a server between them. Everything here is
 * a fault that only exists when all three are real.
 *
 * The one that justifies the file: quitting a co-op run used to race
 * its own submission. Saying "I am leaving" closes the room, the
 * co-op board needs the room open to know who the second pilot was,
 * and the POST lost — 409, no row, run gone. Every unit test passed.
 *
 * Not in `make check`: it wants two browser contexts and most of a
 * minute. Run it when co-op changes.
 *
 *   make coop-smoke
 *   node tools/twopilots.cjs [url]
 */
const { chromium } = require('playwright');

const URL = process.argv[2] || 'http://127.0.0.1:8411/';
let bad = 0;
const ok = (name, good, detail) => {
  if (!good) bad++;
  console.log(`  ${good ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const coop = (p) => p.evaluate(() => ({
  phase: window.coop.phase,
  side: window.coop.side,
  code: window.coop.code,
  peerHere: window.coop.peerHere,
  quitBy: window.coop.quitBy,
  endIn: window.coop.endIn,
  heldFor: window.coop.heldFor,
  resumeSec: window.coop.resumeSec,
  tries: window.coop.tries,
  error: window.coop.error,
}));
const g = (p) => p.evaluate(() => ({
  state: window.game.state,
  levelIndex: window.game.levelIndex,
  hull: window.game.level.spec.name,
  score: window.game.score,
  mate: window.game.mate && {
    shield: Math.round(window.game.mate.shield),
    shieldMax: window.game.mate.shieldMax,
    lives: window.game.mate.lives,
    alive: window.game.mate.alive,
  },
}));

async function until(p, fn, what, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    if (fn(await coop(p), await g(p))) return true;
    if (Date.now() - t0 > ms) return false;
    await p.waitForTimeout(100);
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const open = async (tag) => {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${tag} pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !/ERR_CONNECTION|WebSocket/.test(m.text())) {
        errs.push(`${tag} console: ${m.text()}`);
      }
    });
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForFunction(() => window.game && window.net && window.net.player, null,
      { timeout: 20000 });
    // Off the splash and onto the title: the co-op screen only opens
    // from the title, and the splash is what the game boots into.
    for (let i = 0; i < 40 && await p.evaluate(() => window.game.state) !== 'title'; i++) {
      await p.keyboard.press('Enter');
      await p.waitForTimeout(200);
    }
    return p;
  };

  // --- pair them up
  const A = await open('host');
  const B = await open('guest');

  await A.keyboard.press('KeyG');
  await A.waitForTimeout(200);
  await A.keyboard.press('KeyH');
  if (!await until(A, (c) => c.code && c.phase === 'waiting', 'hosting')) {
    ok('a room was opened', false, JSON.stringify(await coop(A)));
    process.exit(1);
  }
  const code = (await coop(A)).code;
  ok('a room was opened', !!code, code);

  await B.evaluate((c) => { window.prompt = () => c; }, code);
  await B.keyboard.press('KeyG');
  await B.waitForTimeout(200);
  await B.keyboard.press('KeyJ');
  ok('both pilots are in the room',
    await until(A, (c) => c.phase === 'playing') && await until(B, (c) => c.phase === 'playing'),
    `${(await coop(A)).phase} / ${(await coop(B)).phase}`);

  await A.keyboard.press('Enter');
  await B.keyboard.press('Enter');
  // 'launching' first: the ship comes out of the bay on rails, which
  // takes a couple of seconds before anybody is flying anything.
  ok('both are flying',
    await until(A, (c, s) => s.state === 'play', 'play', 12000)
    && await until(B, (c, s) => s.state === 'play', 'play', 12000),
    `${(await g(A)).state} / ${(await g(B)).state}`);
  await A.waitForTimeout(400);

  // --- the mini-HUD has something real in it
  const mateOnA = (await g(A)).mate;
  const mateOnB = (await g(B)).mate;
  ok('the host can see the other pilot\'s ship',
    !!mateOnA && mateOnA.shieldMax > 0 && mateOnA.lives > 0, JSON.stringify(mateOnA));
  ok('the guest can see the other pilot\'s ship',
    !!mateOnB && mateOnB.shieldMax > 0 && mateOnB.lives > 0, JSON.stringify(mateOnB));

  // A late-run shield, which used to be clamped to 255 on the wire.
  await A.evaluate(() => {
    window.game.player.shieldMax = 1180;
    window.game.player.shield = 870;
    window.game.player.lives = 5;
  });
  await A.waitForTimeout(400);
  const seen = (await g(B)).mate;
  ok('a late-run shield reaches the other screen intact',
    seen.shield === 870 && seen.shieldMax === 1180,
    `the guest sees ${seen.shield}/${seen.shieldMax}`);
  ok('spare hulls reach the other screen', seen.lives === 5, `sees ${seen.lives}`);

  // --- the same hull
  const beforeHull = (await g(B)).hull;
  await A.evaluate(() => { window.game.levelIndex = 2; });
  await A.waitForTimeout(600);
  const after = await g(B);
  ok('the guest follows the host onto another hull',
    after.levelIndex === 2 && after.hull !== beforeHull,
    `${beforeHull} -> ${after.hull} (index ${after.levelIndex})`);

  // --- a dropped socket holds the run
  //
  // The guest's reconnect is blocked first, so the hold is actually
  // observable: unblocked it recovers in well under a frame and the
  // host never visibly pauses, which is the right behaviour and a
  // useless test.
  await B.evaluate(() => {
    window.__realWS = window.WebSocket;
    window.WebSocket = function Blocked() {
      const o = { readyState: 3, close() {}, send() {} };
      setTimeout(() => { if (o.onclose) o.onclose(); }, 10);
      return o;
    };
    window.coop.sock.close();
  });
  ok('the guest tries to get back in rather than ending the run',
    await until(B, (c) => c.phase === 'reconnecting'), (await coop(B)).phase);
  ok('the host is told to wait rather than told it is over',
    await until(A, (c) => c.phase === 'paused' && c.resumeSec > 0),
    JSON.stringify(await coop(A)));
  const heldState = (await g(A)).state;
  ok('the held run has not been thrown away', heldState === 'play', heldState);
  // Nothing moves while it is held: a returning pilot must not come
  // back to a ship that has been flown somewhere by nobody.
  const camHeld = await A.evaluate(() => window.game.cam.x);
  await A.waitForTimeout(700);
  ok('the held run does not advance',
    (await A.evaluate(() => window.game.cam.x)) === camHeld,
    `camera moved ${(await A.evaluate(() => window.game.cam.x)) - camHeld}px`);

  await B.evaluate(() => { window.WebSocket = window.__realWS; });
  ok('the guest gets back in and the run resumes',
    await until(B, (c) => c.phase === 'playing', 'resume', 20000)
    && await until(A, (c) => c.phase === 'playing' && c.peerHere),
    `${(await coop(B)).phase} / ${(await coop(A)).phase}`);
  const resumed = await g(A);
  ok('it resumed the same run rather than restarting one',
    resumed.state === 'play' && resumed.levelIndex === 2,
    `${resumed.state} on hull index ${resumed.levelIndex}`);

  // --- the guest quits on purpose: the host is told and keeps flying
  await B.keyboard.press('KeyQ');
  await B.waitForTimeout(200);
  await B.keyboard.press('KeyY');
  ok('the host is told the second pilot chose to leave',
    await until(A, (c) => c.quitBy === 'guest'), JSON.stringify(await coop(A)));
  ok('the host is not put on hold for a pilot who quit',
    (await coop(A)).phase !== 'paused', (await coop(A)).phase);
  await A.waitForTimeout(600);
  ok('the host is still flying its run', (await g(A)).state === 'play', (await g(A)).state);

  // --- and the other way round: the host quits, the guest counts down
  const A2 = await open('host2');
  const B2 = await open('guest2');
  await A2.keyboard.press('KeyG');
  await A2.waitForTimeout(200);
  await A2.keyboard.press('KeyH');
  await until(A2, (c) => !!c.code);
  const code2 = (await coop(A2)).code;
  await B2.evaluate((c) => { window.prompt = () => c; }, code2);
  await B2.keyboard.press('KeyG');
  await B2.waitForTimeout(200);
  await B2.keyboard.press('KeyJ');
  await until(B2, (c) => c.phase === 'playing');
  await A2.keyboard.press('Enter');
  await B2.keyboard.press('Enter');
  await until(A2, (c, s) => s.state === 'play', 'play', 12000);
  await until(B2, (c, s) => s.state === 'play', 'play', 12000);

  await A2.keyboard.press('KeyQ');
  await A2.waitForTimeout(200);
  await A2.keyboard.press('KeyY');
  ok('the guest is told the host quit, with a countdown',
    await until(B2, (c) => c.quitBy === 'host' && c.endIn > 0),
    JSON.stringify(await coop(B2)));
  ok('the countdown takes the guest back to the title',
    await until(B2, (c, s) => s.state === 'title' && c.phase === 'off', 'title', 12000),
    `${(await g(B2)).state} / ${(await coop(B2)).phase}`);

  console.log(errs.length ? 'console/page errors:\n  ' + errs.join('\n  ') : 'no console errors');
  if (errs.length) bad++;
  await browser.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall two-pilot checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
