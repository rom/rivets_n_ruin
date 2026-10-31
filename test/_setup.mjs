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
function stubContext() {
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'canvas') return { width: 0, height: 0 };
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: noop });
      }
      if (prop === 'createPattern') return () => ({});
      if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'measureText') return () => ({ width: 0 });
      return noop;
    },
    set(target, prop, value) { target[prop] = value; return true; },
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

class StubAudioParam {
  constructor() { this.value = 0; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  cancelScheduledValues() { return this; }
}
class StubNode {
  constructor() {
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
}
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = new StubNode(); }
  resume() {}
  createGain() { return new StubNode(); }
  createOscillator() { return new StubNode(); }
  createBiquadFilter() { return new StubNode(); }
  createDynamicsCompressor() { return new StubNode(); }
  createBufferSource() { return new StubNode(); }
  createAnalyser() { return new StubNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
};

globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => setTimeout(() => fn(performance.now()), 0));
globalThis.addEventListener = globalThis.addEventListener || noop;
globalThis.fetch = globalThis.fetch || (() => Promise.reject(new Error('offline in tests')));
