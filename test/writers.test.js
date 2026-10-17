import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WRITERS, CIRCLE_R, PAD_R, KIRA_GAP, circleLayout, circleCentre, scribble } from "../public/atlas/writers.js";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
const src = readFileSync(new URL("../public/atlas/writers.js", import.meta.url), "utf8");

test("five writers: three men with beards, two women with long hair, gray uniforms, no red", () => {
  assert.equal(WRITERS.length, 5);
  assert.equal(WRITERS.filter(w => !w.woman).length, 3);
  assert.ok(WRITERS.filter(w => !w.woman).every(w => w.beard !== "none"));
  assert.ok(WRITERS.filter(w => w.woman).every(w => w.hairStyle === "long"));
  for (const w of WRITERS) { const [r, g, b] = [1, 3, 5].map(i => parseInt(w.uniform.slice(i, i + 2), 16)); assert.ok(Math.abs(r - g) < 20 && Math.abs(g - b) < 25, `${w.name} uniform is gray`); }
  assert.ok(!/#(?:ff0000|e00|d00|c00)/i.test(src), "no red in the figure code");
});

test("the circle is even, faces inward and keeps seats and rocks clear of each other and of Kira's ledge", () => {
  const [cx, cz] = circleCentre(0, 0, 0, 1);
  const seats = circleLayout(cx, cz, CIRCLE_R);
  for (const s of seats) {
    assert.ok(Math.abs(Math.hypot(s.x - cx, s.z - cz) - CIRCLE_R) < 1e-9);
    assert.ok(Math.sin(s.yaw) * (cx - s.x) + Math.cos(s.yaw) * (cz - s.z) > CIRCLE_R * 0.99, "faces the middle");
    assert.ok(Math.hypot(s.x, s.z) > 11 + PAD_R + 2, "clear of Kira's rock");
  }
  for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) assert.ok(Math.hypot(seats[i].x - seats[j].x, seats[i].z - seats[j].z) > 2 * PAD_R + 4, "rocks do not touch");
  assert.ok(KIRA_GAP > CIRCLE_R, "the circle sits below Kira, not on her");
});

test("the pen hand scribbles a little and stays small", () => {
  for (let t = 0; t < 10; t += 0.1) { const s = scribble(t, 1); assert.ok(Math.abs(s.yaw) <= 0.1 && Math.abs(s.pitch) <= 0.04); }
});

test("main.js puts the writers on the slope below Kira, as scenery that cannot be picked", () => {
  assert.ok(js.includes("circleCentre(px, pz, ox, oz)"));
  assert.ok(js.includes("w.traverse(o => { o.raycast = () => {}; })"));
  assert.ok(js.includes("scenery.userData.stepWriters?."), "animated from the render loop");
});
