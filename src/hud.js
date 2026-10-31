import {
  VIEW_W, VIEW_H, FIELD_H, HUD_H, SHIP, LEVELS, LEVEL_UP, THEMES, COL, clamp,
} from './config.js';
import { netState } from './net.js';
import { PICKUP, ARMORY, APRON } from './config.js';
import { tint, pickups, isTreasure } from './pickups.js';
import { minis } from './miniboss.js';
import { radarProfile } from './level.js';
import { tuneName, TUNES } from './music.js';
import { get as setting, DEFS, display } from './settings.js';
import { rows as shopRows, MODS } from './shop.js';
import { drawSplash, drawLaunchBanner, drawLandingBanner,
  SPLASH_TIME, LAUNCH_TIME, LANDING_TIME, ENDING_TIME } from './sequences.js';
import { VERSION } from './config.js';
import { livingParts, shellUp } from './boss.js';
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

  // One place for the column positions, so adding a readout is a question of
  // changing numbers here rather than discovering a collision in a
  // screenshot. Every block is laid out as label on row 1, value on row 2.
  const X = {
    shield: 8, ships: 86, vel: 130, guns: 190,
    armory: 222, score: 320, prog: 392,
  };
  const L = y0 + 6;      // label row
  const V = y0 + 18;     // value row

  // --- shield. The label carries the max, because healthbars move it and a
  // bar alone cannot show that its own ceiling changed.
  const boosted = p.shieldMax > SHIP.shieldMax;
  text(ctx, boosted ? 'SHIELD ' + p.shieldMax : 'SHIELD', X.shield, L,
    boosted ? '#5fe08a' : COL.hudText);
  const segs = 10;
  const filled = Math.ceil(clamp(p.shield / p.shieldMax, 0, 1) * segs);
  for (let i = 0; i < segs; i++) {
    const on = i < filled;
    ctx.fillStyle = !on ? '#1a212b' : filled <= 3 ? COL.danger : filled <= 6 ? COL.warmHi : COL.cool;
    ctx.fillRect(X.shield + i * 7, V + 1, 5, 9);
  }

  // --- ships
  text(ctx, 'SHIPS', X.ships, L);
  for (let i = 0; i < Math.max(0, p.lives); i++) {
    ctx.fillStyle = COL.cool;
    ctx.beginPath();
    ctx.moveTo(X.ships + i * 7, V + 10);
    ctx.lineTo(X.ships + 3.5 + i * 7, V + 2);
    ctx.lineTo(X.ships + 7 + i * 7, V + 10);
    ctx.closePath();
    ctx.fill();
  }

  // --- velocity and heading
  text(ctx, 'VEL', X.vel, L);
  const spd = Math.abs(p.vx) / (SHIP.maxVX + (p.maxVXBonus || 0));
  ctx.fillStyle = '#1a212b';
  ctx.fillRect(X.vel, V + 1, 38, 9);
  ctx.fillStyle = COL.hudBright;
  ctx.fillRect(X.vel, V + 1, Math.round(38 * clamp(spd, 0, 1)), 9);
  text(ctx, p.facing > 0 ? '>>' : '<<', X.vel + 42, V, COL.cool);

  // --- gun upgrade levels, two rows of pips
  text(ctx, 'GUNS', X.guns, L);
  for (let i = 0; i < p.gunCap; i++) {
    ctx.fillStyle = i < p.gunSpeed ? tint('gunspeed') : '#1a212b';
    ctx.fillRect(X.guns + i * 5, V + 1, 3, 4);
    ctx.fillStyle = i < p.gunBlaze ? tint('gunblaze') : '#1a212b';
    ctx.fillRect(X.guns + i * 5, V + 6, 3, 4);
  }

  // --- armory: three slots, the selected one lit
  text(ctx, 'ARMORY', X.armory, L);   // key hints live on the title screen
  ARMORY.order.forEach((kind, i) => {
    const spec = ARMORY[kind];
    const n = p.ammo ? (p.ammo[kind] || 0) : 0;
    const sel = p.secondary === kind;
    const ax = X.armory + i * 31;
    ctx.fillStyle = sel ? '#1e2630' : '#13191f';
    ctx.fillRect(ax, V, 28, 12);
    if (sel) { ctx.fillStyle = spec.colour; ctx.fillRect(ax, V, 28, 1); }
    text(ctx, spec.short, ax + 2, V + 2, n ? spec.colour : '#2b3440', FONT);
    text(ctx, String(n), ax + 26, V + 2, n ? COL.hudBright : '#2b3440', FONT, 'right');
  });

  // --- score
  text(ctx, 'SCORE', X.score, L);
  text(ctx, String(game.score).padStart(8, '0'), X.score, V, COL.hudBright);

  // --- the hull, and the two running totals the end-of-hull bonus pays on.
  // Where you are is the radar's job; this is how well you are doing it.
  const spec = game.level.spec;
  text(ctx, (game.returning ? '< ' : '> ') + spec.name
    + '  ' + (game.levelIndex + 1) + '/' + game.specs.length,
    X.prog, L, game.returning ? COL.warmHi : COL.cool);

  const guns = game.level.turrets;
  const broken = guns.reduce((n, t) => n + (t.dead ? 1 : 0), 0);
  const all = broken === guns.length && guns.length > 0;
  text(ctx, 'GUNS', X.prog, V, COL.hudText);
  text(ctx, broken + '/' + guns.length, X.prog + 32, V, all ? '#5fe08a' : COL.hudBright);

  const h = game.hullHaul;
  if (h) {
    const bits = [h.coins + 'c'];
    if (h.bars) bits.push(h.bars + 'b');
    if (h.coffins) bits.push(h.coffins + 'f');
    if (h.treasures) bits.push(h.treasures + 't');
    text(ctx, bits.join(' '), X.prog + 92, V, '#ffd24a');
  }

  const net = netState();
  const flying = net.flying.length;
  if (net.online && flying > 0) {
    text(ctx, flying === 1 ? '1 FLYING' : flying + ' FLYING', VIEW_W - 10, V + 12, COL.cool, FONT, 'right');
  }

  const sym = !audio.audio ? 'SND --' : audio.muted ? 'SND OFF' : 'SND ON';
  text(ctx, sym, VIEW_W - 64, V + 12, audio.muted ? COL.danger : COL.hudLine, FONT, 'right');

  if (setting('radar') && (game.state === 'play' || game.state === 'dying')) {
    drawRadar(ctx, game);
  }
  if (game.boss) drawBossBar(ctx, game.boss);
  if (game.toast && setting('damageNumbers')) drawToast(ctx, game.toast);
  if (game.banner) drawBanner(ctx, game.banner);
  if (game.state === 'launching') drawLaunchBanner(ctx, game, clamp(game.stateT / LAUNCH_TIME, 0, 1));
  else if (game.state === 'landing') drawLandingBanner(ctx, game, clamp(game.stateT / LANDING_TIME, 0, 1));
  else if (game.state !== 'play' && game.state !== 'dying') drawScreen(ctx, game);
}

// Boss health, across the top of the playfield. Shows the shell separately
// from the core, because "my shots are doing nothing" needs an answer on
// screen rather than only in the sound.
// Boss health. Two bars rather than one, because while the shell is up the
// core takes no damage — so a single bar driven by core health sat
// completely still through the entire first phase and showed no progress
// for the work actually being done.
function drawBossBar(ctx, b) {
  if (b.entry > 0) return;
  const w = 420;
  const x = (VIEW_W - w) / 2;
  const plated = shellUp(b);

  text(ctx, b.name, VIEW_W / 2, 8, COL.hudBright, FONT, 'center');

  // --- the core, always shown; dim while it cannot be hurt
  ctx.fillStyle = '#10141b';
  ctx.fillRect(x - 2, 21, w + 4, 9);
  const frac = Math.max(0, b.hp / b.maxHp);
  ctx.fillStyle = plated ? '#2a3140' : frac < 0.34 ? COL.danger : COL.warm;
  ctx.fillRect(x, 23, Math.round(w * frac), 5);
  // segment ticks, so a long bar still reads as a quantity
  ctx.fillStyle = '#10141b';
  for (let i = 1; i < 10; i++) ctx.fillRect(x + Math.round(w * i / 10), 23, 1, 5);

  if (!b.parts.length) return;

  // --- the shell: total remaining section health, which is what your
  // shots are actually reducing in the first phase
  const total = b.parts.reduce((a, p) => a + p.maxHp, 0);
  const left = b.parts.reduce((a, p) => a + Math.max(0, p.hp), 0);
  const sfrac = total ? left / total : 0;

  ctx.fillStyle = '#10141b';
  ctx.fillRect(x - 2, 33, w + 4, 7);
  ctx.fillStyle = plated ? COL.warmHi : '#243040';
  ctx.fillRect(x, 34, Math.round(w * sfrac), 5);
  // one divider per section, so you can see which is next to go
  ctx.fillStyle = '#10141b';
  for (let i = 1; i < b.parts.length; i++) {
    ctx.fillRect(x + Math.round(w * i / b.parts.length), 34, 1, 5);
  }

  if (plated) {
    text(ctx, 'ARMOUR HOLDING — ' + livingParts(b).length + '/' + b.parts.length + ' SECTIONS',
      VIEW_W / 2, 43, COL.warmHi, FONT, 'center');
  } else {
    text(ctx, 'ARMOUR BREACHED — CORE EXPOSED', VIEW_W / 2, 43, COL.danger, FONT, 'center');
  }
}

// Says what a pickup just did. Without this the player sees a flash and has
// to infer the effect from the HUD.
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
// "when" as a relative age, which is what a leaderboard reader actually
// wants to know: a run from four minutes ago means something different from
// one from last March.
function ago(iso) {
  if (!iso) return '';
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(secs) || secs < 0) return '';
  if (secs < 60) return 'JUST NOW';
  if (secs < 3600) return Math.floor(secs / 60) + 'M AGO';
  if (secs < 86400) return Math.floor(secs / 3600) + 'H AGO';
  if (secs < 86400 * 30) return Math.floor(secs / 86400) + 'D AGO';
  return new Date(iso).toISOString().slice(2, 10);   // YY-MM-DD, eight characters like the rest
}

// The score board. Ten rows is what was asked for, and ten rows stacked
// vertically do not fit under either screen that shows them, so they run in
// two columns of five — which is also how an arcade board looked.
const BOARD_COLW = 176;
const BOARD_GAP = 8;
export const BOARD_W = BOARD_COLW * 2 + BOARD_GAP;

function drawBoard(ctx, x, y, rows = 10) {
  const net = netState();
  const runs = net.board === 'runs';
  // Two different questions: who is best, and what are the best runs. The
  // second lets one pilot hold several places, which the first hides.
  text(ctx, (runs ? 'HIGH SCORES' : 'TOP PILOTS') + '   [B]', x, y, COL.hudText, FONT);
  text(ctx, runs ? 'BEST RUNS, HIGHEST FIRST' : 'EACH PILOT\u2019S BEST RUN',
    x + BOARD_W, y, COL.hudLine, FONT, 'right');

  if (!net.online) {
    text(ctx, 'BACKEND UNREACHABLE — PLAYING OFFLINE', x, y + 16, COL.hudLine, FONT);
    text(ctx, net.lastError || '', x, y + 29, COL.hudLine, FONT);
    return;
  }
  const me = net.player ? net.player.id : null;
  const list = runs ? net.runs : net.top;
  if (!list.length) {
    text(ctx, 'NO RUNS YET — BE FIRST', x, y + 16, COL.hudLine, FONT);
    return;
  }

  const shown = list.slice(0, rows);
  const perCol = Math.ceil(Math.min(rows, Math.max(shown.length, 1)) / 2);
  shown.forEach((row, i) => {
    const s = row.score;
    const mine = s.playerId === me;
    const col = mine ? COL.warmHi : i === 0 ? COL.coolHi : COL.hudText;
    const cx0 = x + (i < perCol ? 0 : BOARD_COLW + BOARD_GAP);
    const ry = y + 16 + (i % perCol) * 12;
    text(ctx, String(row.position).padStart(2, ' '), cx0, ry, col, FONT);
    text(ctx, s.name.slice(0, 9), cx0 + 16, ry, col, FONT);
    text(ctx, String(s.points).padStart(8, '0'), cx0 + 72, ry, col, FONT);
    text(ctx, ago(s.created), cx0 + BOARD_COLW, ry, s.completed ? COL.cool : COL.hudLine, FONT, 'right');
  });
}

// ------------------------------------------------------------------ radar
//
// The old progress bar answered one question — how far along am I — and the
// hull is 25,000px of structure with guns, minibosses, treasure and a boss
// on it. This is a strip across the top of the playfield showing all of it
// at once, so a decision to turn back for something is a decision you can
// actually make.
//
// Everything is placed by x only: 640px of strip against 25,000px of hull
// is 39:1, so vertical position would be a lie. Height encodes what a thing
// IS, not where it is.
// Three bands, because one band is noise. Top structure hangs down, bottom
// structure stands up, and the clear lane between them is where everything
// you might fly to is marked. A gun sits on the inner edge of its own band,
// which is where it actually sits on the hull.
const RADAR = {
  y: 0, h: 23,
  topY: 1, topH: 8,      // structure hanging from the upper girder
  laneY: 9, laneH: 6,    // the corridor, and everything in it
  botY: 15, botH: 7,     // structure standing on the lower girder
};

export function drawRadar(ctx, game) {
  const level = game.level;
  const R = RADAR;
  const W = VIEW_W;
  const laneMid = R.laneY + R.laneH / 2;
  const botEnd = R.botY + R.botH;

  // The strip overlaps the top of the playfield, and skimming the upper
  // girder is a normal way to fly. So it gets out of the way: full strength
  // while you are anywhere else, nearly transparent while you are under it.
  const p = game.player;
  const clear = clamp((p.y - 24) / 40, 0, 1);
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.65 * clear;

  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, R.y, W, R.h);
  // the lane is lighter than the structure, so a marker in it always reads
  ctx.fillStyle = '#0e141c';
  ctx.fillRect(0, R.laneY, W, R.laneH);
  ctx.fillStyle = COL.hudLine;
  ctx.fillRect(0, R.y + R.h - 1, W, 1);

  const at = (wx) => (clamp(wx, 0, level.length) / level.length) * W;

  // --- the aprons: launch and dock, the two places nothing shoots at you
  ctx.fillStyle = '#101a26';
  ctx.fillRect(0, R.laneY, at(APRON), R.laneH);
  const dock = at(level.length - APRON);
  ctx.fillRect(dock, R.laneY, W - dock, R.laneH);

  // --- the hull, as a silhouette. One flat colour: two tones at this size
  // made terrain look like markers.
  const prof = radarProfile(level, W);
  ctx.fillStyle = '#39424f';
  for (let c = 0; c < W; c++) {
    const t = prof.top[c];
    if (t) ctx.fillRect(c, R.topY, 1, Math.max(1, Math.round((t / 15) * R.topH)));
    const b = prof.bot[c];
    if (b) {
      const hgt = Math.max(1, Math.round((b / 15) * R.botH));
      ctx.fillRect(c, botEnd - hgt, 1, hgt);
    }
  }

  // --- guns, on the inner edge of whichever surface they are mounted on.
  // Dead ones stay, dimmed: what you have already broken matters as much as
  // what you have not, and the bonus is paid on the ratio.
  for (const t of level.turrets) {
    const tx = Math.round(at(t.x));
    const up = t.dir === 1;             // mounted on the top girder, firing down
    if (t.dead) {
      ctx.fillStyle = '#242c37';
      ctx.fillRect(tx, up ? R.topY + R.topH - 1 : R.botY, 1, 1);
      continue;
    }
    ctx.fillStyle = (t.tower && t.tower.colour) || COL.danger;
    ctx.fillRect(tx, up ? R.topY + R.topH - 3 : R.botY, 1, 3);
  }

  // --- loot in the lane, sized by what it is worth stopping for
  for (let i = 0; i < pickups.count; i++) {
    const p = pickups.items[i];
    const px = Math.round(at(p.x));
    if (isTreasure(p.kind)) {
      ctx.fillStyle = tint(p.kind);
      ctx.fillRect(px - 1, R.laneY, 3, R.laneH);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, R.laneY + 2, 1, 2);
    } else if (p.kind === 'coffin') {
      ctx.fillStyle = tint('coffin');
      ctx.fillRect(px, R.laneY, 1, R.laneH);
    } else if (p.kind === 'goldbar') {
      ctx.fillStyle = tint('goldbar');
      ctx.fillRect(px, R.laneY + 1, 1, R.laneH - 2);
    } else if (p.kind === 'coin') {
      ctx.fillStyle = '#6e5c2a';
      ctx.fillRect(px, laneMid - 1, 1, 2);
    } else {
      ctx.fillStyle = '#2f6a7a';      // an upgrade crate
      ctx.fillRect(px, R.laneY + 1, 1, R.laneH - 2);
    }
  }

  // --- minibosses, and the ones still waiting further along
  if (game.miniPlan) {
    for (const slot of game.miniPlan) {
      if (slot.spawned) continue;
      ctx.strokeStyle = '#53606f';
      ctx.lineWidth = 1;
      diamondOutline(ctx, Math.round(at(slot.x)), laneMid, 4);
    }
  }
  for (let i = 0; i < minis.count; i++) {
    const m = minis.items[i];
    if (m.dead) continue;
    diamond(ctx, Math.round(at(m.x)), laneMid, 5, m.spec.colour);
  }

  // --- the arena at the far end, lit red once the boss is actually up
  const ax = at(level.length - VIEW_W);
  const live = game.boss && !game.boss.dead;
  ctx.fillStyle = live ? '#5a1a22' : '#2a2030';
  ctx.fillRect(ax, R.topY, W - ax, R.h - 2);
  text(ctx, 'BOSS', W - 3, R.laneY - 2, live ? '#ff8a92' : '#6b5563', FONT, 'right');

  // --- what you can see, and where you are in it
  const vx0 = at(game.cam.x);
  const vw = Math.max(3, (VIEW_W / level.length) * W);
  ctx.strokeStyle = '#7b8696';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(vx0) + 0.5, R.y + 1.5, Math.round(vw), R.h - 4);

  const px = Math.round(at(p.x));
  ctx.fillStyle = game.returning ? COL.warmHi : COL.coolHi;
  ctx.fillRect(px - 1, R.y + 1, 3, R.h - 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px, R.y + 1, 1, R.h - 2);
  ctx.restore();
}

function diamond(ctx, x, y, r, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
  ctx.closePath(); ctx.fill();
}

function diamondOutline(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y - r); ctx.lineTo(x + r + 0.5, y);
  ctx.lineTo(x + 0.5, y + r); ctx.lineTo(x - r + 0.5, y);
  ctx.closePath(); ctx.stroke();
}

// What the hull paid, itemised. The number alone tells you nothing about
// which of the three things you did well, which is the only reason to show
// a breakdown rather than a total.
function drawBonus(ctx, game, x, y) {
  const b = game.bonus;
  text(ctx, 'HULL BONUS', x, y, COL.warmHi, FONT);
  if (!b) {
    text(ctx, 'NOT RECORDED', x, y + 14, COL.hudLine, FONT);
    return;
  }
  const W = 268;
  // reveal one line at a time, so the total is read as it is counted
  const shown = Math.min(b.lines.length, Math.floor(Math.max(0, game.stateT - 0.5) / 0.22));
  let ry = y + 15;
  b.lines.forEach((line, i) => {
    if (i >= shown) return;
    const on = line.points > 0;
    text(ctx, line.label, x, ry, on ? COL.hudBright : COL.hudLine, FONT);
    text(ctx, (on ? '+' : '') + line.points.toLocaleString(), x + W, ry,
      on ? '#5fe08a' : COL.hudLine, FONT, 'right');
    // The haul line names four kinds of loot and will not fit beside its own
    // number, so it gets the row underneath rather than running into it.
    if (line.detail.length > 22) {
      ry += 11;
      text(ctx, line.detail, x + 10, ry, COL.hudLine, FONT);
    } else {
      text(ctx, line.detail, x + 104, ry, on ? COL.hudText : COL.hudLine, FONT);
    }
    ry += 12;
  });
  if (shown >= b.lines.length) {
    ctx.fillStyle = COL.hudLine;
    ctx.fillRect(x, ry + 2, W, 1);
    text(ctx, 'TOTAL', x, ry + 6, COL.warmHi, FONT);
    text(ctx, '+' + b.total.toLocaleString(), x + W, ry + 6, COL.warmHi, FONT, 'right');
  }
}

// The ship, as it now stands: what the refit built in, and what was bought.
// Mods were invisible here, so the one screen that is meant to answer "what
// am I flying" left out the half of the answer you paid coins for.
function drawFit(ctx, game, x, y) {
  const p = game.player;
  const W = 272;   // x + W must stay inside VIEW_W
  text(ctx, 'REFIT COMPLETE', x, y, COL.warmHi, FONT);
  const refit = [
    ['SHIELD', String(p.shieldMax)],
    ['ACCEL', '+' + Math.round((p.accelMul - 1) * 100) + '%'],
    ['TOP SPEED', '+' + p.maxVXBonus],
    ['GUN SPEED', p.gunSpeed + '/' + p.gunCap],
    ['GUN SPREAD', p.gunBlaze + '/' + p.gunCap],
    ['SHIPS', String(p.lives)],
  ];
  let ry = y + 15;
  for (const [k, v] of refit) {
    text(ctx, k, x, ry, COL.hudText, FONT);
    text(ctx, v, x + W, ry, '#5fe08a', FONT, 'right');
    ry += 12;
  }

  ry += 6;
  const owned = Object.keys(MODS).filter((id) => game.mods && game.mods[id]);
  text(ctx, 'MODS FITTED  ' + owned.length + '/' + Object.keys(MODS).length,
    x, ry, owned.length ? COL.warmHi : COL.hudLine, FONT);
  ry += 15;
  if (!owned.length) {
    text(ctx, 'NONE \u2014 E AT THE ARMOURER', x, ry, COL.hudLine, FONT);
    return;
  }
  for (const id of owned) {
    ctx.fillStyle = '#ffd24a';
    ctx.fillRect(x, ry + 3, 4, 4);
    text(ctx, MODS[id].name, x + 9, ry, '#ffd24a', FONT);
    ry += 12;
  }
}

// The hull just cleared, which is one behind the index after advancing.
const spec0 = (game) => game.specs[game.levelIndex];

function drawScreen(ctx, game) {
  if (game.state === 'splash') { drawSplash(ctx, game.stateT); return; }
  if (game.state === 'ending') { drawEnding(ctx, game); return; }

  ctx.fillStyle = 'rgba(4,6,10,0.80)';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);

  const cx = VIEW_W / 2;
  const net = netState();
  const pulse = 0.55 + 0.45 * Math.sin(game.stateT * 4);
  const BOARD_X = Math.round((VIEW_W - BOARD_W) / 2);

  if (game.state === 'title') {
    text(ctx, "RIVETS 'N RUIN", cx, 34, COL.hudBright, 'bold 30px ui-monospace, Menlo, monospace', 'center');
    text(ctx, 'SKIM THE HULL · BREAK THE GUNS · COME BACK ALIVE', cx, 72, COL.cool, FONT, 'center');

    const mod = activeMod();
    if (mod) {
      text(ctx, 'MOD: ' + mod.name.toUpperCase() + ' BY ' + mod.author.toUpperCase(), cx, 78, COL.warmHi, FONT, 'center');
    }

    text(ctx, LEVELS.map((l) => l.name).join('  ·  '), cx, 92, COL.cool, FONT, 'center');
    text(ctx, 'ARROWS THRUST  Z FIRE  X ORDNANCE  C CYCLE  M MUTE  T TUNE  Q QUIT', cx, 112, COL.hudText, FONT, 'center');
    text(ctx, 'REVERSE THRUST FLIPS THE SHIP — THE HULL SCROLLS BOTH WAYS', cx, 126, COL.hudText, FONT, 'center');

    if (net.online && net.player) {
      text(ctx, 'PILOT ' + net.player.name.toUpperCase() + '   [N] RENAME', cx, 146, COL.cool, FONT, 'center');
    }
    text(ctx, 'TUNE ' + tuneName() + '   BEST ' + String(game.best).padStart(8, '0'),
      cx, 158, COL.hudLine, FONT, 'center');

    // --- hull select
    const sel = game.specs[game.startHull];
    const canLeft = game.startHull > 0;
    const canRight = game.startHull < game.unlocked;
    text(ctx, canLeft ? '<' : ' ', cx - 112, 166, canLeft ? COL.cool : '#20262e', FONT_BIG, 'center');
    text(ctx, canRight ? '>' : ' ', cx + 112, 166, canRight ? COL.cool : '#20262e', FONT_BIG, 'center');
    text(ctx, sel.name + '   ' + (game.startHull + 1) + '/' + game.specs.length,
      cx, 170, COL.hudBright, FONT, 'center');
    text(ctx, game.unlocked > 0
      ? 'ARROWS SELECT HULL — REACHED ' + game.specs[game.unlocked].name
      : 'CLEAR A HULL TO UNLOCK THE NEXT',
      cx, 186, COL.hudText, FONT, 'center');

    ctx.globalAlpha = pulse;
    text(ctx, 'PRESS ENTER TO LAUNCH', cx, 204, COL.warmHi, FONT, 'center');
    ctx.globalAlpha = 1;
    text(ctx, 'O  SETTINGS', cx, 218, COL.hudText, FONT, 'center');

    drawBoard(ctx, BOARD_X, 236, 10);
    return;
  }

  // Between hulls: the refit, and a look at what you are flying into. The
  // next hull being bigger is the headline, so it is shown as a drawn
  // comparison rather than a number — you should see the step up.
  if (game.state === 'levelclear') {
    const cur = spec0(game);
    const next = game.specs[game.levelIndex + 1];
    const p = game.player;
    const curTheme = THEMES[cur.theme] || THEMES.steel;
    const nextTheme = THEMES[next.theme] || THEMES.steel;

    text(ctx, cur.name + ' CLEARED', cx, 12, COL.coolHi, FONT_BIG, 'center');
    text(ctx, 'SCORE ' + String(game.score).padStart(8, '0')
      + '    TIME ' + game.time.toFixed(1) + 'S', cx, 38, COL.hudText, FONT, 'center');

    // --- the hulls, to scale against each other
    const BX = 110;
    const BW = VIEW_W - BX * 2;
    const longest = Math.max(cur.length, next.length);
    const grow = Math.min(1, (game.stateT - 0.3) / 0.9);   // animates in

    const row = (y, spec, theme, frac, label, dim) => {
      const w = Math.max(6, Math.round(BW * (spec.length / longest) * frac));
      ctx.globalAlpha = dim ? 0.45 : 1;
      ctx.fillStyle = '#0a0d13';
      ctx.fillRect(BX, y, BW, 11);
      ctx.fillStyle = theme.mid;
      ctx.fillRect(BX, y, w, 11);
      ctx.fillStyle = theme.rimDark;
      ctx.fillRect(BX, y, w, 2);
      ctx.fillRect(BX, y + 9, w, 2);
      ctx.fillStyle = theme.rivet;
      for (let rx = BX + 5; rx < BX + w - 3; rx += 12) ctx.fillRect(rx, y + 4, 2, 2);
      ctx.fillStyle = theme.edgeHi;
      ctx.fillRect(BX + w - 2, y, 2, 11);
      ctx.globalAlpha = 1;
      text(ctx, label, BX, y - 10, dim ? COL.hudLine : COL.hudBright, FONT);
      text(ctx, (spec.length / 1000).toFixed(1) + 'K', BX + BW + 6, y + 1,
        dim ? COL.hudLine : COL.coolHi, FONT);
    };

    row(68, cur, curTheme, 1, 'FLOWN: ' + cur.name, true);
    row(100, next, nextTheme, grow, 'NEXT: ' + next.name, false);

    // --- what is new about it
    const newFoes = (next.foes || []).filter((f) => !(cur.foes || []).includes(f));
    const newTowers = (next.towers || []).filter((t) => !(cur.towers || []).includes(t));
    const bits = [
      '+' + Math.round(next.length - cur.length).toLocaleString() + ' PX',
      'TURRETS ' + cur.turretHp + ' \u2192 ' + next.turretHp + ' HP',
      'TRAFFIC +' + Math.round((cur.interceptorSpawn / next.interceptorSpawn - 1) * 100) + '%',
    ];
    if (newTowers.length) bits.push('GUNS: ' + newTowers.join(', ').toUpperCase());
    if (newFoes.length) bits.push('NEW: ' + newFoes.join(', ').toUpperCase());
    text(ctx, bits.join('   \u00b7   '), cx, 120, COL.warmHi, FONT, 'center');

    // --- two columns: what the hull paid, and what the ship now is
    const LX = 24;
    const RX = 338;
    drawBonus(ctx, game, LX, 142);
    drawFit(ctx, game, RX, 142);

    ctx.globalAlpha = pulse;
    text(ctx, 'ENTER TO LAUNCH', cx, 296, COL.warmHi, FONT, 'center');
    ctx.globalAlpha = 1;
    text(ctx, 'E  ARMOURER     ' + (game.coins || 0) + ' COINS', cx, 310, '#ffd24a', FONT, 'center');
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
  if (game.coins || game.coffins) {
    text(ctx, 'COINS ' + (game.coins || 0)
      + (game.coffins ? '    GOLD COFFINS ' + game.coffins : ''),
      cx, infoY + 28, '#ffd24a', FONT, 'center');
  }
  drawRankLine(ctx, cx, infoY + 44);

  ctx.globalAlpha = pulse;
  text(ctx, game.state === 'victory' ? 'ENTER TO RUN IT AGAIN' : 'ENTER TO FLY AGAIN',
    cx, infoY + 62, COL.warmHi, FONT, 'center');
  ctx.globalAlpha = 1;

  drawBoard(ctx, BOARD_X, infoY + 84, 10);
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

// Quit confirmation. Deliberately unmissable, and deliberately not defaulted
// to yes: Q sits next to W and A and will get hit by accident.
// The settings screen. Driven entirely from DEFS, so adding a setting adds
// a row here without touching this function.
// The shop, between hulls. Coins are the only currency and there are never
// enough, which is the point: the interesting choice is what to go without.
// The ending: the ship settles onto the admiralty pad and the run is
// totalled while it cools. Earned once in a campaign, so it is allowed to
// take its time — but ENTER skips it.
function drawEnding(ctx, game) {
  const t = game.stateT;
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);
  const cx = VIEW_W / 2;

  // starfield drifting past, then the pad rising into frame
  for (let i = 0; i < 90; i++) {
    const sx = (i * 97 + t * (10 + (i % 5) * 7)) % VIEW_W;
    const sy = (i * 53) % FIELD_H;
    ctx.fillStyle = i % 7 === 0 ? '#dfe6ff' : '#4a5270';
    ctx.fillRect(VIEW_W - sx, sy, 1, 1);
  }

  const land = clamp((t - 0.6) / 3.4, 0, 1);
  const padY = 250 - (1 - land) * 160;
  ctx.fillStyle = '#1f1a0a';
  ctx.fillRect(cx - 120, padY, 240, 40);
  ctx.fillStyle = '#4d4120';
  ctx.fillRect(cx - 120, padY, 240, 5);
  ctx.fillStyle = '#c2a44a';
  for (let i = -112; i < 116; i += 18) ctx.fillRect(cx + i, padY + 10, 6, 4);
  const blink = (t * 3) % 2 < 1;
  ctx.fillStyle = blink ? COL.warmHi : '#5a4a1e';
  ctx.fillRect(cx - 126, padY - 6, 6, 6);
  ctx.fillRect(cx + 120, padY - 6, 6, 6);

  // the ship coming down
  const shipY = 70 + land * (padY - 86);
  ctx.save();
  ctx.translate(cx, shipY);
  ctx.scale(1.6, 1.6);
  ctx.fillStyle = '#6e7b8a';
  ctx.beginPath();
  ctx.moveTo(14, 0); ctx.lineTo(3, -4); ctx.lineTo(-6, -7); ctx.lineTo(-12, -5);
  ctx.lineTo(-11, 0); ctx.lineTo(-12, 5); ctx.lineTo(-6, 7); ctx.lineTo(3, 4);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#aab7c7';
  ctx.beginPath();
  ctx.moveTo(13, 0); ctx.lineTo(3, -3); ctx.lineTo(-6, -6); ctx.lineTo(-11, -4);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = COL.coolHi;
  ctx.fillRect(1, -2, 4, 3);
  if (land < 1) {
    // retro-thrust, strongest just before touchdown
    const flame = 4 + Math.sin(t * 30) * 2 + land * 5;
    ctx.fillStyle = COL.cool;
    ctx.fillRect(-3, 7, 6, flame);
    ctx.fillStyle = COL.coolHi;
    ctx.fillRect(-1.5, 7, 3, flame * 0.6);
  }
  ctx.restore();

  if (land >= 1) {
    const r = Math.min(1, (t - 4.2) / 0.5);
    if (r > 0) {
      ctx.globalAlpha = r;
      text(ctx, 'ALL EIGHT HULLS RUN', cx, 24, COL.coolHi, FONT_BIG, 'center');
      text(ctx, 'OUT AND BACK, EVERY ONE', cx, 52, COL.cool, FONT, 'center');

      const lines = [
        ['FINAL SCORE', String(game.score).padStart(8, '0')],
        ['TOTAL TIME', game.runTime.toFixed(1) + 'S'],
        ['GUNS BROKEN', String(game.turretsKilled)],
        ['SHIPS LOST', String(game.deaths)],
        ['COINS', String(game.coins || 0)],
        ['GOLD BARS', String(game.bars || 0)],
        ['COFFINS', String(game.coffins || 0)],
      ];
      lines.forEach(([k, v], i) => {
        const y = 80 + i * 14;
        if (t < 4.6 + i * 0.22) return;        // totalled line by line
        text(ctx, k, cx - 110, y, COL.hudText, FONT);
        text(ctx, v, cx + 110, y, COL.hudBright, FONT, 'right');
      });

      if (t > 6.6) {
        ctx.globalAlpha = r * (0.5 + 0.5 * Math.sin(t * 3));
        text(ctx, 'ENTER', cx, 286, COL.warmHi, FONT, 'center');
      }
      ctx.globalAlpha = 1;
    }
  }
}

export function drawShop(ctx, game, sel, note) {
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);
  const cx = VIEW_W / 2;

  text(ctx, 'ARMOURER', cx, 12, COL.hudBright, FONT_BIG, 'center');
  text(ctx, 'COINS ' + (game.coins || 0), cx, 40, '#ffd24a', FONT, 'center');

  const list = shopRows(game);
  const top = 60;
  const perCol = Math.ceil(list.length / 2);
  list.forEach((r, i) => {
    const col = i < perCol ? 0 : 1;
    const y = top + (i % perCol) * 17;
    const x = 24 + col * 300;
    const on = i === sel;
    if (on) {
      ctx.fillStyle = '#131c26';
      ctx.fillRect(x - 6, y - 3, 286, 15);
      ctx.fillStyle = r.affordable ? COL.cool : COL.danger;
      ctx.fillRect(x - 6, y - 3, 2, 15);
    }
    const colour = !r.available ? '#2b3440'
      : r.affordable ? (on ? COL.hudBright : COL.hudText)
        : '#5a3a40';
    text(ctx, r.name, x, y, colour, FONT);
    if (r.kind === 'mod') text(ctx, 'MOD', x + 150, y, r.affordable ? '#b45ce0' : '#432f4a', FONT);
    else text(ctx, r.detail, x + 150, y, colour, FONT);
    text(ctx, !r.available ? 'MAX' : String(r.cost), x + 276, y,
      !r.available ? '#2b3440' : r.affordable ? '#ffd24a' : '#5a3a40', FONT, 'right');
  });

  const cur = list[sel];
  if (cur) {
    text(ctx, cur.blurb, cx, top + perCol * 17 + 10, COL.hudLine, FONT, 'center');
  }
  if (note) text(ctx, note, cx, top + perCol * 17 + 26, '#5fe08a', FONT, 'center');

  text(ctx, 'ARROWS CHOOSE    ENTER BUY    E / ESC LEAVE', cx, 298, COL.hudText, FONT, 'center');
}

export function drawSettings(ctx, game, sel) {
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);
  const cx = VIEW_W / 2;

  text(ctx, 'SETTINGS', cx, 16, COL.hudBright, FONT_BIG, 'center');

  const top = 56;
  DEFS.forEach((d, i) => {
    const y = top + i * 18;
    const on = i === sel;
    if (on) {
      ctx.fillStyle = '#131c26';
      ctx.fillRect(96, y - 3, VIEW_W - 192, 16);
      ctx.fillStyle = COL.cool;
      ctx.fillRect(96, y - 3, 2, 16);
    }
    text(ctx, d.label, 110, y, on ? COL.hudBright : COL.hudText, FONT);

    const value = display(d, d.kind === 'tune' ? TUNES[setting('tune')].name : null);
    const vx = VIEW_W - 110;
    if (d.kind === 'range') {
      // a bar as well as a number, because a number alone is hard to aim at
      const w = 70;
      ctx.fillStyle = '#1a212b';
      ctx.fillRect(vx - w, y + 1, w, 8);
      ctx.fillStyle = on ? COL.cool : '#3a4654';
      ctx.fillRect(vx - w, y + 1, Math.round(w * (setting(d.id) - d.min) / (d.max - d.min)), 8);
      text(ctx, value, vx + 6, y, on ? COL.hudBright : COL.hudText, FONT);
    } else {
      const lit = value !== 'OFF';
      text(ctx, (on ? '< ' : '  ') + value + (on ? ' >' : ''), vx, y,
        lit ? (on ? COL.coolHi : COL.cool) : COL.hudLine, FONT, 'right');
    }
  });

  const d = DEFS[sel];
  if (d) text(ctx, d.help, cx, top + DEFS.length * 18 + 12, COL.hudLine, FONT, 'center');

  text(ctx, 'UP / DOWN  CHOOSE      LEFT / RIGHT  CHANGE', cx, 286, COL.hudText, FONT, 'center');
  text(ctx, 'R  RESET TO DEFAULTS       O / ESC  BACK', cx, 300, COL.hudText, FONT, 'center');
}

export function drawQuitPrompt(ctx, game) {
  ctx.fillStyle = 'rgba(4,6,10,0.82)';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);
  const cx = VIEW_W / 2;
  text(ctx, 'ABANDON THE RUN?', cx, 118, COL.danger, FONT_BIG, 'center');
  text(ctx, 'SCORE ' + String(game.score).padStart(8, '0')
    + '    HULL ' + game.level.spec.name, cx, 150, COL.hudText, FONT, 'center');
  text(ctx, 'THE RUN WILL BE RECORDED', cx, 166, COL.hudLine, FONT, 'center');
  const pulse = 0.55 + 0.45 * Math.sin(game.stateT * 5);
  ctx.globalAlpha = pulse;
  text(ctx, 'Y   QUIT TO TITLE', cx, 198, COL.warmHi, FONT, 'center');
  ctx.globalAlpha = 1;
  text(ctx, 'N   KEEP FLYING', cx, 214, COL.cool, FONT, 'center');
}

export function drawPaused(ctx) {
  ctx.fillStyle = 'rgba(4,6,10,0.7)';
  ctx.fillRect(0, 0, VIEW_W, FIELD_H);
  text(ctx, 'PAUSED', VIEW_W / 2, 150, COL.hudBright, FONT_BIG, 'center');
  text(ctx, 'P TO RESUME', VIEW_W / 2, 180, COL.hudText, FONT, 'center');
}
