// Bridges (issue #96: "they're not Jesus"). Nobody wades through the streams or the lake. Wherever a route crosses a stream, a bridge is built across it, and every walk that would
// go through water is re-planned around the water, over a bridge where it must cross (findPath: A* over a raster of the water in which the bridge decks are dry), with any waypoint
// that sits in the water moved onto the bank (nearestDry). Pure functions on numbers and arrays (no three.js), so they are unit-tested in node. main.js builds the planks and does the routing.
//   x, z are world ground coordinates (the viewer's ground plane: city x, y); heights are metres above the ground.

export const BRIDGE = { width: 7, rise: 2.2, landing: 9, steps: 12, thick: 0.7, rail: 1.4, margin: 1.5 };

/** The height of the deck at fraction s (0..1) along the bridge: an arch, level with the ground at both ends. */
export const deckHeight = (s, rise = BRIDGE.rise) => rise * Math.sin(Math.PI * Math.min(1, Math.max(0, s)));

/**
 * A raster of where the water is: cells of `cell` metres over [minX, maxX] x [minZ, maxZ]. streams: arrays of [x, z, halfWidth] samples along each stream
 * (dense enough that neighbouring discs overlap); lake: { box: [x0, z0, x1, z1], test(x, z) } or null. get(x, z) is true on water, false elsewhere (and outside the raster).
 */
export function makeWetGrid({ minX, minZ, maxX, maxZ, cell = 2, streams = [], lake = null }) {
  const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1, g = new Uint8Array(nx * nz);
  const ix = x => Math.floor((x - minX) / cell), iz = z => Math.floor((z - minZ) / cell);
  for (const s of streams) for (const [x, z, hw] of s) {
    const r = Math.ceil(hw / cell) + 1, cx = ix(x), cz = iz(z);
    for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      if (Math.hypot(minX + i * cell + cell / 2 - x, minZ + j * cell + cell / 2 - z) <= hw) g[i * nz + j] = 1;
    }
  }
  if (lake) {
    const [x0, z0, x1, z1] = lake.box;
    for (let i = Math.max(0, ix(x0)); i <= Math.min(nx - 1, ix(x1)); i++) for (let j = Math.max(0, iz(z0)); j <= Math.min(nz - 1, iz(z1)); j++)
      if (lake.test(minX + i * cell + cell / 2, minZ + j * cell + cell / 2)) g[i * nz + j] = 1;
  }
  return { cell, get: (x, z) => { const i = ix(x), j = iz(z); return i >= 0 && j >= 0 && i < nx && j < nz && g[i * nz + j] === 1; } };
}

/** Does the straight segment a -> b (points [x, z]) touch water? */
export function wetOnSegment(grid, a, b, step = 2) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / step));
  for (let k = 0; k <= n; k++) { const t = k / n; if (grid.get(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return true; }
  return false;
}

/** The stretches of the segment a -> b that are under water, as [{ t0, t1 }] fractions of its length. */
export function wetStretches(grid, a, b, step = 2) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / step)), out = []; let start = -1;
  for (let k = 0; k <= n; k++) {
    const t = k / n, wet = grid.get(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (wet && start < 0) start = t; if ((!wet || k === n) && start >= 0) { out.push({ t0: start, t1: wet ? t : (k - 1) / n }); start = -1; }
  }
  return out;
}

/** Where a stream runs at the point near (x, z): the nearest sample of the stream, its direction there (unit tx, tz) and half width. */
export function streamFrame(samples, x, z) {
  let bi = 0, bd = Infinity;
  samples.forEach(([sx, sz], i) => { const d = Math.hypot(sx - x, sz - z); if (d < bd) { bd = d; bi = i; } });
  const p = samples[Math.max(0, bi - 3)], q = samples[Math.min(samples.length - 1, bi + 3)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  return { x: samples[bi][0], z: samples[bi][1], tx: (q[0] - p[0]) / l, tz: (q[1] - p[1]) / l, hw: samples[bi][2], dist: bd };
}

/** A bridge across a stream at the frame's point: laid across the stream (at right angles to it), long enough to land on dry ground at both ends. */
export function makeBridge(frame, grid, landing = BRIDGE.landing) {
  const nx = -frame.tz, nz = frame.tx;                                   // across the stream
  let half = frame.hw + landing;
  for (let k = 0; k < 8 && (grid.get(frame.x + nx * half, frame.z + nz * half) || grid.get(frame.x - nx * half, frame.z - nz * half)); k++) half += 4;   // land on dry ground
  const P = [frame.x - nx * half, frame.z - nz * half], Q = [frame.x + nx * half, frame.z + nz * half], L = 2 * half;
  return { C: [frame.x, frame.z], P, Q, L, dir: [nx, nz], yaw: Math.atan2(-nz, nx), half };
}

/** The height of the deck under (x, z), or 0 when it is not on a bridge. */
export function deckHeightAt(bridges, x, z) {
  for (const br of bridges) {
    const ux = br.Q[0] - br.P[0], uz = br.Q[1] - br.P[1], dx = x - br.P[0], dz = z - br.P[1], s = (dx * ux + dz * uz) / (br.L * br.L);
    if (s < 0 || s > 1) continue;
    if (Math.abs(dx * -uz / br.L + dz * ux / br.L) <= BRIDGE.width / 2) return deckHeight(s);
  }
  return 0;
}

/** Is (x, z) on a bridge's deck (within half its width of the axis, between its ends)? */
export function onDeck(bridges, x, z) {
  for (const br of bridges) {
    const ux = br.Q[0] - br.P[0], uz = br.Q[1] - br.P[1], dx = x - br.P[0], dz = z - br.P[1], s = (dx * ux + dz * uz) / (br.L * br.L);
    if (s >= 0 && s <= 1 && Math.abs(dx * -uz / br.L + dz * ux / br.L) <= BRIDGE.width / 2) return true;
  }
  return false;
}

/** Can a person stand at (x, z): dry ground, or a bridge deck? */
export const passable = (grid, bridges, x, z) => !grid.get(x, z) || onDeck(bridges, x, z);

/** The nearest passable point to (x, z) within maxR metres (searching in growing rings), or null. A point that is already passable is returned as it is. */
export function nearestDry(grid, bridges, x, z, maxR = 40, step = 2) {
  if (passable(grid, bridges, x, z)) return [x, z];
  for (let r = step; r <= maxR; r += step) {
    let best = null, bd = Infinity;
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (passable(grid, bridges, px, pz) && r < bd) { bd = r; best = [px, pz]; } }
    if (best) return best;
  }
  return null;
}

function lineClear(grid, bridges, a, b, free = 6, step = 1.5) {   // the segment a -> b stays on passable ground (the first and last `free` metres are forgiven: a person may start or end in the water's edge)
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / step));
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, d = t * len;
    if (d > free && len - d > free && !passable(grid, bridges, x, z)) return false;
  }
  return true;
}

/**
 * The shortest way from a to b ([x, z] each) that stays out of the water and crosses it only on a bridge deck, as a list of points starting at a and ending at b; null when there is no such
 * way. A* over cells of `cell` metres in the box around a and b (padded by `pad`), 8 neighbours with no corner cutting, then straightened wherever the way is clear.
 */
export function findPath(grid, bridges, a, b, { cell = 3, pad = 80, maxCells = 450000 } = {}) {
  const ox = Math.min(a[0], b[0]) - pad, oz = Math.min(a[1], b[1]) - pad, nx = Math.ceil((Math.abs(a[0] - b[0]) + 2 * pad) / cell) + 1, nz = Math.ceil((Math.abs(a[1] - b[1]) + 2 * pad) / cell) + 1;
  if (nx * nz > maxCells) return null;
  const memo = new Int8Array(nx * nz), idx = (i, j) => i * nz + j, cx = i => ox + i * cell, cz = j => oz + j * cell;
  const ok = (i, j) => { if (i < 0 || j < 0 || i >= nx || j >= nz) return false; const k = idx(i, j); if (!memo[k]) memo[k] = passable(grid, bridges, cx(i), cz(j)) ? 1 : 2; return memo[k] === 1; };
  const cellOf = p => [Math.round((p[0] - ox) / cell), Math.round((p[1] - oz) / cell)];
  const snap = ([i, j]) => { if (ok(i, j)) return [i, j]; for (let r = 1; r <= 14; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && ok(i + di, j + dj)) return [i + di, j + dj]; return null; };
  const s0 = snap(cellOf(a)), g0 = snap(cellOf(b)); if (!s0 || !g0) return null;
  const g = new Float32Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1), heap = [], closed = new Uint8Array(nx * nz);
  const h = (i, j) => Math.hypot(i - g0[0], j - g0[1]) * cell, push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  g[idx(s0[0], s0[1])] = 0; push(h(s0[0], s0[1]), idx(s0[0], s0[1]));
  const goal = idx(g0[0], g0[1]); let found = false;
  while (heap.length) {
    const [, k] = pop(); if (closed[k]) continue; closed[k] = 1; if (k === goal) { found = true; break; }
    const i = Math.floor(k / nz), j = k % nz;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (!ok(ni, nj)) continue;
      if (di && dj && (!ok(i + di, j) || !ok(i, j + dj))) continue;
      const nk = idx(ni, nj), ng = g[k] + (di && dj ? 1.4142 : 1) * cell; if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(ng + h(ni, nj), nk); }
    }
  }
  if (!found) return null;
  const cells = []; for (let k = goal; k >= 0; k = from[k]) cells.push([cx(Math.floor(k / nz)), cz(k % nz)]); cells.reverse();
  const pts = [a, ...cells, b];
  const out = [pts[0]]; let i = 0;                                     // straighten: from each point, jump to the farthest one that can be reached in a straight, clear line
  while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !lineClear(grid, bridges, pts[i], pts[j])) j--; out.push(pts[j]); i = j; }
  return out;
}

/** Adds the deck height to a path: [[x, z], ...] becomes [[x, z, h], ...], with a point at least every `maxStep` metres wherever the way is on or beside a bridge so people follow the arch. */
export function withHeights(points, bridges, maxStep = 3) {
  const near = (x, z) => onDeck(bridges, x, z), out = [];
  for (let k = 0; k < points.length; k++) {
    const [x, z] = points[k];
    if (k > 0) { const [px, pz] = points[k - 1], len = Math.hypot(x - px, z - pz); if (len > maxStep && (near(px, pz) || near(x, z) || near((px + x) / 2, (pz + z) / 2))) { const n = Math.ceil(len / maxStep); for (let m = 1; m < n; m++) { const t = m / n, qx = px + (x - px) * t, qz = pz + (z - pz) * t; out.push([qx, qz, deckHeightAt(bridges, qx, qz)]); } } }
    out.push([x, z, deckHeightAt(bridges, x, z)]);
  }
  return out;
}
