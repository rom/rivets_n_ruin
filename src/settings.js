// Settings.
//
// Everything here is a player preference rather than a game rule, so it all
// persists and none of it touches a run. The definitions are data so the
// screen that draws them needs no knowledge of what any particular setting
// means — adding one is an entry in this list.

import { DIFFICULTY, LEVELS } from './config.js';

const KEY = 'rnr.settings';

// Grouped only for the heading the screen shows; the list is still flat,
// because a group is a label and not a structure.
export const GROUPS = ['AUDIO', 'GAME', 'ACCESSIBILITY', 'PICTURE'];

export const DEFS = [
  { id: 'music', group: 'AUDIO', label: 'MUSIC', kind: 'bool', def: true,
    help: 'The score. Off leaves sound effects alone.' },
  { id: 'sfx', group: 'AUDIO', label: 'SOUND EFFECTS', kind: 'bool', def: true,
    help: 'Guns, impacts, explosions, pickups.' },
  { id: 'volume', group: 'AUDIO', label: 'MASTER VOLUME', kind: 'range', def: 85, min: 0, max: 100, step: 5,
    help: 'Overall output level.' },
  { id: 'tune', group: 'AUDIO', label: 'TUNE', kind: 'tune', def: 0,
    help: 'Each hull picks its own unless you override it here.' },
  { id: 'difficulty', group: 'GAME', label: 'DIFFICULTY', kind: 'difficulty', def: 1,
    help: 'Takes effect on the next run. Harder settings score more.' },
  { id: 'startHull', group: 'GAME', label: 'START HULL', kind: 'hull', def: 0,
    help: 'Begin on any hull you have reached. Earlier refits are credited.' },
  { id: 'demo', group: 'GAME', label: 'ATTRACT DEMO', kind: 'bool', def: true,
    help: 'Plays itself after two minutes idle. Any key stops it.' },
  // --- accessibility.
  //
  // Each of these removes a specific barrier rather than making the game
  // easier in general — easier in general is what DIFFICULTY is for. They
  // are off by default because a default that changes how the game looks
  // or plays for everyone is not an accessibility setting, it is a
  // redesign.
  { id: 'autofire', group: 'ACCESSIBILITY', label: 'AUTO FIRE', kind: 'bool', def: false,
    help: 'Guns fire on their own. No key to hold down for a whole run.' },
  { id: 'gameSpeed', group: 'ACCESSIBILITY', label: 'GAME SPEED', kind: 'range',
    def: 100, min: 50, max: 100, step: 10,
    help: 'Slows everything evenly. More thinking time; the clock slows with it.' },
  { id: 'reduceFlash', group: 'ACCESSIBILITY', label: 'REDUCE FLASHING', kind: 'bool', def: false,
    help: 'Damps the full-screen flashes, and stops the score pulsing.' },
  { id: 'contrast', group: 'ACCESSIBILITY', label: 'HIGH CONTRAST', kind: 'bool', def: false,
    help: 'Outlines incoming fire and hazards, and brightens the HUD.' },
  { id: 'aimLine', group: 'ACCESSIBILITY', label: 'FIRING LINE', kind: 'bool', def: false,
    help: 'A faint line along the ship\'s line of fire, so aim needs no guessing.' },
  { id: 'radar', group: 'PICTURE', label: 'RADAR STRIP', kind: 'bool', def: true,
    help: 'The map across the top: guns, loot, minibosses, the boss.' },
  { id: 'bloom', group: 'PICTURE', label: 'BLOOM', kind: 'bool', def: true,
    help: 'Glow around bright things. Off is cheaper on a slow machine.' },
  { id: 'scanlines', group: 'PICTURE', label: 'CRT SCANLINES', kind: 'bool', def: true,
    help: 'The vignette and scanline overlay.' },
  { id: 'shake', group: 'PICTURE', label: 'SCREEN SHAKE', kind: 'bool', def: true,
    help: 'Camera kick on impacts and explosions.' },
  { id: 'foreground', group: 'PICTURE', label: 'FOREGROUND LAYER', kind: 'bool', def: true,
    help: 'Girders and cables passing in front of the ship.' },
  { id: 'damageNumbers', group: 'PICTURE', label: 'SHOW PICKUP TOASTS', kind: 'bool', def: true,
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
      if (d.kind === 'difficulty' && Number.isFinite(saved[d.id])) {
        state[d.id] = Math.max(0, Math.min(DIFFICULTY.length - 1, saved[d.id]));
      }
      if (d.kind === 'hull' && Number.isFinite(saved[d.id])) {
        state[d.id] = Math.max(0, Math.min(LEVELS.length - 1, saved[d.id]));
      }
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
//
// `ctx` carries the bounds this module cannot know on its own: how many
// tunes there are, and how far through the campaign the pilot has actually
// got. A start hull beyond that is not a setting, it is a cheat.
export function nudge(id, dir, ctx = {}) {
  const tuneCount = ctx.tuneCount || 1;
  const hullMax = ctx.hullMax === undefined ? 0 : ctx.hullMax;
  const d = DEFS.find((x) => x.id === id);
  if (!d) return;
  if (d.kind === 'bool') set(id, !state[id]);
  else if (d.kind === 'range') {
    set(id, Math.max(d.min, Math.min(d.max, state[id] + dir * d.step)));
  } else if (d.kind === 'tune') {
    set(id, ((state[id] + dir) % tuneCount + tuneCount) % tuneCount);
  } else if (d.kind === 'difficulty') {
    set(id, Math.max(0, Math.min(DIFFICULTY.length - 1, state[id] + dir)));
  } else if (d.kind === 'hull') {
    set(id, Math.max(0, Math.min(hullMax, state[id] + dir)));
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
  if (d.kind === 'difficulty') return DIFFICULTY[state[d.id]].name;
  if (d.kind === 'hull') {
    const i = Math.max(0, Math.min(LEVELS.length - 1, state[d.id] | 0));
    return LEVELS[i].name + '  ' + (i + 1) + '/' + LEVELS.length;
  }
  return '';
}
