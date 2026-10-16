import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stickVector, groundStep, zoomOffset, wantsTouch, DEADZONE, MIN_DISTANCE } from "../public/atlas/touch.js";

test("the stick has a dead zone, a full push is magnitude 1, and up the screen is forward", () => {
  assert.deepEqual(stickVector(0, 0, 50), { x: 0, y: 0, mag: 0 });
  assert.equal(stickVector(50 * DEADZONE * 0.9, 0, 50).mag, 0, "inside the dead zone");
  const up = stickVector(0, -50, 50);
  assert.ok(Math.abs(up.y - 1) < 1e-9 && Math.abs(up.x) < 1e-9 && Math.abs(up.mag - 1) < 1e-9);
  const right = stickVector(80, 0, 50);
  assert.ok(Math.abs(right.x - 1) < 1e-9 && right.mag === 1, "pushed past the ring is clamped");
  const half = stickVector(0, 25, 50);
  assert.ok(half.y < 0 && half.mag > 0 && half.mag < 1, "down the screen is backward, and gentler for a smaller push");
  assert.deepEqual(stickVector(5, 5, 0), { x: 0, y: 0, mag: 0 });
});

test("pushing forward moves toward what the camera looks at, right moves to its right (same as WASD)", () => {
  const cam = { x: 0, z: 100 }, tgt = { x: 0, z: 0 };                      // looking toward -z
  const [fx, fz] = groundStep(cam, tgt, { x: 0, y: 1, mag: 1 }, 50, 1);
  assert.ok(Math.abs(fx) < 1e-9 && Math.abs(fz + 40) < 1e-9, `forward ${fx},${fz}: 0.8 x distance per second`);
  const [rx, rz] = groundStep(cam, tgt, { x: 1, y: 0, mag: 1 }, 50, 1);
  assert.ok(Math.abs(rx - 40) < 1e-9 && Math.abs(rz) < 1e-9, `right ${rx},${rz}`);
  const [bx, bz] = groundStep({ x: 100, z: 0 }, { x: 0, z: 0 }, { x: 0, y: -0.5, mag: 0.5 }, 100, 0.5);   // looking toward -x, pulled back
  assert.ok(Math.abs(bx - 20) < 1e-9 && Math.abs(bz) < 1e-9);
  assert.deepEqual(groundStep({ x: 5, z: 5 }, { x: 5, z: 5 }, { x: 0, y: 1, mag: 1 }, 10, 1).map(Math.round), [0, -8], "straight above: falls back to -z");
});

test("zoom scales the offset from the target and respects the limits", () => {
  const off = { x: 30, y: 40, z: 0 };                                       // length 50
  assert.deepEqual(zoomOffset(off, 0, 1), off);
  const inn = zoomOffset(off, 1, 0.5), out = zoomOffset(off, -1, 0.5);
  assert.ok(Math.hypot(inn.x, inn.y, inn.z) < 50 && Math.hypot(out.x, out.y, out.z) > 50);
  assert.ok(Math.abs(inn.x / inn.y - 0.75) < 1e-9, "the viewing direction does not change");
  const close = zoomOffset({ x: 0, y: 4, z: 0 }, 1, 10);
  assert.ok(Math.abs(Math.hypot(close.x, close.y, close.z) - MIN_DISTANCE) < 1e-9, "never closer than the minimum");
  const far = zoomOffset({ x: 0, y: 900, z: 0 }, -1, 10, MIN_DISTANCE, 1000);
  assert.ok(Math.abs(far.y - 1000) < 1e-9, "never farther than the maximum");
});

test("the controls show on touch screens, and ?touch / ?touch=0 override", () => {
  assert.equal(wantsTouch("", true), true);
  assert.equal(wantsTouch("", false), false);
  assert.equal(wantsTouch("?touch", false), true);
  assert.equal(wantsTouch("?theme=day&touch=1", false), true);
  assert.equal(wantsTouch("?touch=0", true), false);
});

test("the viewer creates them and stops any fly-to when a finger lands", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("import { createTouchControls } from './touch.js';"));
  assert.ok(js.includes("scenery.userData.touch = createTouchControls({ camera, controls, onUse: stopCamera, maxDistance: E * 4 });"));
});
