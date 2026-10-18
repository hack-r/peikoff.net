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

test("riders are never pushed around inside the shaft, and people queueing ignore them", () => {
  assert.match(main, /j => j === i \|\| hidden\[j\] \|\| riding\[j\]/, "waiting and stepping aside skip riders");
  assert.match(main, /riding\[i\] = 1; p\[2\] = e\.z; p\[0\] = ss\[0\]; p\[1\] = ss\[1\];/, "a rider in the cabin is put in their own slot and not steered");
});
