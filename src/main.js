import { VIEW_W, VIEW_H } from './config.js';
import { initInput, tapped, endFrame } from './input.js';
import { startLoop } from './loop.js';
import { makeGame, update } from './game.js';
import { drawWorld } from './render.js';
import { drawHud, drawPaused } from './hud.js';

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

const game = makeGame();
let paused = false;

// Exposed for poking at the feel from the devtools console.
window.game = game;

startLoop(
  (dt) => {
    if (tapped('pause')) paused = !paused;
    if (paused) { endFrame(); return; }
    update(game, dt);
  },
  () => {
    drawWorld(ctx, game);
    drawHud(ctx, game);
    if (paused) drawPaused(ctx);
  },
);
