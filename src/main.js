import { VIEW_W, VIEW_H } from './config.js';
import { initInput, tapped, endFrame } from './input.js';
import { startLoop } from './loop.js';
import { makeGame, update, syncBest } from './game.js';
import { drawWorld } from './render.js';
import { drawHud, drawPaused, drawQuitPrompt } from './hud.js';
import { unlock, toggleMute, isMuted, ready } from './audio.js';
import { startMusic, stopMusic, musicRunning } from './music.js';
import { sfxUi } from './sfx.js';
import { initNet, rename, refreshTop, refreshPresence, netState } from './net.js';
import { nextTune, tuneName, setTune } from './music.js';
import { loadModFromURL } from './mods.js';
import { LEVELS } from './config.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

function fit() {
  let s = Math.min(window.innerWidth / VIEW_W, (window.innerHeight - 40) / VIEW_H);
  s = s >= 1 ? Math.floor(s) : s;            // integer upscale keeps pixels square
  canvas.style.width = Math.round(VIEW_W * s) + 'px';
  canvas.style.height = Math.round(VIEW_H * s) + 'px';
}
window.addEventListener('resize', fit);
fit();

initInput(window);

// Browsers will not start audio outside a user gesture, so the context is
// created on the first key or pointer event and the score starts with it.
function wakeAudio() {
  unlock();
  if (ready() && !musicRunning()) startMusic();
}
window.addEventListener('keydown', wakeAudio, { once: false });
window.addEventListener('pointerdown', wakeAudio, { once: false });

// A mod may replace the hull seed and override tuning, so it has to resolve
// before the level is built. The game starts regardless: a mod that will not
// load, or a backend that is down, costs you the stock hull and nothing more.
const mod = await loadModFromURL().catch(() => null);
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
    drawWorld(ctx, game);
    drawHud(ctx, game, { muted: isMuted(), audio: ready() });
    if (game.quitting) drawQuitPrompt(ctx, game);
    else if (paused) drawPaused(ctx);
  },
);
