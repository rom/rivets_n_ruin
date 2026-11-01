import { VIEW_W, VIEW_H } from './config.js';
import { fitCanvas, applyTransform, reportFrame, setStatic } from './display.js';
import {
  initInput, tapped, endFrame, setSynthetic, realAnyTapped,
} from './input.js';
import { demoActions, IDLE_BEFORE_DEMO } from './demo.js';
import { startLoop } from './loop.js';
import { installErrorReporting, report } from './errors.js';
import { makeGame, update, syncBest } from './game.js';
import { drawWorld } from './render.js';
import {
  drawHud, drawPaused, drawQuitPrompt, drawSettings, drawShop, drawHelp, HELP_PAGES,
  drawDemoBadge,
} from './hud.js';
import { rows as shopRows, buy as shopBuy, applyMods } from './shop.js';
import { saveHangar, clearHangar, setHangarSync, mergeHangars, applyHangar } from './hangar.js';
import { unlock, toggleMute, isMuted, ready } from './audio.js';
import { startMusic, stopMusic, musicRunning } from './music.js';
import { sfxUi } from './sfx.js';
import { initNet, rename, refreshTop, refreshRuns, refreshPresence, netState, toggleBoard,
  fetchHangar, pushHangar } from './net.js';
import { nextTune, tuneName, setTune, TUNES } from './music.js';
import * as settings from './settings.js';
import { applySettings } from './audio.js';
import { loadModFromURL } from './mods.js';
import { LEVELS, BUILD } from './config.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

// The canvas backing store tracks the window and the device pixel ratio, and
// the context carries a matching transform, so everything — sprites, strokes
// and especially text — is rasterised at display resolution rather than
// drawn into 640x360 and blown up. See display.js.
function fit() { fitCanvas(canvas, ctx); }

// Launching the demo is launching a run: the same reset, the same states.
// It starts on the furthest hull reached, because that is the hull worth
// showing somebody who has walked away from the machine.
function startDemo(g) {
  g.setStartHull(g.unlocked);
  g.state = 'title';
  g.stateT = 0;
}

// And stopping it is going back to the title with nothing kept.
function toTitle(g) {
  g.state = 'title';
  g.stateT = 0;
  g.banner = null;
  g.toast = null;
  g.quitting = false;
}

// Everything that is a screen rather than a flight: a menu, a prompt, or one
// of the states whose whole content is drawn over a dimmed world.
const SCREEN_STATES = new Set([
  'splash', 'title', 'levelclear', 'gameover', 'ending', 'victory',
]);
function isOverlay() {
  return shopOpen || settingsOpen || helpOpen || paused || game.quitting
    || SCREEN_STATES.has(game.state);
}
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
// Attract mode. demoT counts seconds since anybody touched a key; demoOn
// says the machine is flying itself.
let demoT = 0;
let demoOn = false;
let helpOpen = false;
let helpPage = 0;
let settingsSel = 0;
let wipeArmed = false;      // the hangar wipe has been asked for once
let wipeNote = '';
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

// Brings the hangar in line with the account.
//
// Two copies, and either can be ahead: this browser may have banked
// coins offline, and the account may have been played on another
// machine. mergeHangars takes the better of each, which is the only
// rule that cannot take something away from a pilot who earned it.
async function syncHangar() {
  const remote = await fetchHangar();
  if (!remote) return;                       // signed out, or offline
  const merged = mergeHangars(
    { coins: game.coins, bars: game.bars, mods: game.mods }, remote,
  );
  applyHangar(game, merged);
  saveHangar(game);                          // writes both copies back
}

// Backend comes up behind the game, never in front of it.
initNet().then((ok) => {
  if (!ok) { console.info('backend unreachable — scores stay local'); return; }
  syncBest(game);     // adopt the account's best if it beats this browser's
  // Only start uploading once the merge has happened. Wiring the hook
  // first would let an ordinary save push this browser's empty hangar
  // over an account that had things in it.
  syncHangar().then(() => setHangarSync(pushHangar));
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
// A browser tab can close at any moment, including mid-hull. The hangar
// is saved at every point the game knows about — a purchase, a hull
// cleared, a run ended — but none of those is "the player just closed
// the tab", so catch that too. pagehide fires where beforeunload does
// not, notably on iOS.
for (const ev of ['pagehide', 'beforeunload']) {
  window.addEventListener(ev, () => saveHangar(game));
}
// Backgrounding a tab is the same risk: a phone may never come back to it.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveHangar(game);
});

// Error reporting, installed before anything else can throw. The context
// is a callback rather than a value so a report carries where the game
// was at the moment of the fault, not at the moment this was set up.
installErrorReporting({
  context: () => ({
    state: game.state,
    hull: game.levelIndex + 1,
    build: BUILD,
  }),
});

window.game = game;
// Exposed for the tooling only: the gallery and the end-screen probe need
// to put the net client into a given state (refused, placed, offline) to
// photograph what the player would actually see. Nothing in the game reads
// this back.
window.net = netState();

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
    if (helpOpen) {
      const n = HELP_PAGES();
      if (tapped('left')) { helpPage = (helpPage - 1 + n) % n; sfxUi(); }
      if (tapped('right')) { helpPage = (helpPage + 1) % n; sfxUi(); }
      if (tapped('help') || tapped('pause') || tapped('start')) { helpOpen = false; sfxUi(); }
      endFrame();
      return;
    }
    if (tapped('help') && game.state !== 'play' && game.state !== 'dying') {
      helpOpen = true; helpPage = 0; sfxUi(); endFrame(); return;
    }
    if (settingsOpen) {
      const n = settings.DEFS.length;
      if (tapped('up')) { settingsSel = (settingsSel - 1 + n) % n; sfxUi(); }
      if (tapped('down')) { settingsSel = (settingsSel + 1) % n; sfxUi(); }
      const bounds = { tuneCount: TUNES.length, hullMax: game.unlocked };
      if (tapped('left')) { settings.nudge(settings.DEFS[settingsSel].id, -1, bounds); sfxUi(); }
      if (tapped('right')) { settings.nudge(settings.DEFS[settingsSel].id, 1, bounds); sfxUi(); }
      if (tapped('restart')) { settings.reset(); sfxUi(); }
      // Clearing the hangar is the one irreversible thing on this screen,
      // so it asks twice. The prompt lives in the footer rather than a
      // modal: a modal over a settings page is a lot of machinery for a
      // question with two answers.
      if (tapped('wipe')) {
        if (wipeArmed) {
          clearHangar(game);
          applyMods(game);
          wipeArmed = false;
          wipeNote = 'HANGAR CLEARED';
        } else {
          wipeArmed = true;
          wipeNote = '';
        }
        sfxUi();
      } else if (wipeArmed && (tapped('up') || tapped('down') || tapped('left')
        || tapped('right') || tapped('options') || tapped('pause') || tapped('start'))) {
        wipeArmed = false;      // any other key is an answer of "no"
      }
      if (tapped('options') || tapped('pause') || tapped('start')) {
        settingsOpen = false; wipeArmed = false; wipeNote = ''; sfxUi();
      }
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
    // --- attract mode
    //
    // A real keypress always wins: it stops the demo, drops the run and
    // puts the title back, so nobody ever finds themselves fighting a ship
    // that is also being flown by something else.
    if (realAnyTapped()) {
      demoT = 0;
      if (demoOn) {
        demoOn = false;
        setSynthetic(null);
        toTitle(game);
        endFrame();
        return;
      }
    } else {
      demoT += dt;
    }

    if (!demoOn && settings.get('demo') && demoT > IDLE_BEFORE_DEMO
      && game.state === 'title' && !shopOpen && !settingsOpen && !helpOpen && !paused) {
      demoOn = true;
      startDemo(game);
    }
    if (demoOn) setSynthetic(demoActions(game));

    if (paused) { endFrame(); return; }
    // A hold for the tooling. make gallery poses a roster of attackers and
    // then screenshots it; with the simulation running, everything with a
    // speed had moved and everything with a spawn timer had spawned by the
    // time the shutter opened, so half the roster was missing from the
    // sheet. Nothing in the game sets this.
    if (window.__freeze) { endFrame(); return; }
    update(game, dt);
  },
  () => {
    const t0 = performance.now();
    // Menus are not gameplay and must not be rendered at gameplay's cap: a
    // page of text upscaled 2.6x by the browser is the single most visible
    // thing in the game. Resizing resets the context, so this has to happen
    // before the transform goes on.
    if (setStatic(isOverlay())) fit();
    applyTransform(ctx);   // a resize resets context state; re-establish it
    drawWorld(ctx, game);
    drawHud(ctx, game, { muted: isMuted(), audio: ready() });
    if (demoOn) drawDemoBadge(ctx, game);
    if (shopOpen) drawShop(ctx, game, shopSel, shopNote);
    else if (helpOpen) drawHelp(ctx, helpPage);
    else if (settingsOpen) drawSettings(ctx, game, settingsSel, { wipeArmed, wipeNote });
    else if (game.quitting) drawQuitPrompt(ctx, game);
    else if (paused) drawPaused(ctx);
    // Frame-to-frame interval, not draw time: canvas2d records lazily, so
    // the real cost of a resolution shows up as a longer frame, not a longer
    // draw call.
    const now = performance.now();
    reportFrame(now - lastFrameAt, canvas, ctx);
    lastFrameAt = now;
  },
  // GAME SPEED. Menus and the attract demo run at full rate whatever it is
  // set to: slowing the game is about reaction time in flight, and a menu
  // that scrolls in slow motion is just a worse menu.
  () => (game.state === 'play' || game.state === 'dying'
    ? (Number(settings.get('gameSpeed')) || 100) / 100
    : 1),
  (err) => report('frame', err),
);
