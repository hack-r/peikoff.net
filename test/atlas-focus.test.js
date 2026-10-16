import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isFloorHit, framedView, inFront, headingToward } from "../public/atlas/focus.js";

test("flat, low, upward-facing hits are floor; a mountain or tree is not", () => {
  assert.equal(isFloorHit({ normalY: 1, size: { x: 900, y: 0.4, z: 900 }, minY: 0 }), true, "water / asphalt");
  assert.equal(isFloorHit({ normalY: 0.5, size: { x: 200, y: 120, z: 200 }, minY: -2 }), false, "a mountain");
  assert.equal(isFloorHit({ normalY: 1, size: { x: 30, y: 40, z: 30 }, minY: 0 }), false, "a tall thing's top");
});

test("framing keeps the camera's heading and tilt and centres the thing", () => {
  const cam = { x: 300, y: 200, z: 100 }, tgt = { x: 100, y: 100, z: 100 }, ctr = { x: 500, y: 60, z: -40 };
  const { toT, toC } = framedView(ctr, { x: 80, y: 120, z: 80 }, cam, tgt);
  assert.deepEqual(toT, ctr);
  const a = [cam.x - tgt.x, cam.y - tgt.y, cam.z - tgt.z], b = [toC.x - toT.x, toC.y - toT.y, toC.z - toT.z];
  const la = Math.hypot(...a), lb = Math.hypot(...b);
  assert.ok(Math.abs(a[0] / la - b[0] / lb) < 1e-9 && Math.abs(a[1] / la - b[1] / lb) < 1e-9 && Math.abs(a[2] / la - b[2] / lb) < 1e-9, "same direction, so no tilt change");
});

test("the camera never ends up pointing down from below ground, and small things get a minimum distance", () => {
  const { toC, toT } = framedView({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 10, y: 1, z: 0 }, { x: 0, y: 0, z: 0 });
  assert.ok(toC.y >= 4 && Math.hypot(toC.x - toT.x, toC.z - toT.z) >= 30);
});

test("the viewer wires double-click focus for the mouse only and leaves interactive things alone", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("el.addEventListener('dblclick'") && js.includes("lastPtr !== 'mouse'"));
  assert.ok(js.includes("isFloorHit(") && js.includes("framedView("));
});

test("searching a person puts the camera in front of their face and they turn to look at it", () => {
  for (const h of [0, 90, 180, -135, 37]) {
    const o = inFront(h, 30);
    assert.ok(Math.abs(Math.hypot(o.x, o.z) - 30) < 1e-9, "same framing distance");
    assert.ok(Math.abs(wrap(headingToward(0, 0, o.x, o.z) - h)) < 1e-9, `heading ${h}: facing the camera is the heading the camera was placed on`);
  }
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("inFront(people[i][4], 30)") && js.includes("headingToward(pe[0], pe[1], camera.position.x, camera.position.z)"));
});
const wrap = d => ((d % 360) + 540) % 360 - 180;
