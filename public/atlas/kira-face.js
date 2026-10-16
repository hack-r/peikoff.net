// Kira's face. The Princess Peach model's mouth is a small open "o": two pink lips around a black cavity (about 590 vertices in all, near the
// middle of the face). smileMouth() reshapes those vertices in place into a closed smile: the lips and the cavity are squeezed together into one
// soft band, widened, flattened against the face and curved up at the corners. Nothing is added to the model and nothing is drawn over it.
// Pure arrays in, pure arrays out (no three.js), so it is unit-tested in node.

// the model's own coordinates (height 1, facing -z): the mouth sits in this box, centred on (CX, CY, CZ)
export const MOUTH = { x0: -0.06, x1: -0.005, y0: 0.685, y1: 0.73, zMax: -0.09, CX: -0.031, CY: 0.7085, CZ: -0.107 };
export const SMILE = { widen: 1.8, squash: 0.35, flatten: 0.5, curve: 12 };      // x scale, y scale (lips and cavity alike), depth scale, corner lift (y += curve * dx^2)
export const LIP = [0.85, 0.1, 0.3];                                              // the lips' own colour in the model; the cavity takes it, so the smile is one colour

const near = (a, b, t) => Math.abs(a - b) < t;
const isLip = (r, g, b) => near(r, LIP[0], 0.06) && near(g, LIP[1], 0.06) && near(b, LIP[2], 0.06);
const isCavity = (r, g, b) => r < 0.08 && g < 0.08 && b < 0.08;

/** Reshapes the mouth vertices of a model (positions and colours as flat xyz / rgb arrays, 3 numbers per vertex). Returns how many vertices moved. */
export function smileMouth(pos, col, m = MOUTH, s = SMILE) {
  let moved = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (!(x > m.x0 && x < m.x1 && y > m.y0 && y < m.y1 && z < m.zMax)) continue;
    const lip = isLip(col[i], col[i + 1], col[i + 2]), cavity = !lip && isCavity(col[i], col[i + 1], col[i + 2]);
    if (!lip && !cavity) continue;
    const dx = (x - m.CX) * s.widen;
    pos[i] = m.CX + dx;
    pos[i + 1] = m.CY + (y - m.CY) * s.squash + s.curve * dx * dx;
    pos[i + 2] = m.CZ + (z - m.CZ) * s.flatten;
    if (cavity) { col[i] = LIP[0]; col[i + 1] = LIP[1]; col[i + 2] = LIP[2]; }
    moved++;
  }
  return moved;
}
