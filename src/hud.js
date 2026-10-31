import {
  VIEW_W, VIEW_H, FIELD_H, HUD_H, SHIP, LEVEL_LEN, COL, clamp,
} from './config.js';

const FONT = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const FONT_BIG = 'bold 20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function text(ctx, str, x, y, color = COL.hudText, font = FONT, align = 'left') {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

export function drawHud(ctx, game, audio = {}) {
  const p = game.player;
  const y0 = FIELD_H;

  ctx.fillStyle = COL.hudBg;
  ctx.fillRect(0, y0, VIEW_W, HUD_H);
  ctx.fillStyle = COL.hudLine;
  ctx.fillRect(0, y0, VIEW_W, 1);

  // --- shield, as segments: readable at a glance mid-dodge
  text(ctx, 'SHIELD', 8, y0 + 6);
  const segs = 10;
  const filled = Math.ceil(clamp(p.shield / SHIP.shieldMax, 0, 1) * segs);
  for (let i = 0; i < segs; i++) {
    const on = i < filled;
    ctx.fillStyle = !on ? '#1a212b' : filled <= 3 ? COL.danger : filled <= 6 ? COL.warmHi : COL.cool;
    ctx.fillRect(8 + i * 7, y0 + 19, 5, 9);
  }

  // --- lives
  text(ctx, 'SHIPS', 92, y0 + 6);
  for (let i = 0; i < Math.max(0, p.lives); i++) {
    ctx.fillStyle = COL.cool;
    ctx.beginPath();
    ctx.moveTo(94 + i * 10, y0 + 28);
    ctx.lineTo(99 + i * 10, y0 + 19);
    ctx.lineTo(104 + i * 10, y0 + 28);
    ctx.closePath();
    ctx.fill();
  }

  // --- speed / heading
  text(ctx, 'VEL', 146, y0 + 6);
  const spd = Math.abs(p.vx) / SHIP.maxVX;
  ctx.fillStyle = '#1a212b';
  ctx.fillRect(146, y0 + 19, 46, 9);
  ctx.fillStyle = COL.hudBright;
  ctx.fillRect(146, y0 + 19, Math.round(46 * spd), 9);
  text(ctx, p.facing > 0 ? '>>' : '<<', 196, y0 + 19, COL.cool);

  // --- score
  text(ctx, 'SCORE', 232, y0 + 6);
  text(ctx, String(game.score).padStart(8, '0'), 232, y0 + 18, COL.hudBright);

  // --- hull progress, with the turnaround baked in
  text(ctx, game.returning ? 'RETURN RUN' : 'OUTBOUND', 318, y0 + 6, game.returning ? COL.warmHi : COL.hudText);
  const bx = 318, bw = VIEW_W - bx - 10;
  ctx.fillStyle = '#1a212b';
  ctx.fillRect(bx, y0 + 20, bw, 7);
  const prog = clamp(p.x / LEVEL_LEN, 0, 1);
  ctx.fillStyle = game.returning ? '#3a2d1a' : '#16242b';
  ctx.fillRect(bx, y0 + 20, Math.round(bw * prog), 7);
  ctx.fillStyle = game.returning ? COL.warmHi : COL.cool;
  ctx.fillRect(bx + Math.round(bw * prog) - 1, y0 + 18, 3, 11);
  for (let i = 0; i <= 4; i++) {
    ctx.fillStyle = COL.hudLine;
    ctx.fillRect(bx + Math.round((bw - 1) * (i / 4)), y0 + 28, 1, 3);
  }

  text(ctx, 'BEST ' + String(game.best).padStart(8, '0'), VIEW_W - 10, y0 + 6, COL.hudLine, FONT, 'right');
  // audio state, bottom-right: a muted game should never look like a broken one
  const sym = !audio.audio ? 'SND --' : audio.muted ? 'SND OFF' : 'SND ON';
  text(ctx, sym + '  [M]', VIEW_W - 10, y0 + 18, audio.muted ? COL.danger : COL.hudText, FONT, 'right');

  if (game.banner) drawBanner(ctx, game.banner);
  if (game.state !== 'play' && game.state !== 'dying') drawScreen(ctx, game);
}

function drawBanner(ctx, b) {
  const a = Math.min(1, b.t / 0.5) * Math.min(1, (b.max - b.t) / 0.25);
  ctx.globalAlpha = clamp(a, 0, 1);
  text(ctx, b.text, VIEW_W / 2, 56, COL.hudBright, FONT_BIG, 'center');
  if (b.sub) text(ctx, b.sub, VIEW_W / 2, 82, COL.cool, FONT, 'center');
  ctx.globalAlpha = 1;
}

function drawScreen(ctx, game) {
  ctx.fillStyle = 'rgba(4,6,10,0.78)';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);

  const cx = VIEW_W / 2;
  if (game.state === 'title') {
    text(ctx, "RIVETS 'N RUIN", cx, 96, COL.hudBright, 'bold 30px ui-monospace, Menlo, monospace', 'center');
    text(ctx, 'SKIM THE HULL · BREAK THE GUNS · COME BACK ALIVE', cx, 134, COL.cool, FONT, 'center');
    text(ctx, 'ARROWS / WASD  THRUST      Z / SPACE  FIRE      M  MUTE', cx, 174, COL.hudText, FONT, 'center');
    text(ctx, 'REVERSE THRUST FLIPS THE SHIP — THE HULL SCROLLS BOTH WAYS', cx, 190, COL.hudText, FONT, 'center');
    const pulse = 0.55 + 0.45 * Math.sin(game.stateT * 4);
    ctx.globalAlpha = pulse;
    text(ctx, 'PRESS ENTER TO LAUNCH', cx, 232, COL.warmHi, FONT, 'center');
    ctx.globalAlpha = 1;
  } else if (game.state === 'gameover') {
    text(ctx, 'HULL LOST', cx, 110, COL.danger, FONT_BIG, 'center');
    text(ctx, 'SCORE ' + String(game.score).padStart(8, '0'), cx, 146, COL.hudBright, FONT, 'center');
    text(ctx, 'GUNS BROKEN ' + game.turretsKilled, cx, 162, COL.hudText, FONT, 'center');
    const pulse = 0.55 + 0.45 * Math.sin(game.stateT * 4);
    ctx.globalAlpha = pulse;
    text(ctx, 'ENTER TO FLY AGAIN', cx, 200, COL.warmHi, FONT, 'center');
    ctx.globalAlpha = 1;
  } else if (game.state === 'complete') {
    text(ctx, 'DOCKED', cx, 100, COL.coolHi, FONT_BIG, 'center');
    text(ctx, 'FULL RUN — OUT AND BACK', cx, 128, COL.cool, FONT, 'center');
    text(ctx, 'SCORE ' + String(game.score).padStart(8, '0'), cx, 154, COL.hudBright, FONT, 'center');
    text(ctx, 'TIME ' + game.time.toFixed(1) + 'S   GUNS BROKEN ' + game.turretsKilled, cx, 170, COL.hudText, FONT, 'center');
    const pulse = 0.55 + 0.45 * Math.sin(game.stateT * 4);
    ctx.globalAlpha = pulse;
    text(ctx, 'ENTER TO RUN IT AGAIN', cx, 208, COL.warmHi, FONT, 'center');
    ctx.globalAlpha = 1;
  }
}

export function drawPaused(ctx) {
  ctx.fillStyle = 'rgba(4,6,10,0.7)';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);
  text(ctx, 'PAUSED', VIEW_W / 2, 150, COL.hudBright, FONT_BIG, 'center');
  text(ctx, 'P TO RESUME', VIEW_W / 2, 180, COL.hudText, FONT, 'center');
}
