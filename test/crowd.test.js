import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bodyRadius, easeDev, laneShift, steerAround } from "../public/atlas/crowd.js";

const R = bodyRadius(3);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test("a walker heading straight at someone ends up outside their body", () => {
  const leonard = [10, 0, 0, 0];
  for (let x = 6; x <= 14; x += 0.25) {
    const [px, py] = steerAround([x, 0, 0, 0], [leonard], R, Math.PI / 2);
    assert.ok(dist([px, py], leonard) >= R - 1e-9, `at x=${x} the walker is clear of Leonard`);
  }
});

test("walking at a standing person curves round them: never overlapping, never jumping, and straight again afterwards", () => {
  const dt = 1 / 60, speed = 2, dir = [1, 0];
  for (const offY of [0, 0.2, -0.2, 1]) {
    const leonard = [10, offY, 0, 0];
    let dev = 0, prev = null, worst = 0, tooClose = 0;
    for (let x = 0; x <= 20; x += speed * dt) {
      dev = easeDev(dev, laneShift([x, 0, 0, 0], dir, [leonard], R, () => false, dev), dt, speed * 1.2);
      const cur = steerAround([x, dev, 0, 0], [leonard], R, 0);
      tooClose = Math.max(tooClose, R - dist(cur, leonard));
      if (prev) worst = Math.max(worst, dist(cur, prev));
      prev = cur;
    }
    assert.ok(tooClose < 1e-9, `offset ${offY}: never inside Leonard`);
    assert.ok(worst < speed * dt * 2, `offset ${offY}: biggest single-frame move ${worst.toFixed(3)} stays smooth`);
    assert.ok(Math.abs(dev) < 0.05, `offset ${offY}: back on the line afterwards`);
  }
});

test("someone walking dead centre on a person still steps out, and by no more than a body", () => {
  const [x, y] = steerAround([3, 3, 0, 0], [[3, 3, 0, 0]], R, 0);
  assert.ok(Math.hypot(x - 3, y - 3) >= R - 1e-9 && Math.hypot(x - 3, y - 3) <= R + 1e-9);
});

test("people on another floor, outside vs inside, or skipped (hidden, or the walker itself) do not block", () => {
  const w = [0, 0, 0, 1];
  assert.deepEqual(steerAround(w, [[0.1, 0, 6, 1]], R), [0, 0]);
  assert.deepEqual(steerAround(w, [[0.1, 0, 0, 0]], R), [0, 0]);
  assert.deepEqual(steerAround(w, [[0.1, 0, 0, 1]], R, 0, () => true), [0, 0]);
});

test("a person squeezed between two others is pushed clear of both", () => {
  const a = [0, 0, 0, 0], b = [1.8, 0, 0, 0];
  const [x, y] = steerAround([0.9, 0.1, 0, 0], [a, b], R, 0);
  assert.ok(dist([x, y], a) >= R - 1e-9 && dist([x, y], b) >= R - 1e-9);
});

test("the Atlas wires collision into walkers, and paused people (open card) stay in the list of bodies", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(js.includes("laneShift(p, dir, people, R_, skip"), "walkers curve round everyone in people[]");
  // the person whose card is open is skipped by the walk loop (`continue`) but never removed from people[], so they remain an obstacle
  assert.ok(/if \(w\.i === still\) \{[^}]*continue; \}/.test(js));
});
