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

// Does a building sign sit between the camera and the focused person? Both are projected to the screen: the sign `s` = { sx, sy, dist, hw, hh } (centre in
// pixels, half width/height in pixels, distance from the camera) and the person `p` = { sx, sy, dist, rx, ry } (the middle of the body and, optionally, its half width and
// half height in pixels; without them the figure is a tall strip of `reach` pixels above and below its point). A sign blocks when it is no farther than the person
// (`slack` absorbs the sign's own depth) and any part of the figure, head to feet, is under it.
export const signBlocks = (s, p, reach = 30, slack = 2) => s.dist < p.dist + slack && Math.abs(p.sx - s.sx) <= s.hw + (p.rx || 0) && p.sy + (p.ry ?? reach) >= s.sy - s.hh && p.sy - (p.ry ?? reach) <= s.sy + s.hh;
