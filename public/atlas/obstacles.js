// What people must not walk through, and how they walk round it. Pure geometry (no browser objects), so it is unit-tested in node.
//
// An obstacle is a circle (a prop, a chair) or an oriented rectangle (a building, a cottage, a house, the villa, a hall) on the ground plane, with `p`, the margin a walker keeps from it
// (the body radius). Coordinates are the viewer's ground plane: x, z (the city's x, y). Everything is built once into a grid; a command asks for a detour only for a leg that touches
// something, and every frame the walker's position is pushed out of anything it has drifted into (pushOut), so "never through" holds even when people curve round each other.
//
// A leg may start or end inside an obstacle (out of the door of a building, in at the door of a house, off one's own chair): exemptFor() lists those, and they are ignored for that leg.

const EPS = 1e-6;

/** A set of obstacles with a cell index. */
export class Obstacles {
  constructor(cell = 32) { this.cell = cell; this.list = []; this.cells = new Map(); this.stats = { detours: 0, failed: 0 }; }

  /** An oriented rectangle: centre (cx, cz), unit axis (ux, uz), half extents hu along the axis and hw across it. tag/meta are for callers. */
  addRect(cx, cz, ux, uz, hu, hw, p, tag, meta = {}) {
    const ex = Math.abs(ux) * hu + Math.abs(uz) * hw, ez = Math.abs(uz) * hu + Math.abs(ux) * hw;
    return this._add({ kind: 'rect', cx, cz, ux, uz, hu, hw, p, tag, ...meta, bb: [cx - ex, cz - ez, cx + ex, cz + ez] });
  }
  addCircle(x, z, r, p, tag, meta = {}) { return this._add({ kind: 'circle', cx: x, cz: z, r, p, tag, ...meta, bb: [x - r, z - r, x + r, z + r] }); }
  _add(o) { o.id = this.list.length; this.list.push(o); this._index(o); return o; }
  _index(o) {
    const c = this.cell, r = o.p + 1;
    for (let i = Math.floor((o.bb[0] - r) / c); i <= Math.floor((o.bb[2] + r) / c); i++) for (let j = Math.floor((o.bb[1] - r) / c); j <= Math.floor((o.bb[3] + r) / c); j++) {
      const k = i * 100003 + j; let a = this.cells.get(k); if (!a) this.cells.set(k, a = []); a.push(o);
    }
  }

  /** Obstacles whose cells touch the box [x0, z0, x1, z1]. */
  query(x0, z0, x1, z1) {
    const c = this.cell, seen = new Set(), out = [];
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const a = this.cells.get(i * 100003 + j); if (a) for (const o of a) if (!seen.has(o.id)) { seen.add(o.id); out.push(o); }
    }
    return out;
  }

  /** Is (x, z) inside the obstacle grown by `grow` (default its own margin)? */
  inside(o, x, z, grow = o.p) {
    if (o.kind === 'circle') return Math.hypot(x - o.cx, z - o.cz) < o.r + grow - EPS;
    const dx = x - o.cx, dz = z - o.cz, du = dx * o.ux + dz * o.uz, dw = -dx * o.uz + dz * o.ux;
    return Math.abs(du) < o.hu + grow - EPS && Math.abs(dw) < o.hw + grow - EPS;
  }

  /** Does the segment a -> b enter the obstacle grown by `grow` (default its own margin)? */
  hits(o, ax, az, bx, bz, grow = o.p) {
    if (o.kind === 'circle') {
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = l2 < EPS ? 0 : Math.max(0, Math.min(1, ((o.cx - ax) * dx + (o.cz - az) * dz) / l2));
      return Math.hypot(ax + dx * t - o.cx, az + dz * t - o.cz) < o.r + grow - 1e-4;
    }
    const hu = o.hu + grow - 1e-4, hw = o.hw + grow - 1e-4, ax_ = ax - o.cx, az_ = az - o.cz, bx_ = bx - o.cx, bz_ = bz - o.cz;
    const u0 = ax_ * o.ux + az_ * o.uz, w0 = -ax_ * o.uz + az_ * o.ux, u1 = bx_ * o.ux + bz_ * o.uz, w1 = -bx_ * o.uz + bz_ * o.ux;
    let t0 = 0, t1 = 1;                                                    // Liang-Barsky against the box
    for (const [p, q] of [[-(u1 - u0), u0 + hu], [u1 - u0, hu - u0], [-(w1 - w0), w0 + hw], [w1 - w0, hw - w0]]) {
      if (Math.abs(p) < EPS) { if (q <= 0) return false; continue; }
      const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return t0 < t1 - 1e-9;
  }

  /** Ids of the obstacles the leg a -> b starts or ends in (grown by their margin): those are not obstacles for this leg. */
  exemptFor(a, b, extra = null) {
    const ex = new Set(extra || []);
    for (const pt of [a, b]) for (const o of this.query(pt[0] - 2, pt[1] - 2, pt[0] + 2, pt[1] + 2)) if (this.inside(o, pt[0], pt[1], o.p + 0.05)) ex.add(o.id);
    return ex;
  }

  /** Which obstacles does the segment run through (those not in `ex`)? */
  blockers(ax, az, bx, bz, ex = null) {
    const out = [];
    for (const o of this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz))) if (!(ex && ex.has(o.id)) && this.hits(o, ax, az, bx, bz)) out.push(o);
    return out;
  }

  /** Move (x, z) out of every obstacle it is inside (grown by `grow` beyond the margin: 0 = just the margin), except those in `ex`. */
  pushOut(x, z, ex = null, grow = 0) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const o of this.query(x - 1, z - 1, x + 1, z + 1)) {
        if (ex && ex.has(o.id)) continue; const g = o.p + grow; if (!this.inside(o, x, z, g)) continue;
        if (o.kind === 'circle') { let dx = x - o.cx, dz = z - o.cz, d = Math.hypot(dx, dz); if (d < 1e-6) { dx = 1; dz = 0; d = 1; } const R = o.r + g + 1e-3; x = o.cx + dx / d * R; z = o.cz + dz / d * R; }
        else {
          const dx = x - o.cx, dz = z - o.cz, du = dx * o.ux + dz * o.uz, dw = -dx * o.uz + dz * o.ux, pu = o.hu + g - Math.abs(du), pw = o.hw + g - Math.abs(dw);
          let nu = du, nw = dw; if (pu < pw) nu = (du < 0 ? -1 : 1) * (o.hu + g + 1e-3); else nw = (dw < 0 ? -1 : 1) * (o.hw + g + 1e-3);
          x = o.cx + nu * o.ux - nw * o.uz; z = o.cz + nu * o.uz + nw * o.ux;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  }
}

function corners(o) {   // the points a path bends at: just outside the grown rectangle's corners, or round the grown circle
  if (o.kind === 'circle') { const R = (o.r + o.p) / Math.cos(Math.PI / 8) + 0.05, out = []; for (let k = 0; k < 8; k++) { const t = (k + 0.5) * Math.PI / 4; out.push([o.cx + Math.cos(t) * R, o.cz + Math.sin(t) * R]); } return out; }
  const hu = o.hu + o.p + 0.05, hw = o.hw + o.p + 0.05, out = [];
  for (const [su, sw] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) out.push([o.cx + o.ux * hu * su - o.uz * hw * sw, o.cz + o.uz * hu * su + o.ux * hw * sw]);
  return out;
}

/**
 * The shortest way from a to b ([x, z] each) that keeps out of the obstacles (except those in `ex`) and stays where `walkable(x, z)` is true (water, mountains): [a, ..., b], just [a, b] when the
 * straight way is clear, null when there is none. A* over the corners of the obstacles near the way (a visibility graph), straightened wherever the way is clear.
 */
export function detour(obs, a, b, { ex = null, walkable = null, window = 24, maxNodes = 400 } = {}) {
  const wet = (p, q) => {                                                  // does the straight way p -> q leave walkable ground? (the first and last 4 m of a leg are forgiven: it may begin in the water's edge)
    if (!walkable) return false; const len = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(len / 1.5));
    for (let k = 0; k <= n; k++) { const t = k / n, d = t * len; if (d > 4 && len - d > 4 && !walkable(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)) return true; }
    return false;
  };
  const blocked0 = obs.blockers(a[0], a[1], b[0], b[1], ex);
  if (!blocked0.length) return [a, b];
  obs.stats.detours++;
  let x0 = Math.min(a[0], b[0]) - window, z0 = Math.min(a[1], b[1]) - window, x1 = Math.max(a[0], b[0]) + window, z1 = Math.max(a[1], b[1]) + window, rel = [];
  for (let pass = 0; pass < 2; pass++) {                                   // the obstacles near the way, then those near their corners
    rel = obs.query(x0, z0, x1, z1).filter(o => !(ex && ex.has(o.id)));
    for (const o of rel) for (const c of corners(o)) { if (c[0] < x0) x0 = c[0] - 2; if (c[0] > x1) x1 = c[0] + 2; if (c[1] < z0) z0 = c[1] - 2; if (c[1] > z1) z1 = c[1] + 2; }
  }
  rel = obs.query(x0, z0, x1, z1).filter(o => !(ex && ex.has(o.id)));
  const nodes = [a, b], seg = (p, q) => { for (const o of rel) if (obs.hits(o, p[0], p[1], q[0], q[1])) return false; return !wet(p, q); };
  const cand = [];
  for (const o of rel) for (const c of corners(o)) {
    if (rel.some(q => q !== o && obs.inside(q, c[0], c[1], q.p - 0.02)) || (walkable && !walkable(c[0], c[1]))) continue;
    const d = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]); cand.push([d, c]);
  }
  cand.sort((u, v) => u[0] - v[0]); for (const [, c] of cand.slice(0, maxNodes)) nodes.push(c);
  const n = nodes.length, g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n), h = k => Math.hypot(nodes[k][0] - b[0], nodes[k][1] - b[1]);
  g[0] = 0;
  for (;;) {
    let u = -1, bf = Infinity; for (let k = 0; k < n; k++) if (!done[k] && g[k] < Infinity && g[k] + h(k) < bf) { bf = g[k] + h(k); u = k; }
    if (u < 0) break; if (u === 1) break; done[u] = 1;
    for (let v = 1; v < n; v++) {
      if (done[v] || v === u) continue; const d = g[u] + Math.hypot(nodes[v][0] - nodes[u][0], nodes[v][1] - nodes[u][1]);
      if (d >= g[v] || !seg(nodes[u], nodes[v])) continue; g[v] = d; prev[v] = u;
    }
  }
  if (!(g[1] < Infinity)) { obs.stats.failed++; return null; }
  const path = []; for (let k = 1; k >= 0; k = prev[k]) path.push(nodes[k]); path.reverse();
  const out = [path[0]]; let i = 0;                                        // straighten
  while (i < path.length - 1) { let j = path.length - 1; while (j > i + 1 && !seg(path[i], path[j])) j--; out.push(path[j]); i = j; }
  return out;
}

/**
 * Re-plans walking legs ({ a: [x, y, z], b: [x, y, z], len, ride, ... }) so none runs through an obstacle: a leg that touches one is replaced by the legs of its detour. Legs that ride an elevator
 * are left alone. Each leg gets `ex` (the obstacles it starts or ends in, which it may cross) so the per-frame guard knows what to ignore. `extra` = ids exempt for the whole trip (the walker's own chair).
 */
export function avoidLegs(obs, legs, { walkable = null, extra = null, solid = new Set(['cottage', 'prop']) } = {}) {
  for (let k = 1; k < legs.length; k++) {                                  // a waypoint in the open (a street corner) that a cottage or prop stands on is moved off it
    const A = legs[k - 1], L = legs[k]; if (A.ride || L.ride) continue;
    for (const o of obs.query(L.a[0] - 1, L.a[1] - 1, L.a[0] + 1, L.a[1] + 1)) if (solid.has(o.tag) && obs.inside(o, L.a[0], L.a[1], o.p)) {
      const q = obs.pushOut(L.a[0], L.a[1], new Set(obs.list.filter(r => r !== o).map(r => r.id)), 0.3); L.a = [q[0], q[1], L.a[2]]; A.b = [q[0], q[1], A.b[2]]; A.len = Math.hypot(A.b[0] - A.a[0], A.b[1] - A.a[1]); L.len = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]);
    }
  }
  const out = [];
  for (const L of legs) {
    if (L.ride) { out.push(L); continue; }
    const ex = obs.exemptFor(L.a, L.b, extra), path = detour(obs, [L.a[0], L.a[1]], [L.b[0], L.b[1]], { ex, walkable });
    if (!path || path.length <= 2) { L.ex = ex; out.push(L); continue; }
    const lens = []; let tot = 0; for (let k = 0; k + 1 < path.length; k++) { const l = Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]); lens.push(l); tot += l; }
    let run = 0, prevPt = L.a.slice();
    for (let k = 0; k + 1 < path.length; k++) {
      run += lens[k]; const f = tot > 0 ? run / tot : 1, last = k + 2 === path.length;
      const bpt = last ? L.b.slice() : [path[k + 1][0], path[k + 1][1], L.a[2] + (L.b[2] - L.a[2]) * f];
      const len = Math.hypot(bpt[0] - prevPt[0], bpt[1] - prevPt[1]); if (len > 0.01) out.push({ ...L, a: prevPt, b: bpt, len, hold: k === 0 ? L.hold : 0, ex, in: undefined });
      prevPt = bpt;
    }
  }
  return out;
}
