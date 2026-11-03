const down = new Set();
const pressed = new Set();

// What the keyboard does out of the box.
//
// Exported so the README's controls table can be checked against it: a
// key that is bound but undocumented is a feature nobody finds.
export const DEFAULT_MAP = {
  ArrowLeft: 'left',  KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up',      KeyW: 'up',
  ArrowDown: 'down',  KeyS: 'down',
  KeyZ: 'fire', Space: 'fire', KeyJ: 'fire',
  Enter: 'start', NumpadEnter: 'start',
  KeyP: 'pause', Escape: 'pause',
  KeyR: 'restart',
  KeyM: 'mute',
  // 'no' serves double duty: cancel on the quit prompt, rename on the title.
  // The two states are disjoint, so there is no ambiguity to resolve.
  KeyN: 'no',
  KeyY: 'yes',
  KeyQ: 'quit',
  KeyO: 'options',
  KeyH: 'help', Slash: 'help',
  KeyB: 'board',
  KeyK: 'wipe',        // clear the hangar, from the settings screen only
  KeyF: 'wipeall',     // clear everything earned, likewise
  KeyE: 'shop',
  KeyX: 'secondary', ShiftLeft: 'secondary',
  KeyC: 'cycle',
  Digit1: 'arm1', Digit2: 'arm2', Digit3: 'arm3',
  KeyT: 'tune',
  BracketRight: 'tune',
};

// The actions a player can rebind, in the order the controls screen
// lists them. Not every action: `wipe` and `wipeall` are the two
// irreversible keys and they are deliberately fixed, because rebinding
// one onto something you reach for in flight is a way to lose a campaign
// to a typo. `start` is fixed for the same reason a lift has a door
// button — it has to work when everything else has been broken.
export const BINDABLE = [
  ['left', 'MOVE LEFT'], ['right', 'MOVE RIGHT'],
  ['up', 'MOVE UP'], ['down', 'MOVE DOWN'],
  ['fire', 'FIRE'], ['secondary', 'ORDNANCE'], ['cycle', 'CYCLE ORDNANCE'],
  ['arm1', 'ORDNANCE 1'], ['arm2', 'ORDNANCE 2'], ['arm3', 'ORDNANCE 3'],
  ['pause', 'PAUSE'], ['restart', 'RESTART'], ['quit', 'QUIT RUN'],
  ['shop', 'ARMOURER'], ['board', 'LEADERBOARD'], ['help', 'HELP'],
  ['options', 'SETTINGS'], ['mute', 'MUTE'], ['tune', 'NEXT TUNE'],
];
const FIXED = new Set(['start', 'yes', 'no', 'wipe', 'wipeall']);

const KEYS_KEY = 'rnr.keys';

// The live map: the defaults, with the player's own bindings over the
// top. A rebind replaces the whole entry for that action rather than
// adding to it, so a remapped action has exactly the key the controls
// screen shows — two keys doing the same thing is fine as a default and
// confusing as a choice.
export const MAP = { ...DEFAULT_MAP };

function rebuild(overrides) {
  for (const k of Object.keys(MAP)) delete MAP[k];
  // The ACTIONS that have been rebound, not their keys. `overrides` is
  // keyed by action and valued by code, and taking the values here
  // compared a code against an action name — always false, so every
  // default survived and a rebound action answered to its new key *and*
  // its old one.
  const replaced = new Set(Object.keys(overrides));
  for (const [code, action] of Object.entries(DEFAULT_MAP)) {
    if (!replaced.has(action)) MAP[code] = action;
  }
  for (const [action, code] of Object.entries(overrides)) MAP[code] = action;
}

let bindings = {};
function loadBindings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS_KEY) || '{}');
    const ok = {};
    for (const [action, code] of Object.entries(raw)) {
      // Validate rather than trust: a hand-edited file must not be able
      // to bind an action that does not exist, or shadow a fixed key.
      if (typeof code !== 'string' || !code) continue;
      if (!BINDABLE.some(([a]) => a === action)) continue;
      if (FIXED.has(DEFAULT_MAP[code])) continue;
      ok[action] = code;
    }
    bindings = ok;
  } catch { bindings = {}; }
  rebuild(bindings);
}
loadBindings();

const save = () => {
  try { localStorage.setItem(KEYS_KEY, JSON.stringify(bindings)); } catch { /* private mode */ }
};

// Which key an action answers to, for the controls screen to print.
export function keyFor(action) {
  if (bindings[action]) return bindings[action];
  for (const [code, a] of Object.entries(DEFAULT_MAP)) if (a === action) return code;
  return '';
}
export const isBindable = (action) => BINDABLE.some(([a]) => a === action);
export const isFixedKey = (code) => FIXED.has(DEFAULT_MAP[code]);
export const boundActions = () => ({ ...bindings });

// Binds `code` to `action`. Refuses the keys that must keep working —
// see FIXED — and takes the key off whatever else was using it, because
// one key doing two things is how a player loses a run to a keystroke
// they thought meant something else.
export function rebind(action, code) {
  if (!isBindable(action) || !code) return false;
  if (FIXED.has(DEFAULT_MAP[code])) return false;
  for (const [a, c] of Object.entries(bindings)) if (c === code && a !== action) delete bindings[a];
  bindings[action] = code;
  save();
  rebuild(bindings);
  return true;
}

export function resetBindings() {
  bindings = {};
  save();
  rebuild(bindings);
}

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    const a = MAP[e.code];
    if (!a) return;
    e.preventDefault();
    if (!down.has(a)) pressed.add(a);
    down.add(a);
  });
  target.addEventListener('keyup', (e) => {
    const a = MAP[e.code];
    if (!a) return;
    e.preventDefault();
    down.delete(a);
  });
  // Dropping focus mid-thrust should not leave the engine stuck on.
  window.addEventListener('blur', () => { down.clear(); pressed.clear(); touches.clear(); });
}

// --- on-screen controls
//
// A phone has no keyboard, so the buttons drive the same two sets the
// keyboard does and everything downstream stays unaware. Held separately
// so losing a pointer — a finger sliding off the glass, the browser
// taking the gesture — can clear the touches without clearing keys a
// player is also holding.
const touches = new Map();          // pointerId -> action

export function touchDown(id, action) {
  if (!action) return;
  const before = [...touches.values()].includes(action);
  touches.set(id, action);
  if (!before && !down.has(action)) pressed.add(action);
  down.add(action);
}

export function touchUp(id) {
  const action = touches.get(id);
  if (action === undefined) return;
  touches.delete(id);
  // Only release it if no other finger is still on a button for it.
  if (![...touches.values()].includes(action)) down.delete(action);
}

export function touchClear() {
  for (const a of touches.values()) down.delete(a);
  touches.clear();
}

// Which actions the on-screen controls are currently holding, so the
// buttons can be drawn lit.
export const touchHeld = (a) => [...touches.values()].includes(a);

// --- synthetic input
//
// The attract-mode demo flies the real game through the real update loop,
// so it needs to look like a player to everything downstream. Rather than
// thread an "is this the demo" flag through the player, the armoury and
// the menus, it substitutes the input layer: while a synthetic set is
// installed, every read below answers from it.
//
// Real keys keep being recorded regardless — that is how the demo knows to
// stop, and it is why realAnyTapped exists alongside anyTapped.
let synth = null;
let synthPrev = new Set();

export function setSynthetic(actions) {
  if (!actions) { synth = null; synthPrev = new Set(); return; }
  synthPrev = synth || new Set();
  synth = actions;
}
export const isSynthetic = () => synth !== null;

export const held = (a) => (synth ? synth.has(a) : down.has(a));
export const tapped = (a) => (synth ? synth.has(a) && !synthPrev.has(a) : pressed.has(a));
export const endFrame = () => pressed.clear();
// True if any mapped key went down this frame. Used by the splash, which
// should be dismissable without the player hunting for the right key.
export const anyTapped = () => (synth ? synth.size > 0 : pressed.size > 0);
// Always the keyboard, never the demo. The demo stops when a person
// touches something, and it cannot be allowed to stop itself.
export const realAnyTapped = () => pressed.size > 0;
const ax = (pos, neg) => (held(pos) ? 1 : 0) - (held(neg) ? 1 : 0);
export const axisX = () => ax('right', 'left');
export const axisY = () => ax('down', 'up');
