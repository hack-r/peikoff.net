// Walkers must not pass through anyone. Two steps each frame: laneShift picks a sideways offset that starts easing in a few steps before a body is reached (so the walker curves round
// the person, standing, walking or paused with a card open, instead of stopping), and steerAround is the hard guarantee that pushes the final point out of any body still overlapped.
export const bodyRadius = k => Math.max(0.7, 0.5 * k);                       // bodies are drawn k times life size; two centres closer than this overlap

// others: [x, y, z, kind] rows (z = floor height); skip(j) leaves out the walker itself and anyone not drawn; a blocker more than zTol higher or lower (another floor) or in another place (inside vs street) is ignored
export function steerAround(pos, others, radius, heading = 0, skip = () => false, maxPush = radius, zTol = 1) {
  let x = pos[0], y = pos[1];
  const level = (o) => Math.abs(o[2] - pos[2]) < zTol && o[3] === pos[3];
  for (let it = 0; it < 3; it++) {                                              // a few passes so being pushed off one person does not push into the next
    let moved = false;
    for (let j = 0; j < others.length; j++) {
      const o = others[j]; if (skip(j) || !level(o)) continue;
      let ex = x - o[0], ey = y - o[1], d = Math.hypot(ex, ey);
      if (d >= radius) continue;
      if (d < 1e-3) { ex = Math.cos(heading); ey = -Math.sin(heading); d = 1; }   // dead centre: step out to the walker's right
      const push = radius - d; x += ex / d * push; y += ey / d * push; moved = true;
    }
    if (!moved) break;
  }
  const dx = x - pos[0], dy = y - pos[1], n = Math.hypot(dx, dy);
  if (n > maxPush) { x = pos[0] + dx / n * maxPush; y = pos[1] + dy / n * maxPush; }
  return [x, y];
}

// where to be sideways of the walk line (positive = to the walker's left) to pass the nearest body ahead; 0 when the way is clear. dir is the unit direction of travel, dev the current offset.
export function laneShift(pos, dir, others, radius, skip = () => false, dev = 0, bias = 1, look = radius * 3) {
  let best = null, bestAlong = Infinity;
  for (let j = 0; j < others.length; j++) {
    const o = others[j]; if (skip(j) || Math.abs(o[2] - pos[2]) >= 1 || o[3] !== pos[3]) continue;
    const dx = o[0] - pos[0], dy = o[1] - pos[1], along = dx * dir[0] + dy * dir[1], l = -dx * dir[1] + dy * dir[0];
    if (along < -radius * 0.5 || along > look || Math.abs(l - dev) >= radius * 1.1) continue;
    if (along < bestAlong) { bestAlong = along; best = l; }
  }
  if (best === null) return 0;
  const side = best - dev > 1e-3 ? -1 : best - dev < -1e-3 ? 1 : bias;
  return Math.max(-2.2 * radius, Math.min(2.2 * radius, best + side * radius * 1.1));
}

// ease the sideways offset toward its target, never faster than maxRate (units per second) so the sidestep reads as a stroll round someone, not a dodge
export function easeDev(dev, target, dt, maxRate) {
  const step = (target - dev) * (1 - Math.exp(-dt * 3)), cap = maxRate * dt;
  return dev + Math.max(-cap, Math.min(cap, step));
}

// The building a straight leg lies wholly inside (both ends within its footprint, so walking it never crosses a wall), or -1 for a leg along the street or through a door.
// A walker is only kept inside walls on such a leg: the building a person is filed under (people[i][5]) is where they left from until the trip ends, so clamping to it kept every walker
// from a building on that building's corner for the whole trip, all of them at one spot.
export function legBuilding(B, a, b) {
  const within = (q, p) => p[0] >= q.x0 && p[0] <= q.x1 && p[1] >= q.y0 && p[1] <= q.y1;
  return B.findIndex(q => within(q, a) && within(q, b));
}

// keep the point p = [x, y, ...] at least `margin` inside the footprint of building q
export function clampInto(p, q, margin = 0.7) {
  p[0] = Math.min(q.x1 - margin, Math.max(q.x0 + margin, p[0])); p[1] = Math.min(q.y1 - margin, Math.max(q.y0 + margin, p[1]));
}
