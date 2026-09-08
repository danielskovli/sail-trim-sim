// Top-down SVG scene: compass ring, no-go wedge, true/apparent wind arrows and the boat.
// Also owns direct manipulation: drag the wind arrow, the bow/hull and the sail clews.
import { rad, deg, norm180, norm360, clamp, mainState, headsail, headState, BOAT } from './model.js';
import { t, nfKn, mainLabel, mainShort, sailName, headStateLabel, headStateShort } from './i18n.js';
import { windCss } from './palette.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent = null) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const text = (attrs, content, parent) => {
  const t = el('text', attrs, parent);
  t.textContent = content;
  return t;
};
/** Unit vector for a compass-style bearing in SVG coordinates (y down). */
const dir = (bearing) => ({ x: Math.sin(rad(bearing)), y: -Math.cos(rad(bearing)) });
/** Compass-style bearing of a vector in SVG coordinates. */
const bearingOf = (x, y) => norm360(deg(Math.atan2(x, -y)));
const fmt3 = (d) => String(Math.round(norm360(d))).padStart(3, '0');

const HULL = { bowY: -165, sternY: 152, mastY: -38, halfBeam: 52 };
const R_RING = 400;
const MAIN_FOOT_FULL = 130;
// Snap radii used while dragging the main clew: distance from the mast → reef state.
const MAIN_DRAG_R = { full: 130, r1: 110, r2: 90, r3: 70, down: 42 };
// Headsail geometry: where it tacks down, foot length per state, snap radii for dragging.
const HEAD_GEOM = {
  genoa: { tack: { x: 0, y: HULL.bowY + 8 }, foot: { g135: 172, g100: 128, g70: 92, g40: 56, furled: 0 }, dragR: { g135: 172, g100: 138, g70: 104, g40: 72, furled: 40 }, camber: 1 },
  jib: { tack: { x: 0, y: HULL.bowY + 8 }, foot: { j100: 128, j70: 92, j40: 56, furled: 0 }, dragR: { j100: 128, j70: 96, j40: 64, furled: 36 }, camber: 1 },
  storm: { tack: { x: 0, y: HULL.bowY + 42 }, foot: { set: 62, down: 0 }, dragR: { set: 62, down: 28 }, camber: 0.8 },
  code0: { tack: { x: 0, y: HULL.bowY - 14 }, foot: { set: 205, furled: 0 }, dragR: { set: 205, furled: 60 }, camber: 1.5 },
  asym: { tack: { x: 0, y: HULL.bowY - 18 }, foot: { set: 240, down: 0 }, dragR: { set: 240, down: 70 }, camber: 2.0 },
  sym: { tack: { x: 0, y: HULL.mastY }, pole: 117, foot: 215, dragR: { set: 117, down: 45 }, camber: 2.6 },
};
const SNAP_MARGIN = 6;
// A clew drag only starts reefing/furling once the pointer has moved this far radially
// from where it grabbed, so an arc drag for sheet angle never changes sail area by accident.
const RADIAL_INTENT = 12;

/**
 * @param {SVGSVGElement} svg
 * @param {{
 *   onWindDirection?: (twd:number)=>void,
 *   onHeading?: (hdg:number)=>void,
 *   onMain?: (v:{sheet:number, reef:string})=>void,
 *   onHead?: (v:{sheet:number, size:string, windward:boolean})=>void,
 * }} handlers
 */
export function createScene(svg, handlers = {}) {
  svg.setAttribute('viewBox', '-540 -540 1080 1080');

  const defs = el('defs', {}, svg);
  const hullGrad = el('linearGradient', { id: 'hullGrad', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
  el('stop', { offset: '0', 'stop-color': '#d5dbe3' }, hullGrad);
  el('stop', { offset: '0.5', 'stop-color': '#f4f6f9' }, hullGrad);
  el('stop', { offset: '1', 'stop-color': '#c9d0d9' }, hullGrad);

  // --- Compass ring ----------------------------------------------------------
  const gCompass = el('g', { class: 'compass' }, svg);
  el('circle', { cx: 0, cy: 0, r: R_RING, class: 'ring' }, gCompass);
  el('circle', { cx: 0, cy: 0, r: R_RING - 120, class: 'ring faint' }, gCompass);
  el('circle', { cx: 0, cy: 0, r: R_RING - 240, class: 'ring faint' }, gCompass);
  for (let b = 0; b < 360; b += 5) {
    const major = b % 30 === 0;
    const mid = b % 10 === 0;
    const len = major ? 22 : mid ? 14 : 7;
    const d = dir(b);
    el('line', {
      x1: d.x * (R_RING - len), y1: d.y * (R_RING - len), x2: d.x * R_RING, y2: d.y * R_RING,
      class: major ? 'tick major' : 'tick',
    }, gCompass);
    if (major && b % 90 !== 0) {
      text({ x: d.x * (R_RING - 42), y: d.y * (R_RING - 42), class: 'deg', 'text-anchor': 'middle', dy: '0.35em' }, fmt3(b), gCompass);
    }
  }
  for (const [b, label] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const d = dir(b);
    text({ x: d.x * (R_RING + 34), y: d.y * (R_RING + 34), class: 'cardinal', 'text-anchor': 'middle', dy: '0.35em' }, t(`cardinal.${label}`), gCompass);
  }

  // --- No-go zone (rotates with the true wind) --------------------------------
  const gNoGo = el('g', {}, svg);
  const rw = R_RING - 4;
  const a = dir(-30);
  const b = dir(30);
  el('path', {
    class: 'nogo',
    d: `M 0 0 L ${a.x * rw} ${a.y * rw} A ${rw} ${rw} 0 0 1 ${b.x * rw} ${b.y * rw} Z`,
  }, gNoGo);
  for (const s of [-45, 45]) {
    const d = dir(s);
    el('line', { x1: d.x * 60, y1: d.y * 60, x2: d.x * rw, y2: d.y * rw, class: 'layline' }, gNoGo);
    text({ x: d.x * (rw - 30), y: d.y * (rw - 30), class: 'layline-label', 'text-anchor': 'middle' }, '45°', gNoGo);
  }
  text({ x: 0, y: -R_RING + 64, class: 'nogo-label', 'text-anchor': 'middle' }, t('scene.nogo'), gNoGo);

  // --- True wind arrow -----------------------------------------------------------
  const gTrue = el('g', {}, svg);
  const twLine = el('line', { x1: 0, y1: -518, x2: 0, y2: -438, class: 'tw-line' }, gTrue);
  const twHead = el('polygon', { points: '-14,-446 14,-446 0,-414', class: 'tw-head' }, gTrue);
  const twHandle = el('circle', { cx: 0, cy: -462, r: 58, class: 'handle', 'data-hint': 'drag: wind direction' }, gTrue);
  const twLabelBg = el('rect', { class: 'label-bg', rx: 6 }, svg);
  const twLabel = text({ class: 'tw-label', 'text-anchor': 'middle', dy: '0.35em' }, '', svg);

  // --- Boat ------------------------------------------------------------------------
  const gBoat = el('g', { class: 'boat' }, svg);
  const { bowY, sternY, mastY, halfBeam } = HULL;
  const mastPt = { x: 0, y: mastY };
  const shadow = el('path', { class: 'wind-shadow' }, gBoat);
  const hull = el('path', {
    class: 'hull',
    d: `M 0 ${bowY}
        C ${halfBeam * 0.55} ${bowY + 70} ${halfBeam} ${-10} ${halfBeam} ${55}
        C ${halfBeam} ${105} ${halfBeam * 0.86} ${sternY} ${halfBeam * 0.6} ${sternY}
        L ${-halfBeam * 0.6} ${sternY}
        C ${-halfBeam * 0.86} ${sternY} ${-halfBeam} ${105} ${-halfBeam} ${55}
        C ${-halfBeam} ${-10} ${-halfBeam * 0.55} ${bowY + 70} 0 ${bowY} Z`,
  }, gBoat);
  el('rect', { class: 'deck cabin', x: -30, y: -70, width: 60, height: 105, rx: 14 }, gBoat);
  el('rect', { class: 'deck cockpit', x: -24, y: 48, width: 48, height: 74, rx: 10 }, gBoat);
  el('circle', { class: 'wheel', cx: 0, cy: 112, r: 9 }, gBoat);
  el('line', { class: 'forestay', x1: 0, y1: mastY, x2: 0, y2: bowY + 4 }, gBoat);
  const bowsprit = el('line', { class: 'bowsprit', x1: 0, y1: bowY + 2, x2: 0, y2: bowY - 20, visibility: 'hidden' }, gBoat);

  // Snap rings shown while dragging a clew.
  const gSnapMain = el('g', { class: 'snap', visibility: 'hidden' }, gBoat);
  const gSnapHead = el('g', { class: 'snap', visibility: 'hidden' }, gBoat);
  const snapLabels = { main: {}, head: {} };
  for (const [id, r] of Object.entries(MAIN_DRAG_R)) {
    el('circle', { cx: mastPt.x, cy: mastPt.y, r, class: 'snap-ring' }, gSnapMain);
    snapLabels.main[id] = text({ class: 'snap-label', 'text-anchor': 'middle', dy: '0.35em' }, mainLabel(id), gSnapMain);
  }
  let snapHeadType = null;
  function buildHeadSnap(typeId) {
    if (snapHeadType === typeId) return;
    snapHeadType = typeId;
    gSnapHead.innerHTML = '';
    snapLabels.head = {};
    const g = HEAD_GEOM[typeId];
    const origin = g.tack;
    for (const [id, r] of Object.entries(g.dragR)) {
      el('circle', { cx: origin.x, cy: origin.y, r, class: 'snap-ring' }, gSnapHead);
      snapLabels.head[id] = text({ class: 'snap-label', 'text-anchor': 'middle', dy: '0.35em' }, headStateLabel(typeId, id), gSnapHead);
    }
  }

  const gHead = el('g', {}, gBoat);
  const headGhost = el('line', { class: 'ghost' }, gHead);
  const headSail = el('path', { class: 'sail head' }, gHead);
  const headFoot = el('line', { class: 'foot' }, gHead);
  const pole = el('line', { class: 'pole', visibility: 'hidden' }, gHead);

  const gMain = el('g', {}, gBoat);
  const mainGhost = el('line', { class: 'ghost' }, gMain);
  const mainSail = el('path', { class: 'sail main' }, gMain);
  const boom = el('line', { class: 'boom' }, gMain);
  el('circle', { class: 'mast', cx: 0, cy: mastY, r: 7 }, gBoat);

  const gAwa = el('g', {}, gBoat);
  const awLine = el('line', { x1: 0, y1: -190, x2: 0, y2: -80, class: 'aw-line' }, gAwa);
  const awHead = el('polygon', { points: '-10,-88 10,-88 0,-64', class: 'aw-head' }, gAwa);
  const awLabel = text({ class: 'aw-label', 'text-anchor': 'middle', dy: '0.35em' }, '', gAwa);

  const hdgLabel = text({ class: 'hdg-label', 'text-anchor': 'middle' }, '', gBoat);
  const mainBadge = text({ class: 'badge', 'text-anchor': 'middle', dy: '0.35em' }, '', gBoat);
  const headBadge = text({ class: 'badge', 'text-anchor': 'middle', dy: '0.35em' }, '', gBoat);

  // Drag handles (on top of everything in the boat group).
  const bowHandle = el('circle', { cx: 0, cy: bowY - 6, r: 36, class: 'handle', 'data-hint': 'drag: heading' }, gBoat);
  const headHandle = el('circle', { r: 30, class: 'handle clew', 'data-hint': 'drag: headsail sheet / furl' }, gBoat);
  const mainHandle = el('circle', { r: 30, class: 'handle clew', 'data-hint': 'drag: main sheet / reef' }, gBoat);

  // Floating readout while dragging.
  const dragBg = el('rect', { class: 'drag-bg', rx: 6, visibility: 'hidden' }, svg);
  const dragText = text({ class: 'drag-text', visibility: 'hidden' }, '', svg);

  // Downwind the sail works as a drag device: separated flow is the normal, healthy state.
  const dragMode = (sail, awaAbs) => awaAbs > 135 && sail.alpha > 20;

  // Camber is time-dependent (flutter) in the collapsed, luffing, blanketed and soft states below,
  // so only then does the scene need a redraw on every frame.
  const flutters = (sail) => Boolean(sail) && (sail.collapsed || sail.alpha < 9 || (sail.factor !== undefined && sail.factor < 0.5));

  function camberFor(sail, awaAbs, t) {
    if (!sail) return 0.11;
    if (sail.collapsed) return 0.04 * Math.sin(t * 0.012);
    if (sail.alpha <= 2) return 0.06 * Math.sin(t * 0.02);
    if (sail.factor !== undefined && sail.factor < 0.5) return 0.05 + 0.04 * Math.sin(t * 0.014);
    if (sail.alpha < 9) return 0.07 + 0.025 * Math.sin(t * 0.016);
    if (dragMode(sail, awaAbs)) return 0.16;
    if (sail.regime === 'attached') return 0.11;
    if (sail.regime === 'stalling') return 0.145;
    return 0.175;
  }

  function sailState(sail, awaAbs) {
    if (!sail) return '';
    if (sail.overLimit) return 'danger';
    if (sail.collapsed || sail.alpha <= 2) return 'luffing';
    if (sail.factor !== undefined && sail.factor < 0.5) return 'blanketed';
    if (sail.alpha < 9) return 'soft';
    if (dragMode(sail, awaAbs)) return 'drawing';
    if (sail.regime === 'attached') return 'drawing';
    if (sail.regime === 'stalling') return 'stalling';
    return 'stalled';
  }

  /** Draw a sail between two points with the belly on `bellySign` side of the tack→clew direction. */
  function drawSailBetween(path, foot, tack, clew, camber, bellySign) {
    const dx = clew.x - tack.x;
    const dy = clew.y - tack.y;
    const chord = Math.hypot(dx, dy) || 1;
    const d = { x: dx / chord, y: dy / chord };
    const n = { x: -d.y * bellySign, y: d.x * bellySign };
    const mid = { x: (tack.x + clew.x) / 2, y: (tack.y + clew.y) / 2 };
    const ctrl = { x: mid.x + n.x * camber * chord * 2, y: mid.y + n.y * camber * chord * 2 };
    path.setAttribute('d', `M ${tack.x} ${tack.y} Q ${ctrl.x} ${ctrl.y} ${clew.x} ${clew.y} Z`);
    foot.setAttribute('x1', tack.x); foot.setAttribute('y1', tack.y);
    foot.setAttribute('x2', clew.x); foot.setAttribute('y2', clew.y);
  }

  /** Draw a sail from `tack` along `bearing` with the belly on `bellySign` side. Returns the clew. */
  function drawSail(path, foot, tack, bearing, chord, camber, bellySign) {
    if (chord <= 0) {
      path.setAttribute('d', '');
      foot.setAttribute('x1', 0); foot.setAttribute('y1', 0); foot.setAttribute('x2', 0); foot.setAttribute('y2', 0);
      return null;
    }
    const d = dir(bearing);
    const clew = { x: tack.x + d.x * chord, y: tack.y + d.y * chord };
    drawSailBetween(path, foot, tack, clew, camber, bellySign);
    return clew;
  }

  function drawGhost(line, from, bearing, length, show) {
    if (!show || length <= 0) {
      line.setAttribute('visibility', 'hidden');
      return;
    }
    const d = dir(bearing);
    line.setAttribute('visibility', 'visible');
    line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
    line.setAttribute('x2', from.x + d.x * length); line.setAttribute('y2', from.y + d.y * length);
  }

  const place = (node, p) => {
    node.setAttribute('cx', p.x);
    node.setAttribute('cy', p.y);
  };
  const setLine = (line, p1, p2) => {
    line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
  };

  let lastR = null;
  let lastState = null;
  let lastGhost = null;

  /**
   * @param {object} r evaluate() result
   * @param {object} state current state (normalised)
   * @param {{ghost:boolean}} opts
   * @param {number} now elapsed ms (drives luffing flutter)
   * @returns {boolean} true while a sail flutters, i.e. the scene wants another frame
   */
  function update(r, stateIn, opts, now) {
    const animating = flutters(r.sails.main) || flutters(r.sails.head);
    // Redraw only when something changed or a sail is fluttering. Rewriting every SVG attribute
    // on every frame kept the compositor busy with the boat sitting perfectly still.
    if (r === lastR && opts.ghost === lastGhost && !animating) return false;
    const state = r.state ?? stateIn;
    lastR = r;
    lastState = state;
    lastGhost = opts.ghost;
    const { hdg, twd, tws, twa, awa, aws } = r;
    gNoGo.setAttribute('transform', `rotate(${twd})`);
    gTrue.setAttribute('transform', `rotate(${twd})`);
    const twColor = windCss(tws);
    twLine.setAttribute('stroke', twColor);
    twHead.setAttribute('fill', twColor);
    {
      const d = dir(twd);
      const p = { x: d.x * 478, y: d.y * 478 };
      const perp = { x: -d.y, y: d.x };
      const lx = p.x + perp.x * 58;
      const ly = p.y + perp.y * 58;
      twLabel.setAttribute('x', lx);
      twLabel.setAttribute('y', ly);
      twLabel.textContent = t('scene.true', { tws: nfKn(tws), twd: fmt3(twd) });
      const bw = 150;
      twLabelBg.setAttribute('x', lx - bw / 2); twLabelBg.setAttribute('y', ly - 13);
      twLabelBg.setAttribute('width', bw); twLabelBg.setAttribute('height', 26);
    }

    gBoat.setAttribute('transform', `rotate(${hdg})`);
    const sideSign = twa >= 0 ? 1 : -1; // +1: sails to port (wind from starboard)

    // Main
    const mainArea = mainState(state.main.reef).area;
    const mainChord = mainArea > 0 ? MAIN_FOOT_FULL * Math.sqrt(mainArea / 45) : 0;
    const mainBearing = 180 + sideSign * (r.sails.main ? r.sails.main.sheet : state.main.sheet);
    const mainClew = drawSail(mainSail, boom, mastPt, mainBearing, mainChord, camberFor(r.sails.main, r.awaAbs, now), sideSign);
    mainSail.dataset.state = sailState(r.sails.main, r.awaAbs);
    drawGhost(mainGhost, mastPt, 180 + sideSign * (r.sails.main ? r.sails.main.optSheet : 0), mainChord,
      opts.ghost && r.sails.main && Math.abs(r.sails.main.optSheet - r.sails.main.sheet) >= 3);
    place(mainHandle, mainClew ?? mastPt);
    mainHandle.classList.toggle('empty', !mainClew);

    // Headsail
    const type = headsail(state.head.type);
    const geom = HEAD_GEOM[type.id];
    const hs = headState(type.id, state.head.size);
    const headSailR = r.sails.head;
    const sheet = headSailR ? headSailR.sheet : state.head.sheet;
    buildHeadSnap(type.id);
    bowsprit.setAttribute('visibility', type.id === 'code0' || type.id === 'asym' ? 'visible' : 'hidden');
    headSail.dataset.type = type.id;
    let headClew = null;
    let handleAt;
    if (type.control === 'pole') {
      pole.setAttribute('visibility', hs.area > 0 ? 'visible' : 'hidden');
      if (hs.area > 0) {
        const poleDir = dir(sideSign * sheet);
        const poleEnd = { x: mastPt.x + poleDir.x * geom.pole, y: mastPt.y + poleDir.y * geom.pole };
        const belly = dir(sideSign * (sheet - 90));
        const centre = { x: mastPt.x + poleDir.x * 20 + belly.x * 110, y: mastPt.y + poleDir.y * 20 + belly.y * 110 };
        const half = geom.foot / 2;
        const tackK = { x: centre.x + poleDir.x * half, y: centre.y + poleDir.y * half };
        const clewK = { x: centre.x - poleDir.x * half, y: centre.y - poleDir.y * half };
        // Belly points along `belly` (away from the pole side); with tack→clew = -poleDir, that is the -1 side.
        drawSailBetween(headSail, headFoot, tackK, clewK, camberFor(headSailR, r.awaAbs, now) * geom.camber * 0.5, -1);
        setLine(pole, mastPt, poleEnd);
        headClew = poleEnd;
        handleAt = poleEnd;
        drawGhost(headGhost, mastPt, sideSign * (headSailR ? headSailR.optSheet : sheet), geom.pole,
          opts.ghost && headSailR && Math.abs(headSailR.optSheet - headSailR.sheet) >= 3);
      } else {
        headSail.setAttribute('d', '');
        setLine(headFoot, { x: 0, y: 0 }, { x: 0, y: 0 });
        drawGhost(headGhost, mastPt, 0, 0, false);
        handleAt = { x: 0, y: mastY - 40 };
      }
    } else {
      pole.setAttribute('visibility', 'hidden');
      const chord = geom.foot[hs.id] ?? 0;
      const ww = Boolean(state.head.windward) && type.canWindward;
      const side = ww ? -sideSign : sideSign;
      const bearing = 180 + side * sheet;
      headClew = drawSail(headSail, headFoot, geom.tack, bearing, chord, camberFor(headSailR, r.awaAbs, now) * geom.camber, side);
      if (headSailR) {
        const optSide = headSailR.optWindward ? -sideSign : sideSign;
        drawGhost(headGhost, geom.tack, 180 + optSide * headSailR.optSheet, chord,
          opts.ghost && (Math.abs(headSailR.optSheet - headSailR.sheet) >= 3 || headSailR.optWindward !== ww));
      } else {
        drawGhost(headGhost, geom.tack, 180, 0, false);
      }
      handleAt = headClew ?? { x: geom.tack.x, y: geom.tack.y + 34 };
    }
    headSail.dataset.state = sailState(headSailR, r.awaAbs);
    place(headHandle, handleAt);
    headHandle.classList.toggle('empty', !headClew);

    // Wind shadow to leeward (only when sails are up and drawing)
    if (mainArea + hs.area > 0 && r.twaAbs > 30) {
      const d = dir(180 + awa); // downwind direction in boat frame
      const len = 260;
      const spread = 70;
      const c = { x: 0, y: mastY + 30 };
      const perp = { x: -d.y, y: d.x };
      shadow.setAttribute('d', `M ${c.x + perp.x * 40} ${c.y + perp.y * 40}
        L ${c.x + d.x * len + perp.x * spread} ${c.y + d.y * len + perp.y * spread}
        L ${c.x + d.x * len - perp.x * spread} ${c.y + d.y * len - perp.y * spread}
        L ${c.x - perp.x * 40} ${c.y - perp.y * 40} Z`);
      shadow.setAttribute('visibility', 'visible');
    } else {
      shadow.setAttribute('visibility', 'hidden');
    }

    // Apparent wind arrow at the masthead
    gAwa.setAttribute('transform', `translate(0 ${mastY}) rotate(${awa})`);
    const awColor = windCss(aws);
    awLine.setAttribute('stroke', awColor);
    awHead.setAttribute('fill', awColor);
    awLabel.setAttribute('x', 0);
    awLabel.setAttribute('y', -212);
    awLabel.setAttribute('transform', `rotate(${-(awa + hdg)} 0 -212)`);
    awLabel.textContent = r.twaAbs < 30
      ? t('scene.app_irons', { aws: nfKn(aws) })
      : t('scene.app', { aws: nfKn(aws), awa: Math.abs(awa).toFixed(0), side: t(awa >= 0 ? 'tack.starboard.short' : 'tack.port.short') });

    // Labels
    hdgLabel.setAttribute('x', 0);
    hdgLabel.setAttribute('y', bowY - 26);
    hdgLabel.setAttribute('transform', `rotate(${-hdg} 0 ${bowY - 26})`);
    hdgLabel.textContent = t('scene.hdg', { hdg: fmt3(hdg) });

    const placeBadge = (badge, at, from, label) => {
      let x;
      let y;
      if (!at) {
        x = from.x;
        y = from.y + 26;
      } else {
        const dx = at.x - from.x;
        const dy = at.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        x = at.x + (dx / len) * 22;
        y = at.y + (dy / len) * 22;
      }
      badge.setAttribute('x', x);
      badge.setAttribute('y', y);
      badge.setAttribute('transform', `rotate(${-hdg} ${x} ${y})`);
      badge.textContent = label;
    };
    placeBadge(mainBadge, mainClew, mastPt, `${sailName('main')} ${mainShort(state.main.reef)}`);
    const headLabel = type.states.length > 2
      ? `${sailName(type.id)} ${headStateShort(type.id, hs.id)}`
      : hs.area > 0 ? sailName(type.id) : `${sailName(type.id)} ${headStateShort(type.id, hs.id).toLowerCase()}`;
    placeBadge(headBadge, headClew, geom.tack, `${headLabel}${state.head.windward && type.canWindward && hs.area > 0 ? ' ↔' : ''}`);

    if (drag) positionSnapLabels(drag.kind, sideSign, hdg);
    return animating;
  }

  // ---------------------------------------------------------------------------
  // Direct manipulation
  // ---------------------------------------------------------------------------

  let drag = null;

  function svgPoint(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  /** World (compass) frame → boat frame. */
  function toBoat(p, hdg) {
    const a = rad(-hdg);
    return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
  }

  /** Nearest snap ring with hysteresis: only leave `current` once clearly closer to another ring. */
  function snapStage(radii, current, d) {
    let best = current;
    let bestDist = Math.abs(d - (radii[current] ?? Infinity)) - SNAP_MARGIN;
    for (const [id, r] of Object.entries(radii)) {
      const dist = Math.abs(d - r);
      if (dist < bestDist) {
        best = id;
        bestDist = dist;
      }
    }
    return best;
  }

  function headOrigin(typeId) {
    return HEAD_GEOM[typeId].tack;
  }

  function positionSnapLabels(kind, sideSign, hdg) {
    if (kind !== 'main' && kind !== 'head') return;
    const type = kind === 'head' ? headsail(lastState.head.type) : null;
    const radii = kind === 'main' ? MAIN_DRAG_R : HEAD_GEOM[type.id].dragR;
    const origin = kind === 'main' ? mastPt : headOrigin(type.id);
    let bearing;
    if (kind === 'head' && type.control === 'pole') bearing = sideSign * 100; // windward side, just aft of abeam
    else {
      const side = kind === 'head' && lastState.head.windward && type.canWindward ? -sideSign : sideSign;
      bearing = 180 + side * 108; // just forward of abeam, clear of the sail's arc
    }
    const d = dir(bearing);
    for (const [id, r] of Object.entries(radii)) {
      const label = snapLabels[kind][id];
      if (!label) continue;
      const x = origin.x + d.x * r;
      const y = origin.y + d.y * r;
      label.setAttribute('x', x);
      label.setAttribute('y', y);
      label.setAttribute('transform', `rotate(${-hdg} ${x} ${y})`);
    }
  }

  function showReadout(p, str) {
    dragText.textContent = str;
    dragText.setAttribute('x', p.x + 26);
    dragText.setAttribute('y', p.y - 22);
    const w = str.length * 9 + 18;
    dragBg.setAttribute('x', p.x + 26 - 9);
    dragBg.setAttribute('y', p.y - 22 - 15);
    dragBg.setAttribute('width', w);
    dragBg.setAttribute('height', 30);
    dragText.setAttribute('visibility', 'visible');
    dragBg.setAttribute('visibility', 'visible');
  }

  function startDrag(kind, evt) {
    if (!lastR || !lastState) return;
    evt.preventDefault();
    evt.stopPropagation();
    const p = svgPoint(evt);
    drag = { kind, pointerId: evt.pointerId, target: evt.currentTarget, radial: false };
    if (kind === 'heading') drag.offset = norm180(lastState.hdg - bearingOf(p.x, p.y));
    if (kind === 'main' || kind === 'head') {
      const bp = toBoat(p, lastR.hdg);
      const origin = kind === 'main' ? mastPt : headOrigin(lastState.head.type);
      drag.startD = Math.hypot(bp.x - origin.x, bp.y - origin.y);
    }
    if (kind === 'main') gSnapMain.setAttribute('visibility', 'visible');
    if (kind === 'head') gSnapHead.setAttribute('visibility', 'visible');
    try {
      evt.currentTarget.setPointerCapture(evt.pointerId);
    } catch {
      /* not all targets support capture */
    }
    document.body.classList.add('dragging');
    svg.classList.add('dragging');
    positionSnapLabels(kind, lastR.twa >= 0 ? 1 : -1, lastR.hdg);
    moveDrag(evt);
  }

  function moveDrag(evt) {
    if (!drag || evt.pointerId !== drag.pointerId) return;
    evt.preventDefault();
    const p = svgPoint(evt);
    const r = lastR;
    const s = lastState;
    const sideSign = r.twa >= 0 ? 1 : -1;
    switch (drag.kind) {
      case 'wind': {
        const twd = Math.round(bearingOf(p.x, p.y)) % 360;
        handlers.onWindDirection?.(twd);
        showReadout(p, t('drag.wind', { d: fmt3(twd) }));
        break;
      }
      case 'heading': {
        const hdg = Math.round(norm360(bearingOf(p.x, p.y) + drag.offset)) % 360;
        handlers.onHeading?.(hdg);
        showReadout(p, t('drag.heading', { d: fmt3(hdg) }));
        break;
      }
      case 'main': {
        const bp = toBoat(p, r.hdg);
        const dx = bp.x - mastPt.x;
        const dy = bp.y - mastPt.y;
        const raw = Math.abs(norm180(bearingOf(dx, dy) - 180));
        const pointerSide = dx < 0 ? 1 : -1; // +1 = port
        const sheet = pointerSide === sideSign ? clamp(Math.round(raw), BOAT.mainSheetMin, BOAT.mainSheetMax) : 0;
        const d = Math.hypot(dx, dy);
        drag.radial ||= Math.abs(d - drag.startD) >= RADIAL_INTENT; // latch: once you pull, you stay in reefing mode
        const reef = drag.radial ? snapStage(MAIN_DRAG_R, s.main.reef, d) : s.main.reef;
        handlers.onMain?.({ sheet, reef });
        showReadout(p, reef === 'down' ? t('drag.main_down') : t('drag.main', { s: sheet, reef: mainLabel(reef) }));
        break;
      }
      case 'head': {
        const type = headsail(s.head.type);
        const geom = HEAD_GEOM[type.id];
        const bp = toBoat(p, r.hdg);
        const origin = geom.tack;
        const dx = bp.x - origin.x;
        const dy = bp.y - origin.y;
        const d = Math.hypot(dx, dy);
        drag.radial ||= Math.abs(d - drag.startD) >= RADIAL_INTENT;
        const size = drag.radial ? snapStage(geom.dragR, s.head.size, d) : s.head.size;
        const st = headState(type.id, size);
        if (type.control === 'pole') {
          const off = Math.abs(norm180(bearingOf(dx, dy))); // angle from the bow
          const pointerSide = dx < 0 ? 1 : -1;
          const sheet = pointerSide === -sideSign ? clamp(Math.round(off), type.sheetMin, type.sheetMax) : 0;
          handlers.onHead?.({ sheet, size, windward: false });
          showReadout(p, st.area === 0 ? t('drag.doused', { sail: sailName(type.id) }) : t('drag.pole', { p: sheet }));
        } else {
          const raw = Math.abs(norm180(bearingOf(dx, dy) - 180));
          const pointerSide = dx < 0 ? 1 : -1;
          let windward = Boolean(s.head.windward) && type.canWindward;
          if (type.canWindward && raw >= type.sheetMin && Math.abs(dx) > 6) windward = pointerSide !== sideSign;
          const sheet = clamp(Math.round(raw), type.sheetMin, type.sheetMax);
          handlers.onHead?.({ sheet, size, windward });
          const stateText = type.states.length > 2 ? ` · ${headStateShort(type.id, st.id)}` : '';
          showReadout(p, st.area === 0
            ? `${sailName(type.id)} ${headStateShort(type.id, st.id).toLowerCase()}`
            : `${sailName(type.id)} ${sheet}°${stateText}${windward ? t('drag.windward') : ''}`);
        }
        break;
      }
      default:
        break;
    }
  }

  function endDrag(evt) {
    if (!drag || (evt && evt.pointerId !== drag.pointerId)) return;
    try {
      drag.target.releasePointerCapture(drag.pointerId);
    } catch {
      /* ignore */
    }
    drag = null;
    gSnapMain.setAttribute('visibility', 'hidden');
    gSnapHead.setAttribute('visibility', 'hidden');
    dragText.setAttribute('visibility', 'hidden');
    dragBg.setAttribute('visibility', 'hidden');
    document.body.classList.remove('dragging');
    svg.classList.remove('dragging');
  }

  twHandle.addEventListener('pointerdown', (e) => startDrag('wind', e));
  bowHandle.addEventListener('pointerdown', (e) => startDrag('heading', e));
  hull.addEventListener('pointerdown', (e) => startDrag('heading', e));
  mainHandle.addEventListener('pointerdown', (e) => startDrag('main', e));
  headHandle.addEventListener('pointerdown', (e) => startDrag('head', e));
  svg.addEventListener('pointermove', moveDrag);
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', () => endDrag());

  return { update, isDragging: () => drag !== null };
}
