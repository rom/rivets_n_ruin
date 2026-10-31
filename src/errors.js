// Client-side error reporting.
//
// The frame loop catches everything, drops the bad frame and carries on.
// That is the right behaviour — a glitchy frame is recoverable and a dead
// loop is not — but it means a renderer throwing sixty times a second
// presents as a frozen picture with a healthy score, a moving camera and a
// plausible frame rate. The only thing that would tell you is an exception
// in a console nobody has open.
//
// So they get sent. Rules, in order of how much they matter:
//
//   1. Reporting must never affect the game. Every call here is
//      best-effort: it swallows its own failures, never awaits, and never
//      throws back into the caller. A reporter that can break the thing it
//      is reporting on is worse than no reporter.
//   2. One fault must not become a thousand reports. A throw inside the
//      draw path repeats every frame, so identical errors are counted
//      rather than resent, and the session has a hard cap.
//   3. Nothing sensitive leaves. The auth token in particular never goes
//      anywhere near a report — see redact() below.

const ENDPOINT = '/api/errors';
const FLUSH_MS = 4000;       // batch window; nothing is urgent here
const MAX_PER_SESSION = 40;  // hard cap on distinct faults reported
const MAX_MESSAGE = 400;
const MAX_STACK = 1200;
const TIMEOUT_MS = 4000;

const S = {
  installed: false,
  seen: new Map(),     // fingerprint -> { count, first, last, report }
  queue: [],
  sent: 0,
  dropped: 0,
  timer: null,
  context: () => ({}),
  enabled: true,
};

export const errorState = () => S;

// Anything that looks like a credential is stripped before a report
// leaves. The token is the one thing here that is worth stealing, and a
// stack frame or a thrown object can easily carry one: `fetch` failures
// quote the request, and a hand-written throw can quote anything.
export function redact(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(token|secret|password|passwd|pass|authorization|auth|sig)\b(["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
      (_, key, sep) => `${key}${sep}[redacted]`)
    .replace(/([?&](?:token|secret|password|sig)=)[^&\s]+/gi, '$1[redacted]');
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Errors are grouped by where they come from, not by their text: a message
// that interpolates a changing number ("foe 41 is at NaN") would otherwise
// be a new fault every frame and blow the cap in a second.
function fingerprint(report) {
  const site = (report.stack || '').split('\n').slice(0, 2).join('|');
  const shape = (report.message || '').replace(/\d+(\.\d+)?/g, '#');
  return `${report.kind}:${shape}:${site}`;
}

function describe(err) {
  if (err instanceof Error) {
    return {
      message: clip(redact(`${err.name}: ${err.message}`), MAX_MESSAGE),
      stack: clip(redact(err.stack || ''), MAX_STACK),
    };
  }
  // Anything can be thrown, including undefined. Say so rather than
  // reporting "undefined" and leaving someone to guess what that means.
  let text;
  try {
    text = typeof err === 'string' ? err : JSON.stringify(err);
  } catch {
    text = Object.prototype.toString.call(err);
  }
  return {
    message: clip(redact(`thrown non-Error: ${text === undefined ? 'undefined' : text}`), MAX_MESSAGE),
    stack: '',
  };
}

// The public entry point. Safe to call from anywhere, including from
// inside a catch in the frame loop, and safe to call sixty times a second.
export function report(kind, err, extra = {}) {
  if (!S.enabled) return null;
  let entry = null;
  try {
    const { message, stack } = describe(err);
    const base = { kind: String(kind).slice(0, 32), message, stack };
    const key = fingerprint(base);

    const already = S.seen.get(key);
    if (already) {
      // Seen it. Count it and say no more: this is the case that matters,
      // because a draw path that throws does so every single frame.
      already.count++;
      already.last = Date.now();
      return already;
    }
    if (S.seen.size >= MAX_PER_SESSION) {
      S.dropped++;
      return null;
    }

    let context = {};
    try { context = S.context() || {}; } catch { /* a broken context must not stop the report */ }
    entry = {
      ...base,
      ...context,
      ...extra,
      count: 1,
      first: Date.now(),
      last: Date.now(),
      at: new Date().toISOString(),
    };
    S.seen.set(key, entry);
    S.queue.push(entry);
    schedule();
  } catch {
    // Reporting an error must not itself throw. If it does, that is the
    // end of it: there is nowhere left to report to.
  }
  return entry;
}

function schedule() {
  if (S.timer !== null || typeof setTimeout !== 'function') return;
  S.timer = setTimeout(() => { S.timer = null; flush(); }, FLUSH_MS);
  // Node keeps the process alive for a pending timer; the tests would hang.
  if (S.timer && typeof S.timer.unref === 'function') S.timer.unref();
}

// Sends what is queued. Returns a promise for the tests; nothing in the
// game awaits it.
export async function flush() {
  if (!S.queue.length) return false;
  const batch = S.queue.splice(0, S.queue.length);
  const body = {
    errors: batch.map((e) => ({
      kind: e.kind, message: e.message, stack: e.stack,
      count: e.count, at: e.at,
      state: e.state, hull: e.hull, build: e.build, agent: e.agent,
    })),
    dropped: S.dropped,
  };
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined,
        keepalive: true,      // so a report started on unload still goes
      });
      S.sent += batch.length;
      return true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    // The backend being down is the normal case for a game that must stay
    // playable offline. Drop them rather than retrying forever.
    return false;
  }
}

// Installs the global handlers. `context` is called at report time for
// whatever the game can say about where it was — deliberately a callback
// rather than a value, so a report carries the state at the moment of the
// fault and not at the moment the reporter was set up.
export function installErrorReporting({ context = () => ({}) } = {}) {
  if (S.installed) return false;
  S.installed = true;
  S.context = context;

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('error', (e) => {
      report('window', e.error || e.message || 'unknown error', {
        source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
      });
    });
    window.addEventListener('unhandledrejection', (e) => {
      report('promise', e.reason || 'unhandled rejection');
    });
    // Last chance to get what is queued out of the page.
    for (const ev of ['pagehide', 'beforeunload']) {
      window.addEventListener(ev, () => { flush(); });
    }
  }
  return true;
}

// For the tests, and for a player who would rather send nothing.
export function resetErrorReporting(enabled = true) {
  S.seen.clear();
  S.queue.length = 0;
  S.sent = 0;
  S.dropped = 0;
  S.enabled = enabled;
  if (S.timer !== null && typeof clearTimeout === 'function') clearTimeout(S.timer);
  S.timer = null;
  return S;
}
