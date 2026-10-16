import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("Midas's plane is half its earlier size (13 units), including the height it parks at", () => {
  assert.equal(+js.match(/const MIDAS_SC = (\d+);/)[1], 13);
  assert.ok(js.includes("plane.scale.setScalar(MIDAS_SC)"), "the plane uses it");
  assert.ok(js.includes("const halfH = geo.userData.height * MIDAS_SC / 2,"), "so it still rests on the ground when parked");
  assert.ok(!/geo\.userData\.height \* 26/.test(js) && !/plane\.scale\.setScalar\(26\)/.test(js), "no leftover full-size numbers");
});
