// Where people walk. Pure geometry (no browser objects), so it is unit-tested in node.
//
// Every building has one door on its south face (y = y0) and one elevator shaft just inside it. A trip between two buildings is a list of legs:
//   walk to the elevator on the current floor -> ride down to the ground floor -> walk out of the door onto the sidewalk -> along the street lattice
//   -> in through the door of the next building -> walk to its elevator -> ride up to the floor -> walk to a spot on that floor.
// A leg is { a: [x, y, z], b: [x, y, z], len, ride, bi, hold }: a ride only changes z (the elevator is the only way between floors), and `hold`
// is how many seconds the person waits at the start of the leg (for the elevator to come).

export const ELEVATOR_AT = 0.3;                    // the shaft stands this far (fraction of the depth) in from the door wall
export const DOOR_APPROACH = 1.5;                  // how far inside the door people turn towards it

/** Per building: door wall, elevator position and the street row (lattice line) it opens onto. */
export function makeArch(B, pitch) {
  return B.map(b => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return { cx, cy, door: b.y0, ex: cx, ey: b.y0 + (b.y1 - b.y0) * ELEVATOR_AT, ry: Math.round(cy / pitch - 0.5) * pitch };
  });
}

/**
 * Legs for a person standing at `from` = [x, y, z] in building bA, going to building bT and ending at (tx, ty, tz).
 * `o` is the sidewalk lane (+3 or -3 from the street line), `rise` a floor height, `pitch` the lattice spacing.
 */
export function planLegs({ B, arch, bA, bT, from, tx, ty, tz, o, pitch, hold = 0.6 }) {
  const A = B[bA], T = B[bT], dA = arch[bA], dT = arch[bT], legs = [], cur = from.slice();
  const go = (x, y, z, ride = false, bi = -1, h = 0) => {
    const len = ride ? Math.abs(z - cur[2]) : Math.hypot(x - cur[0], y - cur[1]);
    if (len < 0.01) { cur[0] = x; cur[1] = y; cur[2] = z; return; }
    legs.push({ a: cur.slice(), b: [x, y, z], len, ride, bi, hold: h }); cur[0] = x; cur[1] = y; cur[2] = z;
  };
  go(dA.ex, dA.ey, from[2]);                                                         // across the floor to the elevator
  if (from[2] > 0) go(dA.ex, dA.ey, 0, true, bA, hold);                              // down
  go(dA.cx, A.y0 + DOOR_APPROACH, 0); go(dA.cx, dA.ry + o, 0);                      // out of the door onto the sidewalk
  const col = (Math.round(dT.cx / pitch - 0.5) + (dA.cx > dT.cx ? 1 : 0)) * pitch;   // the street column on the side of the target that faces us
  go(col + o, dA.ry + o, 0); go(col + o, dT.ry + o, 0); go(dT.cx, dT.ry + o, 0);     // along the streets
  go(dT.cx, T.y0 + DOOR_APPROACH, 0);                                                // in through the door
  go(dT.ex, dT.ey, 0);                                                               // to the elevator
  if (tz > 0) go(dT.ex, dT.ey, tz, true, bT, hold);                                  // up
  go(tx, ty, tz);                                                                    // to a spot on that floor
  return legs;
}
