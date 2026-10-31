import { VIEW_W, VIEW_H } from './config.js';
import { initInput, tapped, endFrame } from './input.js';
import { startLoop } from './loop.js';
import { makeGame, update } from './game.js';
import { drawWorld } from './render.js';
import { drawHud, drawPaused } from './hud.js';
import { unlock, toggleMute, isMuted, ready } from './audio.js';
import { startMusic, stopMusic, musicRunning } from './music.js';
import { sfxUi } from './sfx.js';

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

const game = makeGame();
let paused = false;

// Exposed for poking at the feel from the devtools console.
window.game = game;

startLoop(
  (dt) => {
    if (tapped('mute')) { const m = toggleMute(); if (!m) sfxUi(); }
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
    if (paused) drawPaused(ctx);
  },
);
