import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HELP, HELP_LAYOUT, HELP_PAGES, SETTINGS_LAYOUT, END_LAYOUT, endLayout,
  rankLine, REASON_CHARS, drawHelp, drawSettings,
} from '../src/hud.js';
import { DEFS, get as setting, set as setSetting, nudge, reset, display } from '../src/settings.js';
import { LEVELS, VIEW_W, FIELD_H } from '../src/config.js';
import { TUNES } from '../src/music.js';

const ctx = () => document.createElement('canvas').getContext('2d');
const CHAR = 6;   // the HUD font is 10px monospace; one glyph is six wide

// --- the help pages

test('there is more than one page, and every page says what it is', () => {
  assert.ok(HELP.length >= 2, 'one page is not a book');
  assert.equal(HELP_PAGES(), HELP.length);
  for (const p of HELP) {
    assert.ok(p.title && p.title.length <= 24, `"${p.title}" is not a title`);
    assert.ok(p.sub && p.sub.length <= 52, `"${p.sub}" is too long for a subtitle`);
    assert.ok(p.rows.length > 4, `${p.title} has almost nothing on it`);
  }
});

// The reason the layout is data: a page that runs past its own footer is
// invisible from anywhere except that page.
test('no help page overruns its own footer', () => {
  for (const p of HELP) {
    let y = HELP_LAYOUT.top;
    for (const row of p.rows) {
      y += row.head ? HELP_LAYOUT.headGap + HELP_LAYOUT.headPitch : HELP_LAYOUT.pitch;
    }
    assert.ok(y <= HELP_LAYOUT.bottom,
      `"${p.title}" ends at y=${y}, past the footer at ${HELP_LAYOUT.bottom}`);
  }
});

test('no help row runs out of its column', () => {
  const keyRoom = HELP_LAYOUT.valX - HELP_LAYOUT.keyX - CHAR;
  const valRoom = VIEW_W - HELP_LAYOUT.keyX - HELP_LAYOUT.valX;
  for (const p of HELP) {
    for (const row of p.rows) {
      if (row.head) {
        assert.ok(row.head.length * CHAR < VIEW_W - HELP_LAYOUT.keyX * 2,
          `"${row.head}" does not fit`);
        continue;
      }
      assert.ok(row.k.length * CHAR <= keyRoom,
        `"${row.k}" is ${row.k.length} chars, the key column holds ${Math.floor(keyRoom / CHAR)}`);
      assert.ok(row.v.length * CHAR <= valRoom,
        `"${row.v}" is ${row.v.length} chars, the value column holds ${Math.floor(valRoom / CHAR)}`);
    }
  }
});

test('every page draws, and an out-of-range page clamps rather than throwing', () => {
  const c = ctx();
  for (let i = 0; i < HELP.length; i++) drawHelp(c, i);
  drawHelp(c, -3);
  drawHelp(c, 999);
});

// Every key the help claims exists has to actually be bound, or the page
// is documentation of a game that is not this one.
test('every key the help names is a key the game binds', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/input.js', import.meta.url), 'utf8'));
  const bound = new Set();
  for (const m of src.matchAll(/(\w+):\s*'(\w+)'/g)) bound.add(m[1]);
  const NAMED = {
    'ARROWS / WASD': ['ArrowLeft', 'KeyW'],
    'REVERSE THRUST': ['ArrowLeft'],
    'Z / SPACE': ['KeyZ', 'Space'],
    'X / SHIFT': ['KeyX', 'ShiftLeft'],
    C: ['KeyC'],
    '1  2  3': ['Digit1', 'Digit2', 'Digit3'],
    ENTER: ['Enter'],
    E: ['KeyE'],
    'P / ESC': ['KeyP', 'Escape'],
    Q: ['KeyQ'],
    R: ['KeyR'],
    M: ['KeyM'],
    T: ['KeyT'],
    B: ['KeyB'],
    O: ['KeyO'],
  };
  for (const [label, codes] of Object.entries(NAMED)) {
    for (const code of codes) {
      assert.ok(bound.has(code), `the help names ${label}, but ${code} is not bound`);
    }
  }
  assert.ok(bound.has('KeyH'), 'the help page itself has no key');
});

// --- the start-hull setting

test('settings offers a start hull, bounded by what has been reached', () => {
  const d = DEFS.find((x) => x.id === 'startHull');
  assert.ok(d, 'there is no start hull setting');
  assert.equal(d.kind, 'hull');

  reset();
  assert.equal(setting('startHull'), 0);

  // nothing unlocked: it cannot move off the first hull
  nudge('startHull', 1, { hullMax: 0 });
  assert.equal(setting('startHull'), 0, 'it let a locked hull be selected');

  // three hulls reached
  for (let i = 0; i < 9; i++) nudge('startHull', 1, { hullMax: 3 });
  assert.equal(setting('startHull'), 3, 'it did not stop at the hull reached');

  for (let i = 0; i < 9; i++) nudge('startHull', -1, { hullMax: 3 });
  assert.equal(setting('startHull'), 0, 'it went below the first hull');
});

test('the start hull reads as a hull, not a number', () => {
  const d = DEFS.find((x) => x.id === 'startHull');
  for (let i = 0; i < LEVELS.length; i++) {
    setSetting('startHull', i);
    const shown = display(d, null);
    assert.ok(shown.includes(LEVELS[i].name), `hull ${i} shows as "${shown}"`);
    assert.ok(shown.includes(`${i + 1}/${LEVELS.length}`), `hull ${i} shows as "${shown}"`);
  }
  reset();
});

test('a saved start hull past the end of the campaign is clamped, not trusted', () => {
  // settings.load() runs at import, so this exercises the same clamp the
  // loader applies to a hand-edited or stale localStorage entry.
  const d = DEFS.find((x) => x.id === 'startHull');
  setSetting('startHull', 999);
  const shown = display(d, null);
  assert.ok(shown.includes(LEVELS[LEVELS.length - 1].name),
    `an out-of-range hull shows as "${shown}"`);
  reset();
});

test('the settings screen draws every row without throwing', () => {
  const c = ctx();
  const game = { levelIndex: 0, unlocked: 3, startHull: 1, player: {}, mods: {} };
  for (let i = 0; i < DEFS.length; i++) drawSettings(c, game, i);
  drawSettings(c, game, 999);
});

test('every setting row fits the screen', () => {
  for (const d of DEFS) {
    assert.ok(d.label.length * CHAR < 180, `"${d.label}" is too long`);
    assert.ok(d.help && d.help.length * CHAR < VIEW_W - 20,
      `the help for ${d.id} is too long to centre`);
    if (d.kind === 'tune') continue;
    const shown = display(d, TUNES[0].name);
    assert.ok(shown.length * CHAR < 200, `${d.id} shows "${shown}", which is too wide`);
  }
  reset();
});

// Adding a twelfth setting pushed the per-row explanation straight into the
// footer under it. The layout is data so the next one cannot.
test('the settings list and its explanation clear the footer', () => {
  const L = SETTINGS_LAYOUT;
  const lastRow = L.top + (DEFS.length - 1) * L.pitch;
  const helpY = L.top + DEFS.length * L.pitch + L.helpGap;
  assert.ok(lastRow + 12 < helpY, 'the last row overlaps its own explanation');
  assert.ok(helpY + 12 <= L.footer,
    `${DEFS.length} settings put the explanation at y=${helpY}, the footer is at ${L.footer}`);
  assert.ok(L.footer + 12 <= L.footer2 + 12, 'the two footer lines overlap');
});

// --- the overview between hulls
//
// The mod list grew a row per mod with no bound. With everything fitted it
// ran straight through "ENTER TO LAUNCH" and the armourer prompt below it,
// which is only visible once you own enough mods to see it.

test('the fitted-mods list cannot reach the prompts under it', async () => {
  const { OVERVIEW } = await import('../src/hud.js');
  const { MODS } = await import('../src/shop.js');
  const L = OVERVIEW;

  const refitRows = 6;
  const modsHead = L.top + L.headGap + refitRows * L.pitch + 6;
  const modsTop = modsHead + L.headGap;
  const modsBottom = modsTop + L.rows * L.pitch;

  assert.ok(modsBottom + 8 <= L.launch,
    `the mod list ends at y=${modsBottom}, the launch prompt is at ${L.launch}`);
  assert.ok(L.launch + 10 <= L.armourer, 'the two prompts overlap');
  assert.ok(L.armourer + 10 <= 348, 'the armourer prompt is off the bottom of the frame');

  // and there are enough slots that the common case is not "+N MORE"
  assert.ok(L.rows * 2 >= Object.keys(MODS).length - 2,
    `${Object.keys(MODS).length} mods into ${L.rows * 2} slots loses too many`);
});

test('the overview draws with every mod fitted at full tier', async () => {
  const { drawScreen } = await import('../src/hud.js');
  const { MODS, applyMods } = await import('../src/shop.js');
  const { makeGame } = await import('../src/game.js');
  const { hullBonus } = await import('../src/game.js');

  const game = makeGame();
  for (const id of Object.keys(MODS)) game.mods[id] = MODS[id].tiers.length;
  applyMods(game);
  game.levelIndex = 3;
  game.hullHaul = { coins: 400, bars: 2, coffins: 1, treasures: 1, value: 9000 };
  game.deathsThisHull = 0;
  game.bonus = hullBonus(game);
  game.state = 'levelclear';
  game.stateT = 5;
  // throws if any of it reads something undefined
  drawScreen(document.createElement('canvas').getContext('2d'), game);
});

// --- attract mode
//
// The demo flies the real game through the real update loop by replacing
// the input layer, so the thing that must hold is that it produces input a
// player could produce, and that a real key always wins.

test('the demo pilot only ever presses keys the game binds', async () => {
  const fs = await import('node:fs');
  const { demoActions } = await import('../src/demo.js');
  const { makeGame } = await import('../src/game.js');
  const src = fs.readFileSync(new URL('../src/input.js', import.meta.url), 'utf8');
  const actions = new Set([...src.matchAll(/:\s*'(\w+)'/g)].map((m) => m[1]));

  const game = makeGame();
  const seen = new Set();
  for (const state of ['title', 'play', 'levelclear', 'exiting', 'gameover']) {
    game.state = state;
    game.player.alive = state === 'play';
    for (let i = 0; i < 40; i++) {
      game.player.y = 20 + i * 7;
      game.time += 0.1;
      for (const a of demoActions(game)) seen.add(a);
    }
  }
  assert.ok(seen.size > 0, 'the pilot never pressed anything');
  for (const a of seen) {
    assert.ok(actions.has(a), `the demo presses "${a}", which no key produces`);
  }
});

test('the pilot flies forward and shoots when there is a hull to fly', async () => {
  const { demoActions } = await import('../src/demo.js');
  const { makeGame } = await import('../src/game.js');
  const game = makeGame();
  game.state = 'play';
  game.player.alive = true;
  game.player.x = 3000;
  game.player.y = 160;
  const a = demoActions(game);
  assert.ok(a.has('fire'), 'it is not shooting');
  assert.ok(a.has('right'), 'it is not going anywhere');
});

// Menus advance on tapped(), which is the frame an action starts. A key
// the pilot never lets go of produces exactly one edge and then nothing —
// which is how the demo came to reach the title and sit there.
test('the pilot pulses start rather than holding it', async () => {
  const { demoActions } = await import('../src/demo.js');
  const { makeGame } = await import('../src/game.js');
  const game = makeGame();
  for (const state of ['title', 'levelclear', 'gameover', 'victory', 'exiting']) {
    game.state = state;
    game.player.alive = false;
    let on = 0;
    let off = 0;
    for (let i = 0; i < 60; i++) {
      game.stateT = i / 30;
      if (demoActions(game).has('start')) on++; else off++;
    }
    assert.ok(on > 4, `it never presses start on the ${state} screen`);
    assert.ok(off > 4,
      `it holds start on the ${state} screen, which produces one edge and then nothing`);
  }
});

test('synthetic input replaces the keyboard but never hides it', async () => {
  const inp = await import('../src/input.js');
  assert.equal(inp.isSynthetic(), false);
  inp.setSynthetic(new Set(['fire', 'right']));
  assert.equal(inp.isSynthetic(), true);
  assert.equal(inp.held('fire'), true);
  assert.equal(inp.held('left'), false);
  assert.equal(inp.axisX(), 1);
  // tapped fires on the frame an action starts, not every frame it is held
  assert.equal(inp.tapped('fire'), true);
  inp.setSynthetic(new Set(['fire']));
  assert.equal(inp.tapped('fire'), false, 'a held action kept reporting as tapped');
  assert.equal(inp.tapped('right'), false);
  // the real keyboard is still readable, which is how the demo knows to stop
  assert.equal(inp.realAnyTapped(), false);
  inp.setSynthetic(null);
  assert.equal(inp.isSynthetic(), false);
  assert.equal(inp.held('fire'), false);
});

test('attract mode can be turned off, and is on by default', () => {
  const d = DEFS.find((x) => x.id === 'demo');
  assert.ok(d, 'there is no attract-mode setting');
  assert.equal(d.kind, 'bool');
  assert.equal(d.def, true);
});

test('the attract badge fits both of its labels', async () => {
  const { drawDemoBadge } = await import('../src/hud.js');
  // Measured the way the HUD font measures: 10px monospace, six per glyph.
  const left = 'ATTRACT MODE'.length * CHAR + 8;
  const right = 'ANY KEY TO PLAY'.length * CHAR + 8;
  const w = 206;
  assert.ok(left + right + 8 <= w,
    `the labels need ${left + right + 8}px and the badge is ${w}px`);
  drawDemoBadge(document.createElement('canvas').getContext('2d'), { stateT: 1 });
});


// --- the end screen
//
// The rank line is one row when the run placed and two when it was
// refused, because a refusal has to say why. With the offsets below it
// baked in as literals, that second row was drawn straight through ENTER
// TO FLY AGAIN — the same overlap that put the mod list through ENTER TO
// LAUNCH on the overview page. Measured here instead.

const NET_STATES = [
  ['sending', { online: true, submitState: 'sending' }],
  ['refused', { online: true, submitState: 'refused', submitError: 'score 9 exceeds the maximum 8 attainable in 1.0s' }],
  ['refused, no reason', { online: true, submitState: 'refused' }],
  // The backend's messages are prose and can be long; the line is centred
  // on a 640px screen and must not run off both ends of it.
  ['refused, long reason', { online: true, submitState: 'refused',
    submitError: 'flew 25 hull(s) in 30.0s, which cannot be done in under 1104.1s at full throttle' }],
  ['recorded', { online: true, submitState: 'recorded' }],
  ['placed', { online: true, submitState: 'recorded', rank: { position: 1 }, stats: { players: 37 } }],
  ['offline', { online: false }],
];

test('nothing on the end screen is drawn on top of anything else', () => {
  const ROW = END_LAYOUT.pitch;
  for (const state of ['gameover', 'victory']) {
    for (const [what, net] of NET_STATES) {
      const line = rankLine(net);
      const L = endLayout(state, line);
      const rows = [
        ['score', L.score], ['stats', L.stats], ['coins', L.coins],
        ['rank', L.rank],
      ];
      if (line.sub) rows.push(['rank reason', L.rankBottom]);
      rows.push(['prompt', L.prompt], ['board', L.board]);
      for (let i = 1; i < rows.length; i++) {
        const gap = rows[i][1] - rows[i - 1][1];
        assert.ok(gap >= ROW,
          `${state}/${what}: "${rows[i][0]}" is ${gap}px below "${rows[i - 1][0]}", `
          + `and a row is ${ROW}px tall — they overlap`);
      }
    }
  }
});

test('the end screen board still fits above the radar band', () => {
  // The board draws its heading, then up to five rows at 12px, starting
  // 16px below. Everything has to land inside the playfield.
  const tallest = Math.max(...['gameover', 'victory'].flatMap((state) =>
    NET_STATES.map(([, net]) => endLayout(state, rankLine(net)).board)));
  const boardBottom = tallest + 16 + 5 * 12;
  assert.ok(boardBottom <= FIELD_H,
    `the board ends at y=${boardBottom}, past the playfield at ${FIELD_H}`);
});

test('a refused run is given room its reason actually needs', () => {
  const placed = endLayout('gameover', rankLine(
    { online: true, submitState: 'recorded', rank: { position: 1 } }));
  const refused = endLayout('gameover', rankLine(
    { online: true, submitState: 'refused', submitError: 'nope' }));
  assert.ok(refused.prompt > placed.prompt,
    'a two-row rank line did not push the prompt down, so it will be drawn through');
  assert.equal(refused.prompt - placed.prompt, END_LAYOUT.subGap,
    'the prompt moved by something other than the height of the extra row');
});

test('every end-screen rank line fits the width it is centred in', () => {
  for (const [what, net] of NET_STATES) {
    const line = rankLine(net);
    for (const part of [line.head, line.sub]) {
      if (!part) continue;
      assert.ok(part.length * CHAR <= VIEW_W - 16,
        `${what}: "${part}" is ${part.length * CHAR}px wide, the screen is ${VIEW_W}px`);
    }
  }
});

// The refusal reason is the one thing a player can quote back, so it must
// arrive whole. It was truncated at a guessed 64 characters; the longest
// message the validator actually sends is 67, so the number at the end —
// the useful part — was the part cut off.
test('a real refusal message is not truncated', () => {
  const real = [
    'score 1000000000 exceeds the maximum 124264118 attainable in 256.8s',
    'flew 25 hull(s) in 30.0s, which cannot be done in under 1104.1s at full throttle',
    'turret count 5000 exceeds 3250, the most a full campaign carries',
    'a run must be opened before a score can be submitted',
  ];
  for (const msg of real) {
    const line = rankLine({ online: true, submitState: 'refused', submitError: msg });
    assert.equal(line.sub, msg.toUpperCase(),
      `"${msg}" (${msg.length} chars) was cut to ${line.sub.length}`);
    assert.ok(line.sub.length * CHAR <= VIEW_W - 16, `"${msg}" does not fit the screen`);
  }
});

test('an absurdly long reason is cut to something that fits', () => {
  const line = rankLine({ online: true, submitState: 'refused', submitError: 'x'.repeat(500) });
  assert.equal(line.sub.length, REASON_CHARS);
  assert.ok(line.sub.length * CHAR <= VIEW_W - 16);
});
