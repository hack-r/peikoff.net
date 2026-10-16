import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("Ayn Rand's villa is placed right against the lake (the placement code is browser-only, so its pieces are checked in the source)", () => {
  assert.ok(js.includes("const lakeK = (x, z) =>"), "distance from the lake in shore-radii (1 = the drawn beach)");
  assert.ok(/lakeK\(x, z\) < 1\.03/.test(js), "the tight test keeps only the beach itself clear, not the 1.25 margin");
  assert.ok(js.includes("grid = (wb, tight) =>") && js.includes("tightGrids ||= { B: grid(true, true), N: grid(false, true) }"), "its own obstacle grids");
  const villa = js.slice(js.indexOf("const villa = model('villa'"), js.indexOf("if (villa) {"));
  assert.ok(villa.includes("Math.max(0, lakeK(x, z) - 1)") && villa.includes(", 0, true,"), "scored by distance to the beach, tight search on");
  assert.ok(villa.includes("Math.min(vSize[0], vSize[2]) / 2 + 6"), "the free circle is the villa's footprint, not its diagonal");
  assert.ok(/lawn/.test(villa), "the lawn in front must be free too");
  assert.ok(!js.includes("const lake = []; for (let x = -900"), "the old 'near the 1.25 margin' lake sampling is gone");
});

test("cottages near the villa or its lawn are moved clear: measured from the villa's rectangle, never into the lake, a mountain or another cottage", () => {
  assert.ok(js.includes("const CLEAR_VILLA = 30, CLEAR_LAWN = 46"), "the margins");
  assert.ok(js.includes("const gapVilla = (x, z) =>") && js.includes("Math.hypot(Math.max(0, Math.abs(u_) - hd_), Math.max(0, Math.abs(w_) - hw_))"), "the gap to the villa's walls (its rectangle), not to its centre");
  assert.ok(js.includes("gapVilla(p_.x, p_.z) >= CLEAR_VILLA && Math.hypot(p_.x - cx, p_.z - cz) >= CLEAR_LAWN"), "only crowded cottages move");
  assert.ok(js.includes("gapVilla(x, z) < CLEAR_VILLA + 6 || Math.hypot(x - cx, z - cz) < CLEAR_LAWN + 6"), "and land with a bigger margin than the one that moved them");
  assert.ok(js.includes("lakeK(x, z) < 1.05 || surf_(x, z) > 0.3") && js.includes("q_ !== c_ && Math.hypot(q_.m.position.x - x"), "not into the water, onto a mountain or against another cottage");
  assert.ok(!js.includes("const nudge = (ox, oz, R) =>"), "the old circular clearance is gone");
});
