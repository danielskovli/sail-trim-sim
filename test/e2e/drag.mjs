// End-to-end checks of the direct-manipulation layer: drive the app in headless Chrome over the
// DevTools protocol, perform real pointer drags and verify the resulting state.
// Requires a local Chrome/Chromium (set CHROME=/path/to/binary to override the default).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']
    .find((p) => existsSync(p));
if (!CHROME) {
  console.log('SKIP: no Chrome binary found (set CHROME=/path/to/chrome)');
  process.exit(0);
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = `${HERE}out/`;
await mkdir(OUT, { recursive: true });
const PORT = 5199;
const CDP_PORT = 9333;
const URL_ = `http://localhost:${PORT}/?tws=14&twd=320&hdg=10&main=full:10&head=genoa:g135:12`;

const server = spawn('node', [`${ROOT}serve.mjs`, String(PORT)], { stdio: 'ignore' });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${HERE}chrome-profile`, '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' });
const killAll = () => {
  try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
  try { server.kill('SIGKILL'); } catch { /* ignore */ }
};
process.on('exit', killAll);
setTimeout(() => { console.error('TIMEOUT'); killAll(); process.exit(2); }, 90000).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error('timed out waiting');
}
await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok);
const targets = await waitFor(async () => {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  return list.some((t) => t.type === 'page') ? list : null;
});
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.navigate', { url: URL_ });
await sleep(1500);

const readState = () => evaluate(`JSON.parse(localStorage.getItem('sail-trim-sim.v1'))`);
const screenOf = (selector, x, y) => evaluate(`(() => {
  const svg = document.getElementById('scene');
  const node = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'svg'};
  const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
  const s = pt.matrixTransform(node.getScreenCTM());
  return [s.x, s.y];
})()`);
const centerOf = (selector) => evaluate(`(() => {
  const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
})()`);
const boatPoint = (bearing, radius, originY) => screenOf('g.boat',
  radius * Math.sin((bearing * Math.PI) / 180), originY - radius * Math.cos((bearing * Math.PI) / 180));
const shoot = async (name) => {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${OUT}${name}`, Buffer.from(shot.data, 'base64'));
};

async function drag(from, to, { steps = 12, shotAt = null, shotName = null } = {}) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0], y: from[1] });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await sleep(16);
    if (shotAt === i && shotName) await shoot(shotName);
  }
  if (shotAt === 'end' && shotName) await shoot(shotName);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button: 'left', clickCount: 1 });
  await sleep(60);
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
};
const MAST_Y = -38;
const TACK_Y = -157;

// 1. Wind arrow: drag from its current handle to the east (bearing 090 on radius 462).
{
  const from = await centerOf('[data-hint="drag: wind direction"]');
  const to = await screenOf(null, 462, 0);
  await drag(from, to);
  const s = await readState();
  check('wind arrow drag sets direction', Math.abs(s.twd - 90) <= 1, `twd=${s.twd}`);
}

// 2. Bow: drag the bow handle to bearing 045 → heading 045.
{
  const from = await centerOf('[data-hint="drag: heading"]');
  const to = await screenOf(null, 190 * Math.SQRT1_2, -190 * Math.SQRT1_2);
  await drag(from, to);
  const s = await readState();
  check('bow drag sets heading', Math.abs(s.hdg - 45) <= 2, `hdg=${s.hdg}`);
}

// Now wind 090, heading 045 → wind from starboard (twa +45), sails to port.
// 3. Main clew: drag to the port side at 40° off the stern, on the reef-1 ring.
{
  const from = await centerOf('[data-hint="drag: main sheet / reef"]');
  const to = await boatPoint(180 + 40, 110, MAST_Y);
  await drag(from, to, { steps: 14, shotAt: 'end', shotName: 'drag-main.png' });
  const s = await readState();
  check('main clew drag sets sheet ~40°', Math.abs(s.main.sheet - 40) <= 2, `sheet=${s.main.sheet}`);
  check('main clew pulled in to the reef-1 ring reefs', s.main.reef === 'r1', `reef=${s.main.reef}`);
}

// 4. Genoa clew: drag across to the STARBOARD (windward) side at 80° → wing-on-wing, still 135 %.
{
  const from = await centerOf('[data-hint="drag: headsail sheet / furl"]');
  const to = await boatPoint(180 - 80, 172, TACK_Y);
  await drag(from, to, { steps: 16 });
  const s = await readState();
  check('genoa dragged across sets windward', s.head.windward === true, `windward=${s.head.windward}`);
  check('genoa sheet ~80°', Math.abs(s.head.sheet - 80) <= 2, `sheet=${s.head.sheet}`);
  check('genoa size unchanged at full radius', s.head.size === 'g135', `size=${s.head.size}`);
}

// 5. Genoa: drag clew back to leeward and in to the 70 % ring at 20°.
{
  const from = await centerOf('[data-hint="drag: headsail sheet / furl"]');
  const to = await boatPoint(180 + 20, 104, TACK_Y);
  await drag(from, to, { steps: 16, shotAt: 12, shotName: 'drag-genoa.png' });
  const s = await readState();
  check('genoa back to leeward', s.head.windward === false, `windward=${s.head.windward}`);
  check('genoa furled to 70 %', s.head.size === 'g70', `size=${s.head.size}`);
}

// 6. Main: drag clew all the way in to the mast → dropped; then drag out again → hoists.
{
  const from = await centerOf('[data-hint="drag: main sheet / reef"]');
  const to = await screenOf('g.boat', -20, MAST_Y - 20);
  await drag(from, to, { steps: 16 });
  let s = await readState();
  check('main pulled to the mast drops it', s.main.reef === 'down', `reef=${s.main.reef}`);
  const from2 = await centerOf('[data-hint="drag: main sheet / reef"]');
  const to2 = await boatPoint(200, 130, MAST_Y);
  await drag(from2, to2, { steps: 16 });
  s = await readState();
  check('dragging the empty handle out hoists full main', s.main.reef === 'full', `reef=${s.main.reef} sheet=${s.main.sheet}`);
}

// 7. Arc drag for sheet angle only (radius held at the full ring ± 8 px) must not reef.
{
  const from = await centerOf('[data-hint="drag: main sheet / reef"]');
  const pts = [];
  for (let i = 1; i <= 12; i++) {
    const bearing = 180 + 20 + (i * 45) / 12; // 20° → 65°
    const rr = 130 + (i % 2 ? 8 : -8); // wobble radially like a human hand
    pts.push(await boatPoint(bearing, rr, MAST_Y));
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0], y: from[1] });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', clickCount: 1 });
  for (const [x, y] of pts) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await sleep(16);
  }
  const last = pts[pts.length - 1];
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last[0], y: last[1], button: 'left', clickCount: 1 });
  await sleep(60);
  const s = await readState();
  check('arc drag with ±8 px radial wobble keeps full main', s.main.reef === 'full', `reef=${s.main.reef}`);
  check('arc drag ends at ~65° sheet', Math.abs(s.main.sheet - 65) <= 2, `sheet=${s.main.sheet}`);
}

// 8. Wheel over the chart changes wind speed.
{
  const before = (await readState()).tws;
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1000, y: 300, deltaX: 0, deltaY: -120 });
  await sleep(100);
  const after = (await readState()).tws;
  check('wheel up increases wind speed', after > before, `${before} → ${after}`);
}

// 9. Legend bar click sets wind speed.
{
  const [x, y] = await evaluate(`(() => { const r = document.getElementById('legend-wrap').getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + 8]; })()`);
  await drag([x, y], [x, y], { steps: 1 });
  const s = await readState();
  check('legend click sets wind ~25 kn', Math.abs(s.tws - 25) <= 1, `tws=${s.tws}`);
}

// 10. Symmetric spinnaker: switch type via the panel, then drag the pole end to 60° on the windward side.
{
  await evaluate(`(() => { const b = [...document.querySelectorAll('#head-type .seg')].find((x) => x.textContent === 'Sym'); b.click(); return true; })()`);
  await evaluate(`(() => { document.getElementById('in-hdg').value = 200; document.getElementById('in-hdg').dispatchEvent(new Event('input')); document.getElementById('in-tws').value = 12; document.getElementById('in-tws').dispatchEvent(new Event('input')); return true; })()`);
  await sleep(100);
  let s = await readState();
  check('headsail type switches to sym via the panel', s.head.type === 'sym' && s.head.size === 'set', `type=${s.head.type} size=${s.head.size}`);
  // wind 090 → heading 200 → twa = -110 (port tack): windward is port, i.e. -x in the boat frame → bearing -60.
  const from = await centerOf('[data-hint="drag: headsail sheet / furl"]');
  const to = await boatPoint(-60, 117, MAST_Y);
  await drag(from, to, { steps: 14, shotAt: 'end', shotName: 'drag-pole.png' });
  s = await readState();
  check('pole drag sets pole angle ~60°', Math.abs(s.head.sheet - 60) <= 2, `pole=${s.head.sheet}`);
  check('pole drag keeps the kite flying', s.head.size === 'set', `size=${s.head.size}`);
}

const errors = events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
check('no runtime exceptions or error logs', errors.length === 0, errors.map((e) => JSON.stringify(e.params).slice(0, 300)).join(' | ') || 'clean');

await shoot('final.png');
ws.close();
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
