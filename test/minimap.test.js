import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { squareBounds, makeProjection, wedge, nearestPlace } from "../public/atlas/minimap.js";

test("square bounds cover every point, padded, and ignore junk", () => {
  const b = squareBounds([[0, 0], [400, 100], [NaN, 5], [Infinity, 1]], 0.1);
  assert.equal(b.cx, 200);
  assert.equal(b.cz, 50);
  assert.ok(b.half >= 200 && b.half <= 250, `half ${b.half}`);
  assert.deepEqual(squareBounds([], 0.1, 150), { cx: 0, cz: 0, half: 150 });
  assert.equal(squareBounds([[0, 0], [10, 10]]).half, 100, "never smaller than the minimum");
});

test("projection: world to map and back, with the centre in the middle", () => {
  const b = { cx: 100, cz: -50, half: 500 }, p = makeProjection(b, 200);
  assert.deepEqual(p.toMap(100, -50), [100, 100]);
  assert.deepEqual(p.toMap(-400, -550), [0, 0]);
  assert.deepEqual(p.toMap(600, 450), [200, 200]);
  for (const [x, z] of [[0, 0], [333, -222], [-100, 400]]) {
    const [px, py] = p.toMap(x, z), [wx, wz] = p.fromMap(px, py);
    assert.ok(Math.abs(wx - x) < 1e-9 && Math.abs(wz - z) < 1e-9);
  }
});

test("the view cone points from the camera toward what it looks at", () => {
  assert.ok(Math.abs(wedge({ x: 0, z: 0 }, { x: 10, z: 0 }).dir) < 1e-9, "+x is angle 0");
  assert.ok(Math.abs(wedge({ x: 0, z: 0 }, { x: 0, z: 10 }).dir - Math.PI / 2) < 1e-9, "+z is down the map");
  const narrow = wedge({ x: 0, z: 0 }, { x: 1, z: 0 }, 1), wide = wedge({ x: 0, z: 0 }, { x: 1, z: 0 }, 2);
  assert.ok(wide.half > narrow.half && wide.half <= 1.05, "a wider screen sees a wider cone, within a limit");
});

test("hovering finds the nearest named place within reach", () => {
  const p = makeProjection({ cx: 0, cz: 0, half: 100 }, 200), places = [{ name: "Manor", x: 0, z: 0 }, { name: "Mine", x: 50, z: 50 }];
  assert.equal(nearestPlace(places, p, 101, 99)?.name, "Manor");
  assert.equal(nearestPlace(places, p, 152, 149)?.name, "Mine");
  assert.equal(nearestPlace(places, p, 20, 180), null);
});

test("the viewer builds the map and flies to a tapped point", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("import { createMinimap } from './minimap.js';"));
  assert.ok(js.includes("scenery.userData.minimap = createMinimap({"), "created once the scene exists");
  assert.ok(js.includes("function flyToPoint(x, z, instant = false)"), "tap flies, drag is instant");
  assert.ok(js.includes("goTo: flyToPoint"));
});

test("the map lists Ayn Rand's villa, which the viewer stores inside the salon place", () => {
  const src = readFileSync(new URL("../public/atlas/minimap.js", import.meta.url), "utf8");
  assert.ok(src.includes("if (P.salon?.villa) P.villa = P.salon.villa;"));
  assert.ok(src.includes("['villa', \"Ayn Rand's villa\"]"));
});
