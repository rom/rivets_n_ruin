import {
  VIEW_W, VIEW_H, FIELD_H, HUD_H, SHIP, LEVELS, LEVEL_UP, COL, clamp,
} from './config.js';
import { netState } from './net.js';
import { PICKUP } from './config.js';
import { tint } from './pickups.js';
import { tuneName, TUNES } from './music.js';
import { activeMod } from './mods.js';

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
  // Label carries the max, because healthbars change it and a bar alone
  // cannot show that its own ceiling moved.
  text(ctx, p.shieldMax > SHIP.shieldMax ? 'SHIELD ' + p.shieldMax : 'SHIELD', 8, y0 + 6,
    p.shieldMax > SHIP.shieldMax ? '#5fe08a' : COL.hudText);
  const segs = 10;
  const filled = Math.ceil(clamp(p.shield / p.shieldMax, 0, 1) * segs);
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
    ctx.moveTo(93 + i * 8, y0 + 28);
    ctx.lineTo(97 + i * 8, y0 + 20);
    ctx.lineTo(101 + i * 8, y0 + 28);
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

  // --- gun upgrade levels
  text(ctx, 'GUNS', 212, y0 + 6);
  for (let i = 0; i < PICKUP.gunLevels; i++) {
    ctx.fillStyle = i < p.gunSpeed ? tint('gunspeed') : '#1a212b';
    ctx.fillRect(212 + i * 6, y0 + 19, 4, 4);
    ctx.fillStyle = i < p.gunBlaze ? tint('gunblaze') : '#1a212b';
    ctx.fillRect(212 + i * 6, y0 + 24, 4, 4);
  }

  // --- score
  text(ctx, 'SCORE', 252, y0 + 6);
  text(ctx, String(game.score).padStart(8, '0'), 252, y0 + 18, COL.hudBright);

  // --- hull progress, with the turnaround baked in
  const spec = game.level.spec;
  text(ctx, (game.returning ? '< ' : '> ') + spec.name
    + '  ' + (game.levelIndex + 1) + '/' + game.specs.length,
    318, y0 + 6, game.returning ? COL.warmHi : COL.cool);
  const bx = 318, bw = VIEW_W - bx - 10;
  ctx.fillStyle = '#1a212b';
  ctx.fillRect(bx, y0 + 20, bw, 7);
  const prog = clamp(p.x / game.level.length, 0, 1);
  ctx.fillStyle = game.returning ? '#3a2d1a' : '#16242b';
  ctx.fillRect(bx, y0 + 20, Math.round(bw * prog), 7);
  ctx.fillStyle = game.returning ? COL.warmHi : COL.cool;
  ctx.fillRect(bx + Math.round(bw * prog) - 1, y0 + 18, 3, 11);
  for (let i = 0; i <= 4; i++) {
    ctx.fillStyle = COL.hudLine;
    ctx.fillRect(bx + Math.round((bw - 1) * (i / 4)), y0 + 28, 1, 3);
  }

  const net = netState();
  const flying = net.flying.length;
  if (net.online && flying > 0) {
    // Other people are on the hull right now. Worth knowing mid-run.
    text(ctx, flying === 1 ? '1 PILOT FLYING' : flying + ' PILOTS FLYING',
      VIEW_W - 10, y0 + 6, COL.cool, FONT, 'right');
  } else {
    text(ctx, 'BEST ' + String(game.best).padStart(8, '0'), VIEW_W - 10, y0 + 6, COL.hudLine, FONT, 'right');
  }
  // audio state, bottom-right: a muted game should never look like a broken one
  const sym = !audio.audio ? 'SND --' : audio.muted ? 'SND OFF' : 'SND ON';
  text(ctx, sym + '  [M]', VIEW_W - 10, y0 + 18, audio.muted ? COL.danger : COL.hudText, FONT, 'right');

  if (game.toast) drawToast(ctx, game.toast);
  if (game.banner) drawBanner(ctx, game.banner);
  if (game.state !== 'play' && game.state !== 'dying') drawScreen(ctx, game);
}

// Says what the pickup just did. Without this the player sees a flash and
// has to infer the effect from the HUD.
function drawToast(ctx, t) {
  const a = Math.min(1, t.t / 0.4);
  ctx.globalAlpha = clamp(a, 0, 1);
  const y = 282 - (1 - Math.min(1, t.t / 1.9)) * 10;
  text(ctx, t.text, VIEW_W / 2, y, tint(t.kind), FONT, 'center');
  ctx.globalAlpha = 1;
}

function drawBanner(ctx, b) {
  const a = Math.min(1, b.t / 0.5) * Math.min(1, (b.max - b.t) / 0.25);
  ctx.globalAlpha = clamp(a, 0, 1);
  text(ctx, b.text, VIEW_W / 2, 56, COL.hudBright, FONT_BIG, 'center');
  if (b.sub) text(ctx, b.sub, VIEW_W / 2, 82, COL.cool, FONT, 'center');
  ctx.globalAlpha = 1;
}

// The top list. Drawn on every non-playing screen, because a score board
// nobody sees is not a score board.
function drawBoard(ctx, x, y, title, rows = 8) {
  const net = netState();
  text(ctx, title, x, y, COL.hudText, FONT);

  if (!net.online) {
    text(ctx, 'BACKEND UNREACHABLE — PLAYING OFFLINE', x, y + 16, COL.hudLine, FONT);
    text(ctx, net.lastError || '', x, y + 29, COL.hudLine, FONT);
    return;
  }
  if (!net.top.length) {
    text(ctx, 'NO RUNS YET — BE FIRST', x, y + 16, COL.hudLine, FONT);
    return;
  }

  const me = net.player ? net.player.id : null;
  net.top.slice(0, rows).forEach((row, i) => {
    const s = row.score;
    const mine = s.playerId === me;
    const col = mine ? COL.warmHi : i === 0 ? COL.coolHi : COL.hudText;
    const ry = y + 16 + i * 12;
    text(ctx, String(row.position).padStart(2, ' '), x, ry, col, FONT);
    text(ctx, s.name.slice(0, 16), x + 22, ry, col, FONT);
    text(ctx, String(s.points).padStart(8, '0'), x + 150, ry, col, FONT);
    if (s.completed) text(ctx, 'OK', x + 216, ry, COL.cool, FONT);
  });
}

// The hull just cleared, which is one behind the index after advancing.
const spec0 = (game) => game.specs[game.levelIndex];

function drawScreen(ctx, game) {
  ctx.fillStyle = 'rgba(4,6,10,0.80)';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);

  const cx = VIEW_W / 2;
  const net = netState();
  const pulse = 0.55 + 0.45 * Math.sin(game.stateT * 4);
  const BOARD_X = 186;

  if (game.state === 'title') {
    text(ctx, "RIVETS 'N RUIN", cx, 34, COL.hudBright, 'bold 30px ui-monospace, Menlo, monospace', 'center');
    text(ctx, 'SKIM THE HULL · BREAK THE GUNS · COME BACK ALIVE', cx, 72, COL.cool, FONT, 'center');

    const mod = activeMod();
    if (mod) {
      text(ctx, 'MOD: ' + mod.name.toUpperCase() + ' BY ' + mod.author.toUpperCase(), cx, 78, COL.warmHi, FONT, 'center');
    }

    text(ctx, LEVELS.map((l) => l.name).join('  ·  '), cx, 92, COL.cool, FONT, 'center');
    text(ctx, 'ARROWS / WASD  THRUST    Z / SPACE  FIRE    M  MUTE    T  TUNE', cx, 112, COL.hudText, FONT, 'center');
    text(ctx, 'REVERSE THRUST FLIPS THE SHIP — THE HULL SCROLLS BOTH WAYS', cx, 126, COL.hudText, FONT, 'center');

    if (net.online && net.player) {
      text(ctx, 'PILOT ' + net.player.name.toUpperCase() + '   [N] RENAME', cx, 146, COL.cool, FONT, 'center');
    }
    text(ctx, 'TUNE ' + tuneName() + '   BEST ' + String(game.best).padStart(8, '0'),
      cx, 158, COL.hudLine, FONT, 'center');

    ctx.globalAlpha = pulse;
    text(ctx, 'PRESS ENTER TO LAUNCH', cx, 168, COL.warmHi, FONT, 'center');
    ctx.globalAlpha = 1;

    drawBoard(ctx, BOARD_X, 196, 'TOP PILOTS', 6);
    return;
  }

  // Between hulls: show what the ship just gained, then carry on.
  if (game.state === 'levelclear') {
    const next = game.specs[game.levelIndex + 1];
    const p = game.player;
    text(ctx, spec0(game).name + ' CLEARED', cx, 30, COL.coolHi, FONT_BIG, 'center');
    text(ctx, 'SCORE ' + String(game.score).padStart(8, '0')
      + '    TIME ' + game.time.toFixed(1) + 'S', cx, 58, COL.hudText, FONT, 'center');

    text(ctx, 'REFIT COMPLETE', cx, 84, COL.warmHi, FONT, 'center');
    // The refit is already applied by the time this draws, so these are the
    // ship's real new numbers; the +N is what this hull just bought you.
    const rows = [
      ['HULL PLATING', p.shieldMax + ' SHIELD', '+' + LEVEL_UP.shieldMax],
      ['THRUSTERS', Math.round((p.accelMul - 1) * 100) + '% ACCEL  +' + p.maxVXBonus + ' TOP SPEED',
        '+' + Math.round((LEVEL_UP.accelMul - 1) * 100) + '%'],
      ['CANNON', '+' + p.bulletBonus + ' MUZZLE   ' + p.gunCap + ' MOUNTS', '+' + LEVEL_UP.gunCap],
      ['ARMOURY', 'GUNSPEED ' + p.gunSpeed + '   GUNBLAZE ' + p.gunBlaze, '+1 EACH'],
      ['HANGAR', p.lives + ' SHIPS', '+' + LEVEL_UP.lives],
    ];
    rows.forEach(([k, v, d], i) => {
      const ry = 106 + i * 14;
      text(ctx, k, 128, ry, COL.hudText, FONT);
      text(ctx, v, 250, ry, COL.coolHi, FONT);
      text(ctx, d, 462, ry, '#5fe08a', FONT);
    });

    text(ctx, 'NEXT HULL: ' + next.name, cx, 186, COL.warmHi, FONT, 'center');
    text(ctx, next.subtitle, cx, 200, COL.hudText, FONT, 'center');
    text(ctx, 'TUNE ' + (TUNES[next.tune] ? TUNES[next.tune].name : tuneName()), cx, 216, COL.hudLine, FONT, 'center');
    ctx.globalAlpha = pulse;
    text(ctx, 'ENTER TO LAUNCH', cx, 240, COL.warmHi, FONT, 'center');
    ctx.globalAlpha = 1;
    return;
  }

  if (game.state === 'gameover') {
    text(ctx, 'HULL LOST', cx, 34, COL.danger, FONT_BIG, 'center');
  } else {
    text(ctx, 'CAMPAIGN COMPLETE', cx, 34, COL.coolHi, FONT_BIG, 'center');
    text(ctx, 'ALL THREE HULLS — OUT AND BACK', cx, 60, COL.cool, FONT, 'center');
  }

  const infoY = game.state === 'victory' ? 80 : 68;
  text(ctx, 'SCORE ' + String(game.score).padStart(8, '0'), cx, infoY, COL.hudBright, FONT, 'center');
  text(ctx, 'TIME ' + game.time.toFixed(1) + 'S    GUNS BROKEN ' + game.turretsKilled
    + '    LOSSES ' + game.deaths, cx, infoY + 14, COL.hudText, FONT, 'center');
  drawRankLine(ctx, cx, infoY + 32);

  ctx.globalAlpha = pulse;
  text(ctx, game.state === 'victory' ? 'ENTER TO RUN IT AGAIN' : 'ENTER TO FLY AGAIN',
    cx, infoY + 52, COL.warmHi, FONT, 'center');
  ctx.globalAlpha = 1;

  drawBoard(ctx, BOARD_X, infoY + 76, 'TOP PILOTS', 6);
}

// Where that run put you. Blank until the backend answers.
function drawRankLine(ctx, cx, y) {
  const net = netState();
  if (!net.online) {
    text(ctx, 'RUN NOT RECORDED — BACKEND UNREACHABLE', cx, y, COL.danger, FONT, 'center');
    return;
  }
  if (net.rank && net.rank.position) {
    // Total comes from /api/stats, not the visible rows — the board is capped
    // at six, so counting rows would report "3 OF 6" out of fifty players.
    const total = net.stats ? Math.max(net.stats.players, net.rank.position) : net.rank.position;
    text(ctx, 'YOU PLACE ' + net.rank.position + ' OF ' + total, cx, y, COL.warmHi, FONT, 'center');
  } else {
    text(ctx, 'SENDING RUN...', cx, y, COL.hudLine, FONT, 'center');
  }
}

export function drawPaused(ctx) {
  ctx.fillStyle = 'rgba(4,6,10,0.7)';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);
  text(ctx, 'PAUSED', VIEW_W / 2, 150, COL.hudBright, FONT_BIG, 'center');
  text(ctx, 'P TO RESUME', VIEW_W / 2, 180, COL.hudText, FONT, 'center');
}
