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

test("cottages that the villa or its lawn would stand on are moved clear (and never into the lake)", () => {
  assert.ok(js.includes("const nudge = (ox, oz, R) =>"));
  assert.ok(js.includes("nudge(villa.cx, villa.cz, vR_); nudge(cx, cz, 36);"), "both the villa and the lawn");
  assert.ok(js.includes("if (lakeK(x, z) < 1.05 || surf_(x, z) > 0.3"), "a moved cottage is not put in the water or on a mountain");
  assert.ok(js.includes("found: for (const d_ of") && js.includes("break found;"), "tries other directions and distances until one is free");
});
