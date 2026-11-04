// Backend client.
//
// Hard rule: the game must remain completely playable when the backend is
// unreachable. Every call here is best-effort — it times out, swallows the
// failure, flips `online` to false and returns a falsy value. Nothing in the
// game loop may await a network call or branch on one succeeding.

import { VERSION } from './config.js';

const TIMEOUT_MS = 4000;
const HEARTBEAT_MS = 5000;
const STORE_KEY = 'rnr.player';

// Every request says which build it came from.
//
// A header rather than a field in the body, because it has to be on
// reads too and those have no body. The server tallies the versions it
// sees, which is what turns "the game is broken for some people" into
// "nine people are still on 1.0.4" — and it can refuse writes from a
// build too old to trust, which arrives here as a 426.
const VERSION_HEADER = 'X-RNR-Version';

const S = {
  base: '',            // same origin; the Go server serves game and API together
  online: false,
  checked: false,
  player: null,        // { id, name, token }
  top: [],        // one row per player
  submitState: 'idle',   // idle | sending | recorded | refused
  submitError: null,     // why the backend refused it, in its own words
  runs: [],       // best individual runs
  coop: [],       // best co-op runs: two pilots a row
  board: 'pilots',// which of the three the UI is showing
  best: 0,
  run: null,      // { id, key } for the run in progress; see internal/api/runs.go
  flying: [],
  stats: null,
  rank: null,
  // Set when the server refuses this build. Sticky: it does not come
  // back on the next successful read, because the build is still old.
  outdated: null,
  lastError: null,
  lastBeat: 0,
};

export const netState = () => S;
export const isOnline = () => S.online;
export const player = () => S.player;

async function call(path, { method = 'GET', body, auth = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const headers = { [VERSION_HEADER]: VERSION };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && S.player) headers.Authorization = `Bearer ${S.player.token}`;

    const res = await fetch(S.base + path, {
      method, headers, signal: ctl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 204) { S.online = true; return true; }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      S.lastError = (data && data.error) || `HTTP ${res.status}`;
      // 426: this build is older than the server will take writes
      // from. Worth holding onto rather than letting it scroll past as
      // one more failed call — it is the one error the player can
      // actually do something about, and the title screen says so.
      if (res.status === 426) S.outdated = S.lastError;
      // A 5xx means the server is sick, not absent; anything else means it
      // answered us, so we are still online.
      S.online = res.status < 500;
      return null;
    }
    S.online = true;
    S.lastError = null;
    return data;
  } catch (err) {
    S.online = false;
    S.lastError = err.name === 'AbortError' ? 'backend timed out' : 'backend unreachable';
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function loadPlayer() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.id && p.token ? p : null;
  } catch {
    return null;
  }
}

function savePlayer(p) {
  S.player = p;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

// Forget who this browser is.
//
// A full reset has to do this, not just clear the local copies. The
// account holds the hangar and the best score, and syncBest only ever
// raises the local figure from the server's — so a reset that kept the
// identity would watch the high score it had just cleared come straight
// back on the next sync, which makes the button a lie.
//
// What it does NOT do is delete anything on the server. Runs already
// submitted stay on the leaderboard under the old name, because that
// board is a public record and a button in a settings screen is not
// the right instrument for editing one. Signing back in gets the old
// pilot, and everything of theirs, back.
export function forgetPlayer() {
  S.player = null;
  S.best = 0;
  try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
}

// A name nobody has to type before their first run.
function suggestName() {
  const a = ['RUST', 'IRON', 'SLAG', 'BOLT', 'ARC', 'FLUX', 'DROSS', 'QUENCH', 'FORGE', 'SCRAP'];
  const b = ['JACK', 'HOUND', 'WRENCH', 'KITE', 'SPUR', 'HAMMER', 'RIG', 'NAIL'];
  const pick = (x) => x[Math.floor(Math.random() * x.length)];
  return `${pick(a)}${pick(b)}${Math.floor(Math.random() * 90 + 10)}`;
}

// The server's record of your best, pulled on connect. This is what makes
// a high score survive a cleared localStorage or a different machine: the
// pilot identity owns it, the browser only caches it.
export const serverBest = () => S.best;

export async function initNet() {
  S.checked = true;
  const health = await call('/api/health');
  if (!health) return false;

  S.player = loadPlayer();
  if (!S.player) {
    const created = await register(suggestName());
    if (!created) return false;
  } else {
    // Confirm the token still resolves; the server may have been wiped.
    const me = await call('/api/me', { auth: true });
    if (!me) {
      const created = await register(suggestName());
      if (!created) return false;
    } else if (me.player) {
      S.best = me.player.best || 0;
    }
  }
  await Promise.all([refreshTop(), refreshRuns(), refreshPresence(), refreshStats()]);
  return true;
}

// Registration and login. A pilot created before passwords existed can
// adopt one by registering the same name while holding their token, which
// keeps their scores.
export async function signUp(name, password) {
  const data = await call('/api/auth/register', { method: 'POST', auth: true, body: { name, password } });
  if (!data) return null;
  savePlayer({ id: data.id, name: data.name, token: data.token });
  await identityChanged();
  await Promise.all([refreshTop(), refreshRuns(), refreshStats()]);
  return S.player;
}

export async function signIn(name, password) {
  const data = await call('/api/auth/login', { method: 'POST', body: { name, password } });
  if (!data) return null;
  savePlayer({ id: data.id, name: data.name, token: data.token });
  await identityChanged();
  await Promise.all([refreshTop(), refreshRuns(), refreshStats()]);
  return S.player;
}

// Called whenever the pilot this browser is acting as changes: a
// sign-in, a sign-up, a fresh anonymous registration, or the backend
// coming back after being unreachable.
//
// It exists because the hangar has to be reconciled against whichever
// account is now in play, and net.js is the only place that knows when
// that changes. Doing it once at page load covered exactly one of
// those four moments, and signing in afterwards pushed this browser's
// hangar over the account it had just signed into.
let onIdentity = null;
export function setIdentityHook(fn) { onIdentity = fn; }

async function identityChanged() {
  if (!onIdentity) return;
  try { await onIdentity(); } catch { /* the run carries on regardless */ }
}

// --- the hangar, as the server holds it
//
// Coins, bars and bought mods are the one piece of progress that is
// supposed to outlive a ship. They lived only in localStorage, so they
// did not outlive a new browser, a cleared cache or a second machine —
// which is most of what signing in is for.

export async function fetchHangar() {
  return call('/api/me/hangar', { auth: true });
}

export async function pushHangar(h) {
  return call('/api/me/hangar', {
    method: 'PUT',
    auth: true,
    body: { coins: h.coins | 0, bars: h.bars | 0, mods: h.mods || {} },
  });
}

export async function register(name) {
  const data = await call('/api/players', { method: 'POST', body: { name } });
  if (!data) return null;
  savePlayer({ id: data.id, name: data.name, token: data.token });
  return S.player;
}

// Renaming means a new identity: the backend has no rename route, and for a
// score board that is the honest behaviour — the old name keeps its scores.
export async function rename(name) {
  const data = await call('/api/players', { method: 'POST', body: { name } });
  if (!data) return null;
  savePlayer({ id: data.id, name: data.name, token: data.token });
  await refreshTop();
  return S.player;
}

// The best individual runs, without folding to one row per player, so one
// exceptional pilot can hold several places.
export async function refreshRuns(modId = '', window = 'all', limit = 10) {
  const q = new URLSearchParams({ window, limit: String(limit) });
  if (modId) q.set('mod', modId);
  const data = await call(`/api/scores/runs?${q}`);
  if (data) S.runs = data.top || [];
  return S.runs;
}

// The three boards, in the order the key cycles them.
export const BOARDS = ['pilots', 'runs', 'coop'];

export function setBoard(which) {
  S.board = BOARDS.includes(which) ? which : 'pilots';
  return S.board;
}
export const toggleBoard = () => setBoard(
  BOARDS[(BOARDS.indexOf(S.board) + 1) % BOARDS.length]);

// The co-op top ten: one row per run, two names on it.
//
// No mod parameter. A mod is a variant of the single-player
// configuration and a co-op room carries a seed and a hull, not a mod,
// so a per-mod co-op board would be a filter on a field that is always
// empty.
export async function refreshCoopTop(limit = 10) {
  const data = await call(`/api/coop/scores/top?limit=${limit}`);
  if (data) S.coop = data.top || [];
  return S.coop;
}
export const coopTop = () => S.coop;

export async function refreshTop(modId = '', window = 'all', limit = 8) {
  const q = new URLSearchParams({ window, limit: String(limit) });
  if (modId) q.set('mod', modId);
  const data = await call(`/api/scores/top?${q}`);
  if (data) S.top = data.top || [];
  return S.top;
}

export async function refreshPresence() {
  const data = await call('/api/presence');
  if (data) S.flying = data.flying || [];
  return S.flying;
}

export async function refreshStats() {
  const data = await call('/api/stats');
  if (data) {
    S.stats = data;
    // The server publishes the oldest build it will take writes from.
    // Knowing before the first submission is better than finding out
    // at the end of a run that the score cannot be posted.
    const srv = data.server;
    if (srv && srv.minClient && olderThan(VERSION, srv.minClient)) {
      S.outdated = `this build (${VERSION}) is older than the server's `
        + `minimum of ${srv.minClient} — reload to get the current one`;
    }
  }
  return S.stats;
}

// Server info, for anything that wants to show it: the build, when it
// came up, and how long it has been there.
export const serverInfo = () => (S.stats && S.stats.server) || null;
export const outdated = () => S.outdated;

// Compares two dotted versions the same way the server does, so the
// client and the gate agree about what "older" means. Anything that is
// not a number counts as 0, which makes 1.2.0-rc1 the same release as
// 1.2.0 — a release candidate of an allowed version is allowed.
export function olderThan(a, b) {
  const part = (v, i) => parseInt((v.split('.')[i] || '0').match(/^\d*/)[0] || '0', 10);
  const n = Math.max(a.split('.').length, b.split('.').length);
  for (let i = 0; i < n; i++) {
    if (part(a, i) !== part(b, i)) return part(a, i) < part(b, i);
  }
  return false;
}

// Opens a run with the server before the first hull. The reply carries a
// secret that signs the eventual submission, so a score cannot be posted
// without having started a run through the game. See internal/api/runs.go
// for what this does and does not actually prove.
export async function startRun(modId = '') {
  S.submitState = 'idle';
  S.submitError = null;
  S.run = null;
  if (!S.player) return null;
  const data = await call('/api/runs/start', { method: 'POST', auth: true, body: { modId } });
  if (!data) return null;
  try {
    const raw = Uint8Array.from(
      atob(data.secret.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    S.run = { id: data.runId, key };
  } catch {
    S.run = null;          // no WebCrypto: play on, unsigned
  }
  return S.run;
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Must match sign() in internal/api/runs.go exactly, including the field
// order and the two decimal places on the time.
async function signRun(run, points, timeSec, levels) {
  const msg = `${run.id}|${points}|${timeSec.toFixed(2)}|${levels}`;
  const mac = await crypto.subtle.sign('HMAC', run.key, new TextEncoder().encode(msg));
  return b64url(mac);
}

export async function submitRun({
  modId = '', points, timeSec, turrets, deaths, completed, levels = 1, hullsFlown = 0,
}) {
  if (!S.player) return null;
  const body = { modId, points, timeSec, turrets, deaths, completed, levels, hullsFlown };
  if (S.run) {
    body.runId = S.run.id;
    try { body.sig = await signRun(S.run, points, timeSec, levels); } catch { /* unsigned */ }
  }
  S.submitState = 'sending';
  const data = await call('/api/scores', { method: 'POST', auth: true, body });
  S.run = null;        // a run is good for one submission
  // A run the backend refuses is not a run that is still sending. The end
  // screen used to show SENDING RUN... for as long as you left it sitting
  // there, which is how a rejected 4.6-million run looked exactly like a
  // slow network.
  S.submitState = data ? 'recorded' : 'refused';
  S.submitError = data ? null : S.lastError;
  if (data) {
    S.rank = data.rank || null;
    if (data.score && data.score.points > S.best) S.best = data.score.points;
    refreshTop(modId);   // deliberately not awaited
    refreshRuns(modId);
    refreshStats();      // so "N of M" reports the real player count
  }
  return data;
}

/**
 * Post a co-op run. The host calls this; the guest calls nothing.
 *
 * It has to be the host: that is the side that simulated the run, so
 * its figures are the ones the game produced, and two submissions for
 * one run would mean two board rows or a rule deciding which of two
 * disagreeing clients to believe.
 *
 * The partner is deliberately not in the body. The server takes the
 * second pilot from the room, where it was recorded when they joined
 * with their own account, so a host cannot name anybody it did not
 * actually play with. See internal/api/coopscores.go.
 */
export async function submitCoopRun({
  code, points, timeSec, turrets, deaths, completed, levels = 1, hullsFlown = 0,
}) {
  if (!S.player) return null;
  const body = { code, points, timeSec, turrets, deaths, completed, levels, hullsFlown };
  if (S.run) {
    body.runId = S.run.id;
    try { body.sig = await signRun(S.run, points, timeSec, levels); } catch { /* unsigned */ }
  }
  S.submitState = 'sending';
  const data = await call('/api/coop/scores', { method: 'POST', auth: true, body });
  S.run = null;
  S.submitState = data ? 'recorded' : 'refused';
  S.submitError = data ? null : S.lastError;
  if (data) {
    S.rank = data.rank || null;
    refreshCoopTop();    // deliberately not awaited
    refreshStats();
  }
  return data;
}

// What the guest's end screen says instead of a submission.
//
// Marked rather than left idle: a screen that sits on SENDING RUN...
// for ever looks exactly like a backend that is down, and the guest is
// not sending anything by design.
export function coopPostedByHost() {
  S.submitState = 'posted-by-host';
  S.submitError = null;
  S.rank = null;
}

// Fire-and-forget, self-throttling. Called from the game loop, so it must
// never block and never throw.
export function heartbeat(modId, progress, score, level = 0) {
  if (!S.player || !S.online) return;
  const now = Date.now();
  if (now - S.lastBeat < HEARTBEAT_MS) return;
  S.lastBeat = now;
  call('/api/presence', {
    method: 'POST',
    auth: true,
    body: { modId, progress, score, runId: S.run ? S.run.id : '', level },
  }).then(() => refreshPresence());
}

export async function listMods(limit = 20, sort = 'plays') {
  const data = await call(`/api/mods?limit=${limit}&sort=${sort}`);
  return data ? data.mods || [] : [];
}

export async function getMod(id) {
  return call(`/api/mods/${encodeURIComponent(id)}`);
}

export async function publishMod({ name, seed, config, notes }) {
  return call('/api/mods', { method: 'POST', auth: true, body: { name, seed, config, notes } });
}
