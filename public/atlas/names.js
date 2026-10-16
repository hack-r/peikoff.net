// Name labels for /names: pure helpers (no DOM, no three.js) so they can be tested.
// `cands` are people already projected to the screen: { i, sx, sy, dist } (pixels, distance from the camera).
// Pick the nearest ones first, at most `max`, and drop any label that would overlap one already chosen.
export function chooseLabels(cands, { max = 40, w = 110, h = 18 } = {}) {
  const out = [];
  for (const c of [...cands].sort((a, b) => a.dist - b.dist || a.i - b.i)) {
    if (out.length >= max) break;
    if (out.some(o => Math.abs(o.sx - c.sx) < w && Math.abs(o.sy - c.sy) < h)) continue;
    out.push(c);
  }
  return out;
}

// Is the point (sx, sy) inside a w x h screen, with a margin?
export const onScreen = (sx, sy, w, h, margin = 0) => sx >= -margin && sy >= -margin && sx <= w + margin && sy <= h + margin;
