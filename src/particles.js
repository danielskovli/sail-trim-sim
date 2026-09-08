// Animated wind particle layer (windy.com style streaks) on a full-window canvas.
import { windCss } from './palette.js';

export function createParticles(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let dpr = 1;
  let particles = [];

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
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const count = Math.floor((w * h) / 650);
    particles = Array.from({ length: count }, () => spawn({}));
  }

  window.addEventListener('resize', resize);
  resize();

  /**
   * @param {number} dt milliseconds since the previous frame
   * @param {{tws:number, twd:number}} wind true wind (knots, degrees FROM)
   * @param {number} t elapsed ms
   */
  function frame(dt, wind, t) {
    const step = Math.min(3, dt / 16.7);
    // Fade the previous frame to leave trails.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
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
