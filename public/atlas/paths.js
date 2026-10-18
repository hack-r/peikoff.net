// Where people walk. Pure geometry (no browser objects), so it is unit-tested in node.
//
// Every building has one door on its south face (y = y0) and one elevator shaft just inside it. A trip between two buildings is a list of legs:
//   walk to the elevator on the current floor -> ride down to the ground floor -> walk out of the door onto the sidewalk -> along the street lattice
//   -> in through the door of the next building -> walk to its elevator -> ride up to the floor -> walk to a spot on that floor.
// A leg is { a: [x, y, z], b: [x, y, z], len, ride, bi, hold }: a ride only changes z (the elevator is the only way between floors), and `hold`
// is how many seconds the person waits at the start of the leg (for the elevator to come).

export const ELEVATOR_AT = 0.3;                    // the shaft stands this far (fraction of the depth) in from the door wall
export const DOOR_APPROACH = 1.5;                  // how far inside the door people turn towards it

export const MIN_SHAFT_GAP = 5;                    // shafts of one building stand at least this far apart (data units), so their queues do not run into each other

export const CAR_OVERRIDES = { 68: 3 };               // org_id -> ordinary elevators: Atlas Network (15 floors) had one and people took too long to leave it

/** How many ordinary elevators each building gets: the tallest building of two or more floors three, the next tallest two, the rest one (none for a single floor), fewer where the footprint is too narrow. CAR_OVERRIDES raises named organisations (Atlas Network: three). */
export function carCounts(B) {
  const tall = B.map((b, i) => i).filter(i => B[i].floors >= 2).sort((a, b) => B[b].floors - B[a].floors || a - b);
  return B.map((b, i) => {
    if (b.floors < 2) return 0;
    const want = CAR_OVERRIDES[b.org_id] || (tall[0] === i ? 3 : tall[1] === i ? 2 : 1);
    return Math.max(1, Math.min(want, Math.floor((b.x1 - b.x0) / MIN_SHAFT_GAP) - 1));
  });
}

/** Per building: door wall, the elevators (`cars`: ex, ey and `exec` for an executive car) and the street row (lattice line) it opens onto. `ex`, `ey` are the first car.
 *  counts[i] ordinary cars (default 1); exec = set of building indices that also get an executive car (the last, rightmost shaft). */
export function makeArch(B, pitch, { counts = null, exec = new Set() } = {}) {
  return B.map((b, i) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, ey = b.y0 + (b.y1 - b.y0) * ELEVATOR_AT;
    const n = counts ? counts[i] : 1, x = exec.has(i) ? 1 : 0, slots = Math.max(1, n + x), cars = [];
    for (let c = 0; c < slots; c++) cars.push({ ex: slots === 1 ? cx : b.x0 + (b.x1 - b.x0) * (c + 1) / (slots + 1), ey, exec: x === 1 && c === slots - 1 });
    return { cx, cy, door: b.y0, ex: cars[0].ex, ey, cars, ry: Math.round(cy / pitch - 0.5) * pitch };
  });
}

/**
 * Legs for a person standing at `from` = [x, y, z] in building bA, going to building bT and ending at (tx, ty, tz).
 * `o` is the sidewalk lane (+3 or -3 from the street line), `rise` a floor height, `pitch` the lattice spacing.
 */
export function planLegs({ B, arch, bA, bT, from, tx, ty, tz, o, pitch, hold = 0.6, pick = () => 0 }) {
  const A = B[bA], T = B[bT], dA = arch[bA], dT = arch[bT], legs = [], cur = from.slice();
  const go = (x, y, z, ride = false, bi = -1, h = 0, ci = 0) => {
    const len = ride ? Math.abs(z - cur[2]) : Math.hypot(x - cur[0], y - cur[1]);
    if (len < 0.01) { cur[0] = x; cur[1] = y; cur[2] = z; return; }
    legs.push({ a: cur.slice(), b: [x, y, z], len, ride, bi, ci, hold: h }); cur[0] = x; cur[1] = y; cur[2] = z;
  };
  const cA = pick(bA, from[2], from[0], from[1]), kA = dA.cars[cA];                   // the car to take: the nearest or shortest queue (pick), in the building the trip starts in
  if (A.floors >= 2) go(kA.ex, kA.ey, from[2]);                                      // across the floor to the elevator (one-floor buildings have none)
  if (from[2] > 0) go(kA.ex, kA.ey, 0, true, bA, hold, cA);                          // down
  go(dA.cx, A.y0 + DOOR_APPROACH, 0); go(dA.cx, dA.ry + o, 0);                      // out of the door onto the sidewalk
  const col = (Math.round(dT.cx / pitch - 0.5) + (dA.cx > dT.cx ? 1 : 0)) * pitch;   // the street column on the side of the target that faces us
  go(col + o, dA.ry + o, 0); go(col + o, dT.ry + o, 0); go(dT.cx, dT.ry + o, 0);     // along the streets
  go(dT.cx, T.y0 + DOOR_APPROACH, 0);                                                // in through the door
  const cT = pick(bT, 0, dT.cx, T.y0 + DOOR_APPROACH), kT = dT.cars[cT];
  if (T.floors >= 2) go(kT.ex, kT.ey, 0);                                            // to the elevator
  if (tz > 0) go(kT.ex, kT.ey, tz, true, bT, hold, cT);                              // up
  go(tx, ty, tz);                                                                    // to a spot on that floor
  return legs;
}

/**
 * Legs for a trip that may start or end outside the buildings: in a building (`fromB` / `toB` >= 0), on a street lane inside the lattice, or on free ground
 * outside it (a venue). `from` = [x, y, z]; `to` = [x, y] (the spot; `tz` its floor when `toB` >= 0). Streets are the lattice lines (multiples of `pitch`);
 * people use the lane `o` (+3 / -3) beside a line, and cross the open ground between the edge of the lattice and a venue in a straight line.
 * Walking legs only ever run along lanes or over open ground, except inside the buildings the trip starts or ends in.
 */
export function planEventLegs({ B, arch, pitch, from, fromB = -1, to, toB = -1, tz = 0, o, hold = 0.6, pick = () => 0 }) {
  const xs = arch.map(a => a.cx), ys = arch.map(a => a.cy), half = pitch / 2;
  const bx0 = Math.min(...xs) - half, bx1 = Math.max(...xs) + half, by0 = Math.min(...ys) - half, by1 = Math.max(...ys) + half;
  const inLattice = (x, y) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1, line = v => Math.round(v / pitch) * pitch;
  const clampX = x => Math.min(bx1, Math.max(bx0, x)), clampY = y => Math.min(by1, Math.max(by0, y));
  const laneOf = (x, y) => Math.abs(x - line(x)) <= Math.abs(y - line(y)) ? 'col' : 'row';
  const entryOf = (x, y) => [line(clampX(x)) + o, line(clampY(y)) + o];            // where open ground meets the lattice
  const legs = [], cur = from.slice();
  const go = (x, y, z = cur[2], ride = false, bi = -1, h = 0, ci = 0) => {
    const len = ride ? Math.abs(z - cur[2]) : Math.hypot(x - cur[0], y - cur[1]);
    if (len < 0.01) { cur[0] = x; cur[1] = y; cur[2] = z; return; }
    legs.push({ a: cur.slice(), b: [x, y, z], len, ride, bi, ci, hold: h }); cur[0] = x; cur[1] = y; cur[2] = z;
  };
  let lane;                                                                          // what the person stands on after the first part: 'row', 'col' or 'free'
  if (fromB >= 0) {
    const A = B[fromB], dA = arch[fromB];
    const cA = pick(fromB, from[2], from[0], from[1]), kA = dA.cars[cA];
    if (A.floors >= 2) go(kA.ex, kA.ey, from[2]); if (from[2] > 0) go(kA.ex, kA.ey, 0, true, fromB, hold, cA);
    go(dA.cx, A.y0 + DOOR_APPROACH, 0); go(dA.cx, dA.ry + o, 0); lane = 'row';
  } else if (inLattice(from[0], from[1])) lane = laneOf(from[0], from[1]);
  else { const e = entryOf(from[0], from[1]); go(e[0], e[1], 0); lane = 'col'; }      // from a venue to the nearest edge of the street grid
  // where the trip must arrive in the lattice, and what happens after that
  let dest, after;
  if (toB >= 0) { const T = B[toB], dT = arch[toB]; dest = { x: dT.cx, y: dT.ry + o, lane: 'row' };
    after = () => { go(dT.cx, T.y0 + DOOR_APPROACH, 0); const cT = pick(toB, 0, dT.cx, T.y0 + DOOR_APPROACH), kT = dT.cars[cT]; if (T.floors >= 2) go(kT.ex, kT.ey, 0); if (tz > 0) go(kT.ex, kT.ey, tz, true, toB, hold, cT); go(to[0], to[1], tz); }; }
  else if (inLattice(to[0], to[1])) { dest = { x: to[0], y: to[1], lane: laneOf(to[0], to[1]) }; after = () => {}; }
  else { const e = entryOf(to[0], to[1]); dest = { x: e[0], y: e[1], lane: 'col' }; after = () => go(to[0], to[1], 0); }
  if (lane === 'free') { go(dest.x, dest.y, 0); after(); return legs; }
  if (lane === 'col') { const yr = line(cur[1]) + o; go(cur[0], yr); lane = 'row'; }  // along the column to the nearest row lane
  const yr = cur[1];
  if (dest.lane === 'col') { go(dest.x, yr); go(dest.x, dest.y); }
  else { const col = line(dest.x) + o; go(col, yr); go(col, dest.y); go(dest.x, dest.y); }
  after();
  return legs;
}
