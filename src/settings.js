// Settings.
//
// Everything here is a player preference rather than a game rule, so it all
// persists and none of it touches a run. The definitions are data so the
// screen that draws them needs no knowledge of what any particular setting
// means — adding one is an entry in this list.

const KEY = 'rnr.settings';

export const DEFS = [
  { id: 'music', label: 'MUSIC', kind: 'bool', def: true,
    help: 'The score. Off leaves sound effects alone.' },
  { id: 'sfx', label: 'SOUND EFFECTS', kind: 'bool', def: true,
    help: 'Guns, impacts, explosions, pickups.' },
  { id: 'volume', label: 'MASTER VOLUME', kind: 'range', def: 85, min: 0, max: 100, step: 5,
    help: 'Overall output level.' },
  { id: 'tune', label: 'TUNE', kind: 'tune', def: 0,
    help: 'Each hull picks its own unless you override it here.' },
  { id: 'bloom', label: 'BLOOM', kind: 'bool', def: true,
    help: 'Glow around bright things. Off is cheaper on a slow machine.' },
  { id: 'scanlines', label: 'CRT SCANLINES', kind: 'bool', def: true,
    help: 'The vignette and scanline overlay.' },
  { id: 'shake', label: 'SCREEN SHAKE', kind: 'bool', def: true,
    help: 'Camera kick on impacts and explosions.' },
  { id: 'foreground', label: 'FOREGROUND LAYER', kind: 'bool', def: true,
    help: 'Girders and cables passing in front of the ship.' },
  { id: 'damageNumbers', label: 'SHOW PICKUP TOASTS', kind: 'bool', def: true,
    help: 'The line naming what a pickup just did.' },
];

const state = {};

function load() {
  for (const d of DEFS) state[d.id] = d.def;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const d of DEFS) {
      if (saved[d.id] === undefined) continue;
      // Validate rather than trust: a hand-edited or stale entry should not
      // be able to put the game into a state the UI cannot get it out of.
      if (d.kind === 'bool' && typeof saved[d.id] === 'boolean') state[d.id] = saved[d.id];
      if (d.kind === 'range' && Number.isFinite(saved[d.id])) {
        state[d.id] = Math.max(d.min, Math.min(d.max, saved[d.id]));
      }
      if (d.kind === 'tune' && Number.isFinite(saved[d.id])) state[d.id] = saved[d.id];
    }
  } catch { /* corrupt or unavailable; defaults stand */ }
}
load();

export const get = (id) => state[id];
export const all = () => ({ ...state });

export function set(id, value) {
  const d = DEFS.find((x) => x.id === id);
  if (!d) return;
  state[id] = value;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  for (const fn of listeners) fn(id, value);
}

// Steps a setting by one notch in the given direction.
export function nudge(id, dir, tuneCount = 1) {
  const d = DEFS.find((x) => x.id === id);
  if (!d) return;
  if (d.kind === 'bool') set(id, !state[id]);
  else if (d.kind === 'range') {
    set(id, Math.max(d.min, Math.min(d.max, state[id] + dir * d.step)));
  } else if (d.kind === 'tune') {
    set(id, ((state[id] + dir) % tuneCount + tuneCount) % tuneCount);
  }
}

export function reset() {
  for (const d of DEFS) state[d.id] = d.def;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  for (const fn of listeners) fn(null, null);
}

const listeners = [];
export const onChange = (fn) => listeners.push(fn);

// Renders a setting's current value as the screen should show it.
export function display(d, tuneName) {
  if (d.kind === 'bool') return state[d.id] ? 'ON' : 'OFF';
  if (d.kind === 'range') return String(state[d.id]);
  if (d.kind === 'tune') return tuneName || String(state[d.id]);
  return '';
}
