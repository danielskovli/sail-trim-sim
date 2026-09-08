import {
  evaluate, applyRecommended, randomScenario, defaultState, normaliseState, recommend,
  MAIN_STATES, HEADSAILS, headsail, headState, mainState, compassName, clamp, norm360,
} from './model.js';
import { createParticles } from './particles.js';
import { createScene } from './scene.js';
import { legendGradient, windCss } from './palette.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'sail-trim-sim.v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s.tws !== 'number' || !s.main) return null;
    return s;
  } catch {
    return null;
  }
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, quiz }));
  } catch {
    /* ignore */
  }
}

/**
 * Optional scenario in the URL, e.g.
 *   ?tws=22&twd=300&hdg=350&main=r1:6&head=jib:j100:8&quiz=1
 *   ?tws=12&twd=0&hdg=150&head=asym:set:80&inv=jib,asym
 * `genoa=g100:8` is accepted as a legacy spelling of `head=genoa:g100:8`; `wow=1` sets it to windward.
 */
function stateFromUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has('tws') && !q.has('twd') && !q.has('hdg')) return null;
  const s = defaultState();
  const num = (k, cur) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : cur);
  s.tws = num('tws', s.tws);
  s.twd = num('twd', s.twd);
  s.hdg = num('hdg', s.hdg);
  if (q.has('main')) {
    const [id, sheet] = q.get('main').split(':');
    if (MAIN_STATES.some((x) => x.id === id)) s.main.reef = id;
    if (Number.isFinite(Number(sheet)) && sheet !== undefined) s.main.sheet = Number(sheet);
  }
  if (q.has('head')) {
    const [type, size, sheet] = q.get('head').split(':');
    if (HEADSAILS.some((h) => h.id === type)) s.head.type = type;
    if (size && headsail(s.head.type).states.some((x) => x.id === size)) s.head.size = size;
    if (Number.isFinite(Number(sheet)) && sheet !== undefined) s.head.sheet = Number(sheet);
  } else if (q.has('genoa')) {
    const [size, sheet] = q.get('genoa').split(':');
    s.head.type = 'genoa';
    if (headsail('genoa').states.some((x) => x.id === size)) s.head.size = size;
    if (Number.isFinite(Number(sheet)) && sheet !== undefined) s.head.sheet = Number(sheet);
  }
  s.head.windward = q.get('wow') === '1';
  if (q.has('inv')) {
    const aboard = new Set(q.get('inv').split(',').map((x) => x.trim()));
    for (const h of HEADSAILS) if (!h.always) s.inventory[h.id] = aboard.has(h.id);
  }
  if (q.has('quiz')) s.quiz = q.get('quiz') === '1';
  return s;
}

const initial = stateFromUrl() ?? loadState() ?? defaultState();
let quiz = Boolean(initial.quiz);
let state = normaliseState(initial);
let checked = false;
let result = evaluate(state);

const particles = createParticles($('wind'));
const scene = createScene($('scene'), {
  onWindDirection: (twd) => change((s) => { s.twd = twd; }),
  onHeading: (hdg) => change((s) => { s.hdg = hdg; }),
  onMain: ({ sheet, reef }) => change((s) => { s.main.sheet = sheet; s.main.reef = reef; }),
  onHead: ({ sheet, size, windward }) => change((s) => {
    s.head.sheet = sheet;
    s.head.size = size;
    s.head.windward = windward;
  }),
});

// Mouse wheel / trackpad anywhere over the chart changes wind speed.
let wheelAcc = 0;
window.addEventListener('wheel', (e) => {
  if (e.target instanceof Element && e.target.closest('.panel, .coach, .readouts, .legend, .brand')) return;
  e.preventDefault();
  wheelAcc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  const steps = Math.trunc(wheelAcc / 40);
  if (steps !== 0) {
    wheelAcc -= steps * 40;
    change((s) => { s.tws = Math.round((s.tws - steps * 0.5) * 2) / 2; });
  }
}, { passive: false });

// Drag the marker (or click anywhere) on the legend bar to set wind speed.
{
  const wrap = $('legend-wrap');
  let active = null;
  const setFromEvent = (e) => {
    const rect = wrap.getBoundingClientRect();
    const f = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    change((s) => { s.tws = Math.round(f * 50 * 2) / 2; });
  };
  wrap.addEventListener('pointerdown', (e) => {
    active = e.pointerId;
    wrap.setPointerCapture(e.pointerId);
    setFromEvent(e);
  });
  wrap.addEventListener('pointermove', (e) => { if (active === e.pointerId) setFromEvent(e); });
  const end = (e) => { if (active === e.pointerId) active = null; };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function buildSegmented(container, items, current, onPick) {
  container.innerHTML = '';
  for (const s of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg' + (s.id === current ? ' active' : '');
    b.textContent = s.short;
    b.title = s.title ?? `${s.label}${s.area !== undefined ? ` · ${s.area} m²` : ''}`;
    b.addEventListener('click', () => onPick(s.id));
    container.appendChild(b);
  }
}

function change(mutate) {
  mutate(state);
  state = normaliseState(state);
  const type = headsail(state.head.type);
  state.tws = clamp(state.tws, 0, 60);
  state.twd = norm360(state.twd);
  state.hdg = norm360(state.hdg);
  state.main.sheet = clamp(Math.round(state.main.sheet), 0, 90);
  state.head.sheet = clamp(Math.round(state.head.sheet), type.sheetMin, type.sheetMax);
  if (!type.canWindward) state.head.windward = false;
  if (!type.always && !state.inventory[type.id]) {
    state.head.type = 'genoa';
    state.head.size = 'g135';
  }
  checked = false;
  refresh();
}

function setHeadType(id) {
  change((s) => {
    if (s.head.type === id) return;
    const t = headsail(id);
    s.head.type = id;
    s.head.size = t.states[0].id;
    s.head.windward = false;
    // Start from a sensible sheet for the new sail at the current apparent wind.
    const r = evaluate({ ...s, head: { ...s.head, sheet: t.sheetMin } });
    s.head.sheet = r.sails.head ? r.sails.head.optSheet : t.sheetMin;
  });
}

function syncControls() {
  const type = headsail(state.head.type);
  const hs = headState(type.id, state.head.size);
  $('in-tws').value = state.tws;
  $('out-tws').textContent = `${state.tws.toFixed(state.tws < 10 ? 1 : 0)} kn`;
  $('out-tws-sub').textContent = `Bft ${result.beaufort.force} · ${result.beaufort.label}`;
  $('in-twd').value = state.twd;
  $('out-twd').textContent = `${String(Math.round(state.twd)).padStart(3, '0')}° ${compassName(state.twd)}`;
  $('in-hdg').value = state.hdg;
  $('out-hdg').textContent = `${String(Math.round(state.hdg)).padStart(3, '0')}° ${compassName(state.hdg)}`;
  $('out-twa').textContent = `TWA ${result.twaAbs.toFixed(0)}° ${result.tack === 'starboard' ? 'stbd' : 'port'} · ${result.pointOfSail}`;

  buildSegmented($('main-reef'), MAIN_STATES, state.main.reef, (id) => change((s) => { s.main.reef = id; }));
  $('in-main-sheet').value = state.main.sheet;
  $('out-main-sheet').textContent = `${state.main.sheet}°`;
  $('out-main-side').textContent = state.main.reef === 'down' ? 'main is down' : `boom to ${result.tack === 'starboard' ? 'port' : 'starboard'}`;

  const aboard = HEADSAILS.filter((h) => h.always || state.inventory[h.id]).map((h) => ({ id: h.id, short: h.short, title: h.label }));
  buildSegmented($('head-type'), aboard, type.id, setHeadType);
  buildSegmented($('head-size'), type.states, state.head.size, (id) => change((s) => { s.head.size = id; }));
  const slider = $('in-head-sheet');
  slider.min = type.sheetMin;
  slider.max = type.sheetMax;
  slider.value = state.head.sheet;
  $('head-sheet-label').textContent = type.control === 'pole' ? 'Pole angle from the bow' : 'Sheet · clew angle';
  $('out-head-sheet').textContent = `${state.head.sheet}°`;
  const windwardSide = result.tack === 'starboard' ? 'starboard' : 'port';
  const leewardSide = result.tack === 'starboard' ? 'port' : 'starboard';
  let sideText;
  if (hs.area === 0) sideText = `${type.short.toLowerCase()} is ${hs.short.toLowerCase()}`;
  else if (type.control === 'pole') sideText = `pole to ${windwardSide} (windward)`;
  else if (state.head.windward && type.canWindward) sideText = `set to windward (${windwardSide})`;
  else sideText = `set to leeward (${leewardSide})`;
  $('out-head-side').textContent = sideText;
  $('head-windward-row').hidden = !type.canWindward;
  $('in-head-windward').checked = Boolean(state.head.windward);
  const env = [];
  if (type.minAwa > 0 || type.maxAwa < 180) env.push(`flies at ${type.minAwa}–${type.maxAwa}° apparent`);
  if (Number.isFinite(type.maxTws)) env.push(`up to ${type.maxTws} kn true`);
  $('head-envelope').textContent = env.length ? `${type.label}: ${env.join(', ')}.` : `${type.label}: all angles, all winds.`;

  const inv = $('inventory');
  inv.innerHTML = '';
  for (const h of HEADSAILS.filter((x) => !x.always)) {
    const label = document.createElement('label');
    label.className = 'chip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(state.inventory[h.id]);
    cb.addEventListener('change', () => change((s) => { s.inventory[h.id] = cb.checked; }));
    label.appendChild(cb);
    label.appendChild(document.createTextNode(h.label));
    inv.appendChild(label);
  }

  $('in-quiz').checked = quiz;
  $('btn-check').hidden = !quiz;
}

$('in-tws').addEventListener('input', (e) => change((s) => { s.tws = Number(e.target.value); }));
$('in-twd').addEventListener('input', (e) => change((s) => { s.twd = Number(e.target.value); }));
$('in-hdg').addEventListener('input', (e) => change((s) => { s.hdg = Number(e.target.value); }));
$('in-main-sheet').addEventListener('input', (e) => change((s) => { s.main.sheet = Number(e.target.value); }));
$('in-head-sheet').addEventListener('input', (e) => change((s) => { s.head.sheet = Number(e.target.value); }));
$('in-head-windward').addEventListener('change', (e) => change((s) => { s.head.windward = e.target.checked; }));
$('in-quiz').addEventListener('change', (e) => {
  quiz = e.target.checked;
  checked = false;
  refresh();
});
$('btn-check').addEventListener('click', () => {
  checked = true;
  refresh();
});
$('btn-scenario').addEventListener('click', () => {
  const sc = randomScenario();
  change((s) => Object.assign(s, sc));
  flash($('scenario-card'));
});
$('btn-best').addEventListener('click', () => {
  const next = applyRecommended(state);
  change((s) => Object.assign(s, next));
  checked = true;
  refresh();
});
$('btn-reset').addEventListener('click', () => {
  change((s) => Object.assign(s, defaultState(), { inventory: s.inventory }));
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
  const big = e.shiftKey ? 10 : 1;
  const map = {
    ArrowLeft: (s) => { s.hdg -= big; },
    ArrowRight: (s) => { s.hdg += big; },
    ArrowUp: (s) => { s.tws += e.shiftKey ? 5 : 1; },
    ArrowDown: (s) => { s.tws -= e.shiftKey ? 5 : 1; },
    '[': (s) => { s.main.sheet -= big; },
    ']': (s) => { s.main.sheet += big; },
    ',': (s) => { s.head.sheet -= big; },
    '.': (s) => { s.head.sheet += big; },
  };
  if (map[e.key]) {
    e.preventDefault();
    change(map[e.key]);
  } else if (e.key === 'n') {
    $('btn-scenario').click();
  } else if (e.key === 'c') {
    if (quiz) $('btn-check').click();
  }
});

function flash(node) {
  node.classList.remove('flash');
  void node.offsetWidth;
  node.classList.add('flash');
}

// ---------------------------------------------------------------------------
// Readouts, coach, legend
// ---------------------------------------------------------------------------

function renderReadouts() {
  const r = result;
  $('ro-tws').textContent = r.tws.toFixed(r.tws < 10 ? 1 : 0);
  $('ro-twd').textContent = `${String(Math.round(r.twd)).padStart(3, '0')}° ${compassName(r.twd)} · Bft ${r.beaufort.force}`;
  $('ro-aws').textContent = r.aws.toFixed(r.aws < 10 ? 1 : 0);
  $('ro-awa').textContent = r.twaAbs < 30 ? 'in irons' : `${r.awaAbs.toFixed(0)}° ${r.tack === 'starboard' ? 'stbd' : 'port'}`;
  $('ro-pos').textContent = r.pointOfSail;
  $('ro-twa').textContent = `TWA ${r.twaAbs.toFixed(0)}° · ${r.tack} tack`;
  $('ro-bsp').textContent = r.speed.toFixed(1);
  $('ro-pol').textContent = `target ${r.polarSpeed.toFixed(1)} kn`;
  $('ro-vmg').textContent = Math.abs(r.vmg).toFixed(1);
  $('ro-vmg-sub').textContent = r.vmg >= 0 ? 'upwind' : 'downwind';
  $('ro-heel').textContent = `${r.heel.toFixed(0)}°`;
  const bar = $('heel-bar');
  bar.style.width = `${clamp((r.heel / 45) * 100, 0, 100)}%`;
  bar.dataset.level = r.heel > 30 ? 'bad' : r.heel > 24 ? 'warn' : 'ok';
  $('ro-tws-tile').style.setProperty('--accent', windCss(r.tws));
  $('ro-aws-tile').style.setProperty('--accent', windCss(r.aws));

  $('scenario-text').textContent = `${r.tws.toFixed(r.tws < 10 ? 1 : 0)} kn from ${compassName(r.twd)} (${String(Math.round(r.twd)).padStart(3, '0')}°), heading ${String(Math.round(r.hdg)).padStart(3, '0')}° — ${r.pointOfSail.toLowerCase()} on ${r.tack} tack.`;
}

const ICONS = { good: '✓', info: 'i', warn: '!', bad: '✕' };

function renderCoach() {
  const show = !quiz || checked;
  const list = $('feedback');
  const placeholder = $('coach-placeholder');
  const ring = $('score-ring');
  const num = $('score-num');
  const label = $('score-label');
  const circumference = 2 * Math.PI * 44;
  list.innerHTML = '';
  if (!show) {
    placeholder.hidden = false;
    ring.style.strokeDashoffset = circumference;
    ring.style.stroke = 'rgba(255,255,255,0.25)';
    num.textContent = '?';
    label.textContent = 'Quiz mode';
    $('coach-summary').textContent = 'Set your sails for the conditions, then press Check my trim.';
    $('score-parts').innerHTML = '';
    return;
  }
  placeholder.hidden = true;
  const s = result.score.total;
  ring.style.strokeDashoffset = circumference * (1 - s / 100);
  ring.style.stroke = s >= 85 ? '#5fc06a' : s >= 60 ? '#e2b84a' : '#ea5f52';
  num.textContent = String(s);
  label.textContent = s >= 90 ? 'Excellent' : s >= 75 ? 'Good' : s >= 55 ? 'Needs work' : s >= 30 ? 'Poor' : 'Dangerous';
  const rec = result.recommended;
  const recType = headsail(rec.head.type);
  const trims = [];
  if (rec.mainSheet !== null) trims.push(`main ${rec.mainSheet}°`);
  if (rec.headSheet !== null) trims.push(recType.control === 'pole' ? `pole ${rec.headSheet}°` : `${recType.short.toLowerCase()} ${rec.headSheet}°${rec.headWindward ? ' to windward' : ''}`);
  $('coach-summary').textContent = `Recommended here: ${rec.name.toLowerCase()}${trims.length ? `, ${trims.join(', ')}` : ''}. Target speed ${rec.speed.toFixed(1)} kn, you make ${result.speed.toFixed(1)} kn.`;
  for (const f of result.feedback) {
    const li = document.createElement('li');
    li.className = `fb fb-${f.severity}`;
    li.innerHTML = `<span class="fb-icon">${ICONS[f.severity]}</span><div><div class="fb-title">${f.title}</div><div class="fb-detail">${f.detail}</div></div>`;
    list.appendChild(li);
  }
  const parts = [['Course', result.score.course], ['Sail plan', result.score.plan], ['Main', result.score.main], ['Headsail', result.score.head]];
  $('score-parts').innerHTML = parts
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `<span class="part" data-level="${v >= 85 ? 'ok' : v >= 60 ? 'warn' : 'bad'}">${k} <b>${v}</b></span>`)
    .join('');
}

function renderLegend() {
  const max = 50;
  $('legend-bar').style.background = legendGradient(max);
  const ticks = $('legend-ticks');
  ticks.innerHTML = '';
  for (let k = 0; k <= max; k += 5) {
    const t = document.createElement('span');
    t.style.left = `${(100 * k) / max}%`;
    t.textContent = k;
    ticks.appendChild(t);
  }
}
function updateLegendMarker() {
  $('legend-marker').style.left = `${clamp((100 * result.tws) / 50, 0, 100)}%`;
}

let cheatKey = '';
function renderCheatSheet() {
  const key = JSON.stringify(state.inventory);
  if (key === cheatKey) return;
  cheatKey = key;
  const body = $('cheat-body');
  const cols = [45, 90, 135, 175];
  body.innerHTML = '';
  for (let tws = 5; tws <= 45; tws += 5) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${tws} kn</th>` + cols.map((twa) => {
      const p = recommend(tws, twa, state.inventory);
      const m = mainState(p.main);
      const t = headsail(p.head.type);
      const hs = headState(p.head.type, p.head.size);
      const headText = hs.area === 0 ? '—' : t.states.length > 2 ? `${t.short} ${hs.short}` : t.short;
      return `<td>${m.area ? m.short : '—'} / ${headText}</td>`;
    }).join('');
    body.appendChild(tr);
  }
}

function refresh() {
  result = evaluate(state);
  syncControls();
  renderReadouts();
  renderCoach();
  renderCheatSheet();
  updateLegendMarker();
  saveState();
}

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------

let last = performance.now();
function loop(now) {
  const dt = now - last;
  last = now;
  particles.frame(dt, { tws: state.tws, twd: state.twd }, now);
  scene.update(result, state, { ghost: !quiz || checked }, now);
  requestAnimationFrame(loop);
}

renderLegend();
refresh();
requestAnimationFrame(loop);
