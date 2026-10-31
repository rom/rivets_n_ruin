import { VIEW_W, VIEW_H } from './config.js';
import { fitCanvas, applyTransform, reportFrame } from './display.js';
import { initInput, tapped, endFrame } from './input.js';
import { startLoop } from './loop.js';
import { makeGame, update, syncBest } from './game.js';
import { drawWorld } from './render.js';
import { drawHud, drawPaused, drawQuitPrompt, drawSettings, drawShop } from './hud.js';
import { rows as shopRows, buy as shopBuy } from './shop.js';
import { unlock, toggleMute, isMuted, ready } from './audio.js';
import { startMusic, stopMusic, musicRunning } from './music.js';
import { sfxUi } from './sfx.js';
import { initNet, rename, refreshTop, refreshRuns, refreshPresence, netState, toggleBoard } from './net.js';
import { nextTune, tuneName, setTune, TUNES } from './music.js';
import * as settings from './settings.js';
import { applySettings } from './audio.js';
import { loadModFromURL } from './mods.js';
import { LEVELS } from './config.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

// The canvas backing store tracks the window and the device pixel ratio, and
// the context carries a matching transform, so everything — sprites, strokes
// and especially text — is rasterised at display resolution rather than
// drawn into 640x360 and blown up. See display.js.
function fit() { fitCanvas(canvas, ctx); }
window.addEventListener('resize', fit);
fit();

initInput(window);

// Browsers will not start audio outside a user gesture, so the context is
// created on the first key or pointer event and the score starts with it.
function wakeAudio() {
  unlock();
  applySettings(settings.all());
  if (ready() && !musicRunning()) startMusic();
}

// Settings can be changed before audio exists, so re-apply whenever either
// of those things happens.
settings.onChange(() => applySettings(settings.all()));

// The settings screen is modal and owns the keyboard while it is open.
let settingsOpen = false;
let settingsSel = 0;
let shopOpen = false;
let shopSel = 0;
let shopNote = '';
window.addEventListener('keydown', wakeAudio, { once: false });
window.addEventListener('pointerdown', wakeAudio, { once: false });

// A mod may replace the hull seed and override tuning, so it has to resolve
// before the level is built. The game starts regardless: a mod that will not
// load, or a backend that is down, costs you the stock hull and nothing more.
const mod = await loadModFromURL().catch(() => null);
let lastFrameAt = performance.now();
const game = makeGame(mod ? { seed: mod.seed, name: mod.name.toUpperCase() } : null);
setTune(LEVELS[0].tune);
let paused = false;

// Backend comes up behind the game, never in front of it.
initNet().then((ok) => {
  if (!ok) console.info('backend unreachable — scores stay local');
  else syncBest(game);   // adopt the account's best if it beats this browser's
});

// Keep the title screen's board and pilot count fresh while nobody is flying,
// and retry the handshake if the backend was down at load — otherwise a
// server that comes back up would never be noticed until a page reload.
setInterval(() => {
  if (game.state === 'play' || game.state === 'dying') return;
  if (!netState().online) {
    initNet().then((ok) => { if (ok) syncBest(game); });
    return;
  }
  refreshTop(mod ? mod.id : '');
  refreshRuns(mod ? mod.id : '');
  refreshPresence();
}, 10000);

// Exposed for poking at the feel from the devtools console.
window.game = game;

// Renaming mints a fresh identity server-side; the old name keeps its scores.
function promptRename() {
  const current = netState().player ? netState().player.name : '';
  const next = window.prompt('Pilot name (2-16 characters):', current);
  if (!next || next === current) return;
  rename(next.trim()).then((p) => {
    if (!p) window.alert('Could not take that name: ' + (netState().lastError || 'it may be taken'));
  });
}

startLoop(
  (dt) => {
    // The shop owns the keyboard while open, like the settings screen.
    if (shopOpen) {
      const list = shopRows(game);
      const perCol = Math.ceil(list.length / 2);
      if (tapped('up')) { shopSel = (shopSel - 1 + list.length) % list.length; sfxUi(); }
      if (tapped('down')) { shopSel = (shopSel + 1) % list.length; sfxUi(); }
      if (tapped('left')) { shopSel = Math.max(0, shopSel - perCol); sfxUi(); }
      if (tapped('right')) { shopSel = Math.min(list.length - 1, shopSel + perCol); sfxUi(); }
      if (tapped('start') || tapped('fire')) {
        const res = shopBuy(game, list[shopSel]);
        shopNote = res || 'NOT ENOUGH COINS';
        sfxUi();
      }
      if (tapped('shop') || tapped('pause') || tapped('quit')) { shopOpen = false; sfxUi(); }
      endFrame();
      return;
    }
    if (tapped('shop') && game.state === 'levelclear') {
      shopOpen = true; shopSel = 0; shopNote = ''; sfxUi(); endFrame(); return;
    }
    if (settingsOpen) {
      const n = settings.DEFS.length;
      if (tapped('up')) { settingsSel = (settingsSel - 1 + n) % n; sfxUi(); }
      if (tapped('down')) { settingsSel = (settingsSel + 1) % n; sfxUi(); }
      if (tapped('left')) { settings.nudge(settings.DEFS[settingsSel].id, -1, TUNES.length); sfxUi(); }
      if (tapped('right')) { settings.nudge(settings.DEFS[settingsSel].id, 1, TUNES.length); sfxUi(); }
      if (tapped('restart')) { settings.reset(); sfxUi(); }
      if (tapped('options') || tapped('pause') || tapped('start')) { settingsOpen = false; sfxUi(); }
      if (settings.get('tune') !== undefined) setTune(settings.get('tune'));
      endFrame();
      return;
    }
    if (tapped('options') && game.state !== 'play' && game.state !== 'dying') {
      settingsOpen = true; settingsSel = 0; sfxUi(); endFrame(); return;
    }
    if (tapped('board') && game.state !== 'play' && game.state !== 'dying') {
      toggleBoard();
      sfxUi();
    }
    if (tapped('mute')) { const m = toggleMute(); if (!m) sfxUi(); }
    if (tapped('tune')) {
      sfxUi();
      const i = nextTune();
      game.toast = { text: 'TUNE  ' + tuneName(), kind: 'gunspeed', t: 1.8 };
    }
    if (tapped('no') && game.state === 'title' && netState().online) {
      sfxUi();
      promptRename();
    }
    if (tapped('pause')) {
      paused = !paused;
      if (paused) stopMusic(); else startMusic();
      sfxUi();
    }
    if (paused) { endFrame(); return; }
    update(game, dt);
  },
  () => {
    const t0 = performance.now();
    applyTransform(ctx);   // a resize resets context state; re-establish it
    drawWorld(ctx, game);
    drawHud(ctx, game, { muted: isMuted(), audio: ready() });
    if (shopOpen) drawShop(ctx, game, shopSel, shopNote);
    else if (settingsOpen) drawSettings(ctx, game, settingsSel);
    else if (game.quitting) drawQuitPrompt(ctx, game);
    else if (paused) drawPaused(ctx);
    // Frame-to-frame interval, not draw time: canvas2d records lazily, so
    // the real cost of a resolution shows up as a longer frame, not a longer
    // draw call.
    const now = performance.now();
    reportFrame(now - lastFrameAt, canvas, ctx);
    lastFrameAt = now;
  },
);
