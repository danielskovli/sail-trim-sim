import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apparentWind, polarSpeed, recommendedStage, recommend, optimalTrim, evaluate, applyRecommended,
  randomScenario, defaultState, normaliseState, mainSpec, headSpec, SAIL_PLANS, HEADSAILS, sailCoefficients,
  norm180, NO_GO_ANGLE, AERO, planName,
} from '../src/model.js';
import { STRINGS, setLanguage, t, tIn, detectLanguage, nf } from '../src/i18n.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${a} ≈ ${b} (±${tol})`);
const withHead = (state, head) => ({ ...state, head: { ...state.head, ...head } });
const NO_KITES = { jib: true, storm: true, code0: false, asym: false, sym: false };
const GENOA_ONLY = { jib: false, storm: false, code0: false, asym: false, sym: false };
const keys = (r) => r.feedback.map((f) => f.key);

test('apparent wind: beam reach adds boat speed forward', () => {
  const w = apparentWind(10, 90, 5);
  near(w.aws, Math.sqrt(125), 1e-9, 'aws');
  near(w.awa, Math.atan2(10, 5) * (180 / Math.PI), 1e-9, 'awa');
  assert.equal(apparentWind(10, -90, 5).awa < 0, true, 'sign follows the tack');
});

test('polar interpolates and respects the no-go zone', () => {
  near(polarSpeed(10, 90), 7.5, 1e-9);
  near(polarSpeed(11, 90), 7.7, 1e-9);
  assert.equal(polarSpeed(10, 20), 0, 'inside no-go');
  assert.ok(polarSpeed(10, 40) < polarSpeed(10, 45), 'pinching is slower');
  assert.ok(polarSpeed(0, 90) === 0);
});

test('sail coefficients: flogging, attached, separated; kites stall later', () => {
  assert.equal(sailCoefficients(-5).cl, 0);
  assert.ok(sailCoefficients(20).cl > 1.2);
  assert.ok(sailCoefficients(90).cl < 0.05 && sailCoefficients(90).cd > 1.2);
  assert.ok(sailCoefficients(35, AERO.kite).cl > sailCoefficients(35, AERO.white).cl, 'a kite still lifts at 35°');
});

test('optimal trim: boom near centreline upwind, fully eased on a run; genoa goes wing-on-wing', () => {
  const up = optimalTrim(mainSpec('full'), 30);
  assert.ok(up.sheet <= 8, `upwind boom ${up.sheet}`);
  const run = optimalTrim(mainSpec('full'), 175);
  assert.ok(run.sheet >= 85, `run boom ${run.sheet}`);
  assert.equal(optimalTrim(headSpec('genoa', 'g135'), 178).windward, true, 'wing-on-wing on a dead run');
  assert.equal(optimalTrim(headSpec('genoa', 'g135'), 70).windward, false);
  const pole = optimalTrim(headSpec('sym', 'set'), 170);
  near(pole.sheet, 80, 6, 'pole square to the apparent wind');
  assert.equal(pole.windward, false, 'a symmetric kite has no windward flag');
});

test('white-sail reefing stage grows with wind and is stricter upwind', () => {
  assert.equal(recommendedStage(10, 45), 0);
  assert.ok([2, 3].includes(recommendedStage(20, 45)), 'reef 1 around 20 kn upwind');
  assert.ok(recommendedStage(30, 45) >= 5, 'deep reefs at 30 kn upwind');
  assert.ok(recommendedStage(20, 135) <= recommendedStage(20, 45), 'more sail downwind');
  assert.equal(recommendedStage(60, 90), SAIL_PLANS.length - 1, 'bare poles in a storm');
  for (let tws = 2; tws <= 55; tws += 1) {
    assert.ok(recommendedStage(tws, 60) >= recommendedStage(tws - 1, 60), `monotonic at ${tws} kn`);
  }
});

test('recommend: picks the right headsail for angle, wind and inventory', () => {
  assert.equal(recommend(8, 90).head.type, 'code0', 'light-air reach → code 0');
  assert.equal(recommend(12, 140).head.type, 'asym', 'broad reach → asymmetric');
  assert.equal(recommend(12, 175).head.type, 'sym', 'dead run → symmetric on the pole');
  assert.equal(recommend(12, 175, { ...defaultState().inventory, sym: false }).head.type, 'genoa', 'no sym aboard, asym cannot run dead downwind → genoa');
  assert.notEqual(recommend(25, 140).head.type, 'asym', 'asym is over its wind limit at 25 kn');
  assert.ok(['genoa', 'jib'].includes(recommend(25, 140).head.type));
  assert.equal(recommend(20, 45).head.type, 'jib', 'a real jib beats a furled genoa upwind in a breeze');
  assert.equal(recommend(20, 45, { ...defaultState().inventory, jib: false }).head.type, 'genoa');
  assert.equal(recommend(30, 45).head.type, 'storm', 'storm jib in a near gale upwind');
  assert.equal(recommend(10, 45).head.type, 'genoa', 'full genoa upwind in moderate air');
  for (const tws of [5, 12, 20, 30]) for (const twa of [45, 90, 140, 175]) {
    assert.equal(recommend(tws, twa, GENOA_ONLY).head.type, 'genoa', `genoa-only inventory at ${tws}/${twa}`);
  }
});

test('evaluate: the recommended setup scores near-perfect everywhere, with and without kites', () => {
  for (const inventory of [defaultState().inventory, NO_KITES, GENOA_ONLY]) {
    for (const tws of [4, 8, 12, 16, 20, 25, 30, 38]) {
      for (const twa of [42, 60, 90, 120, 150, 178]) {
        const state = applyRecommended({ ...defaultState(), inventory, tws, twd: 0, hdg: -twa });
        const r = evaluate(state);
        assert.ok(r.score.total >= 85, `${tws} kn / ${twa}° [${state.head.type}] scored ${r.score.total}: ${JSON.stringify(r.score)} ${keys(r).join(' | ')}`);
        assert.ok(r.speed >= 0.95 * r.polarSpeed - 1e-6, `${tws} kn / ${twa}° speed ${r.speed} vs polar ${r.polarSpeed}`);
      }
    }
  }
});

test('evaluate: full sail in a gale upwind is flagged as overpowered', () => {
  const r = evaluate(withHead({ ...defaultState(), tws: 32, main: { reef: 'full', sheet: 5 } }, { type: 'genoa', size: 'g135', sheet: 8, windward: false }));
  assert.ok(r.score.plan < 30, `plan ${r.score.plan}`);
  assert.ok(r.score.total <= 40, `total ${r.score.total}`);
  assert.ok(r.heel > 30, `heel ${r.heel}`);
  assert.ok(keys(r).includes('plan.overpowered'), keys(r).join());
});

test('evaluate: luffing main is detected and costs speed', () => {
  const good = evaluate(applyRecommended(defaultState()));
  const bad = evaluate({ ...defaultState(), main: { reef: 'full', sheet: 70 } });
  assert.equal(bad.score.main, 0);
  assert.ok(bad.speed < good.speed - 0.5);
  assert.ok(keys(bad).includes('trim.luffing'));
  const item = bad.feedback.find((f) => f.key === 'trim.luffing');
  assert.equal(item.title, 'Main is luffing');
  assert.match(item.detail, /Sheet in about \d+°/);
});

test('evaluate: in irons zeroes the score', () => {
  const r = evaluate({ ...defaultState(), twd: 10, hdg: 5 });
  assert.equal(r.pointOfSail, 'irons');
  assert.ok(r.score.total <= 15);
  assert.equal(r.speed, 0);
  assert.ok(keys(r).includes('course.irons'));
});

test('evaluate: leeward genoa on a dead run is blanketed, wing-on-wing fixes it', () => {
  const base = { ...defaultState(), tws: 15, twd: 0, hdg: 180, main: { reef: 'full', sheet: 90 }, inventory: GENOA_ONLY };
  const lee = evaluate(withHead(base, { type: 'genoa', size: 'g135', sheet: 90, windward: false }));
  const wow = evaluate(withHead(base, { type: 'genoa', size: 'g135', sheet: 90, windward: true }));
  assert.ok(lee.score.head < 40, `leeward genoa ${lee.score.head}`);
  assert.ok(keys(lee).includes('trim.blanketed'));
  assert.ok(wow.score.head >= 95, `wing-on-wing ${wow.score.head}`);
  assert.ok(wow.speed > lee.speed);
});

test('evaluate: wing-on-wing on a beam reach collapses', () => {
  const r = evaluate(withHead({ ...defaultState(), tws: 12, twd: 0, hdg: 270 }, { type: 'genoa', size: 'g135', sheet: 40, windward: true }));
  assert.equal(r.score.head, 0);
  assert.ok(keys(r).includes('trim.wow_collapse'));
});

test('evaluate: spinnaker envelope and wind limit', () => {
  const upwind = evaluate(withHead({ ...defaultState(), tws: 10, twd: 0, hdg: -45 }, { type: 'asym', size: 'set', sheet: 30, windward: false }));
  assert.equal(upwind.score.head, 0, 'asym cannot go upwind');
  const collapse = upwind.feedback.find((f) => f.key === 'trim.collapse');
  assert.ok(collapse, keys(upwind).join());
  assert.equal(collapse.params.reason, t('reason.forward'));

  const gale = evaluate(withHead({ ...defaultState(), tws: 26, twd: 0, hdg: 140 }, { type: 'asym', size: 'set', sheet: 80, windward: false }));
  assert.ok(gale.score.plan <= 10, `plan ${gale.score.plan}`);
  assert.ok(gale.score.total <= 40, `total ${gale.score.total}`);
  assert.ok(keys(gale).includes('plan.overlimit'));

  const good = evaluate(applyRecommended({ ...defaultState(), tws: 12, twd: 0, hdg: 140 }));
  assert.equal(good.state.head.type, 'asym');
  assert.ok(good.score.total >= 90, `asym broad reach ${good.score.total}`);
});

test('evaluate: symmetric spinnaker pole feedback', () => {
  const base = { ...defaultState(), tws: 12, twd: 0, hdg: 178, main: { reef: 'full', sheet: 90 } };
  const best = evaluate(applyRecommended(base));
  assert.equal(best.state.head.type, 'sym');
  assert.ok(best.score.head >= 95, `sym optimum ${best.score.head}`);
  const forward = evaluate(withHead(base, { type: 'sym', size: 'set', sheet: 15, windward: false }));
  assert.ok(forward.score.head < 60, `pole too far forward scores ${forward.score.head}`);
  assert.ok(keys(forward).includes('pole.forward'));
});

test('evaluate: a white-sail boat is told when the kite would pay', () => {
  const r = evaluate(withHead({ ...defaultState(), tws: 12, twd: 0, hdg: 140, main: { reef: 'full', sheet: 70 } }, { type: 'genoa', size: 'g135', sheet: 60, windward: false }));
  assert.equal(r.recommended.head.type, 'asym');
  assert.ok(keys(r).includes('plan.kite'), keys(r).join(' | '));
  assert.ok(r.score.plan < 100);
});

test('evaluate: under-canvassed and unbalanced plans are called out', () => {
  const r = evaluate(withHead({ ...defaultState(), tws: 10, main: { reef: 'r3', sheet: 8 } }, { type: 'genoa', size: 'furled', sheet: 10, windward: false }));
  assert.ok(r.score.plan < 30);
  assert.ok(keys(r).includes('plan.under'));
  assert.ok(keys(r).includes('plan.mainheavy'));
  assert.equal(r.score.head, null, 'no headsail score when furled');
});

test('default scenario: full main + 100 % jib on a close reach, trimmed, with the genoa still recommended', () => {
  const s = defaultState();
  assert.equal(s.head.type, 'jib');
  assert.equal(s.head.size, 'j100');
  const r = evaluate(s);
  assert.equal(r.pointOfSail, 'closereach');
  assert.ok(r.score.total >= 95, `default scenario scores ${r.score.total}: ${keys(r).join(' | ')}`);
  assert.equal(r.recommended.head.type, 'genoa', 'the coach still points at the bigger sail');
  const plan = r.feedback.find((f) => f.key === 'plan.right');
  assert.ok(plan, keys(r).join(' | '));
  assert.match(plan.detail, /^Full main \+ jib at 100 %/, 'describes the plan the user has, not the recommended genoa');
});

test('normaliseState falls back to the genoa when the headsail in use is not aboard', () => {
  const s = normaliseState({ ...defaultState(), inventory: { ...defaultState().inventory, jib: false } });
  assert.equal(s.head.type, 'genoa');
  assert.equal(s.head.size, 'g135');
  const asym = normaliseState({ ...defaultState(), head: { type: 'asym', size: 'set', sheet: 60, windward: false }, inventory: { asym: false } });
  assert.equal(asym.head.type, 'genoa');
  assert.equal(normaliseState({ ...defaultState(), head: { type: 'asym', size: 'set', sheet: 60, windward: false } }).head.type, 'asym', 'aboard by default');
});

test('normaliseState migrates the legacy genoa key and repairs bad ids', () => {
  const s = normaliseState({ tws: 10, twd: 0, hdg: 90, main: { reef: 'r9', sheet: 5 }, genoa: { size: 'g70', sheet: 20, windward: true } });
  assert.equal(s.head.type, 'genoa');
  assert.equal(s.head.size, 'g70');
  assert.equal(s.head.windward, true);
  assert.equal(s.main.reef, 'full');
  assert.equal(s.genoa, undefined);
  assert.deepEqual(Object.keys(s.inventory).sort(), HEADSAILS.filter((h) => !h.always).map((h) => h.id).sort());
});

test('random scenarios never start inside the no-go zone', () => {
  let seed = 1;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 500; i++) {
    const s = randomScenario(rng);
    const twa = Math.abs(norm180(s.twd - s.hdg));
    assert.ok(twa >= 37 && twa <= 180, `twa ${twa}`);
    assert.ok(s.tws >= 2 && s.tws <= 42);
    assert.ok(twa > NO_GO_ANGLE);
  }
});

// ---------------------------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------------------------

test('i18n: every English key has a Norwegian translation and vice versa; placeholders match', () => {
  const enKeys = Object.keys(STRINGS.en);
  const nbKeys = Object.keys(STRINGS.nb);
  const missingNb = enKeys.filter((k) => !(k in STRINGS.nb));
  const extraNb = nbKeys.filter((k) => !(k in STRINGS.en));
  assert.deepEqual(missingNb, [], `missing in nb: ${missingNb.join(', ')}`);
  assert.deepEqual(extraNb, [], `not in en: ${extraNb.join(', ')}`);
  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of enKeys) {
    const a = placeholders(STRINGS.en[k]);
    const b = placeholders(STRINGS.nb[k]);
    // nb may use sail_lc where en uses sail (article/casing differences), otherwise sets must match.
    const norm = (arr) => arr.map((p) => (p === 'sail_lc' ? 'sail' : p));
    assert.deepEqual(norm(b), norm(a), `placeholders differ for ${k}: en ${a} vs nb ${b}`);
  }
});

test('i18n: evaluate speaks Norwegian when asked, and English again afterwards', () => {
  try {
    setLanguage('nb');
    const r = evaluate({ ...defaultState(), main: { reef: 'full', sheet: 70 } });
    const item = r.feedback.find((f) => f.key === 'trim.luffing');
    assert.equal(item.title, 'Storseil lever');
    assert.match(item.detail, /Skjøt inn ca\. \d+°/);
    assert.equal(planName({ main: 'r1', head: { type: 'asym', size: 'set' } }), 'Storseil med rev 1 + asymmetrisk spinnaker');
    assert.equal(planName({ main: 'full', head: { type: 'genoa', size: 'g100' } }), 'Fullt storseil + genoa på 100 %');
    assert.equal(nf(7.6, 1), '7,6');
    assert.equal(r.beaufort.label, 'Laber bris');
  } finally {
    setLanguage('en');
  }
  assert.equal(planName({ main: 'r1', head: { type: 'asym', size: 'set' } }), 'Main at reef 1 + asymmetric spinnaker');
  assert.equal(planName({ main: 'down', head: { type: 'genoa', size: 'furled' } }), 'Bare poles');
  assert.equal(nf(7.6, 1), '7.6');
  assert.equal(tIn('nb', 'pos.deadrun'), 'Plattlens');
  assert.equal(t('nonexistent.key'), 'nonexistent.key');
});

test('i18n: language detection order is URL, saved choice, browser', () => {
  assert.equal(detectLanguage('?lang=nb', 'en', 'en-GB'), 'nb');
  assert.equal(detectLanguage('', 'nb', 'en-GB'), 'nb');
  assert.equal(detectLanguage('', null, 'nb-NO'), 'nb');
  assert.equal(detectLanguage('', null, 'nn-NO'), 'nb');
  assert.equal(detectLanguage('', null, 'de-DE'), 'en');
  assert.equal(detectLanguage('?lang=xx', null, ''), 'en');
});
