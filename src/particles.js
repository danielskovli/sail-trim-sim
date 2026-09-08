// Animated wind particle layer (windy.com style streaks) on a full-window canvas.
// The streaks are part of the picture, so they always run, but cheaply: the canvas renders at CSS
// resolution rather than device pixels, caps the particle count and draws at most 30 times a second.
// The browser already pauses requestAnimationFrame while the tab is hidden. Do not put
// backdrop-filter panels over it: every panel would have to be re-blurred on each frame it changes.
import { windCss } from './palette.js';

const FRAME_MS = 1000 / 30;
const MAX_PARTICLES = 1500;
const PIXELS_PER_PARTICLE = 650;

export function createParticles(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let particles = [];
  let lastDraw = -Infinity;

  function spawn(p) {
    p.x = Math.random() * w;
    p.y = Math.random() * h;
    p.age = 0;
    p.life = 80 + Math.random() * 160;
    p.jitter = (Math.random() - 0.5) * 0.18; // radians of static direction scatter
    p.phase = Math.random() * Math.PI * 2;
    return p;
  }

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    // One canvas pixel per CSS pixel on purpose: a Retina-sized backing store doubled the per-frame work.
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const count = Math.min(MAX_PARTICLES, Math.floor((w * h) / PIXELS_PER_PARTICLE));
    particles = Array.from({ length: count }, () => spawn({}));
  }

  window.addEventListener('resize', resize);
  resize();

  /**
   * Draw one frame if one is due. Call on every animation frame; the layer throttles itself.
   * @param {{tws:number, twd:number}} wind true wind (knots, degrees FROM)
   * @param {number} t elapsed ms
   */
  function frame(wind, t) {
    const dt = t - lastDraw;
    if (dt < FRAME_MS - 4) return; // tolerate rAF jitter so a 60 Hz display lands on every second frame
    lastDraw = t;
    const step = Math.min(3, dt / 16.7); // motion per draw scales with the time it covers

    // Fade the previous frame to leave trails; the same trail length per second at any frame rate.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = `rgba(0,0,0,${Math.pow(0.9, step).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    const tws = Math.max(0, wind.tws);
    const speed = (0.25 + tws * 0.13) * step;
    const base = ((wind.twd + 180) * Math.PI) / 180; // direction the air moves TOWARDS
    const wobble = Math.sin(t * 0.0006) * 0.06;

    ctx.strokeStyle = windCss(tws, 0.75);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const p of particles) {
      const a = base + p.jitter + Math.sin(t * 0.001 + p.phase) * 0.05 + wobble;
      const nx = p.x + Math.sin(a) * speed;
      const ny = p.y - Math.cos(a) * speed;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      p.x = nx;
      p.y = ny;
      p.age += step;
      if (p.age > p.life || nx < -10 || nx > w + 10 || ny < -10 || ny > h + 10) spawn(p);
    }
    ctx.stroke();
  }

  return { frame, resize };
}
