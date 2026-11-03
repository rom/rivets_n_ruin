// The operator's page.
//
// Plain ES modules and no build step, like the game. Two rules run
// through all of it:
//
//   1. Nothing from the server is ever written as HTML. Pilot names,
//      mod names and client error messages are strings other people
//      put into a public API, and this page shows them to the one
//      person holding a credential that deletes accounts. Everything
//      goes in through textContent, via el() below. There is no
//      innerHTML in this file and there should never be one.
//
//   2. Every button that destroys something asks first, and says what
//      it is about to destroy by name. "Are you sure?" is not a
//      confirmation; "delete rom, 14 runs, permanently?" is.
//
// The session token lives in sessionStorage, so a refresh does not log
// you out and closing the tab does. It is a 30-minute token on a
// loopback listener for a page that loads nothing from anywhere — see
// the policy in api.go — which is the trade worth making over keeping
// it in a variable and logging out on every reload.

const TOKEN_KEY = 'rnr.admin.token';

// ---------------------------------------------------------------- dom

// Build an element. Children that are strings become text nodes, never
// markup. This is the whole of the page's defence against a pilot
// called `<img onerror=...>` and it is one function on purpose.
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const $ = (id) => document.getElementById(id);
const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
const show = (node, ...kids) => { clear(node); node.append(...kids.flat().filter(Boolean)); };

// --------------------------------------------------------------- talk

let token = null;

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  // Every route answers 404 when it refuses, including an expired
  // session — the server deliberately does not distinguish "wrong
  // token" from "no such route". From in here the difference matters,
  // so a 404 while holding a token is read as the session being gone
  // rather than as the route not existing.
  if (res.status === 404 && token) {
    signOut('the session expired');
    throw new Error('signed out');
  }
  let data = null;
  try { data = await res.json(); } catch { /* 204, or a body that is not JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  return data;
}

// ------------------------------------------------------------ messages

function note(where, text, kind) {
  show(where, el('div', { class: 'note' + (kind ? ' ' + kind : '') }, text));
}
const say = (text, kind) => note($('note'), text, kind);
const clearSay = () => clear($('note'));

// How many rows a list is showing. Its own line, above the table,
// rather than the shared status note: putting it there meant every
// refresh after an action overwrote the result of that action, so
// "the run is gone, rom now shows 2 runs, best 700" was replaced by
// "6 runs" before anyone could read it.
const caption = (text) => el('div', { class: 'caption' }, text);

// ------------------------------------------------------------- signing

async function signIn(password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(res.status === 404
    ? 'this server has no operator door, or you are not at its console'
    : 'no');
  const data = await res.json();
  token = data.token;
  expiresAt = data.expires ? new Date(data.expires).getTime() : null;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (expiresAt) sessionStorage.setItem(TOKEN_KEY + '.exp', String(expiresAt));
  } catch { /* private mode */ }
  return data;
}

function signOut(why) {
  token = null;
  expiresAt = null;
  if ($('session')) $('session').textContent = '';
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY + '.exp');
  } catch { /* private mode */ }
  $('app').hidden = true;
  $('login').hidden = false;
  $('pw').value = '';
  if (why) note($('login-note'), why, 'bad');
  else clear($('login-note'));
}

// When the session runs out. Shown rather than left to be discovered
// halfway through typing a new password, which is what a 30-minute
// token with no clock on it feels like.
let expiresAt = null;

function tickSession() {
  const box = $('session');
  // Null-safe because the clock runs on an interval for the life of
  // the page and nothing stops it: a caller that has taken the element
  // away, as the README screenshot tool does to keep the picture the
  // same every time, should not produce a console error a second later.
  if (!box) return;
  if (!expiresAt || !token) { box.textContent = ''; return; }
  const left = Math.round((expiresAt - Date.now()) / 1000);
  if (left <= 0) { signOut('the session expired'); return; }
  const m = Math.floor(left / 60);
  box.textContent = m >= 1 ? `session ${m}m left` : `session ${left}s left`;
}
setInterval(tickSession, 1000);

async function enter() {
  $('login').hidden = true;
  $('app').hidden = false;
  clear($('login-note'));
  tickSession();
  await loadOverview();
}

// ------------------------------------------------------------- shaping

const INT = new Intl.NumberFormat();
const n = (v) => INT.format(v ?? 0);

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleString();
}

function ago(iso) {
  if (!iso) return '—';
  const secs = (Date.now() - new Date(iso)) / 1000;
  if (!Number.isFinite(secs)) return '—';
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60]]) {
    if (secs >= size) return Math.floor(secs / size) + unit + ' ago';
  }
  return Math.max(0, Math.round(secs)) + 's ago';
}

const secs = (v) => (v ? v.toFixed(1) + 's' : '—');

function tile(k, v, small) {
  return el('div', { class: 'tile' },
    el('div', { class: 'k' }, k),
    el('div', { class: 'v' + (small ? ' small' : '') }, v));
}

// Wrapped in its own scroller, so a table too wide for the screen
// scrolls on its own rather than taking the header and the tabs off the
// left edge with it.
function table(headers, rows) {
  if (!rows.length) return el('div', { class: 'empty' }, 'nothing here');
  return el('div', { class: 'scroller' }, el('table', {},
    el('thead', {}, el('tr', {}, headers.map((h) =>
      el('th', { class: h.num ? 'num' : null }, h.label || h)))),
    el('tbody', {}, rows)));
}

// --------------------------------------------------------------- tabs

const TABS = ['overview', 'pilots', 'runs', 'errors'];
const LOADERS = {};

// Showing a tab and loading a tab are two different things.
//
// They were one function, and it cost two bugs. Clicking a row in the
// runs table called it to make sure the tab was up, which reloaded the
// list, which cleared the detail panel — so whether you saw the run you
// clicked depended on which of two fetches finished first. And opening
// a pilot from a run detail did not call it at all, so it filled a
// panel on a tab that was not showing and the button appeared to do
// nothing.
function showTab(which) {
  for (const t of TABS) $('tab-' + t).hidden = t !== which;
  for (const b of document.querySelectorAll('nav button')) {
    b.setAttribute('aria-current', String(b.dataset.tab === which));
  }
}

function openTab(which) {
  showTab(which);
  clearSay();
  if (LOADERS[which]) LOADERS[which]().catch((e) => say(e.message, 'bad'));
}

// ----------------------------------------------------------- overview

async function loadOverview() {
  const [stats, pres] = await Promise.all([
    api('GET', '/api/admin/stats'),
    api('GET', '/api/admin/presence'),
  ]);
  const s = stats.store || {};
  show($('stat-tiles'),
    tile('PILOTS', n(s.players)),
    tile('RUNS', n(s.runs)),
    tile('RUNS TODAY', n(s.runsToday)),
    tile('MODS', n(s.mods)),
    tile('FLYING NOW', n(s.flyingNow)),
    tile('BEST SCORE', n(s.bestScore)),
    tile('HELD BY', s.bestPilot || '—', true));

  show($('presence'), pres.count
    ? table(['PILOT', 'MOD', { label: 'SCORE', num: true }, { label: 'ALONG', num: true }, 'LAST BEAT'],
      pres.flying.map((p) => el('tr', {},
        el('td', {}, p.name),
        el('td', { class: 'id' }, p.modId || 'stock'),
        el('td', { class: 'num' }, n(p.score)),
        el('td', { class: 'num' }, Math.round((p.progress || 0) * 100) + '%'),
        el('td', {}, ago(p.updated)))))
    : el('div', { class: 'empty' }, 'nobody is flying'));

  const h = stats.hardening || {};
  show($('server-info'), el('dl', { class: 'pairs' },
    el('dt', {}, 'admin sessions'), el('dd', {}, n(stats.adminSessions)),
    el('dt', {}, 'hardening'), el('dd', {}, h.mode ? String(h.mode) : 'not reported'),
    el('dt', {}, 'applied'), el('dd', {}, (h.applied || []).join(', ') || '—'),
    el('dt', {}, 'unavailable'), el('dd', {}, (h.skipped || []).join(', ') || '—')));
}
LOADERS.overview = loadOverview;

// ------------------------------------------------------------- pilots

async function loadPilots() {
  const q = $('pilot-q').value.trim();
  const res = await api('GET', '/api/admin/players?limit=200&q=' + encodeURIComponent(q));
  clear($('pilot-detail'));
  show($('pilot-list'),
    caption(`${res.count} pilot${res.count === 1 ? '' : 's'}${q ? ' matching ' + q : ''}`),
    table(
    ['PILOT', { label: 'RUNS', num: true }, { label: 'BEST', num: true }, 'PASSWORD', 'SEEN', 'ID'],
    (res.players || []).map((p) => el('tr', {
      class: 'clickable',
      on: { click: () => openPilot(p.id) },
    },
    el('td', {}, p.name),
    el('td', { class: 'num' }, n(p.runs)),
    el('td', { class: 'num' }, n(p.best)),
    el('td', {}, p.hasPassword ? 'yes' : 'token only'),
    el('td', {}, ago(p.lastSeen)),
    el('td', { class: 'id' }, p.id)))));
}
LOADERS.pilots = loadPilots;

async function openPilot(id) {
  showTab('pilots');
  // Reached from a run detail as well as from the list, and then the
  // list behind it has never been loaded. Filled first so the page is
  // not one card floating on an empty tab.
  if (!$('pilot-list').firstChild) await loadPilots().catch(() => {});
  const d = await api('GET', '/api/admin/players/' + encodeURIComponent(id));
  const p = d.player;
  const st = d.stats || {};
  const hangar = d.hangar || {};
  const scores = d.recentScores || [];

  // What the counters say against what the runs on record add up to.
  // These can legitimately differ — an operator may have edited one —
  // and a difference nobody notices is how a leaderboard and a pilot
  // card end up telling two stories.
  const recordedBest = scores.reduce((m, s) => Math.max(m, s.points), 0);
  const mismatch = scores.length && recordedBest !== p.best;

  show($('pilot-detail'), el('div', { class: 'detail' },
    el('h3', {}, p.name),
    el('div', { class: 'id' }, p.id),
    el('dl', { class: 'pairs' },
      el('dt', {}, 'runs'), el('dd', {}, n(p.runs)),
      el('dt', {}, 'best'), el('dd', { class: mismatch ? 'disagrees' : null },
        n(p.best) + (mismatch ? `  (runs on record top out at ${n(recordedBest)})` : '')),
      el('dt', {}, 'completed'), el('dd', {}, n(st.completedRuns)),
      el('dt', {}, 'total points'), el('dd', {}, n(st.totalPoints)),
      el('dt', {}, 'password'), el('dd', {}, p.hasPassword ? 'set' : 'token only'),
      el('dt', {}, 'created'), el('dd', {}, when(p.created)),
      el('dt', {}, 'last seen'), el('dd', {}, when(p.lastSeen)),
      el('dt', {}, 'hangar'), el('dd', {},
        `${n(hangar.coins)}c, ${n(hangar.bars)} bar(s), `
        + `${Object.keys(hangar.mods || {}).length} system(s)`)),

    el('h2', {}, 'RECENT RUNS'),
    table(['WHEN', { label: 'POINTS', num: true }, { label: 'TIME', num: true },
      { label: 'HULLS', num: true }, { label: 'GUNS', num: true }, 'DONE', 'RUN'],
    scores.map((s) => el('tr', { class: 'clickable', on: { click: () => openRunById(s.id) } },
      el('td', {}, ago(s.created)),
      el('td', { class: 'num' }, n(s.points)),
      el('td', { class: 'num' }, secs(s.timeSec)),
      el('td', { class: 'num' }, n(s.levels)),
      el('td', { class: 'num' }, n(s.turrets)),
      el('td', {}, s.completed ? 'yes' : ''),
      el('td', { class: 'id' }, s.id)))),

    el('h2', {}, 'EDIT'),
    editStats(p),

    el('div', { class: 'actions' },
      el('button', { on: { click: () => setPassword(p) } }, 'CHANGE PASSWORD'),
      el('button', { class: 'danger', on: { click: () => resetPilot(p) } }, 'RESET THIS PILOT'),
      el('button', { class: 'danger', on: { click: () => deletePilot(p) } }, 'DELETE THIS PILOT'))));
  $('pilot-detail').scrollIntoView({ block: 'nearest' });
}

function editStats(p) {
  const runs = el('input', { type: 'number', min: '0', value: p.runs, class: 'w-small',
    'aria-label': 'Runs' });
  const best = el('input', { type: 'number', min: '0', value: p.best, class: 'w-mid',
    'aria-label': 'Best score' });
  return el('div', {},
    el('div', { class: 'row' },
      el('label', {}, 'runs '), runs,
      el('label', {}, 'best '), best,
      el('button', {
        on: {
          click: async () => {
            try {
              const res = await api('POST',
                `/api/admin/players/${encodeURIComponent(p.id)}/stats`,
                { runs: Number(runs.value), best: Number(best.value) });
              const rec = res.onRecord || {};
              say(`${p.name}: counters now ${n(res.player.runs)} runs, best `
                + `${n(res.player.best)}. The runs on record are `
                + `${n(rec.runs)} and ${n(rec.best)}.`,
              res.player.best === rec.best && res.player.runs === rec.runs ? 'good' : null);
              await openPilot(p.id);
            } catch (e) { say(e.message, 'bad'); }
          },
        },
      }, 'SAVE COUNTERS')),
    el('div', { class: 'id footnote' },
      'The counters are a cache. The leaderboard is computed from the runs '
      + 'themselves, so setting a best no run supports makes the card and the '
      + 'board disagree. Remove the run instead if that is what you meant.'));
}

async function setPassword(p) {
  const pw = prompt(`New password for ${p.name}.\n\n`
    + 'Their existing token is revoked, so they are signed out everywhere.');
  if (!pw) return;
  try {
    const res = await api('POST', `/api/admin/players/${encodeURIComponent(p.id)}/password`, { password: pw });
    say(`${p.name}'s password is changed. Their new token, shown once: ${res.token}`, 'good');
  } catch (e) { say(e.message, 'bad'); }
}

async function resetPilot(p) {
  if (!confirm(`Reset ${p.name}?\n\n`
    + `Their ${p.runs} recorded run(s) and everything in their hangar go. `
    + 'The account and its password stay, so they can still sign in.\n\n'
    + 'This cannot be undone.')) return;
  try {
    await api('POST', `/api/admin/players/${encodeURIComponent(p.id)}/reset`);
    say(`${p.name} is reset.`, 'good');
    await loadPilots();
  } catch (e) { say(e.message, 'bad'); }
}

async function deletePilot(p) {
  if (!confirm(`Delete ${p.name}?\n\n`
    + `The account, its password, its hangar and its ${p.runs} recorded `
    + 'run(s) all go, and the name becomes free for somebody else.\n\n'
    + 'This cannot be undone.')) return;
  try {
    await api('DELETE', '/api/admin/players/' + encodeURIComponent(p.id));
    clear($('pilot-detail'));
    say(`${p.name} is gone.`, 'good');
    await loadPilots();
  } catch (e) { say(e.message, 'bad'); }
}

// --------------------------------------------------------------- runs

async function loadRuns() {
  const q = $('run-q').value.trim();
  const res = await api('GET', '/api/admin/runs?limit=100&q=' + encodeURIComponent(q));
  clear($('run-detail'));
  const shown = (res.runs || []).length;
  show($('run-list'),
    caption(`${n(res.total)} run${res.total === 1 ? '' : 's'}${q ? ' matching ' + q : ''}`
      + (res.total > shown ? `, showing the newest ${shown}` : '')),
    table(
    ['WHEN', 'PILOT', { label: 'POINTS', num: true }, { label: 'TIME', num: true },
      { label: 'PTS/S', num: true }, { label: 'HULLS', num: true }, 'DONE', 'RUN'],
    (res.runs || []).map((s) => el('tr', {
      class: 'clickable', on: { click: () => openRunById(s.id) },
    },
    el('td', {}, ago(s.created)),
    el('td', {}, s.name),
    el('td', { class: 'num' }, n(s.points)),
    el('td', { class: 'num' }, secs(s.timeSec)),
    el('td', { class: 'num' }, s.timeSec > 0 ? (s.points / s.timeSec).toFixed(1) : '—'),
    el('td', { class: 'num' }, n(s.levels)),
    el('td', {}, s.completed ? 'yes' : ''),
    el('td', { class: 'id' }, s.id)))));
}
LOADERS.runs = loadRuns;

async function openRunById(id) {
  showTab('runs');
  if (!$('run-list').firstChild) await loadRuns().catch(() => {});
  try {
    const d = await api('GET', '/api/admin/runs/' + encodeURIComponent(id));
    const s = d.run;
    const others = d.otherRuns || [];
    // How far out of line this run is for this pilot. A run three times
    // their usual is the thing worth looking at, and the number is
    // easier to read than the list it came from.
    const rest = others.filter((p) => p !== s.points);
    const typical = rest.length ? rest.reduce((a, b) => a + b, 0) / rest.length : 0;

    show($('run-detail'), el('div', { class: 'detail' },
      el('h3', {}, `${s.name} — ${n(s.points)}`),
      el('div', { class: 'id' }, s.id),
      el('dl', { class: 'pairs' },
        el('dt', {}, 'pilot'), el('dd', {}, `${s.name} (${s.playerId})`),
        el('dt', {}, 'when'), el('dd', {}, when(s.created)),
        el('dt', {}, 'mod'), el('dd', {}, s.modId || 'stock hull'),
        el('dt', {}, 'points'), el('dd', {}, n(s.points)),
        el('dt', {}, 'time'), el('dd', {}, secs(s.timeSec)),
        el('dt', {}, 'points a second'), el('dd', {}, (d.pointsPerSec || 0).toFixed(2)),
        el('dt', {}, 'hulls reached'), el('dd', {}, n(s.levels)),
        el('dt', {}, 'points a hull'), el('dd', {}, (d.pointsPerHull || 0).toFixed(0)),
        el('dt', {}, 'guns broken'), el('dd', {}, n(s.turrets)),
        el('dt', {}, 'deaths'), el('dd', {}, n(s.deaths)),
        el('dt', {}, 'completed'), el('dd', {}, s.completed ? 'yes' : 'no'),
        el('dt', {}, 'their other runs'),
        el('dd', { class: typical && s.points > typical * 3 ? 'disagrees' : null },
          rest.length
            ? `${rest.length} other run(s), averaging ${n(Math.round(typical))}`
              + (s.points > typical * 3 ? ' — this one is well out of line' : '')
            : 'none')),
      el('div', { class: 'actions' },
        el('button', { on: { click: () => openPilot(s.playerId) } }, 'OPEN THE PILOT'),
        el('button', { class: 'danger', on: { click: () => deleteRun(s) } }, 'DELETE THIS RUN'))));
    $('run-detail').scrollIntoView({ block: 'nearest' });
  } catch (e) { say(e.message, 'bad'); }
}

async function deleteRun(s) {
  if (!confirm(`Delete ${s.name}'s run of ${n(s.points)}?\n\n`
    + "It leaves the leaderboard, and the pilot's best is recomputed from "
    + 'what is left of theirs.\n\nThis cannot be undone.')) return;
  try {
    const res = await api('DELETE', '/api/admin/runs/' + encodeURIComponent(s.id));
    say(`The run is gone. ${s.name} now shows ${n(res.runs)} run(s), best ${n(res.best)}.`, 'good');
    clear($('run-detail'));
    await loadRuns();
  } catch (e) { say(e.message, 'bad'); }
}

async function wipeScores() {
  if (!confirm('Wipe EVERY recorded run?\n\n'
    + "The leaderboard empties and every pilot's counters go to zero. "
    + 'Accounts, passwords and hangars stay.\n\nThis cannot be undone.')) return;
  const typed = prompt('Type RESET to confirm.');
  if (typed !== 'RESET') { say('not confirmed, nothing was changed'); return; }
  try {
    const res = await api('POST', '/api/admin/scores/reset', { confirm: 'RESET' });
    say(`${n(res.deleted)} run(s) removed. The board is empty.`, 'good');
    await loadOverview();
  } catch (e) { say(e.message, 'bad'); }
}

// ------------------------------------------------------------- errors

async function loadErrors() {
  const d = await api('GET', '/api/admin/errors?limit=100');
  const sum = d.summary || {};
  show($('error-summary'), el('div', { class: 'tiles' },
    tile('REPORTED', n(sum.reported)),
    tile('DROPPED', n(sum.dropped)),
    tile('HELD', n(sum.held)),
    tile('SINCE', when(sum.since), true)));
  show($('error-list'), table(
    ['WHEN', 'KIND', 'MESSAGE', { label: 'HULL', num: true }, 'BUILD', 'AGENT'],
    (d.recent || []).map((e) => el('tr', {},
      el('td', {}, ago(e.at)),
      el('td', {}, e.kind || '—'),
      el('td', {}, el('div', { class: 'trace' }, e.message + (e.stack ? '\n' + e.stack : ''))),
      el('td', { class: 'num' }, e.hull ? n(e.hull) : '—'),
      el('td', { class: 'id' }, e.build || '—'),
      el('td', { class: 'id' }, e.agent || '—')))));
}
LOADERS.errors = loadErrors;

// ---------------------------------------------------------------- go

$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clear($('login-note'));
  try {
    await signIn($('pw').value);
    $('pw').value = '';
    await enter();
  } catch (e) {
    note($('login-note'), e.message, 'bad');
  }
});

$('signout').addEventListener('click', async () => {
  try { await api('POST', '/api/admin/logout'); } catch { /* going anyway */ }
  signOut();
});

$('wipe').addEventListener('click', wipeScores);
$('pilot-search').addEventListener('submit', (e) => {
  e.preventDefault();
  clearSay();
  loadPilots().catch((err) => say(err.message, 'bad'));
});
$('run-search').addEventListener('submit', (e) => {
  e.preventDefault();
  clearSay();
  loadRuns().catch((err) => say(err.message, 'bad'));
});
for (const b of document.querySelectorAll('nav button')) {
  b.addEventListener('click', () => openTab(b.dataset.tab));
}

// A token from before a refresh. Checked rather than trusted: a stale
// one means the login screen, not a page of empty tables and errors.
(async () => {
  let saved = null;
  try { saved = sessionStorage.getItem(TOKEN_KEY); } catch { /* private mode */ }
  if (!saved) return;
  token = saved;
  try {
    const exp = Number(sessionStorage.getItem(TOKEN_KEY + '.exp'));
    if (exp) expiresAt = exp;
  } catch { /* private mode */ }
  try {
    await api('GET', '/api/admin/stats');
    await enter();
  } catch { /* api() already signed out on a 404 */ }
})();
