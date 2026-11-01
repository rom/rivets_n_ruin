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
// Gold bars are here too, and for the same reason: the armourer prices
// its permanent systems in them, so a bar has to survive the tab the way
// a coin does.
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

export const freshHangar = () => ({ coins: 0, bars: 0, mods: {} });

// Everything read back from storage goes through this. Storage is the one
// input a player can edit by hand, so nothing from it is trusted: an
// unknown mod id, a level that is not a number, a negative coin count and
// a coins field that is a string are all things localStorage can hold and
// the game cannot.
export function sanitise(raw, validIds = null) {
  const out = freshHangar();
  if (!raw || typeof raw !== 'object') return out;

  for (const field of ['coins', 'bars']) {
    const n = Number(raw[field]);
    if (Number.isFinite(n) && n > 0) out[field] = Math.min(MAX_COINS, Math.floor(n));
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
//
// Writes localStorage first and the server second, and never waits for
// the server. localStorage is the copy that has to be there when the tab
// closes; the backend is the copy that makes a second machine work.
// Reversing them would mean a dropped connection could cost a purchase.
//
// The upload is a hook rather than an argument because saveHangar is
// called from the shop, the game loop and two page-lifecycle handlers,
// and threading a parameter through all of them to reach one module
// would be four chances to forget.
let upload = null;
export function setHangarSync(fn) { upload = fn; }

export function saveHangar(game) {
  const h = sanitise({ coins: game.coins, bars: game.bars, mods: game.mods });
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...h }));
  } catch { /* private mode; the run still plays, it just will not keep */ }
  if (upload) {
    // Never awaited, and never allowed to throw into a caller that was
    // in the middle of buying something.
    try { Promise.resolve(upload(h)).catch(() => {}); } catch { /* offline */ }
  }
  return h;
}

// Reconciling the two copies at sign-in.
//
// Two places hold a hangar and either can be ahead: the browser you are
// sitting at may have banked coins while offline, and the account may
// have been played on another machine since. There is no clock worth
// trusting on the client, so this does not try to merge by time.
//
// It takes the better of each, which is the only rule that can never
// take something away from a pilot who earned it. The failure it allows
// — playing offline on two machines and keeping the best of both — is a
// pilot being slightly richer than they should be in a single-player
// shop. The failure it avoids is losing a purchase, and between those
// two there is no contest.
export function mergeHangars(local, remote) {
  const a = sanitise(local);
  const b = sanitise(remote);
  const out = {
    coins: Math.max(a.coins, b.coins),
    bars: Math.max(a.bars, b.bars),
    mods: {},
  };
  for (const id of new Set([...Object.keys(a.mods), ...Object.keys(b.mods)])) {
    out.mods[id] = Math.max(a.mods[id] || 0, b.mods[id] || 0);
  }
  return out;
}

// Puts a reconciled hangar into the live game, so the shop and the HUD
// read it immediately rather than at the next reload.
export function applyHangar(game, h) {
  const clean = sanitise(h);
  game.coins = clean.coins;
  game.bars = clean.bars;
  game.mods = clean.mods;
  return clean;
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
    game.bars = 0;
    game.mods = {};
  }
  return freshHangar();
}
