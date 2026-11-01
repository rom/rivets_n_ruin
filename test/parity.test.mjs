import './_setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEVELS, BOSSES, SHIP, LEVEL_UP, PICKUP, HULL_BONUS, DIFFICULTY,
} from '../src/config.js';
import { MODS } from '../src/shop.js';
import { BODY_KINDS } from '../src/foeart.js';
import { KINDS as MINI_KINDS } from '../src/miniboss.js';
import { MARKS } from '../src/shipart.js';
import { MAP as KEYS } from '../src/input.js';
import { readdirSync } from 'node:fs';

// The Go score validator mirrors a handful of client constants in order to
// decide what is physically possible. When they drift, the server starts
// rejecting honest runs with a 422 — which has happened twice, each time
// only discovered by playing. This reads the Go source and compares.

const go = readFileSync(new URL('../internal/validate/score.go', import.meta.url), 'utf8');

// Handles plain numbers and simple products like `0.64 * 0.75`, which is
// how the spawn-interval constant is written so its derivation stays visible.
const goConst = (name) => {
  const m = go.match(new RegExp(`\\b${name}\\s*=\\s*([0-9.]+(?:\\s*\\*\\s*[0-9.]+)*)`));
  assert.ok(m, `could not find ${name} in score.go`);
  return m[1].split('*').map((p) => Number(p.trim())).reduce((a, b) => a * b, 1);
};

const goSlice = (name) => {
  const m = go.match(new RegExp(`var ${name} = \\[\\]\\w+\\{([^}]*)\\}`, 's'));
  assert.ok(m, `could not find ${name} in score.go`);
  return m[1].split(',').map((s) => s.replace(/\/\/.*/g, '').trim()).filter(Boolean);
};

test('top speed matches', () => {
  assert.equal(goConst('BaseMaxVX'), SHIP.maxVX,
    'validate.BaseMaxVX and SHIP.maxVX have drifted');
});

test('per-hull speed gain matches', () => {
  assert.equal(goConst('MaxVXPerLevel'), LEVEL_UP.maxVXAdd,
    'validate.MaxVXPerLevel and LEVEL_UP.maxVXAdd have drifted');
});

test('hull lengths match, in order', () => {
  const lens = goSlice('HullLengths').map(Number);
  assert.deepEqual(lens, LEVELS.map((l) => l.length),
    'validate.HullLengths does not match LEVELS[].length');
});

test('there is a boss reward for every boss', () => {
  assert.equal(goSlice('BossRewards').length, BOSSES.length,
    'validate.BossRewards and BOSSES differ in length');
});

test('boss pickup drop counts are declared for every boss', () => {
  assert.equal(goSlice('BossPickupDrops').length, BOSSES.length,
    'validate.BossPickupDrops and BOSSES differ in length');
});

test('the validator allows for the densest interceptor spawn', () => {
  const fastest = Math.min(...LEVELS.map((l) => l.interceptorSpawn));
  const goInterval = goConst('FastestSpawnInterval');
  // the Go value is spawnEvery * 0.75, the low end of the random multiplier
  assert.ok(goInterval <= fastest * 0.75 + 1e-9,
    `validator assumes interceptors no denser than ${goInterval}s, but a hull spawns at ${(fastest * 0.75).toFixed(3)}s`);
});

// --- the economy.
//
// The ceiling on a submission is built from these, and when the client's
// economy grew past the server's copy of it the server started throwing
// away real runs: a 4.65-million hull was refused against a ceiling of
// 1.74 million, and the end screen showed SENDING RUN... while it happened.
// Each of these is one half of a pair that must not drift again.

test('coin, bar, coffin and treasure values match', () => {
  const top = Math.max(...Object.values(PICKUP.treasure).map((t) => t.value));
  const pairs = [
    ['CoinValue', PICKUP.coinValue],
    ['BarValue', PICKUP.barValue],
    ['CoffinValue', PICKUP.coffinValue],
    ['BestTreasure', top],
    ['MaxCoinsPerKill', PICKUP.coinsPerKill[1]],
    ['MaxLives', PICKUP.maxLives],
    ['TreasureRolls', PICKUP.treasureFromBoss],
    ['BossBarsMax', PICKUP.bossBars[1]],
    ['BossCoffinsMax', PICKUP.bossCoffins[1]],
  ];
  for (const [name, want] of pairs) {
    assert.equal(goConst(name), want, `validate.${name} has drifted from src/config.js`);
  }
});

test('drop rates match, at their most generous', () => {
  assert.equal(goConst('CrateChance'), PICKUP.dropFromTurret,
    'validate.CrateChance has drifted from PICKUP.dropFromTurret');
  assert.equal(goConst('BarChance'), PICKUP.barChance,
    'validate.BarChance has drifted from PICKUP.barChance');
  assert.equal(goConst('CoffinChance'), PICKUP.coffinChance,
    'validate.CoffinChance has drifted from PICKUP.coffinChance');
});

// Treasure odds climb per hull and are never capped, so the server's
// figure has to be the last hull's. It was the eight-hull value for the
// whole of the twenty-five-hull campaign, which is why it is now derived
// from the hull count on both sides rather than written down on either.
test('the treasure rate is the last hull\'s, not an older campaign\'s', () => {
  assert.equal(goConst('TreasureBase'), PICKUP.treasureChance,
    'validate.TreasureBase has drifted from PICKUP.treasureChance');
  assert.equal(goConst('TreasurePerHull'), PICKUP.treasureHullBonus,
    'validate.TreasurePerHull has drifted from PICKUP.treasureHullBonus');
  const lastHull = PICKUP.treasureChance + PICKUP.treasureHullBonus * (LEVELS.length - 1);
  assert.ok(/TreasurePerHull\*float64\(len\(HullLengths\)-1\)/.test(go.replace(/\s+/g, '')),
    'the Go treasure rate is no longer derived from the hull count');
  assert.ok(lastHull > PICKUP.treasureChance,
    'treasure odds no longer climb with the hull; the derivation is pointless');
});

test('end-of-hull bonuses match', () => {
  const pairs = [
    ['BonusTowers', HULL_BONUS.towers],
    ['BonusSweep', HULL_BONUS.fullSweep],
    ['BonusPerLife', HULL_BONUS.perLife],
    ['BonusNoLoss', HULL_BONUS.noLoss],
    ['HaulShare', HULL_BONUS.haulPct],
  ];
  for (const [name, want] of pairs) {
    assert.equal(goConst(name), want, `validate.${name} has drifted from HULL_BONUS`);
  }
});

// The two multipliers a pilot can legitimately stack on top of everything
// else. Either one being low is a ceiling that refuses honest runs.
test('the loot and score multipliers match the best a pilot can buy', () => {
  const scavenger = Math.max(...MODS.scavenger.tiers.map((t) => t.mul || 1));
  assert.equal(goConst('MaxCoinMul'), scavenger,
    'validate.MaxCoinMul is not the top SCAVENGER RIG tier');
  const hardest = Math.max(...DIFFICULTY.map((d) => d.scoreMul));
  assert.equal(goConst('MaxScoreMul'), hardest,
    'validate.MaxScoreMul is not the hardest difficulty\'s scoreMul');
});

test('the afterburner speed bonus matches', () => {
  const src = readFileSync(new URL('../src/shop.js', import.meta.url), 'utf8');
  const m = src.match(/maxVXBonus \+= (\d+)/);
  assert.ok(m, 'could not find the afterburner speed bonus in src/shop.js');
  assert.equal(goConst('AfterburnerBonus'), Number(m[1]),
    'validate.AfterburnerBonus has drifted from the AFTERBURNER mod');
});

test('the validator allows for the most heavily defended hull', () => {
  const maxTurretsSeen = goConst('MaxTurretsPerHull');
  assert.ok(maxTurretsSeen >= 40, 'turret allowance looks too low for eight hulls');
});

// --- the README is the third copy of these facts, and it drifted furthest.
//
// Its hull table went on claiming three hulls long after there were eight,
// and its gap list described systems that had since been built. Nobody
// notices a stale README from inside the code, so the table is checked.

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('the README hull table lists every hull, with its real length', () => {
  const rows = [...readme.matchAll(/\|\s*\*\*([A-Z]+)\*\*[^|]*\|\s*([\d,]+)px\s*\|/g)]
    .map((m) => ({ name: m[1], length: Number(m[2].replace(/,/g, '')) }));
  assert.equal(rows.length, LEVELS.length,
    `README lists ${rows.length} hulls, the game has ${LEVELS.length}`);
  rows.forEach((row, i) => {
    assert.equal(row.name, LEVELS[i].name, `README hull ${i + 1} is out of order`);
    assert.equal(row.length, LEVELS[i].length,
      `README says ${LEVELS[i].name} is ${row.length}px, config says ${LEVELS[i].length}px`);
  });
});

test('the README names every boss', () => {
  for (const b of BOSSES) {
    assert.ok(readme.includes(b.name), `the README never mentions ${b.name}`);
  }
});


// --- the rest of the README, which drifts hardest of all
//
// The hull table below was already checked, and that was the only table
// that was. Everything else went stale quietly: the attacker table said
// four types when there were eight, the layout block was missing ten
// modules and named the wrong counts for three more, the refit table
// described a per-hull gun grant that no longer exists, the controls
// table had never heard of two keys, and seven rows of the hull table
// carried raw float artefacts like `every 0.42400000000000004s`.
//
// Prose cannot be checked. Tables can.

const firstHullFielding = (key) => {
  const out = {};
  for (const L of LEVELS) for (const v of L[key] || []) if (!(v in out)) out[v] = L.name;
  return out;
};

test('the README tower table lists every tower, from the right hull', () => {
  const rows = [...readme.matchAll(/\|\s*\*\*([A-Z]+)\*\*\s*\|\s*([A-Z]+)\s*\|[^|]*\|/g)]
    .map((m) => ({ name: m[1].toLowerCase(), from: m[2] }));
  const real = firstHullFielding('towers');
  for (const [kind, from] of Object.entries(real)) {
    const row = rows.find((r) => r.name === kind);
    assert.ok(row, `the README never lists the ${kind.toUpperCase()} tower`);
    assert.equal(row.from, from,
      `README says ${kind.toUpperCase()} arrives on ${row.from}, config says ${from}`);
  }
});

test('the README attacker table lists every attacker, from the right hull', () => {
  const real = firstHullFielding('foes');
  for (const [kind, from] of Object.entries(real)) {
    const re = new RegExp(`\\|\\s*\\*\\*${kind}\\*\\*\\s*\\|\\s*([A-Z]+)\\s*\\|`, 'i');
    const m = readme.match(re);
    assert.ok(m, `the README never lists the ${kind} attacker`);
    assert.equal(m[1], from,
      `README says the ${kind} arrives on ${m[1]}, config says ${from}`);
  }
  // ...and claims the right number of them.
  const count = Object.keys(real).length;
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten', 'eleven', 'twelve'];
  assert.ok(new RegExp(`${words[count]} more types`, 'i').test(readme),
    `the README does not say "${words[count]} more types" for ${count} attackers`);
});

test('the README refit table matches the grant schedule', () => {
  const pairs = [
    [/\+1 free level of \*\*gunspeed\*\* \| every (\w+) hull/, LEVEL_UP.gunSpeedEvery, 'gunspeed'],
    [/\+1 free level of \*\*gunblaze\*\* \| every (\w+) hull/, LEVEL_UP.gunBlazeEvery, 'gunblaze'],
    [/\+1 to the \*\*cap\*\* on both \| every (\w+) hull/, LEVEL_UP.gunCapEvery, 'the cap'],
  ];
  const ordinal = (n) => `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
  for (const [re, want, what] of pairs) {
    const m = readme.match(re);
    assert.ok(m, `the README does not say how often ${what} is granted`);
    assert.equal(m[1], ordinal(want),
      `README grants ${what} every ${m[1]} hull, config says every ${ordinal(want)}`);
  }
  for (const [label, value] of [
    ['Shield maximum', LEVEL_UP.shieldMax], ['Muzzle velocity', LEVEL_UP.bulletSpeedAdd],
  ]) {
    assert.ok(readme.includes(`${label} +${value}`),
      `the README does not say "${label} +${value}"`);
  }
  assert.ok(readme.includes(`ceiling of ${SHIP.shieldCap}`),
    `the README does not state the shield ceiling of ${SHIP.shieldCap}`);
});

test('the README crate table matches the drop weights', () => {
  for (const [kind, weight] of Object.entries(PICKUP.dropWeights)) {
    const re = new RegExp(`\\|\\s*\\*?\\*?${kind}s?\\*?\\*?[^|]*\\|\\s*${weight}\\s*\\|`, 'i');
    assert.ok(re.test(readme),
      `the README does not give ${kind} a weight of ${weight}`);
  }
  assert.ok(readme.includes(`× ${PICKUP.gunDropFalloff} per level already held`),
    `the README does not state the ${PICKUP.gunDropFalloff} falloff`);
});

test('the README controls table lists every key the game binds', () => {
  // Keys that are deliberately undocumented would be a decision; there
  // are none, so every binding must appear.
  const label = (code) => code
    .replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow(\w+)/, '$1')
    .replace('Slash', '/').replace('BracketRight', ']').replace('Escape', 'Esc')
    .replace('ShiftLeft', 'Shift').replace('NumpadEnter', 'Enter');
  const missing = [];
  for (const code of Object.keys(KEYS)) {
    const k = label(code);
    if (/^[0-9]$/.test(k) && /`1`–`3`/.test(readme)) continue;   // given as a range
    if (['Left', 'Right', 'Up', 'Down'].includes(k)) continue;   // given as arrows
    if (!new RegExp(`\`${k.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}\``).test(readme)) {
      missing.push(`${code} (${k})`);
    }
  }
  assert.deepEqual(missing, [], `keys bound but not in the controls table: ${missing.join(', ')}`);
});

test('the README endpoint table lists every route', () => {
  const go = readFileSync(new URL('../internal/api/api.go', import.meta.url), 'utf8');
  const routes = [...go.matchAll(/mux\.HandleFunc\("([A-Z]+) ([^"]+)"/g)]
    .map((m) => ({ method: m[1], path: m[2] }));
  assert.ok(routes.length > 10, `only found ${routes.length} routes in api.go`);
  for (const r of routes) {
    const re = new RegExp(`\\|\\s*\`${r.method}\`\\s*\\|\\s*\`${
      r.path.replace(/[{}]/g, '\\$&')}\`\\s*\\|`);
    assert.ok(re.test(readme), `the README does not document ${r.method} ${r.path}`);
  }
});

test('the README layout block names every client module', () => {
  const listed = readme.slice(readme.indexOf('## Layout'));
  const missing = readdirSync(new URL('../src', import.meta.url))
    .filter((f) => f.endsWith('.js') && !listed.includes(`src/${f}`));
  assert.deepEqual(missing, [],
    `modules missing from the layout block: ${missing.join(', ')}`);
});

test('the README counts the art it claims to count', () => {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten'];
  assert.ok(readme.includes(`the ${words[BODY_KINDS.length]} attacker bodies`),
    `the layout block miscounts the ${BODY_KINDS.length} attacker bodies`);
  const minis = Object.keys(MINI_KINDS).length;
  assert.ok(readme.includes(`the ${words[minis]} mid-hull minibosses`),
    `the layout block miscounts the ${minis} minibosses`);
  const shapes = new Set(BOSSES.map((b) => b.kind)).size;
  assert.ok(readme.includes(`the ${words[shapes]} boss shapes`),
    `the layout block miscounts the ${shapes} boss shapes`);
  assert.ok(readme.includes(`${MARKS.length} ship marks`)
    || readme.includes('twenty-five ship marks'),
    `the README miscounts the ${MARKS.length} ship marks`);
});

// A generated table that dumps raw floats reads as a bug in the game
// rather than a bug in the generator, which is worse than it sounds.
test('no number in the README is a float artefact', () => {
  // No trailing \b: these numbers are followed by a unit ("0.424...s"),
  // and a word boundary cannot occur between a digit and a letter — which
  // is why the first version of this test passed over every one of them.
  const bad = [...readme.matchAll(/\b\d+\.\d{6,}/g)].map((m) => m[0]);
  assert.deepEqual(bad, [], `unrounded floats in the README: ${bad.join(', ')}`);
});

// The return leg was removed from the game a long time ago. The README
// described it for most of that time, and so did two source comments.
//
// Scanned by paragraph rather than by line, because prose is written in
// paragraphs: "It used to send you back down the same hull the other way"
// and the three lines explaining why are one thought, and a line-by-line
// scan flags the explanation while letting the claim through.
test('nothing still describes the return leg as current', () => {
  // `(\w+ ){0,2}` because the first version missed the single most
  // prominent instance in the whole document — the opening paragraph's
  // "then you have to fly it back" — on the word "it".
  const live = /\b(fly|flies|flying|flown)(?: (?!back\b)\w+){0,2} back\b(?! to back)|\breturn run\b|\breturn leg\b|\bback down the (same )?hull\b|\bthe way back\b(?! in\b)|\bthe way home\b|\bopens the (turnaround|return)\b/i;
  const past = /used to|no longer|any ?more|was a commute|outlived|removed|it once|once modelled/i;

  const check = (what, text, sep) => {
    for (const [i, para] of text.split(sep).entries()) {
      if (!live.test(para) || past.test(para)) continue;
      assert.fail(`${what}: paragraph ${i + 1} describes the return leg as current:\n${para.trim()}`);
    }
  };
  check('README.md', readme, /\n\s*\n/);
  for (const f of readdirSync(new URL('../src', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    // Source splits on a blank line too; a comment block and the code it
    // introduces are one paragraph, which is the unit that gets stale.
    check(`src/${f}`, readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), /\n\s*\n/);
  }
});

// Every image the README points at must exist, and every image generated
// for it should be pointed at. A broken image reads as a broken project,
// and an orphan is a file nobody will ever delete because nobody knows it
// is unused.
test('every README image resolves, and none is orphaned', () => {
  const referenced = [...readme.matchAll(/!\[[^\]]*\]\((docs\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(referenced.length > 20, `only ${referenced.length} images referenced`);

  const onDisk = new Set(readdirSync(new URL('../docs', import.meta.url)));
  const missing = [...new Set(referenced)].filter((p) => !onDisk.has(p.replace('docs/', '')));
  assert.deepEqual(missing, [], `README points at images that do not exist: ${missing.join(', ')}`);

  // Icons are referenced from index.html, not here.
  const used = new Set(referenced.map((p) => p.replace('docs/', '')));
  const orphans = [...onDisk].filter((f) => f.endsWith('.png')
    && !used.has(f) && !/icon|apple-touch/.test(f));
  assert.deepEqual(orphans, [], `images nobody references: ${orphans.join(', ')}`);
});
