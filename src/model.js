// Sail trim model for a ~40 ft cruising sloop: mainsail plus a headsail inventory
// (furling genoa, working jib, storm jib, code 0, asymmetric and symmetric spinnaker).
// Pure functions, no DOM. Angles in degrees, speeds in knots, areas in m².
//
// Conventions
//  - Compass directions: 0 = north, clockwise. Wind direction is where the wind comes FROM.
//  - twa/awa are signed relative to the bow: positive = wind over the starboard side
//    (starboard tack, boom out to port), negative = port tack.
//  - Sheet angles are the angle of the sail's foot from the centreline (0 = amidships).
//    For the symmetric spinnaker the control is the pole angle from the bow (0 = forward, 90 = square).

export const DEG = Math.PI / 180;
export const rad = (d) => d * DEG;
export const deg = (r) => r / DEG;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const norm360 = (a) => ((a % 360) + 360) % 360;
export const norm180 = (a) => norm360(a + 180) - 180;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Boat and sail inventory
// ---------------------------------------------------------------------------

export const BOAT = {
  name: '40 ft cruising sloop',
  loaMetres: 12.2,
  displacementKg: 8500,
  mainSheetMin: 0,
  mainSheetMax: 90,
};

export const MAIN_STATES = [
  { id: 'full', label: 'Full', short: 'Full', area: 45 },
  { id: 'r1', label: 'Reef 1', short: 'R1', area: 36 },
  { id: 'r2', label: 'Reef 2', short: 'R2', area: 28 },
  { id: 'r3', label: 'Reef 3', short: 'R3', area: 20 },
  { id: 'down', label: 'Dropped', short: 'Down', area: 0 },
];
export const mainState = (id) => MAIN_STATES.find((s) => s.id === id) ?? MAIN_STATES[0];

/** Aerodynamic profiles: lift/drag character of a sail shape. */
export const AERO = {
  white: { clMax: 1.5, alphaStall: 25, alphaFlat: 60, cd0: 0.05, cnFlat: 1.3 }, // main, genoa, jib
  flat: { clMax: 1.2, alphaStall: 22, alphaFlat: 60, cd0: 0.05, cnFlat: 1.3 }, // storm jib
  full: { clMax: 1.65, alphaStall: 30, alphaFlat: 65, cd0: 0.08, cnFlat: 1.35 }, // code 0
  kite: { clMax: 1.5, alphaStall: 38, alphaFlat: 70, cd0: 0.12, cnFlat: 1.4 }, // spinnakers
};

/**
 * Headsail inventory. `shape` is the trim-shape efficiency of a partially furled sail,
 * `minAwa`/`maxAwa` the apparent-wind envelope the sail can fly in, `maxTws` the true wind
 * speed beyond which a cruising crew should have it down.
 */
export const HEADSAILS = [
  {
    id: 'genoa', label: 'Furling genoa (135 %)', short: 'Genoa', aero: 'white', control: 'sheet',
    sheetMin: 7, sheetMax: 90, canWindward: true, minAwa: 0, maxAwa: 180, maxTws: Infinity, always: true,
    states: [
      { id: 'g135', label: '135 % (full)', short: '135 %', area: 50, shape: 1 },
      { id: 'g100', label: 'Furled to 100 %', short: '100 %', area: 37, shape: 0.9 },
      { id: 'g70', label: 'Furled to 70 %', short: '70 %', area: 26, shape: 0.8 },
      { id: 'g40', label: 'Furled to 40 %', short: '40 %', area: 15, shape: 0.65 },
      { id: 'furled', label: 'Furled', short: 'Furled', area: 0, shape: 1 },
    ],
  },
  {
    id: 'jib', label: 'Working jib (100 %, furling)', short: 'Jib', aero: 'white', control: 'sheet',
    sheetMin: 5, sheetMax: 90, canWindward: true, minAwa: 0, maxAwa: 180, maxTws: Infinity,
    states: [
      { id: 'j100', label: 'Full (100 %)', short: '100 %', area: 37, shape: 1 },
      { id: 'j70', label: 'Furled to 70 %', short: '70 %', area: 26, shape: 0.85 },
      { id: 'j40', label: 'Furled to 40 %', short: '40 %', area: 15, shape: 0.7 },
      { id: 'furled', label: 'Furled', short: 'Furled', area: 0, shape: 1 },
    ],
  },
  {
    id: 'storm', label: 'Storm jib', short: 'Storm jib', aero: 'flat', control: 'sheet',
    sheetMin: 8, sheetMax: 60, canWindward: false, minAwa: 0, maxAwa: 180, maxTws: Infinity,
    states: [
      { id: 'set', label: 'Set', short: 'Set', area: 12, shape: 1 },
      { id: 'down', label: 'Down', short: 'Down', area: 0, shape: 1 },
    ],
  },
  {
    id: 'code0', label: 'Code 0 (furling reacher)', short: 'Code 0', aero: 'full', control: 'sheet',
    sheetMin: 15, sheetMax: 90, canWindward: false, minAwa: 40, maxAwa: 125, maxTws: 14,
    states: [
      { id: 'set', label: 'Set', short: 'Set', area: 75, shape: 1 },
      { id: 'furled', label: 'Furled', short: 'Furled', area: 0, shape: 1 },
    ],
  },
  {
    id: 'asym', label: 'Asymmetric spinnaker', short: 'Asym', aero: 'kite', control: 'sheet',
    sheetMin: 20, sheetMax: 100, canWindward: false, minAwa: 70, maxAwa: 165, maxTws: 20,
    states: [
      { id: 'set', label: 'Flying', short: 'Set', area: 110, shape: 1 },
      { id: 'down', label: 'Doused', short: 'Down', area: 0, shape: 1 },
    ],
  },
  {
    id: 'sym', label: 'Symmetric spinnaker (pole)', short: 'Sym', aero: 'kite', control: 'pole',
    sheetMin: 0, sheetMax: 90, canWindward: false, minAwa: 100, maxAwa: 180, maxTws: 22,
    states: [
      { id: 'set', label: 'Flying', short: 'Set', area: 100, shape: 1 },
      { id: 'down', label: 'Doused', short: 'Down', area: 0, shape: 1 },
    ],
  },
];
export const headsail = (id) => HEADSAILS.find((h) => h.id === id) ?? HEADSAILS[0];
export const headState = (typeId, stateId) => {
  const h = headsail(typeId);
  return h.states.find((s) => s.id === stateId) ?? h.states[0];
};
export const isKite = (typeId) => typeId === 'code0' || typeId === 'asym' || typeId === 'sym';
export const DEFAULT_INVENTORY = { jib: true, storm: true, code0: true, asym: true, sym: true };

// Backwards-compatible aliases.
export const GENOA_STATES = headsail('genoa').states;
export const genoaState = (id) => headState('genoa', id);
export const FULL_AREA = MAIN_STATES[0].area + GENOA_STATES[0].area;

// White-sail reefing stages from full canvas down to bare poles. Index = stage.
export const SAIL_PLANS = [
  { main: 'full', genoa: 'g135', name: 'Full main + full genoa' },
  { main: 'full', genoa: 'g100', name: 'Full main + genoa furled to 100 %' },
  { main: 'r1', genoa: 'g100', name: 'Reef 1 + genoa at 100 %' },
  { main: 'r1', genoa: 'g70', name: 'Reef 1 + genoa at 70 %' },
  { main: 'r2', genoa: 'g70', name: 'Reef 2 + genoa at 70 %' },
  { main: 'r2', genoa: 'g40', name: 'Reef 2 + storm-size jib (40 %)' },
  { main: 'r3', genoa: 'g40', name: 'Reef 3 + storm-size jib (40 %)' },
  { main: 'r3', genoa: 'furled', name: 'Deep-reefed main alone (or storm jib alone)' },
  { main: 'down', genoa: 'furled', name: 'Bare poles' },
];
export const planArea = (plan) => mainState(plan.main).area + genoaState(plan.genoa).area;

// ---------------------------------------------------------------------------
// Wind helpers
// ---------------------------------------------------------------------------

const BEAUFORT = [
  [1, 'Calm'], [3, 'Light air'], [6, 'Light breeze'], [10, 'Gentle breeze'],
  [16, 'Moderate breeze'], [21, 'Fresh breeze'], [27, 'Strong breeze'], [33, 'Near gale'],
  [40, 'Gale'], [47, 'Strong gale'], [55, 'Storm'], [63, 'Violent storm'], [Infinity, 'Hurricane'],
];
export function beaufort(knots) {
  const force = BEAUFORT.findIndex(([max]) => knots < max);
  return { force, label: BEAUFORT[force][1] };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassName = (dir) => COMPASS[Math.round(norm360(dir) / 22.5) % 16];

export function pointOfSail(twaAbs) {
  if (twaAbs < 30) return 'In irons';
  if (twaAbs < 50) return 'Close-hauled';
  if (twaAbs < 80) return 'Close reach';
  if (twaAbs < 100) return 'Beam reach';
  if (twaAbs < 150) return 'Broad reach';
  if (twaAbs < 172) return 'Running';
  return 'Dead run';
}

/** Apparent wind from true wind angle (signed, deg), true wind speed and boat speed. */
export function apparentWind(tws, twa, boatSpeed) {
  const t = rad(Math.abs(twa));
  const x = tws * Math.sin(t);
  const y = tws * Math.cos(t) + boatSpeed;
  const aws = Math.hypot(x, y);
  const awaAbs = deg(Math.atan2(x, y));
  return { aws, awa: twa < 0 ? -awaAbs : awaAbs, awaAbs };
}

// ---------------------------------------------------------------------------
// Polar (boat speed with the right sails, optimally trimmed). Rows = TWS, cols = TWA.
// Approximate for a modern 40 ft cruiser-racer in flat water, spinnaker downwind.
// ---------------------------------------------------------------------------

const POLAR_TWS = [4, 6, 8, 10, 12, 14, 16, 20, 25, 30];
const POLAR_TWA = [45, 52, 60, 75, 90, 110, 120, 135, 150, 165, 180];
const POLAR = [
  [3.0, 3.5, 3.9, 4.3, 4.4, 4.2, 4.2, 3.6, 2.9, 2.4, 2.2],
  [4.3, 4.8, 5.2, 5.6, 5.7, 5.5, 5.6, 5.0, 4.2, 3.6, 3.2],
  [5.3, 5.8, 6.2, 6.6, 6.8, 6.7, 6.9, 6.3, 5.4, 4.6, 4.3],
  [5.9, 6.4, 6.8, 7.2, 7.5, 7.5, 7.8, 7.2, 6.4, 5.6, 5.3],
  [6.3, 6.7, 7.1, 7.6, 7.9, 8.0, 8.4, 7.9, 7.1, 6.3, 6.0],
  [6.5, 6.9, 7.3, 7.8, 8.2, 8.5, 8.9, 8.5, 7.7, 6.9, 6.6],
  [6.6, 7.0, 7.4, 8.0, 8.5, 8.9, 9.4, 9.0, 8.3, 7.4, 7.1],
  [6.7, 7.1, 7.5, 8.2, 8.9, 9.6, 9.7, 9.4, 8.7, 7.8, 7.4],
  [6.6, 7.0, 7.5, 8.3, 9.2, 10.2, 10.5, 10.3, 9.6, 8.6, 8.0],
  [6.4, 6.9, 7.4, 8.3, 9.3, 10.6, 11.0, 10.9, 10.2, 9.2, 8.5],
];

function interp1(xs, x) {
  if (x <= xs[0]) return [0, 0];
  if (x >= xs[xs.length - 1]) return [xs.length - 1, 0];
  let i = 0;
  while (xs[i + 1] < x) i++;
  return [i, (x - xs[i]) / (xs[i + 1] - xs[i])];
}

export const NO_GO_ANGLE = 30;

/** Polar boat speed (kn) for true wind speed and absolute true wind angle. */
export function polarSpeed(tws, twaAbs) {
  if (tws <= 0.5 || twaAbs <= NO_GO_ANGLE) return 0;
  const twsClamped = clamp(tws, POLAR_TWS[0], POLAR_TWS[POLAR_TWS.length - 1]);
  const twaClamped = clamp(twaAbs, POLAR_TWA[0], POLAR_TWA[POLAR_TWA.length - 1]);
  const [i, ti] = interp1(POLAR_TWS, twsClamped);
  const [j, tj] = interp1(POLAR_TWA, twaClamped);
  const i2 = Math.min(i + 1, POLAR_TWS.length - 1);
  const j2 = Math.min(j + 1, POLAR_TWA.length - 1);
  const a = lerp(POLAR[i][j], POLAR[i][j2], tj);
  const b = lerp(POLAR[i2][j], POLAR[i2][j2], tj);
  let v = lerp(a, b, ti);
  if (tws < POLAR_TWS[0]) v *= tws / POLAR_TWS[0]; // fade to zero in drifting conditions
  if (tws > 30) v *= Math.max(0.6, 1 - 0.012 * (tws - 30)); // sea state, survival mode
  if (twaAbs < POLAR_TWA[0]) v *= Math.pow(smoothstep(NO_GO_ANGLE - 2, POLAR_TWA[0], twaAbs), 0.6);
  return v;
}

// ---------------------------------------------------------------------------
// Sail aerodynamics
// ---------------------------------------------------------------------------

const INDUCED = 0.114; // 1 / (pi * AR * e) with AR ~ 3.5
const HEEL_PENALTY = 0.15; // weight of side force in the trim objective

/**
 * Lift/drag coefficients of a sail vs angle of attack (deg) for an aero profile.
 * alpha <= 0 means the wind is on the leeward face: the sail inverts and flogs.
 */
export function sailCoefficients(alpha, aero = AERO.white) {
  if (alpha <= 0) return { cl: 0, cd: 0.08, regime: 'flogging' };
  const flatCl = 0.5 * aero.cnFlat * Math.sin(rad(2 * alpha));
  const flatCd = aero.cd0 + aero.cnFlat * Math.sin(rad(alpha)) ** 2;
  if (alpha >= aero.alphaFlat) return { cl: flatCl, cd: flatCd, regime: 'separated' };
  if (alpha <= aero.alphaStall) {
    const cl = aero.clMax * Math.sin((Math.PI / 2) * (alpha / aero.alphaStall));
    return { cl, cd: aero.cd0 + INDUCED * cl * cl, regime: 'attached' };
  }
  const t = smoothstep(aero.alphaStall, aero.alphaFlat, alpha);
  const clAtt = aero.clMax;
  const cdAtt = aero.cd0 + INDUCED * clAtt * clAtt;
  const regime = t < 0.2 ? 'attached' : t < 0.5 ? 'stalling' : 'stalled';
  return { cl: lerp(clAtt, flatCl, t), cd: lerp(cdAtt, flatCd, t), regime };
}

/**
 * Drive (cx, along the boat) and side (cy, heeling) force coefficients for a sail
 * at angle of attack alpha, with the apparent wind at awaAbs degrees off the bow.
 */
export function sailForces(alpha, awaAbs, aero = AERO.white) {
  const { cl, cd, regime } = sailCoefficients(alpha, aero);
  const a = rad(awaAbs);
  const cx = cl * Math.sin(a) - cd * Math.cos(a);
  const cy = cl * Math.cos(a) + cd * Math.sin(a);
  return { cx, cy, cl, cd, regime };
}

/** A sail ready for analysis: the main at a reef state, or a headsail type at a furl/hoist state. */
export function mainSpec(reef) {
  const st = mainState(reef);
  return { kind: 'main', id: 'main', label: 'Main', aero: AERO.white, control: 'sheet', area: st.area, shape: 1, sheetMin: BOAT.mainSheetMin, sheetMax: BOAT.mainSheetMax, canWindward: false, type: null, state: st };
}
export function headSpec(typeId, stateId) {
  const type = headsail(typeId);
  const st = headState(typeId, stateId);
  return { kind: 'head', id: type.id, label: type.short, aero: AERO[type.aero], control: type.control, area: st.area, shape: st.shape, sheetMin: type.sheetMin, sheetMax: type.sheetMax, canWindward: type.canWindward, type, state: st };
}

/** Angle of attack of a sail for a given control setting. */
export function angleOfAttack(spec, awaAbs, sheet, windward = false) {
  if (spec.control === 'pole') {
    // Symmetric kite: the sail is square to the wind when the pole is perpendicular to it.
    return clamp(90 - Math.abs(awaAbs - 90 - sheet), 0, 90);
  }
  if (windward) {
    // Sail set on the windward side (poled-out / wing-on-wing genoa). Only the magnitude
    // matters: the sail is a membrane and works with either face pressed.
    return Math.abs(norm180(awaAbs + sheet));
  }
  return awaAbs - sheet;
}

/** Efficiency multipliers from the sail's wind-angle envelope and the main's wind shadow. */
export function interaction(spec, awaAbs, windward) {
  const none = { factor: 1, blanketed: false, collapsed: false, reason: '' };
  if (spec.kind === 'main' || spec.id === 'storm') return none;
  if (spec.id === 'genoa' || spec.id === 'jib') {
    if (windward) {
      // Poled out to windward: collapses unless the wind is well aft.
      return { factor: smoothstep(135, 155, awaAbs), blanketed: false, collapsed: awaAbs < 145, reason: 'too far forward for wing-on-wing' };
    }
    const blanket = 0.85 * smoothstep(140, 165, awaAbs);
    return { factor: 1 - blanket, blanketed: blanket > 0.3, collapsed: false, reason: '' };
  }
  const t = spec.type;
  let factor = smoothstep(t.minAwa - 12, t.minAwa + 4, awaAbs) * (1 - smoothstep(t.maxAwa - 12, t.maxAwa + 4, awaAbs));
  let blanketed = false;
  if (spec.id === 'asym') {
    const shadow = 0.6 * smoothstep(158, 178, awaAbs);
    factor *= 1 - shadow;
    blanketed = shadow > 0.25;
  }
  const collapsed = factor < 0.35;
  const reason = awaAbs < t.minAwa ? 'apparent wind too far forward' : awaAbs > t.maxAwa ? 'apparent wind too far aft' : '';
  return { factor, blanketed, collapsed, reason };
}

/** A symmetric kite on the pole is a pure drag device: projected area is everything. */
function poleForces(alpha, awaAbs, aero) {
  const cd = aero.cd0 + aero.cnFlat * Math.sin(rad(alpha)) ** 2;
  const a = rad(awaAbs);
  return { cx: -cd * Math.cos(a), cy: cd * Math.sin(a), cl: 0, cd, regime: alpha > 60 ? 'separated' : 'stalled' };
}

export function analyseSail(spec, awaAbs, sheet, windward = false) {
  const ww = windward && spec.canWindward;
  const alpha = angleOfAttack(spec, awaAbs, sheet, ww);
  const forces = spec.control === 'pole' ? poleForces(alpha, awaAbs, spec.aero) : sailForces(alpha, awaAbs, spec.aero);
  const inter = interaction(spec, awaAbs, ww);
  const cx = forces.cx * inter.factor * spec.shape;
  const cy = forces.cy * inter.factor * (1 - (1 - spec.shape) * 0.5); // a baggy furled sail heels more per unit drive
  const objective = cx - HEEL_PENALTY * Math.max(0, cy);
  return { alpha, cx, cy, cl: forces.cl, cd: forces.cd, regime: forces.regime, objective, windward: ww, ...inter };
}

/** Best control setting (and side, for wing-capable headsails) at this apparent wind angle. */
export function optimalTrim(spec, awaAbs) {
  let best = null;
  const sides = spec.canWindward ? [false, true] : [false];
  for (const windward of sides) {
    for (let s = spec.sheetMin; s <= spec.sheetMax; s++) {
      const r = analyseSail(spec, awaAbs, s, windward);
      if (!best || r.objective > best.objective + 1e-9) best = { sheet: s, ...r };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Heel, reefing and the recommended sail plan
// ---------------------------------------------------------------------------

const HEEL_K = 4.3e-4; // empirical: full sail, AWS 20 kn, close-hauled → ~22° heel
const HEEL_SAT = 50;
export const HEEL_COMFORT = 24; // above this we call it overpowered

export function heelAngle(aws, sideForceArea) {
  const raw = HEEL_K * aws * aws * Math.max(0, sideForceArea);
  return HEEL_SAT * Math.tanh(raw / HEEL_SAT);
}

const TWS_CAPS = [18, 22, 27, 32, 37, 44, 52]; // stage floor by true wind speed alone
function twsCapStage(tws) {
  if (tws < TWS_CAPS[0]) return 0;
  if (tws < TWS_CAPS[1]) return 1;
  if (tws < TWS_CAPS[2]) return 2;
  if (tws < TWS_CAPS[3]) return 4;
  if (tws < TWS_CAPS[4]) return 5;
  if (tws < TWS_CAPS[5]) return 6;
  if (tws < TWS_CAPS[6]) return 7;
  return 8;
}

/** Evaluate a sail plan {main, head:{type,size}} at optimal trim for the given apparent wind. */
export function planAtOptimalTrim(plan, aws, awaAbs) {
  const mSpec = mainSpec(plan.main);
  const hSpec = headSpec(plan.head.type, plan.head.size);
  const main = mSpec.area > 0 ? optimalTrim(mSpec, awaAbs) : null;
  const head = hSpec.area > 0 ? optimalTrim(hSpec, awaAbs) : null;
  const driveArea = (main ? main.cx * mSpec.area : 0) + (head ? head.cx * hSpec.area : 0);
  const sideArea = (main ? Math.max(0, main.cy) * mSpec.area : 0) + (head ? Math.max(0, head.cy) * hSpec.area : 0);
  return { main, head, mainSpec: mSpec, headSpec: hSpec, driveArea, sideArea, heel: heelAngle(aws, sideArea), area: mSpec.area + hSpec.area };
}

const whitePlan = (stage) => ({ main: SAIL_PLANS[stage].main, head: { type: 'genoa', size: SAIL_PLANS[stage].genoa } });

/** White-sail reefing stage for the true wind, using polar speed for the apparent wind. */
export function recommendedStage(tws, twaAbs) {
  const vPol = polarSpeed(tws, twaAbs);
  const { aws, awaAbs: awa } = apparentWind(tws, twaAbs, vPol);
  let stage = 0;
  for (; stage < SAIL_PLANS.length - 1; stage++) {
    if (planAtOptimalTrim(whitePlan(stage), aws, awa).heel <= HEEL_COMFORT) break;
  }
  return Math.max(stage, twsCapStage(tws));
}

export function planName(plan) {
  const m = mainState(plan.main);
  const h = headsail(plan.head.type);
  const hs = headState(plan.head.type, plan.head.size);
  if (m.area === 0 && hs.area === 0) return 'Bare poles';
  const mainText = m.area === 0 ? 'main down' : m.id === 'full' ? 'full main' : `main at ${m.label.toLowerCase()}`;
  let headText;
  if (hs.area === 0) headText = h.id === 'genoa' || h.id === 'jib' || h.id === 'code0' ? `${h.short.toLowerCase()} furled` : `${h.short.toLowerCase()} down`;
  else if (h.states.length > 2) headText = `${h.short.toLowerCase()} at ${hs.short}`;
  else headText = h.label.toLowerCase().replace(/ \(.*\)$/, '');
  const text = `${mainText} + ${headText}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Recommended sail plan for the true wind, given which headsails are aboard.
 * Starts from the white-sail reefing stage, then upgrades the headsail: a proper jib or storm jib
 * instead of a rag of furled genoa, and a code 0 or spinnaker when the angle and wind allow.
 */
export function recommend(tws, twaAbs, inventory = DEFAULT_INVENTORY) {
  const inv = { ...DEFAULT_INVENTORY, ...(inventory ?? {}) };
  const stage = recommendedStage(tws, twaAbs);
  const base = SAIL_PLANS[stage];
  const vPol = polarSpeed(tws, twaAbs);
  const wind = apparentWind(tws, twaAbs, vPol);
  const awa = wind.awaAbs;
  let plan = { main: base.main, head: { type: 'genoa', size: base.genoa } };
  const fitsHeel = (candidate) => planAtOptimalTrim(candidate, wind.aws, awa).heel <= HEEL_COMFORT + 2;

  if (inv.storm && (base.genoa === 'g40' || (stage === 7 && twaAbs < 150))) {
    const candidate = { main: base.main, head: { type: 'storm', size: 'set' } };
    if (fitsHeel(candidate)) plan = candidate;
  } else if (inv.jib && (base.genoa === 'g100' || base.genoa === 'g70')) {
    const candidate = { main: base.main, head: { type: 'jib', size: base.genoa === 'g100' ? 'j100' : 'j70' } };
    if (fitsHeel(candidate)) plan = candidate;
  }

  if (tws >= 2 && twaAbs > NO_GO_ANGLE) {
    const tryKite = (type) => {
      const t = headsail(type);
      if (!inv[type] || tws > t.maxTws - 2) return false;
      if (awa < t.minAwa + 4 || awa > t.maxAwa - 4) return false;
      const candidate = { main: base.main, head: { type, size: 'set' } };
      const p = planAtOptimalTrim(candidate, wind.aws, awa);
      if (p.heel > HEEL_COMFORT + 2) return false;
      plan = candidate;
      return true;
    };
    if (twaAbs >= 55 && awa <= 95 && tws <= 14 && tryKite('code0')) { /* light-air reaching */ }
    else if (twaAbs >= 150 && tryKite('sym')) { /* running with the pole */ }
    else if (twaAbs >= 100 && tryKite('asym')) { /* broad reaching */ }
    else if (twaAbs >= 55 && tryKite('code0')) { /* reaching a little deeper than the asym likes */ }
  }
  return { stage, ...plan, name: planName(plan) };
}

// ---------------------------------------------------------------------------
// Full evaluation of the user's setup
// ---------------------------------------------------------------------------

export function defaultState() {
  return {
    tws: 14,
    twd: 320,
    hdg: 10,
    main: { reef: 'full', sheet: 10 },
    head: { type: 'genoa', size: 'g135', sheet: 12, windward: false },
    inventory: { ...DEFAULT_INVENTORY },
  };
}

/** Bring older or partial state objects (e.g. from localStorage or a URL) up to the current shape. */
export function normaliseState(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const s = { ...d, ...raw };
  s.main = { ...d.main, ...(raw.main ?? {}) };
  const head = raw.head ?? (raw.genoa ? { type: 'genoa', ...raw.genoa } : null);
  s.head = { ...d.head, ...(head ?? {}) };
  if (!HEADSAILS.some((h) => h.id === s.head.type)) s.head.type = 'genoa';
  if (!headsail(s.head.type).states.some((x) => x.id === s.head.size)) s.head.size = headsail(s.head.type).states[0].id;
  if (!MAIN_STATES.some((m) => m.id === s.main.reef)) s.main.reef = 'full';
  s.inventory = { ...DEFAULT_INVENTORY, ...(raw.inventory ?? {}) };
  delete s.genoa;
  return s;
}

function scoreFromRatio(ratio) {
  return Math.round(100 * clamp(ratio, 0, 1));
}

/**
 * Evaluate the boat with the user's settings.
 * @param {ReturnType<typeof defaultState>} input
 */
export function evaluate(input) {
  const state = normaliseState(input);
  const tws = Math.max(0, state.tws);
  const twa = norm180(state.twd - state.hdg);
  const twaAbs = Math.abs(twa);
  const tack = twa >= 0 ? 'starboard' : 'port';
  const pos = pointOfSail(twaAbs);
  const vPol = polarSpeed(tws, twaAbs);

  // Reference: recommended plan, optimally trimmed, at polar speed.
  const refWind = apparentWind(tws, twaAbs, vPol);
  const rec = recommend(tws, twaAbs, state.inventory);
  const ref = planAtOptimalTrim(rec, refWind.aws, refWind.awaAbs);

  const mSpec = mainSpec(state.main.reef);
  const hSpec = headSpec(state.head.type, state.head.size);
  const mainArea = mSpec.area;
  const headArea = hSpec.area;
  const userArea = mainArea + headArea;
  const mainSheet = clamp(Math.round(state.main.sheet), mSpec.sheetMin, mSpec.sheetMax);
  const headSheet = clamp(Math.round(state.head.sheet), hSpec.sheetMin, hSpec.sheetMax);
  const headWindward = Boolean(state.head.windward) && hSpec.canWindward;
  const overLimit = headArea > 0 && tws > hSpec.type.maxTws;

  // Fixed-point iteration: speed → apparent wind → forces → speed.
  let speed = vPol;
  let wind = refWind;
  let main = null;
  let head = null;
  let heel = 0;
  for (let iter = 0; iter < 5; iter++) {
    wind = apparentWind(tws, twaAbs, speed);
    main = mainArea > 0 ? analyseSail(mSpec, wind.awaAbs, mainSheet, false) : null;
    head = headArea > 0 ? analyseSail(hSpec, wind.awaAbs, headSheet, headWindward) : null;
    const driveArea = (main ? main.cx * mainArea : 0) + (head ? head.cx * headArea : 0);
    const sideArea = (main ? Math.max(0, main.cy) * mainArea : 0) + (head ? Math.max(0, head.cy) * headArea : 0);
    heel = heelAngle(wind.aws, sideArea);
    let v = 0;
    if (ref.driveArea > 1e-6 && vPol > 0) {
      const driveRatio = clamp(driveArea / ref.driveArea, 0, 1.15);
      v = vPol * Math.sqrt(driveRatio);
      // Overpowered: leeway, rudder drag and rounding up eat the extra drive.
      v *= clamp(1 - 0.018 * Math.max(0, heel - HEEL_COMFORT), 0.35, 1);
      if (overLimit) v *= 0.8; // a kite in too much wind: broaches and round-ups
    } else if (driveArea > 0 && vPol > 0) {
      v = vPol; // reference is bare poles but the user carries canvas: survival, no speed credit
    }
    speed = 0.5 * (speed + v); // damped update
  }

  // Optimal trim for the sails the user actually has up, at the user's apparent wind.
  const mainOpt = mainArea > 0 ? optimalTrim(mSpec, wind.awaAbs) : null;
  const headOpt = headArea > 0 ? optimalTrim(hSpec, wind.awaAbs) : null;

  const feedback = [];
  const push = (severity, area, title, detail) => feedback.push({ severity, area, title, detail });

  // --- Course -------------------------------------------------------------
  let courseScore = 100;
  if (twaAbs < NO_GO_ANGLE) {
    courseScore = 0;
    push('bad', 'course', 'In irons — you are inside the no-go zone',
      `The wind is only ${twaAbs.toFixed(0)}° off the bow. Bear away to at least 40–45° true wind angle before anything else matters.`);
  } else if (twaAbs < 38) {
    courseScore = Math.round(lerp(40, 100, (twaAbs - NO_GO_ANGLE) / (38 - NO_GO_ANGLE)));
    push('warn', 'course', 'Pinching', `At ${twaAbs.toFixed(0)}° true the sails can barely fill. Bear away a few degrees to ~42–45° for real speed.`);
  } else if (twaAbs >= 172) {
    courseScore = 85;
    const kite = isKite(state.head.type) && headArea > 0;
    push('info', 'course', 'Dead run', state.head.type === 'sym' && headArea > 0
      ? 'Squared-back pole and a preventer on the boom — an accidental gybe is the main risk on a dead run.'
      : kite
        ? 'An asymmetric wants apparent wind: heat up to ~150° true and gybe downwind; it collapses behind the main dead downwind.'
        : headWindward
          ? 'Wing-on-wing is the right call here. Rig a preventer on the boom — an accidental gybe is the main risk on a dead run.'
          : 'Risk of an accidental gybe, and the headsail sits in the main’s wind shadow. Set it to windward (wing-on-wing), hoist a kite, or heat up to ~150° for better VMG.');
  } else if (pos === 'Close-hauled') {
    push('good', 'course', 'Close-hauled', `Sailing ${twaAbs.toFixed(0)}° to the true wind on ${tack} tack — a good upwind angle.`);
  }

  // --- Sail plan (area and choice of headsail) --------------------------------
  const recArea = ref.area;
  const ratio = recArea > 0 ? userArea / recArea : userArea > 0 ? Infinity : 1;
  let planScore = 100;
  const recName = rec.name;
  const recHead = headsail(rec.head.type);
  if (overLimit) {
    planScore = 10;
    push('bad', 'plan', `Too much wind for the ${hSpec.type.short.toLowerCase()}`,
      `${tws.toFixed(0)} kn true is over its ${hSpec.type.maxTws} kn limit — expect broaches or a blown-out sail. Get it down and go to white sails: ${recName.toLowerCase()}.`);
  } else if (tws < 3) {
    planScore = userArea >= 0.8 * FULL_AREA ? 100 : 70;
    push(userArea >= 0.8 * FULL_AREA ? 'good' : 'warn', 'plan', 'Drifting conditions',
      `Hardly any wind. Hoist everything you have — ${recName.toLowerCase()} — and keep the sails full.`);
  } else if (recArea === 0) {
    planScore = userArea === 0 ? 100 : Math.max(0, 100 - Math.round(userArea * 3));
    push(userArea === 0 ? 'good' : 'bad', 'plan', 'Survival conditions',
      `In ${tws.toFixed(0)} kn true the recommendation is bare poles (or a storm jib / trysail), and to heave to or run off.`);
  } else if (ratio > 1.001) {
    const heelScore = heel <= HEEL_COMFORT ? 100 : heel <= 28 ? 80 : heel <= 32 ? 55 : heel <= 38 ? 25 : 5;
    const ratioScore = ratio <= 1.2 ? 100 : ratio <= 1.4 ? 75 : ratio <= 1.7 ? 50 : 25;
    planScore = Math.min(heelScore, ratioScore);
    if (planScore >= 100) {
      push('good', 'plan', 'Sail plan is fine', `Carrying ${userArea} m² of ${recArea} m² recommended (${recName.toLowerCase()}). Heel ~${heel.toFixed(0)}°.`);
    } else {
      const sev = planScore >= 75 ? 'warn' : 'bad';
      const heelText = heel > HEEL_COMFORT ? `Predicted heel ${heel.toFixed(0)}° — ` : '';
      push(sev, 'plan', planScore >= 75 ? 'A bit too much sail' : 'Overpowered — reduce sail',
        `${heelText}you are carrying ${userArea} m² where ${recArea} m² is about right. Recommended: ${recName.toLowerCase()}.`);
    }
  } else {
    planScore = ratio >= 0.85 ? 100 : ratio >= 0.7 ? 80 : ratio >= 0.5 ? 55 : ratio >= 0.3 ? 30 : 10;
    if (planScore >= 100) {
      push('good', 'plan', 'Sail plan is right for the conditions',
        `${recName} — ${userArea} m² for ${tws.toFixed(0)} kn true (${wind.aws.toFixed(0)} kn apparent).`);
    } else {
      const swap = rec.head.type !== state.head.type && isKite(rec.head.type);
      push(planScore >= 80 ? 'warn' : 'bad', 'plan', swap ? `Time for the ${recHead.short.toLowerCase()}` : planScore >= 80 ? 'Slightly under-canvassed' : 'Under-canvassed',
        swap
          ? `Only ${userArea} m² up; ${recArea} m² would be right. ${recName} is the fast setup at ${twaAbs.toFixed(0)}° true in ${tws.toFixed(0)} kn.`
          : `Only ${userArea} m² up; ${recArea} m² would be right. Shake out a reef / unfurl: ${recName.toLowerCase()}.`);
    }
  }
  // A different headsail of similar size: a nudge, not a penalty.
  if (planScore >= 80 && !overLimit && headArea > 0 && rec.head.type !== state.head.type && Math.abs(ratio - 1) < 0.2) {
    if (hSpec.shape < 1 && (rec.head.type === 'jib' || rec.head.type === 'storm')) {
      push('info', 'plan', `A ${recHead.short.toLowerCase()} would set better`, `A genoa furled to ${hSpec.state.short} is baggy and heels more per knot; a ${recHead.label.toLowerCase()} of the same size holds its shape.`);
    }
  }
  // Balance between main and headsail (white sails only)
  if (userArea > 0 && tws >= 6 && tws < 30 && rec.stage < 6 && !isKite(state.head.type) && !isKite(rec.head.type)) {
    const share = mainArea / userArea;
    if (share < 0.25) {
      planScore = Math.round(planScore * 0.7);
      push('warn', 'plan', 'Headsail-heavy sail plan', 'With little or no main the boat carries lee helm and points poorly. Get some main up to balance the rig.');
    } else if (share > 0.75 && twaAbs < 150) {
      planScore = Math.round(planScore * 0.7);
      push('warn', 'plan', 'Main-heavy sail plan', 'Main alone means heavy weather helm and slow tacking. Set a headsail to balance the boat.');
    }
  }

  // --- Sail trim ------------------------------------------------------------
  const trimFeedback = (spec, sail, opt, sheet) => {
    if (!sail) return null;
    const label = spec.label;
    const key = spec.kind;
    if (twaAbs < NO_GO_ANGLE) {
      push('bad', key, `${label} is flogging`, 'No sail can draw inside the no-go zone.');
      return 0;
    }
    if (sail.collapsed) {
      if (spec.kind === 'head' && (spec.id === 'genoa' || spec.id === 'jib')) {
        push('bad', key, `${label} is collapsing to windward`,
          `Wing-on-wing only works with the wind well aft (≥ ~150° apparent); it is ${wind.awaAbs.toFixed(0)}°. Gybe the ${label.toLowerCase()} back to leeward.`);
      } else {
        const t = spec.type;
        push('bad', key, `${label} is collapsing — ${sail.reason}`,
          `The ${label.toLowerCase()} flies between ~${t.minAwa}° and ${t.maxAwa}° apparent; you are at ${wind.awaAbs.toFixed(0)}°. ${wind.awaAbs < t.minAwa ? 'Bear away, or change down to a headsail that points.' : 'Head up to bring the apparent wind forward, or switch sails.'}`);
      }
      return 0;
    }
    const eff = opt.objective > 1e-6 ? clamp(sail.objective / opt.objective, 0, 1) : sail.objective >= opt.objective ? 1 : 0;
    const score = scoreFromRatio(eff);
    const delta = sheet - opt.sheet; // positive = eased (or pole squared) more than optimal
    const downwind = wind.awaAbs > 135;
    if (spec.control === 'pole') {
      if (eff >= 0.9) push('good', key, 'Pole well set', `Pole at ${sheet}°, square to the apparent wind (best ~${opt.sheet}°). The kite is drawing.`);
      else if (delta > 0) push(eff >= 0.6 ? 'warn' : 'bad', key, 'Pole too far aft', `Ease the pole forward ~${delta}° (to ~${opt.sheet}°) so it sits perpendicular to the apparent wind.`);
      else push(eff >= 0.6 ? 'warn' : 'bad', key, 'Pole too far forward', `Square the pole back ~${-delta}° (to ~${opt.sheet}°) so the kite faces the wind.`);
      return score;
    }
    if (spec.kind === 'head' && !sail.windward && sail.blanketed && sail.factor < 0.55) {
      push(eff >= 0.6 ? 'warn' : 'bad', key, `${label} blanketed by the main`,
        `It is collapsing in the main’s wind shadow (${wind.awaAbs.toFixed(0)}° apparent). ${spec.canWindward ? 'Pole it out to windward (wing-on-wing) or head up to ~150° true.' : 'Head up to ~150° true so it draws clear air.'}`);
      return score;
    }
    if (sail.alpha <= 2 && !downwind) {
      push('bad', key, `${label} is luffing`, `Sheeted out beyond the wind — it is flogging. Sheet in about ${Math.abs(delta)}° (to ~${opt.sheet}°).`);
    } else if (eff >= 0.9) {
      const note = sail.blanketed ? ' It is partly blanketed by the main, though.' : '';
      const kiteNote = isKite(spec.id) ? ' Luff just on the curl.' : '';
      push('good', key, `${label} well trimmed`, `Angle of attack ${sail.alpha.toFixed(0)}° — ${sail.regime} flow.${kiteNote} Best sheet is ${opt.sheet}°; you are within ${Math.abs(delta)}°.${note}`);
    } else if (delta > 0) {
      push(eff >= 0.6 ? 'warn' : 'bad', key, `${label} under-trimmed`, `${isKite(spec.id) ? 'Luff is curling and folding.' : 'Luff is soft / bubbling.'} Sheet in ~${delta}° (to ~${opt.sheet}°).`);
    } else {
      const heelNote = wind.awaAbs < 100 ? ' Over-sheeting adds heel and kills speed.' : ' Downwind, ease it until the luff just breaks.';
      push(eff >= 0.6 ? 'warn' : 'bad', key, `${label} over-sheeted${sail.regime.startsWith('stall') ? ' — stalled' : ''}`,
        `Angle of attack ${sail.alpha.toFixed(0)}°. Ease ~${-delta}° (to ~${opt.sheet}°).${heelNote}`);
    }
    if (spec.kind === 'head' && spec.canWindward && sail.blanketed && !sail.windward && eff >= 0.6) {
      push('info', key, `${label} blanketed by the main`, 'Pole it out to windward (wing-on-wing) or head up to ~150° true so it draws clear air.');
    }
    return score;
  };

  const mainScore = trimFeedback(mSpec, main, mainOpt, mainSheet);
  const headScore = trimFeedback(hSpec, head, headOpt, headSheet);
  if (headArea > 0 && hSpec.canWindward && headOpt && headOpt.windward && !headWindward && twaAbs >= NO_GO_ANGLE) {
    push('info', 'head', 'Try wing-on-wing', `With the wind ${wind.awaAbs.toFixed(0)}° apparent the ${hSpec.label.toLowerCase()} draws best set to windward (sheeted ~${headOpt.sheet}°).`);
  }

  // --- Score ----------------------------------------------------------------
  const parts = [
    ['course', courseScore, 15],
    ['plan', planScore, 35],
    ['main', mainScore, 25],
    ['head', headScore, 25],
  ].filter(([, s]) => s !== null);
  const weight = parts.reduce((a, [, , w]) => a + w, 0);
  let total = Math.round(parts.reduce((a, [, s, w]) => a + s * w, 0) / weight);
  if (twaAbs < NO_GO_ANGLE) total = Math.min(total, 15);
  if (planScore < 30) total = Math.min(total, 40); // a dangerous or hopeless sail plan is never "fine"
  if (heel > 35) total = Math.min(total, 35);

  const vmg = speed * Math.cos(rad(twaAbs));
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  feedback.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    state,
    tws, twd: norm360(state.twd), hdg: norm360(state.hdg), twa, twaAbs, tack, pointOfSail: pos,
    beaufort: beaufort(tws),
    polarSpeed: vPol,
    speed, vmg, heel,
    aws: wind.aws, awa: (twa >= 0 ? 1 : -1) * wind.awaAbs, awaAbs: wind.awaAbs,
    areas: { main: mainArea, head: headArea, total: userArea, recommended: recArea },
    recommended: {
      stage: rec.stage, main: rec.main, head: rec.head, name: rec.name,
      mainSheet: ref.main ? ref.main.sheet : null,
      headSheet: ref.head ? ref.head.sheet : null,
      headWindward: ref.head ? ref.head.windward : false,
      heel: ref.heel,
      speed: vPol,
    },
    sails: {
      main: main ? { ...main, spec: mSpec, sheet: mainSheet, optSheet: mainOpt.sheet } : null,
      head: head ? { ...head, spec: hSpec, sheet: headSheet, optSheet: headOpt.sheet, optWindward: headOpt.windward, overLimit } : null,
    },
    score: { total, course: courseScore, plan: planScore, main: mainScore, head: headScore },
    feedback,
  };
}

/** Apply the recommended sail plan and trim to a state (returns a new state). */
export function applyRecommended(input) {
  const state = normaliseState(input);
  const r = evaluate(state);
  const rec = r.recommended;
  const next = {
    ...state,
    main: { reef: rec.main, sheet: rec.mainSheet ?? state.main.sheet },
    head: { type: rec.head.type, size: rec.head.size, sheet: rec.headSheet ?? state.head.sheet, windward: rec.headWindward },
  };
  // Re-trim at the speed the recommended plan actually reaches.
  const r2 = evaluate(next);
  if (r2.sails.main) next.main.sheet = r2.sails.main.optSheet;
  if (r2.sails.head) {
    next.head.sheet = r2.sails.head.optSheet;
    next.head.windward = r2.sails.head.optWindward;
  }
  return next;
}

/** Random practice scenario. */
export function randomScenario(rng = Math.random) {
  const u = rng();
  let tws;
  if (u < 0.15) tws = 2 + rng() * 5;
  else if (u < 0.85) tws = 6 + rng() * 19;
  else tws = 25 + rng() * 17;
  const twd = Math.floor(rng() * 360);
  const twa = (rng() < 0.5 ? -1 : 1) * (38 + rng() * 142);
  const hdg = norm360(Math.round(twd - twa));
  return { tws: Math.round(tws * 10) / 10, twd, hdg };
}
