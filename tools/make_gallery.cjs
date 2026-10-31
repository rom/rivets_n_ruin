#!/usr/bin/env node
/**
 * Renders the images used in the README, from the game's own renderer.
 *
 * Drawing them by hand would mean the documentation drifts from the code the
 * first time a sprite or a palette changes. This drives the real game in a
 * browser, poses it, and screenshots — so a hull in the README is that hull.
 *
 *   node tools/make_gallery.cjs [url]      default http://127.0.0.1:8000/
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_BASE = process.argv[2] || 'http://127.0.0.1:8000/';
const OUT = path.join(__dirname, '..', 'docs');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game);
  // Enter until the ship is actually flying: splash -> title -> launching
  // -> play. One press used to be enough; the splash and launch sequences
  // each added a screen, and until this was fixed every gallery image was
  // shot with the title screen drawn over the scene.
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => window.game.state) === 'play') break;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
  }
  const reached = await page.evaluate(() => window.game.state);
  if (reached !== 'play') throw new Error(`could not reach play: stuck in ${reached}`);
  await page.evaluate(() => { window.game.player.invuln = 1e9; });
  const el = await page.$('#game');

  // Every scene below poses the world by hand, so nothing may be mid-banner,
  // mid-sequence or mid-menu when the shutter opens.
  const clear = () => page.evaluate(() => {
    const g = window.game;
    g.state = 'play';
    g.stateT = 9;
    g.banner = null;
    g.toast = null;
    g.quitting = false;
    g.player.alive = true;
    g.player.invuln = 1e9;
  });

  const shot = async (name, clip) => {
    await el.screenshot({ path: path.join(OUT, name), ...(clip ? { clip } : {}) });
    console.log('  ' + name);
  };

  // --- one strip per hull theme, framed on a stretch with structure in it
  console.log('hulls:');
  const hulls = await page.evaluate(() => window.game.specs.map((s) => s.name));
  for (let i = 0; i < hulls.length; i++) {
    await page.evaluate(async (i) => {
      const { buildLevel } = await import('./src/level.js');
      const g = window.game;
      g.levelIndex = i;
      g.level = buildLevel(g.specs[i]);
      g.boss = null;
      g.returning = false;
      g.player.invuln = 1e9;
      // find a stretch with a few blocks so the theme shows on structure
      const o = g.level.obstacles.find((b) => b.x > 2500) || { x: 3000 };
      g.player.x = o.x - 120;
      g.player.y = 170;
      g.cam.x = o.x - 420;
    }, i);
    await clear();
    await page.waitForTimeout(450);
    await clear();
    await shot(`hull-${String(i + 1).padStart(2, '0')}-${hulls[i].toLowerCase()}.png`,
      { x: 0, y: 0, width: 1400, height: 660 });
  }

  // --- the attacker roster, posed on one screen
  console.log('attackers:');
  await page.evaluate(async () => {
    const { buildLevel } = await import('./src/level.js');
    const fo = await import('./src/foes.js');
    const en = await import('./src/enemies.js');
    const g = window.game;
    g.levelIndex = 0;
    g.level = buildLevel(g.specs[0]);
    g.player.x = 600; g.player.y = 170; g.cam.x = 300; g.player.invuln = 1e9;
    en.resetEnemies();
    fo.resetFoes();
    const kinds = ['mine', 'lancer', 'orbiter', 'warder', 'weaver', 'splitter', 'bomber', 'leech'];
    kinds.forEach((k, i) => {
      const f = fo.spawnFoe(g, k);
      if (!f) return;
      f.x = 420 + (i % 4) * 150;
      f.baseY = 70 + Math.floor(i / 4) * 130;
      f.y = f.baseY;
      f.state = 0;
      f.t = 0.35;          // mid-telegraph, so the lancer shows its aim line
      f.facing = -1;
    });
    en.spawnInterceptor(g);
  });
  await clear();
  await page.waitForTimeout(120);
  await shot('attackers.png', { x: 0, y: 0, width: 1400, height: 660 });

  // --- the miniboss roster, one of each posed on one screen
  console.log('minibosses:');
  const poseMinis = (fresh) => page.evaluate(async (fresh) => {
    const mb = await import('./src/miniboss.js');
    const fo = await import('./src/foes.js');
    const en = await import('./src/enemies.js');
    const g = window.game;
    if (fresh) {
      fo.resetFoes();
      en.resetEnemies();
      mb.resetMinis();
      g.player.x = 600; g.player.y = 300; g.cam.x = 300; g.player.invuln = 1e9;
      for (const k of Object.keys(mb.KINDS)) mb.spawnMini(g, k, 0);
    }
    // Two of them chase the ship, so re-pose immediately before the shutter
    // rather than trusting where they were a frame ago.
    const hp = [1, 0.55, 1, 0.25];
    for (let i = 0; i < mb.minis.count; i++) {
      const m = mb.minis.items[i];
      m.x = g.cam.x + 95 + i * 150;
      m.baseY = 150;
      m.y = 150;
      m.t = 0.4;
      m.hp = Math.round(m.maxHp * hp[i % hp.length]);
    }
  }, fresh);
  await clear();
  await poseMinis(true);
  await page.waitForTimeout(120);
  await clear();
  await poseMinis(false);
  await shot('minibosses.png', { x: 0, y: 0, width: 1400, height: 560 });

  // --- the armory in flight
  console.log('armory:');
  await page.evaluate(async () => {
    const ar = await import('./src/armory.js');
    const fo = await import('./src/foes.js');
    const g = window.game;
    fo.resetFoes();
    ar.resetOrdnance();
    g.player.ammo = { bomb: 6, grenade: 8, missile: 5 };
    for (const k of ['bomb', 'grenade', 'missile']) {
      g.player.secondary = k;
      g.player.secondaryCd = 0;
      ar.fireSecondary(g);
    }
    const f = fo.spawnFoe(g, 'orbiter');
    if (f) { f.x = g.player.x + 240; f.baseY = 150; f.y = 150; f.state = 1; }
  });
  await clear();
  await page.waitForTimeout(320);
  await shot('armory.png', { x: 0, y: 0, width: 1400, height: 760 });

  // --- a boss fight
  console.log('scenes:');
  await page.evaluate(async () => {
    const { buildLevel } = await import('./src/level.js');
    const g = window.game;
    g.levelIndex = 7;
    g.level = buildLevel(g.specs[7]);
    g.boss = null; g.returning = false;
    g.player.x = g.level.length - 640 + 150;
    g.player.y = 180; g.player.invuln = 1e9;
    g.player.gunBlaze = 4; g.player.gunSpeed = 4;
  });
  await clear();
  await page.waitForTimeout(3600);
  await page.keyboard.down('KeyZ');
  await page.waitForTimeout(700);
  await shot('scene-boss.png');
  await page.keyboard.up('KeyZ');

  // --- the hull-clear reveal
  await page.evaluate(async () => {
    const { buildLevel } = await import('./src/level.js');
    const g = window.game;
    g.levelIndex = 2; g.level = buildLevel(g.specs[2]);
    g.boss = null; g.returning = true; g.score = 148250; g.coins = 612; g.coffins = 4;
    g.player.x = 100; g.player.invuln = 1e9;
  });
  await page.waitForTimeout(1600);
  await shot('scene-refit.png');

  // --- the armourer and the settings screen
  await page.evaluate(() => {
    const g = window.game;
    g.coins = 4200; g.state = 'levelclear'; g.stateT = 2; g.levelIndex = 2;
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  await shot('shop.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.evaluate(() => { window.game.state = 'title'; window.game.stateT = 0.5; });
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyO');
  await page.waitForTimeout(400);
  await shot('settings.png');
  await page.keyboard.press('KeyO');
  await page.waitForTimeout(200);

  // --- the title, with the hull selector
  await page.evaluate(() => {
    localStorage.setItem('rnr.unlocked', '5');
    window.game.unlocked = 5; window.game.startHull = 3;
    window.game.state = 'title'; window.game.stateT = 0.4;
  });
  await page.waitForTimeout(500);
  await shot('scene-title.png');

  await browser.close();
  if (errors.length) {
    console.error('\npage errors:', errors.slice(0, 3));
    process.exit(1);
  }
  console.log('\ngallery written to docs/');
})().catch((e) => { console.error('gallery failed:', e.message); process.exit(1); });
