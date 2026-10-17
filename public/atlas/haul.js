// Ore carriers on the town side of the mountain (decoration, not people in the data): a zigzag path up the slope and the cycle one carrier walks on it.
// Pure functions, so the test can run them without a browser.

// a lower point a and an upper point b ([x, z] each) joined by a path that swings from side to side `legs` half-waves, `amp` metres either way; n + 1 points
export function zigzag(a, b, amp = 8, legs = 3, n = 36) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1, px = -dz / len, pz = dx / len;
  return Array.from({ length: n + 1 }, (_, i) => { const f = i / n, w = Math.sin(f * Math.PI * legs) * amp; return [a[0] + dx * f + px * w, a[1] + dz * f + pz * w]; });
}

export const lengths = poly => { const cum = [0]; for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1])); return cum; };

// the point at distance s along the path (clamped), and the unit direction of travel up the path there
export function pointAt(poly, cum, s) {
  const total = cum[cum.length - 1], d = Math.min(total, Math.max(0, s));
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const a = poly[i - 1], b = poly[i], seg = cum[i] - cum[i - 1] || 1, f = (d - cum[i - 1]) / seg, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, fx: (b[0] - a[0]) / l, fz: (b[1] - a[1]) / l };
}

// one carrier's round trip, in metres of "walking clock": up empty, load at the top (pause), down carrying, tip at the bottom (pause).
// Returns s = distance along the path, up = walking uphill, carry = holds a lump, moving = legs swing, dist = metres walked so far this round (for the leg phase)
export function cycle(clock, len, pause = 6) {
  const round = 2 * (len + pause), c = ((clock % round) + round) % round;
  if (c < len) return { s: c, up: true, carry: false, moving: true, dist: c };
  if (c < len + pause) return { s: len, up: true, carry: c > len + pause * 0.4, moving: false, dist: len };
  if (c < 2 * len + pause) return { s: len - (c - len - pause), up: false, carry: true, moving: true, dist: c - pause };
  return { s: 0, up: false, carry: c < 2 * len + pause * 1.6, moving: false, dist: 2 * len };
}
