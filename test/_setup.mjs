// Minimal browser stubs so DOM-free game logic can be tested in node.
//
// Only what the modules under test actually touch. Deliberately not a full
// DOM: if a test needs more than this, it is reaching into rendering and
// belongs in the browser smoke test instead.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

globalThis.window = globalThis.window || globalThis;
globalThis.performance = globalThis.performance || { now: () => Date.now() };

// --- canvas and audio stubs.
//
// These exist so the *logic* modules can be imported and exercised in node.
// They record nothing and assert nothing: anything that actually depends on
// what was drawn or heard belongs in the browser smoke test, not here.

const noop = () => {};

// --- the one thing this stub is strict about: non-finite numbers.
//
// A real canvas handles NaN two different ways and neither is useful. The
// gradient constructors throw ("The provided double value is non-finite"),
// which at least shows up in the console; everything else silently draws
// nothing, which does not. Both are bugs in the caller, and a stub that
// quietly accepts either lets them through to the browser — which is
// exactly what happened to the searchlight beam, where TOWERS.array
// already owned the `sweep` name and `sw.speed` came back undefined.
//
// So: every number handed to a drawing call must be finite, and every
// colour string must not have NaN or undefined interpolated into it.
// This is deliberately stricter than a browser. The alternative is that
// the whole draw layer is untested in node for this entire class of
// fault, which it was.

// Methods whose arguments are geometry, with the index after which
// trailing arguments stop being numbers (fillText takes a string first).
const GEOM = {
  fillRect: 0, strokeRect: 0, clearRect: 0, rect: 0, roundRect: 0,
  moveTo: 0, lineTo: 0, arc: 0, arcTo: 0, ellipse: 0,
  quadraticCurveTo: 0, bezierCurveTo: 0,
  translate: 0, rotate: 0, scale: 0, transform: 0, setTransform: 0,
  createLinearGradient: 0, createRadialGradient: 0, createConicGradient: 0,
  setLineDash: 0,
  fillText: 1, strokeText: 1, drawImage: 1,
};

function checkNums(prop, args, skip) {
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    if (i < skip) continue;
    if (typeof v !== 'number') continue;
    if (Number.isFinite(v)) continue;
    throw new TypeError(
      `ctx.${prop}: argument ${i} is ${v} — a non-finite coordinate draws nothing`);
  }
}

// `rgba(255,240,196,NaN)` is not a colour. A browser throws on it in
// addColorStop and silently ignores it in fillStyle; either way nothing
// the author intended appears.
function checkColour(where, v) {
  if (typeof v !== 'string') return;
  if (/\b(?:NaN|undefined|Infinity)\b/.test(v)) {
    throw new TypeError(`${where}: ${JSON.stringify(v)} is not a colour`);
  }
}

function stubGradient() {
  return {
    addColorStop(offset, colour) {
      checkNums('addColorStop', [offset], 0);
      checkColour('addColorStop', colour);
    },
  };
}

const COLOUR_PROPS = new Set(['fillStyle', 'strokeStyle', 'shadowColor']);
const NUM_PROPS = new Set(['globalAlpha', 'lineWidth', 'lineDashOffset',
  'miterLimit', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY']);

// The state a real 2D context starts in. Without this, `ctx.globalAlpha
// *= x` reads undefined and yields NaN in node while working perfectly
// in a browser, so the strictness above would only ever fire on the
// stub's own missing defaults.
const INITIAL = {
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  lineDashOffset: 0,
  shadowBlur: 0,
  shadowColor: 'rgba(0, 0, 0, 0)',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  filter: 'none',
  imageSmoothingEnabled: true,
};

function stubContext() {
  const state = { ...INITIAL };
  const stack = [];
  const ctx = new Proxy(state, {
    get(target, prop) {
      // save/restore are a real stack, because the drawing code leans on
      // them: a stub where they do nothing lets a leaked alpha or a
      // leaked transform pass in node and fail in a browser.
      if (prop === 'save') return () => { stack.push({ ...target }); };
      if (prop === 'restore') return () => {
        const prev = stack.pop();
        if (prev) Object.assign(target, prev);
      };
      if (prop in target) return target[prop];
      if (prop === 'canvas') return { width: 0, height: 0 };
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient'
          || prop === 'createConicGradient') {
        return (...args) => { checkNums(prop, args, 0); return stubGradient(); };
      }
      if (prop === 'createPattern') return () => ({});
      if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop in GEOM) {
        return (...args) => { checkNums(prop, args, GEOM[prop]); };
      }
      return noop;
    },
    set(target, prop, value) {
      if (COLOUR_PROPS.has(prop)) checkColour(`ctx.${prop}`, value);
      if (NUM_PROPS.has(prop)) checkNums(prop, [value], 0);
      // A browser ignores an alpha outside 0..1 and keeps the old one,
      // which is a silent wrong-brightness bug. Here it is loud.
      if (prop === 'globalAlpha' && (value < 0 || value > 1)) {
        throw new TypeError(`ctx.globalAlpha: ${value} is outside 0..1 and would be ignored`);
      }
      target[prop] = value;
      return true;
    },
  });
  return ctx;
}

globalThis.document = globalThis.document || {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    return { width: 0, height: 0, style: {}, getContext: () => stubContext() };
  },
  getElementById: () => null,
  addEventListener: noop,
};

// The audio stub records what it was asked to make, so a test can tell
// one sound from another. Without this, "does it make a sound" is the
// only question node can answer — and the bug worth catching is the one
// where three different attackers all made the SAME sound.
class StubAudioParam {
  constructor() { this.value = 0; this.log = []; }
  setValueAtTime(v, t) { this.value = v; this.log.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.value = v; this.log.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.value = v; this.log.push(['exp', v, t]); return this; }
  setTargetAtTime(v, t) { this.value = v; this.log.push(['target', v, t]); return this; }
  cancelScheduledValues() { this.log.push(['cancel']); return this; }
  // The first value this parameter was given, which for a filter or an
  // oscillator is the one that characterises the sound.
  first() { return this.log.length ? this.log[0][1] : this.value; }
}
class StubNode {
  constructor(kind = 'node') {
    this.kind = kind;
    this.gain = new StubAudioParam();
    this.frequency = new StubAudioParam();
    this.detune = new StubAudioParam();
    this.Q = new StubAudioParam();
    this.playbackRate = new StubAudioParam();
    this.threshold = new StubAudioParam();
    this.knee = new StubAudioParam();
    this.ratio = new StubAudioParam();
    this.attack = new StubAudioParam();
    this.release = new StubAudioParam();
  }
  connect(n) { return n; }
  disconnect() {}
  start() {}
  stop() {}
  getFloatTimeDomainData() {}
  // The sequencer builds its lead voice from a custom waveform.
  setPeriodicWave() {}
}
globalThis.AudioContext = class {
  constructor() {
    this.currentTime = 0; this.sampleRate = 44100; this.state = 'running';
    this.destination = new StubNode('destination');
    // Every node this context has handed out, in order, for tests that
    // need to know what a sound is made of rather than only that one
    // happened. Tests clear it themselves.
    this.made = [];
  }
  make(kind) { const n = new StubNode(kind); this.made.push(n); return n; }
  resume() {}
  createGain() { return this.make('gain'); }
  createOscillator() { return this.make('osc'); }
  createBiquadFilter() { return this.make('filter'); }
  createDynamicsCompressor() { return this.make('comp'); }
  createBufferSource() { return this.make('noise'); }
  createAnalyser() { return this.make('analyser'); }
  createPeriodicWave() { return {}; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
};

globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => setTimeout(() => fn(performance.now()), 0));
globalThis.addEventListener = globalThis.addEventListener || noop;
globalThis.fetch = globalThis.fetch || (() => Promise.reject(new Error('offline in tests')));
