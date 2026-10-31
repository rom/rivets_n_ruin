const down = new Set();
const pressed = new Set();

const MAP = {
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

export const held = (a) => down.has(a);
export const tapped = (a) => pressed.has(a);
export const endFrame = () => pressed.clear();
export const axisX = () => (down.has('right') ? 1 : 0) - (down.has('left') ? 1 : 0);
export const axisY = () => (down.has('down') ? 1 : 0) - (down.has('up') ? 1 : 0);
