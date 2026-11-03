#!/usr/bin/env node
/**
 * Renders the operator tool's screenshots for the README.
 *
 * Separate from make_gallery.cjs because it is a different thing: that
 * one poses the game's own renderer and screenshots a canvas, this one
 * drives a web page on a different port. Sharing a file would mean one
 * script that needs a game server, an admin password and a browser, and
 * fails in three ways.
 *
 * It seeds its own data, with fixed names and fixed numbers, and
 * clears what it is about to create first, so it can be run twice and
 * the pictures say the same thing both times.
 *
 * They are not byte-identical: a run carries a generated id and a
 * timestamp, and the pilot and run cards show both. Only the overview
 * comes out the same. Worth knowing before wondering why `make
 * gallery` leaves two changed images in the diff.
 *
 *   node tools/make_admin_shot.cjs <admin-url> <game-url> <password>
 */

const { chromium } = require('playwright');
const path = require('path');

const ADMIN = process.argv[2] || 'http://127.0.0.1:8001';
const GAME = process.argv[3] || 'http://127.0.0.1:8000';
const PW = process.argv[4] || process.env.RNR_ADMIN_PASSWORD;
const OUT = path.join(__dirname, '..', 'docs');

if (!PW) {
  console.error('usage: make_admin_shot.cjs <admin-url> <game-url> <password>');
  process.exit(2);
}

// Pilots and runs that look like a server somebody uses. The times are
// above what the run validator calls possible for the hull count, or
// the submissions are refused and the tool is photographed empty.
const PILOTS = ['vanth', 'okonkwo', 'brightwater', 'sable'];
const RUNS = [
  { pilot: 0, points: 182400, levels: 25, timeSec: 3900, turrets: 486, deaths: 2, completed: true },
  { pilot: 1, points: 141050, levels: 21, timeSec: 3300, turrets: 402, deaths: 4, completed: false },
  { pilot: 0, points: 96820, levels: 17, timeSec: 2700, turrets: 311, deaths: 1, completed: false },
  { pilot: 2, points: 74310, levels: 14, timeSec: 2200, turrets: 240, deaths: 3, completed: false },
  { pilot: 1, points: 58900, levels: 11, timeSec: 1800, turrets: 187, deaths: 0, completed: false },
  { pilot: 3, points: 41260, levels: 9, timeSec: 1500, turrets: 142, deaths: 2, completed: false },
  { pilot: 2, points: 22705, levels: 6, timeSec: 1100, turrets: 88, deaths: 5, completed: false },
];

async function call(method, url, body, token) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${method} ${url}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const post = (url, body, token) => call('POST', url, body, token);

(async () => {
  const { token } = await post(`${ADMIN}/api/admin/login`, { password: PW });

  // Clear whatever a previous run left behind, through the same API
  // the tool is photographing. Without this the second run fails
  // outright on the pilot names, and the board accumulates runs until
  // the picture is of a different server every time.
  const existing = await call('GET', `${ADMIN}/api/admin/players?limit=500`, undefined, token);
  for (const p of existing.players || []) {
    if (PILOTS.includes(p.name)) {
      await call('DELETE', `${ADMIN}/api/admin/players/${p.id}`, undefined, token);
    }
  }
  await post(`${ADMIN}/api/admin/scores/reset`, { confirm: 'RESET' }, token);

  // A pilot each, and a token for each so their runs can be submitted
  // through the game's own API rather than injected behind it.
  const tokens = [];
  for (const name of PILOTS) {
    const made = await post(`${ADMIN}/api/admin/players`,
      { name, password: 'a-password-for-the-picture' }, token);
    tokens.push(made.token);
  }
  for (const r of RUNS) {
    await post(`${GAME}/api/scores`, {
      points: r.points, timeSec: r.timeSec, turrets: r.turrets,
      deaths: r.deaths, completed: r.completed, levels: r.levels,
      hullsFlown: r.levels,
    }, tokens[r.pilot]);
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(ADMIN + '/', { waitUntil: 'networkidle' });
  await page.fill('#pw', PW);
  await page.click('#login-form button');
  await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(600);

  // The session countdown would make every regeneration a diff, and
  // clearing its text is not enough: it is on a one-second interval
  // and ticks straight back. Taking the element away stops it.
  const stopClock = () => page.evaluate(() => {
    const s = document.getElementById('session');
    if (s) s.remove();
  });
  await stopClock();
  await page.screenshot({ path: path.join(OUT, 'admin-overview.png') });
  console.log('  admin-overview.png');

  // Tall enough for the list and the detail at once. Opening a run
  // scrolls it into view, and at the default height that pushed the
  // table's own header row off the top — a picture of a table with no
  // column names is a picture of nothing.
  await page.setViewportSize({ width: 1180, height: 1020 });
  await page.click('nav button[data-tab="runs"]');
  await page.waitForTimeout(700);
  const row = await page.$('#run-list tbody tr');
  if (row) { await row.click(); await page.waitForTimeout(700); }
  await stopClock();
  await page.evaluate(() => { document.querySelector('main').scrollTop = 0; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'admin-run.png') });
  console.log('  admin-run.png');

  // The pilot card is the tallest thing the tool draws. Its own
  // viewport rather than fullPage: with #app a viewport-height grid,
  // fullPage captures the viewport anyway and only makes the file
  // bigger.
  await page.setViewportSize({ width: 1180, height: 1180 });
  await page.click('nav button[data-tab="pilots"]');
  await page.waitForTimeout(700);
  const prow = await page.$('#pilot-list tbody tr');
  if (prow) { await prow.click(); await page.waitForTimeout(700); }
  await stopClock();
  await page.evaluate(() => { document.querySelector('main').scrollTop = 0; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'admin-pilot.png') });
  console.log('  admin-pilot.png');

  await browser.close();
  if (errors.length) {
    console.error('\npage errors:', [...new Set(errors)].slice(0, 3));
    process.exit(1);
  }
})().catch((e) => { console.error('admin shots failed:', e.message); process.exit(1); });
