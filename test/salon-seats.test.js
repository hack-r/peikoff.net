import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("/salon and /speak: each person sits facing the way their own chair faces", () => {
  const line = js.split("\n").find((l) => l.includes("else if (key === 'forum' || key === 'salon')"));
  assert.ok(line, "the seat assignment line exists");
  assert.ok(line.includes("target: { type: 'seat', heading: seat.head }"), "the heading comes from the person's own seat");
  assert.ok(!line.includes("heading: seatHead(v)"), "not one shared heading for the whole venue (the salon's chairs form a ring, each facing the centre)");
});

test("the chairs and the people use the same seat heading", () => {
  assert.ok(js.includes("q.setFromAxisAngle(UP, s_.head * Math.PI / 180)"), "chair instances are turned by the seat's heading");
  assert.ok(js.includes("v.seats.push({ x, y, row: j, w, u, head: seatHead(v), front:"), "forum seats all face the stage");
  assert.ok(/v\.seats\.push\(\{ x, y, row: n, w, u, head: Math\.atan2\(-\(Math\.cos\(ang\)/.test(js), "salon seats each face the middle of the ring");
});

test("people sit on the chair, not through it: hips at the seat top, and costumed people sit too", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  // the seat's top is 0.485 (0.45 + half the 0.07 thickness); a hip at 0.82 dropped by 0.25 is at 0.57, the thigh resting on it (it was 0.37: the legs lay inside the seat)
  assert.ok(js.includes("z - (seated[i] ? 0.25 * k : 0)"), "hips drop 0.25");
  assert.ok(js.includes("if (t.type === 'seat') seated[i] = 1;"), "costumed people take their seat as well");
  assert.ok(js.includes("if (seated[i]) { setLeg(T, -1, -1.45, 0.04); setLeg(T, 1, -1.45, 0.04); } return; }"), "and put their legs forward");
});
