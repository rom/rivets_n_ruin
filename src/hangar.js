// The hangar: what belongs to the pilot rather than to the run.
//
// Three different lifetimes were tangled together. The *loadout* — gun
// levels, armory rounds — belongs to the hull you are flying and is lost
// with the ship, which is the whole tension of the thing. The *run* —
// score, clock, hull reached — belongs to the campaign and resets when you
// launch again. And the *hangar* — coins banked and mods bought — belongs
// to the pilot, and was being thrown away with the other two: close the
// tab and every mod you had paid for was gone.
//
// Mods are the one purchase the game describes as permanent ("new ships
// with new features"), so they are the one purchase that has to outlive a
// browser session. Coins go with them, because a currency you cannot bank
// is not a currency.
//
// What deliberately does NOT live here: anything bought from the ITEMS
// list. Those are the run's loadout, they are already forfeit on death,
// and persisting them would hand a fresh run a maxed ship.

const KEY = 'rnr.hangar';
const VERSION = 1;

// A ceiling on what can be read back in. Not a game rule — the game has no
// coin cap — but a hand-edited or corrupted entry should not be able to
// put the HUD into a state it cannot render or the shop into one where
// everything is free forever.
export const MAX_COINS = 1e9;
export const MAX_MOD_LEVEL = 99;

export const freshHangar = () => ({ coins: 0, mods: {} });

// Everything read back from storage goes through this. Storage is the one
// input a player can edit by hand, so nothing from it is trusted: an
// unknown mod id, a level that is not a number, a negative coin count and
// a coins field that is a string are all things localStorage can hold and
// the game cannot.
export function sanitise(raw, validIds = null) {
  const out = freshHangar();
  if (!raw || typeof raw !== 'object') return out;

  const coins = Number(raw.coins);
  if (Number.isFinite(coins) && coins > 0) {
    out.coins = Math.min(MAX_COINS, Math.floor(coins));
  }

  const mods = raw.mods;
  if (mods && typeof mods === 'object') {
    for (const id of Object.keys(mods)) {
      if (validIds && !validIds.includes(id)) continue;
      const lvl = Number(mods[id]);
      if (!Number.isFinite(lvl) || lvl < 1) continue;
      out.mods[id] = Math.min(MAX_MOD_LEVEL, Math.floor(lvl));
    }
  }
  return out;
}

export function loadHangar(validIds = null) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshHangar();
    const parsed = JSON.parse(raw);
    // Version is for later: when the shape changes, old saves get migrated
    // here rather than silently misread. Nothing to migrate yet, but a save
    // from the future is not something this build can read.
    if (parsed && parsed.version > VERSION) return freshHangar();
    return sanitise(parsed, validIds);
  } catch {
    // Corrupt, or storage unavailable in private mode. An unreadable
    // hangar is an empty one; it must never stop the game starting.
    return freshHangar();
  }
}

// Called after anything that changes what the pilot owns. Takes the game
// rather than a hangar object so there is exactly one copy of the truth —
// a separate mirror would be one more thing to keep in step.
export function saveHangar(game) {
  const h = sanitise({ coins: game.coins, mods: game.mods });
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...h }));
  } catch { /* private mode; the run still plays, it just will not keep */ }
  return h;
}

// The escape hatch. Progress that persists needs a way back to nothing, or
// a pilot who wants a clean run has to clear site data by hand.
//
// Takes the game, because clearing storage alone does not work: the game
// saves on pagehide, so a wipe that left the live coins and mods in place
// was written straight back when the tab closed. Found by clearing storage
// in a browser, closing the tab and finding everything still there.
export function clearHangar(game = null) {
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
  if (game) {
    game.coins = 0;
    game.mods = {};
  }
  return freshHangar();
}
