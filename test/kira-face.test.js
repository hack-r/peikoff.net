import assert from "node:assert/strict";
import test from "node:test";
import { smileMouth, MOUTH, SMILE, LIP } from "../public/atlas/kira-face.js";

const LIPC = LIP, BLACK = [0.02, 0.02, 0], SKIN = [1, 0.6, 0.25];
const model = (verts) => ({ pos: Float32Array.from(verts.flatMap((v) => v.p)), col: Float32Array.from(verts.flatMap((v) => v.c)) });
const at = (m, i) => ({ p: [...m.pos.slice(i * 3, i * 3 + 3)], c: [...m.col.slice(i * 3, i * 3 + 3)] });
const close = (a, b, e = 1e-5) => Math.abs(a - b) < e;

test("the mouth's lips and cavity are squeezed, widened, flattened and curved; the cavity takes the lip colour", () => {
  const { CX, CY, CZ } = MOUTH;
  const m = model([
    { p: [CX + 0.01, CY + 0.01, CZ - 0.005], c: LIPC },     // upper lip, right of centre
    { p: [CX - 0.01, CY - 0.01, CZ + 0.005], c: LIPC },     // lower lip, left of centre
    { p: [CX, CY, CZ], c: BLACK },                           // cavity, dead centre
  ]);
  assert.equal(smileMouth(m.pos, m.col), 3);
  const up = at(m, 0), low = at(m, 1), cav = at(m, 2);
  const dx = 0.01 * SMILE.widen;
  assert.ok(close(up.p[0], CX + dx) && close(low.p[0], CX - dx), "wider about the centre line");
  assert.ok(close(up.p[1], CY + 0.01 * SMILE.squash + SMILE.curve * dx * dx), "squeezed toward the middle, lifted at the corner");
  assert.ok(close(low.p[1], CY - 0.01 * SMILE.squash + SMILE.curve * dx * dx));
  assert.ok(close(up.p[2], CZ - 0.005 * SMILE.flatten) && close(low.p[2], CZ + 0.005 * SMILE.flatten), "flatter against the face");
  assert.ok(close(cav.p[1], CY) && close(cav.p[0], CX), "the centre of the cavity stays put");
  assert.deepEqual(cav.c.map((v) => +v.toFixed(2)), LIPC, "the cavity becomes lip-coloured: one soft smile, no black hole");
  assert.deepEqual(up.c.map((v) => +v.toFixed(2)), LIPC);
});

test("the corners of the smile lift above its centre", () => {
  const { CX, CY, CZ } = MOUTH, cornerX = CX + 0.014;
  const m = model([{ p: [CX, CY, CZ], c: LIPC }, { p: [cornerX, CY, CZ], c: LIPC }, { p: [CX - 0.014, CY, CZ], c: LIPC }]);
  smileMouth(m.pos, m.col);
  assert.ok(at(m, 1).p[1] > at(m, 0).p[1] && at(m, 2).p[1] > at(m, 0).p[1], "both corners are higher than the middle");
  assert.ok(close(at(m, 1).p[1] - CY, at(m, 2).p[1] - CY), "and symmetric");
});

test("nothing else on the model moves: skin, eyes, other colours, and anything outside the mouth box", () => {
  const { CX, CY, CZ } = MOUTH;
  const verts = [
    { p: [CX, CY, CZ], c: SKIN },                          // skin inside the box
    { p: [CX, CY, 0.3], c: LIPC },                         // lip-coloured but on the back of the model
    { p: [CX, 0.76, CZ], c: BLACK },                       // an eye pupil (black), above the box
    { p: [0.2, CY, CZ], c: LIPC },                         // the gown trim, far to the side
    { p: [CX, CY, CZ], c: [0.1, 0.2, 0.75] },              // blue (eyes) inside the box: not touched
  ];
  const m = model(verts), before = { pos: m.pos.slice(), col: m.col.slice() };
  assert.equal(smileMouth(m.pos, m.col), 0);
  assert.deepEqual([...m.pos], [...before.pos]);
  assert.deepEqual([...m.col], [...before.col]);
});

test("the mouth box is where the model's mouth is (the face centre line, below the eyes and nose)", () => {
  assert.ok(MOUTH.CX > MOUTH.x0 && MOUTH.CX < MOUTH.x1 && MOUTH.CY > MOUTH.y0 && MOUTH.CY < MOUTH.y1 && MOUTH.CZ < MOUTH.zMax);
  assert.ok(MOUTH.y1 < 0.74, "below the eyes (they start at about y = 0.74)");
});
