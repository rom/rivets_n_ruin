#!/usr/bin/env node
/**
 * Playable smoke test.
 *
 * Asserts the things that unit tests and state assertions cannot see: that
 * the hull is actually drawn, that the world actually scrolls, and that the
 * camera holds a finite number.
 *
 * This exists because a signature change to updateCamera once left its call
 * sites passing dt where a level length belonged. The camera went NaN,
 * drawImage silently drew nothing, and every state assertion still passed —
 * the game reported a healthy score, a moving ship and the right hull while
 * rendering a black screen. Only looking at pixels catches that.
 *
 *   node tools/smoke.cjs [url]        default http://127.0.0.1:8000/
 */

const { chromium } = require('playwright');

const URL = process.argv[2] || 'http://127.0.0.1:8000/';
const MIN_INK_PCT = 25;       // the hull fills most of the playfield
const MIN_SCROLL_PX = 300;    // how far the camera must travel in the test

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1340, height: 800 } });

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION')) {
      errors.push('console: ' + m.text());
    }
  });
  const notFound = [];
  page.on('response', (r) => { if (r.status() === 404) notFound.push(new URL(r.url()).pathname); });

  console.log(`smoke: ${URL}`);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game, { timeout: 15000 });

  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  const camBefore = await page.evaluate(() => window.game.cam.x);

  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('KeyZ');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyZ');
  await page.keyboard.up('ArrowRight');

  const after = await page.evaluate(() => ({
    camX: window.game.cam.x,
    camFinite: Number.isFinite(window.game.cam.x),
    playerX: window.game.player.x,
    playerFinite: Number.isFinite(window.game.player.x),
    state: window.game.state,
    hullChunks: window.game.level.chunks.size,
  }));

  // How much of the playfield is actually painted?
  const ink = await page.evaluate(() => {
    const c = document.getElementById('game');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, 640, 324).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    }
    return Math.round((lit / (d.length / 4)) * 100);
  });

  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const tick = () => {
      n++;
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
      else res(Math.round(n / ((performance.now() - t0) / 1000)));
    };
    requestAnimationFrame(tick);
  }));

  check('camera holds a finite value', after.camFinite, `cam.x = ${after.camX}`);
  check('player holds a finite value', after.playerFinite, `x = ${Math.round(after.playerX)}`);
  check('world scrolls', after.camX - camBefore >= MIN_SCROLL_PX,
    `camera moved ${Math.round(after.camX - camBefore)}px (need ${MIN_SCROLL_PX})`);
  check('hull is drawn', ink >= MIN_INK_PCT, `${ink}% of the playfield inked (need ${MIN_INK_PCT}%)`);
  check('hull chunks cached', after.hullChunks > 0, `${after.hullChunks} chunk(s)`);
  check('still playing', after.state === 'play', after.state);
  check('holds frame rate', fps >= 30, `${fps} fps`);
  check('no console errors', errors.length === 0, errors.join(' | ') || 'none');
  check('no 404s', notFound.length === 0, notFound.join(' ') || 'none');

  if (process.env.SMOKE_SHOT) {
    await (await page.$('#game')).screenshot({ path: process.env.SMOKE_SHOT });
    console.log(`  screenshot: ${process.env.SMOKE_SHOT}`);
  }

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length
    ? `\nsmoke FAILED: ${failed.length}/${checks.length}`
    : `\nsmoke passed: ${checks.length}/${checks.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('smoke harness error:', e.message);
  process.exit(1);
});
