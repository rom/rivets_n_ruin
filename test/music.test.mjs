import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TUNES, tuneCount, tuneName, setTune, tuneIndex, stopMusic, form, deg, hookIndex,
} from '../src/music.js';
import { LEVELS } from '../src/config.js';

const FIELDS = ['name', 'blurb', 'bpm', 'root', 'scale', 'prog', 'progB',
  'bass', 'kick', 'snare', 'chord', 'hook', 'hookB', 'padCut'];

test('every tune is complete and the right shape', () => {
  assert.ok(TUNES.length >= 8, `only ${TUNES.length} tunes`);
  for (const T of TUNES) {
    for (const f of FIELDS) assert.ok(T[f] !== undefined, `${T.name} is missing ${f}`);
    assert.equal(T.prog.length, 4, `${T.name}: the A section is not four bars`);
    assert.equal(T.progB.length, 4, `${T.name}: the B section is not four bars`);
    for (const m of ['bass', 'kick', 'snare']) {
      assert.equal(T[m].length, 16, `${T.name}.${m} is not one bar of sixteenths`);
      for (const v of T[m]) assert.ok(v === 0 || v === 1, `${T.name}.${m} holds ${v}`);
    }
    for (const h of ['hook', 'hookB']) {
      assert.equal(T[h].length, 32, `${T.name}.${h} is not four bars of eighths`);
    }
    assert.ok(T.bpm >= 60 && T.bpm <= 220, `${T.name}: ${T.bpm} bpm`);
    assert.ok(T.root > 30 && T.root < 200, `${T.name}: root ${T.root}Hz is not a bass note`);
    assert.equal(T.scale.length, 7, `${T.name}: a mode has seven degrees`);
  }
});

test('tune names and blurbs are unique', () => {
  const names = TUNES.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'two tunes share a name: ' + names.join(', '));
});

// The reason the hooks exist. A melody of nothing but rests is silence with
// extra steps; a melody with no rests is a drill.
test('every hook is a melody: it has notes, and it breathes', () => {
  for (const T of TUNES) {
    for (const h of ['hook', 'hookB']) {
      const line = T[h];
      const notes = line.filter((d) => d !== null).length;
      assert.ok(notes >= 6, `${T.name}.${h} plays only ${notes} notes in four bars`);
      assert.ok(notes <= 26, `${T.name}.${h} plays ${notes} of 32 — no room to breathe`);
      for (const d of line) {
        if (d === null) continue;
        assert.ok(Number.isInteger(d) && d >= 0 && d <= 13,
          `${T.name}.${h} holds degree ${d}, which is outside the two octaves written for`);
      }
    }
    assert.notDeepEqual(T.hook, T.hookB, `${T.name}: the B section repeats the A hook`);
  }
});

test('the B section actually goes somewhere', () => {
  for (const T of TUNES) {
    assert.notDeepEqual(T.prog, T.progB,
      `${T.name}: the middle eight sits on the same chords as the verse`);
  }
});

// Every note the scheduler can produce, checked for being a note. A degree
// that resolved to NaN, or a root an octave out, is silence or a siren.
test('every note of every tune lands in the audible range', () => {
  for (const T of TUNES) {
    const progs = [...T.prog, ...T.progB];
    for (const chord of progs) {
      for (const h of [T.hook, T.hookB]) {
        for (const d of h) {
          if (d === null) continue;
          const oct = Math.floor(d / 7);
          const semi = chord + T.scale[d % 7] + 12 * oct + 24;
          const f = T.root * Math.pow(2, semi / 12);
          assert.ok(Number.isFinite(f) && f > 60 && f < 6000,
            `${T.name}: a hook note lands at ${f.toFixed(1)}Hz`);
        }
      }
      // the bass, an octave below the chord root
      const bf = T.root * Math.pow(2, chord / 12);
      assert.ok(bf > 25 && bf < 220, `${T.name}: bass at ${bf.toFixed(1)}Hz`);
    }
  }
});

test('every hull names a tune that exists', () => {
  for (const l of LEVELS) {
    assert.ok(Number.isInteger(l.tune) && l.tune >= 0 && l.tune < TUNES.length,
      `${l.name} asks for tune ${l.tune}, of ${TUNES.length}`);
  }
});

test('the campaign does not play the same tune twice running', () => {
  for (let i = 1; i < LEVELS.length; i++) {
    assert.notEqual(LEVELS[i].tune, LEVELS[i - 1].tune,
      `${LEVELS[i].name} plays the same tune as ${LEVELS[i - 1].name}`);
  }
});

test('setTune wraps in both directions and reports at once', () => {
  stopMusic();
  setTune(0);
  assert.equal(tuneIndex(), 0);
  setTune(TUNES.length);
  assert.equal(tuneIndex(), 0, 'past the end did not wrap');
  setTune(-1);
  assert.equal(tuneIndex(), TUNES.length - 1, 'below zero did not wrap');
  assert.equal(tuneName(), TUNES[TUNES.length - 1].name);
  assert.equal(tuneCount(), TUNES.length);
  setTune(0);
});

// The form is what makes a tune a tune rather than a loop. Sixteen bars,
// four of groove, the hook twice, a middle eight on its own chords.
test('the form states the groove, plays the hook twice and goes somewhere', () => {
  const secs = [];
  const leads = [];
  for (let bar = 0; bar < 16; bar++) {
    const f = form(bar);
    assert.ok(f.sec === 'A' || f.sec === 'B', `bar ${bar} is in section ${f.sec}`);
    secs.push(f.sec);
    leads.push(f.lead);
  }
  assert.equal(secs.filter((x) => x === 'B').length, 4, 'the middle eight is not four bars');
  assert.ok(!leads.slice(0, 4).some(Boolean), 'the hook starts before the groove is stated');
  assert.ok(leads.slice(4).every(Boolean), 'the hook drops out after the intro');
  assert.equal(secs[15], 'A', 'the form does not return before it loops');
});

// Every slot of a four-bar hook must be reachable exactly once per phrase,
// and none of them may index past the end. A melody read one slot short
// silently drops its last note; one slot long reads undefined and is
// silent for a beat, and neither is visible from in front of the screen.
test('the hook index walks each phrase exactly once, in order', () => {
  for (const T of TUNES) {
    const seen = new Array(32).fill(0);
    for (let bar = 0; bar < 4; bar++) {
      for (let pos = 0; pos < 16; pos += 2) {
        const i = hookIndex(bar, pos);
        assert.ok(i >= 0 && i < T.hook.length, `index ${i} is outside ${T.name}.hook`);
        seen[i]++;
      }
    }
    assert.deepEqual(seen, new Array(32).fill(1),
      `${T.name}: the hook index does not cover the phrase exactly once`);
  }
  // and it is monotonic, so the melody plays forwards
  let last = -1;
  for (let bar = 0; bar < 4; bar++) {
    for (let pos = 0; pos < 16; pos += 2) {
      const i = hookIndex(bar, pos);
      assert.equal(i, last + 1, 'the hook is not read in order');
      last = i;
    }
  }
});

test('deg() keeps a melody in key, and climbs octaves past the seventh', () => {
  for (const T of TUNES) {
    for (let d = 0; d <= 13; d++) {
      const semi = deg(T, d);
      assert.ok(Number.isFinite(semi), `${T.name}: degree ${d} is not a note`);
      // the pitch class has to be one the mode actually contains
      assert.ok(T.scale.includes(((semi % 12) + 12) % 12),
        `${T.name}: degree ${d} resolves to ${semi}, which is outside the mode`);
    }
    assert.equal(deg(T, 7), deg(T, 0) + 12, `${T.name}: the eighth degree is not the octave`);
  }
});

