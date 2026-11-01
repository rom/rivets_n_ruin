const down = new Set();
const pressed = new Set();

// Exported so the README's controls table can be checked against it: a
// key that is bound but undocumented is a feature nobody finds.
export const MAP = {
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
  window.addEventListener('blur', () => { down.clear(); pressed.clear(); });
}

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
