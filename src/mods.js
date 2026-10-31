// Mod loading.
//
// The game is already fully determined by a hull seed plus the values in
// config.js, so a mod is exactly those two things. Config overrides are
// applied by mutating the exported objects: the bindings are const, but the
// objects they point at are not, and every system reads them live.

import { SHIP, TURRET, INTERCEPTOR, CAM, COL } from './config.js';
import { getMod } from './net.js';

// Only these may be overridden. An allowlist keeps a mod from reaching into
// anything structural (level length, timestep) where a bad value would break
// the game rather than change it.
const TARGETS = { SHIP, TURRET, INTERCEPTOR, CAM, COL };

let active = null;
export const activeMod = () => active;
export const activeModId = () => (active ? active.id : '');

function mergeInto(target, patch) {
  let applied = 0;
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in target)) continue;                 // ignore unknown keys
    if (typeof target[k] !== typeof v) continue;  // and type mismatches
    target[k] = v;
    applied++;
  }
  return applied;
}

export function applyModConfig(config) {
  let applied = 0;
  for (const [group, patch] of Object.entries(config || {})) {
    const target = TARGETS[group];
    if (!target || typeof patch !== 'object' || patch === null) continue;
    applied += mergeInto(target, patch);
  }
  return applied;
}

// Reads ?mod=<id> and loads it. Returns the mod, or null for the stock hull.
export async function loadModFromURL() {
  const id = new URLSearchParams(location.search).get('mod');
  if (!id) return null;
  const mod = await getMod(id);
  if (!mod) {
    console.warn(`mod ${id} could not be loaded; flying the stock hull`);
    return null;
  }
  const applied = applyModConfig(mod.config);
  active = mod;
  console.info(`mod "${mod.name}" by ${mod.author}: ${applied} override(s), seed ${mod.seed}`);
  return mod;
}
