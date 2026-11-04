import { VIEW_W, VIEW_H } from './config.js';
import { fitCanvas, applyTransform, applyUiTransform, reportFrame,
  setStatic, setPadded } from './display.js';
import {
  initInput, tapped, endFrame, setSynthetic, realAnyTapped,
  touchDown, touchUp, touchClear, rebind, resetBindings, keyFor, BINDABLE,
} from './input.js';
import { padAt, drawPads } from './touch.js';
import { demoActions, IDLE_BEFORE_DEMO } from './demo.js';
import { startLoop } from './loop.js';
import { installErrorReporting, report } from './errors.js';
import { makeGame, update, syncBest, wipeProgress, launchRun, banner, freshRunSeed } from './game.js';
import { drawWorld } from './render.js';
import {
  drawHud, drawPaused, drawQuitPrompt, drawSettings, drawShop, drawHelp, drawControls,
  drawCoop, drawCoopStalled,
  HELP_PAGES,
  drawDemoBadge,
} from './hud.js';
import { rows as shopRows, buy as shopBuy, applyMods, resetShop } from './shop.js';
import { coopState, hostGame, joinGame, leaveGame, hostStalled } from './coop.js';
import { initCoop } from './coopgame.js';
import { saveHangar, clearHangar, setHangarSync, mergeHangars, applyHangar } from './hangar.js';
import { unlock, toggleMute, isMuted, ready } from './audio.js';
import { startMusic, stopMusic, pauseMusic, resumeMusic, musicRunning } from './music.js';
import { sfxUi } from './sfx.js';
import { initNet, rename, refreshTop, refreshRuns, refreshCoopTop, refreshPresence,
  netState, toggleBoard,
  fetchHangar, pushHangar, setIdentityHook, forgetPlayer } from './net.js';
import { nextTune, tuneName, setTune, TUNES } from './music.js';
import * as settings from './settings.js';
import { applySettings } from './audio.js';
import { loadModFromURL } from './mods.js';
import { LEVELS, BUILD } from './config.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

// Two layers. The world canvas carries the adaptive scale and the
// compositor stretches it to the box for free; the UI canvas sits on top
// at the window's own resolution, so the HUD and the menus are never
// upscaled. Before this the cap took the whole backing store down with
// it and the HUD text went blocky the moment gameplay started. See
// display.js.
const uiCanvas = document.getElementById('ui');
const uiCtx = uiCanvas ? uiCanvas.getContext('2d') : null;
const ui = uiCtx ? { canvas: uiCanvas, ctx: uiCtx } : null;
// Everything that is not the world draws here. Falls back to the world
// canvas if the page has no UI layer, so an old index.html still plays.
const hudCtx = uiCtx || ctx;

function fit() { fitCanvas(canvas, ctx, ui); }

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
  return shopOpen || settingsOpen || helpOpen || controlsOpen || paused || game.quitting
    || SCREEN_STATES.has(game.state);
}
window.addEventListener('resize', fit);
fit();

initInput(window);

// --- on-screen controls
//
// AUTO asks the browser whether this is a touchscreen; ON and OFF are
// for the machines it gets wrong, which is mostly touchscreen laptops.
// The buttons feed the same input sets the keyboard does, so everything
// downstream — the demo, the menus, the player — stays unaware.
function touchWanted() {
  const mode = Number(settings.get('touch')) || 0;
  if (mode === 1) return true;
  if (mode === 2) return false;
  try {
    return window.matchMedia('(any-pointer: coarse)').matches
      || navigator.maxTouchPoints > 0;
  } catch {
    return 'ontouchstart' in window;
  }
}
let padsOn = touchWanted();
function syncPads() {
  const want = touchWanted();
  if (want === padsOn) return;
  padsOn = want;
  if (!want) touchClear();
  setPadded(want);
  document.body.classList.toggle('touch', want);
  fit();
}
setPadded(padsOn);
document.body.classList.toggle('touch', padsOn);
settings.onChange((id) => { if (id === 'touch' || id === null) syncPads(); });
export const padsVisible = () => padsOn;

// Pointer to logical coordinates. The UI canvas is laid out by CSS at
// cssW x cssH and drawn in the same 640x384 the HUD is, so the mapping
// is the box, not the backing store — getBoundingClientRect is what
// survives a device pixel ratio, a zoom and a CSS transform alike.
function toLogical(e, rect) {
  return {
    x: ((e.clientX - rect.left) / rect.width) * VIEW_W,
    y: ((e.clientY - rect.top) / rect.height) * VIEW_H,
  };
}

function padState() {
  if (shopOpen || settingsOpen || helpOpen || controlsOpen || paused || game.quitting) return 'menu';
  return game.state;
}

function onPointerDown(e) {
  if (!padsOn) return;
  wakeAudio();
  const rect = canvas.getBoundingClientRect();
  const { x, y } = toLogical(e, rect);
  const b = padAt(padState(), x, y);
  if (!b) return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  touchDown(e.pointerId, b.action);
}

function onPointerMove(e) {
  if (!padsOn || !e.buttons) return;
  const rect = canvas.getBoundingClientRect();
  const { x, y } = toLogical(e, rect);
  const b = padAt(padState(), x, y);
  // Sliding from one button to another re-presses: a thumb crossing the
  // pad should steer rather than stick on whichever one it started on.
  touchUp(e.pointerId);
  if (b) touchDown(e.pointerId, b.action);
}

const onPointerUp = (e) => touchUp(e.pointerId);

for (const el of [canvas, document.getElementById('ui')]) {
  if (!el) continue;
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('contextmenu', (e) => { if (padsOn) e.preventDefault(); });
}
// A finger lifted outside the canvas still has to let go of the button.
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('blur', touchClear);

// Rebinding listens to the keyboard directly, ahead of the action map.
//
// It has to: the key being captured may not mean anything yet, and if it
// does mean something, acting on the old meaning on the way past is how
// binding MOVE LEFT onto the key that currently means QUIT ends a run.
// Capture phase, so this sees the keystroke before initInput's listener
// turns it into an action.
window.addEventListener('keydown', (e) => {
  if (awaitingKey === null) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') {
    awaitingKey = null;
    controlsNote = 'LEFT AS IT WAS';
  } else if (rebind(awaitingKey, e.code)) {
    controlsNote = '';
    awaitingKey = null;
  } else {
    controlsNote = 'THAT KEY IS SPOKEN FOR';
    awaitingKey = null;
  }
  sfxUi();
}, true);

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
// The controls screen: which row is selected, and which action is
// waiting for a key. null means "not listening"; anything else is the
// action the next keystroke binds.
let controlsOpen = false;
let controlsSel = 0;
let awaitingKey = null;
let controlsNote = '';
// Attract mode. demoT counts seconds since anybody touched a key; demoOn
// says the machine is flying itself.
let demoT = 0;
let demoOn = false;
let helpOpen = false;
let helpPage = 0;
let settingsSel = 0;
// false, 'hangar' or 'all': which destructive key has been asked for
// once. One variable rather than two booleans, so arming one answers
// 'no' to the other instead of leaving both primed.
let wipeArmed = false;
let wipeNote = '';
let shopOpen = false;
// The co-op screen. Owns the keyboard while it is up, like the shop
// and the settings screen, so H and J mean host and join here rather
// than help and fire.
let coopOpen = false;
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

// Brings the hangar in line with whichever account is now in play.
//
// Two copies, and either can be ahead: this browser may have banked
// coins offline, and the account may have been played on another
// machine. mergeHangars takes the better of each, which is the only
// rule that cannot take something away from a pilot who earned it.
//
// Uploading is switched OFF for the duration and only switched back on
// once the merge has landed. That ordering is the whole safety
// property: with the hook live, any save — a purchase, a pagehide —
// would PUT this browser's hangar over the account before anyone had
// looked at what the account held.
//
// It runs on every identity change, not just at page load. The first
// version ran once at startup, which left signing in afterwards doing
// exactly the thing the ordering exists to prevent.
async function syncHangar() {
  setHangarSync(null);
  try {
    const remote = await fetchHangar();
    if (!remote) return;                     // signed out, or offline
    applyHangar(game, mergeHangars(
      { coins: game.coins, bars: game.bars, mods: game.mods }, remote,
    ));
    saveHangar(game);                        // local copy, hook still off
    await pushHangar({ coins: game.coins, bars: game.bars, mods: game.mods });
  } finally {
    setHangarSync(pushHangar);
  }
}

// Every moment the pilot this browser acts as can change: a sign-in, a
// sign-up, a fresh anonymous registration, the backend coming back.
setIdentityHook(syncHangar);

// Start again from nothing.
//
// Clearing the local copies is not enough on its own. The account holds
// the hangar and the best score, and both would be synced straight back
// — so this forgets the account too and the next connection registers a
// fresh pilot.
//
// Runs already on the leaderboard stay there, under the old name. That
// board is a public record, and a key on a settings screen is not the
// right instrument for editing one; signing back in gets the old pilot
// and everything of theirs back.
function fullReset() {
  setHangarSync(null);        // nothing may upload while there is no pilot
  clearHangar(game);          // coins, bars, mods, and the live copies
  applyMods(game);            // ...so the ship stops carrying what was bought
  wipeProgress(game);         // best score, furthest hull
  forgetPlayer();             // the account, so none of it comes back
  resetShop(game);
  // Re-register as somebody new, if there is a backend to register with.
  initNet().then((ok) => { if (ok) syncHangar(); });
}

// Backend comes up behind the game, never in front of it.
initNet().then((ok) => {
  if (!ok) { console.info('backend unreachable — scores stay local'); return; }
  syncBest(game);     // adopt the account's best if it beats this browser's
  syncHangar();
});

// Keep the title screen's board and pilot count fresh while nobody is flying,
// and retry the handshake if the backend was down at load — otherwise a
// server that comes back up would never be noticed until a page reload.
setInterval(() => {
  if (game.state === 'play' || game.state === 'dying') return;
  if (!netState().online) {
    // A backend that comes back has to be treated as an identity
    // arriving, not just a board to refresh: nothing has reconciled
    // the hangar yet and the upload hook is not wired.
    initNet().then((ok) => { if (ok) { syncBest(game); syncHangar(); } });
    return;
  }
  refreshTop(mod ? mod.id : '');
  refreshRuns(mod ? mod.id : '');
  refreshCoopTop();
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
//
// It is also when the music breaks. requestAnimationFrame stops, so the
// game is frozen, but setInterval keeps going — throttled to roughly one
// tick a second — and a sequencer woken once a second cannot fill a
// window measured in milliseconds. What comes out is a stutter, played
// over a frozen game, for nobody. Stop the clock, and pick the tune up
// where it left off once the tab is looked at again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { saveHangar(game); pauseMusic(); }
  else resumeMusic();
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
    // --- co-op
    //
    // G from the title. Ahead of the help, shop and settings handlers
    // on purpose: each of those takes the keyboard and returns, so a
    // co-op screen placed after them never saw H — pressing it opened
    // the help over the top of the room code. A screen that owns the
    // keyboard has to be asked first, not last.
    if (tapped('coop') && game.state === 'title' && !shopOpen && !settingsOpen
        && !helpOpen && !coopOpen) {
      sfxUi();
      coopOpen = true;
    } else if (coopOpen) {
      const cs = coopState();
      if (tapped('pause') || tapped('quit')) {
        sfxUi();
        if (cs.phase !== 'off') leaveGame();
        coopOpen = false;
      } else if (cs.phase === 'off' || cs.phase === 'ended') {
        if (tapped('help')) {           // H
          sfxUi();
          const p = netState().player;
          hostGame(freshRunSeed(), game.startHull, p ? p.token : null);
        } else if (tapped('fire')) {    // J
          sfxUi();
          const code = window.prompt('Code from the other pilot:');
          const me = netState().player;
          if (code) joinGame(code.trim(), me ? me.token : null);
        }
      } else if (cs.phase === 'playing' && tapped('start')) {
        sfxUi();
        coopOpen = false;
        launchRun(game, { runSeed: cs.seed, hull: cs.hull });
        banner(game, 'CO-OP', cs.side === 'host'
          ? 'YOU ARE THE FIRST SHIP' : 'YOU ARE THE SECOND SHIP', 2.6);
      }
      endFrame();
      return;
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
    // --- the controls screen, reached from settings
    //
    // It takes the keyboard raw rather than through the action map,
    // because the whole job is catching a key that may not be bound to
    // anything yet — and because a player rebinding MOVE LEFT onto the
    // key that currently means MOVE RIGHT must not have the screen act
    // on the old meaning on the way past.
    if (controlsOpen) {
      const n = BINDABLE.length;
      if (awaitingKey === null) {
        if (tapped('up')) { controlsSel = (controlsSel - 1 + n) % n; sfxUi(); }
        if (tapped('down')) { controlsSel = (controlsSel + 1) % n; sfxUi(); }
        if (tapped('start') || tapped('fire')) {
          awaitingKey = BINDABLE[controlsSel][0];
          controlsNote = '';
          sfxUi();
        }
        if (tapped('restart')) { resetBindings(); controlsNote = 'CONTROLS RESET'; sfxUi(); }
        if (tapped('options') || tapped('pause') || tapped('quit')) {
          controlsOpen = false; settingsOpen = true; sfxUi();
        }
      }
      endFrame();
      return;
    }

    if (settingsOpen) {
      const n = settings.DEFS.length;
      if (tapped('cycle')) {
        controlsOpen = true; settingsOpen = false; controlsSel = 0;
        awaitingKey = null; controlsNote = ''; sfxUi();
        endFrame();
        return;
      }
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
        if (wipeArmed === 'hangar') {
          clearHangar(game);
          applyMods(game);
          wipeArmed = false;
          wipeNote = 'HANGAR CLEARED';
        } else {
          wipeArmed = 'hangar';
          wipeNote = '';
        }
        sfxUi();
      } else if (tapped('wipeall')) {
        if (wipeArmed === 'all') {
          fullReset();
          wipeArmed = false;
          wipeNote = 'EVERYTHING CLEARED — NEW PILOT';
        } else {
          wipeArmed = 'all';
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

    // Everything from here up is text, and text is what the adaptive
    // scale must never touch.
    if (hudCtx !== ctx) {
      applyUiTransform(hudCtx);
      hudCtx.clearRect(0, 0, VIEW_W, VIEW_H);
    }
    drawHud(hudCtx, game, { muted: isMuted(), audio: ready() });
    if (demoOn) drawDemoBadge(hudCtx, game);
    // The buttons go on last, over everything, because they are the only
    // thing on a phone that can get you out of whatever is on screen.
    if (padsOn) {
      drawPads(hudCtx, padState(),
        game.player.jumpCd > 0 ? new Set(['jump']) : null);
    }
    if (hostStalled()) drawCoopStalled(hudCtx);
    if (coopOpen) drawCoop(hudCtx, coopState(), netState().online);
    else if (shopOpen) drawShop(hudCtx, game, shopSel, shopNote);
    else if (helpOpen) drawHelp(hudCtx, helpPage);
    else if (controlsOpen) drawControls(hudCtx, controlsSel, awaitingKey, controlsNote);
    else if (settingsOpen) drawSettings(hudCtx, game, settingsSel, { wipeArmed, wipeNote });
    else if (game.quitting) drawQuitPrompt(hudCtx, game);
    else if (paused) drawPaused(hudCtx);
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
