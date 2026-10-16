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
  assert.ok(js.includes("v.seats.push({ x, y, row: j, w, u, head: seatHead(v) })"), "forum seats all face the stage");
  assert.ok(/v\.seats\.push\(\{ x, y, row: n, w, u, head: Math\.atan2\(-\(Math\.cos\(ang\)/.test(js), "salon seats each face the middle of the ring");
});
