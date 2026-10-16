import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("elevator parts blend in a fixed order, after the building (equal renderOrder is sorted by distance and flips with the camera)", () => {
  const m = main.match(/\[doorMesh, shaftMesh, cabMesh\]\.forEach\(\(mesh, n\) => \{[^\n]*renderOrder = ([\d.]+) \+ n \* ([\d.]+)/);
  assert.ok(m, "door, shaft and cabin get distinct renderOrders by index");
  assert.ok(+m[2] > 0 && +m[1] > 2, "all after bMesh (renderOrder 2), each different");
  assert.ok(+m[1] + 2 * +m[2] < 3, "and before the signs (renderOrder 3)");
});

test("riders are never pushed around inside the shaft, and one cabin follows one rider per frame", () => {
  assert.match(main, /j => j === i \|\| hidden\[j\] \|\| riding\[j\]/, "people waiting for the lift step aside from each other, not from riders");
  assert.ok(!/if \(leg\.ride\) \{[^}]*spreadOut/.test(main), "no sideways push for a rider");
  assert.equal((main.match(/if \(cabBusy\[leg\.bi\] !== tick\)/g) || []).length, 2, "both walker loops let only the first rider this frame move the cabin");
});
