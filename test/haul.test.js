import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cycle, lengths, pointAt, zigzag } from "../public/atlas/haul.js";

const main = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("the zigzag climbs from the lower point to the upper one and swings to both sides", () => {
  const poly = zigzag([0, 0], [0, 40], 8, 3, 36), cum = lengths(poly);
  assert.ok(Math.hypot(poly[0][0], poly[0][1]) < 1e-9 && Math.hypot(poly[36][0], poly[36][1] - 40) < 1e-9, "from the lower point to the upper");
  assert.ok(cum[36] > 40, "longer than the straight line");
  const xs = poly.map(p => p[0]); assert.ok(Math.max(...xs) > 6 && Math.min(...xs) < -6, "swings both ways");
});

test("pointAt walks the path and clamps at both ends", () => {
  const poly = [[0, 0], [10, 0], [10, 10]], cum = lengths(poly);
  assert.deepEqual(pointAt(poly, cum, 5), { x: 5, z: 0, fx: 1, fz: 0 });
  assert.equal(pointAt(poly, cum, 15).z, 5); assert.equal(pointAt(poly, cum, -3).x, 0); assert.equal(pointAt(poly, cum, 99).z, 10);
});

test("a carrier goes up empty, loads at the top, comes down carrying and tips at the bottom", () => {
  const len = 60, pause = 6;
  assert.deepEqual([cycle(10, len, pause).up, cycle(10, len, pause).carry], [true, false]);
  assert.equal(cycle(len + 1, len, pause).moving, false);
  const down = cycle(len + pause + 10, len, pause); assert.deepEqual([down.up, down.carry, down.moving], [false, true, true]); assert.equal(down.s, len - 10);
  const foot = cycle(2 * len + pause + 1, len, pause); assert.deepEqual([foot.s, foot.moving], [0, false]);
  assert.equal(cycle(0, len, pause).s, cycle(2 * (len + pause), len, pause).s, "the round repeats");
  for (let c = 0; c < 300; c += 0.5) { const s = cycle(c, len, pause).s; assert.ok(s >= 0 && s <= len, "stays on the path"); }
});

test("the town-side carriers are scenery: own meshes, not in the people data, never picked, never red, drawn as a few instanced meshes", () => {
  const blk = main.slice(main.indexOf("ore carriers on the town side"), main.indexOf("scenery.userData.taken = []"));
  assert.ok(blk.includes("scenery.userData.haul") && main.includes("stepHaul(dt)"), "runs every frame");
  assert.ok(blk.includes("c_.raycast = () => {}"), "not clickable or searchable");
  assert.ok(!/people\.push|ids\.push|minerSet\.add/.test(blk), "adds no person");
  assert.ok(blk.includes("0x8a4b2a") && blk.includes("makeInstanced"), "the same rusty ore, instanced");
  for (const h of blk.match(/'#[0-9a-f]{6}'/g) || []) { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i + 1, i + 3), 16)); assert.ok(!(r > 1.4 * g && r > 1.4 * b), `${h} is not red`); }
  for (const call of ["!T_.inLake", "cottages.some", "B.some", "railPts.some", "people.some"]) assert.ok(blk.includes(call), `path avoids: ${call}`);
});
