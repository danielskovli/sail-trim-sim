// Windy-style wind speed palette (stops in knots).
const STOPS = [
  [0, [98, 113, 183]],
  [2, [57, 97, 159]],
  [6, [74, 148, 169]],
  [10, [77, 141, 123]],
  [14, [83, 165, 83]],
  [17, [53, 159, 53]],
  [21, [167, 157, 81]],
  [25, [159, 127, 58]],
  [29, [161, 108, 92]],
  [33, [129, 58, 78]],
  [37, [175, 80, 136]],
  [41, [117, 74, 147]],
  [47, [109, 97, 163]],
  [55, [125, 68, 165]],
  [65, [231, 215, 215]],
];

export function windColor(kn) {
  if (kn <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [k1, c1] = STOPS[i];
    if (kn <= k1) {
      const [k0, c0] = STOPS[i - 1];
      const t = (kn - k0) / (k1 - k0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export const windCss = (kn, alpha = 1) => {
  const [r, g, b] = windColor(kn);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
};

/** CSS linear-gradient stops for a legend spanning 0..max knots. */
export function legendGradient(max = 50) {
  const parts = STOPS.filter(([k]) => k <= max).map(([k, [r, g, b]]) => `rgb(${r},${g},${b}) ${(100 * k) / max}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
