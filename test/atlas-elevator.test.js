import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CAPACITY, DOOR_OPEN, Elevator, queueSpot } from "../public/atlas/elevator.js";
import { makeArch } from "../public/atlas/paths.js";

const main = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
const FH = 4;

// run the car for `secs` of game time, calling each(t) after every step
function run(e, secs, each = () => {}, dt = 0.05) { for (let t = 0; t < secs; t += dt) { e.step(dt); each(t); } }

test("a caller waits: the car has to arrive and open before anybody boards", () => {
  const e = new Elevator(); e.z = 3 * FH; e.state = "idle";
  e.request(1, 0, 2 * FH);
  assert.equal(e.phase(1), "waiting");
  let boardedAt = -1, zWhenBoarding = null;
  run(e, 30, (t) => { if (e.phase(1) === "boarding" && boardedAt < 0) { boardedAt = t; zWhenBoarding = e.z; } });
  assert.ok(boardedAt > 0.5, "had to wait for the car to come down three floors");
  assert.equal(zWhenBoarding, 0, "boarding only when the car is at the caller's floor");
});

test("riders are carried to their floors and the doors open there before they exit", () => {
  const e = new Elevator(); const log = [];
  e.request(1, 0, 2 * FH); e.request(2, 0, FH);
  run(e, 40, () => {
    for (const id of [1, 2]) { const ph = e.phase(id); if (ph === "boarding") e.boarded(id); if (ph === "exiting") { log.push([id, e.z]); e.release(id); } }
  });
  assert.deepEqual(log.sort((a, b) => a[0] - b[0]), [[1, 2 * FH], [2, FH]]);
  assert.equal(e.reqs.size, 0);
});

test("capacity: only CAPACITY board at a time, the rest keep waiting and go on the next trip, in order", () => {
  const e = new Elevator(); const n = CAPACITY + 3; let maxCar = 0; const order = [];
  for (let i = 0; i < n; i++) e.request(i, 0, FH);
  run(e, 120, () => {
    maxCar = Math.max(maxCar, e.inCar());
    for (let i = 0; i < n; i++) { const ph = e.phase(i); if (ph === "boarding") { order.push(i); e.boarded(i); } if (ph === "exiting") e.release(i); }
  });
  assert.equal(maxCar, CAPACITY);
  assert.deepEqual(order, [...Array(n).keys()], "first come, first served");
  assert.equal(e.reqs.size, 0, "everybody got where they were going");
});

test("the doors stay open at least DOOR_OPEN and a rider who never steps in does not strand the car", () => {
  const e = new Elevator(); e.request(1, 0, FH); e.request(2, 0, FH);
  let opened = -1, left = -1;
  run(e, 40, (t) => { if (e.state === "open" && opened < 0) opened = t; if (e.state === "moving" && opened >= 0 && left < 0) left = t; });   // nobody calls boarded()
  assert.ok(left - opened >= DOOR_OPEN, `doors open ${left - opened}s`);
  assert.ok(e.z > 0 || e.reqs.size === 0, "the car moved on");
});

test("an empty car parks on the ground floor", () => {
  const e = new Elevator(); e.z = 2 * FH; run(e, 30); assert.equal(e.z, 0);
});

test("queue spots: nobody in line stands inside anybody else, whatever the lobby depth", () => {
  const sep = 2.3;
  for (const depth of [4, 8, 20]) {
    const b = { x0: 0, x1: 12, y0: 0, y1: depth }, a = makeArch([b], 20)[0];
    const spots = Array.from({ length: 24 }, (_, i) => queueSpot(a, b, i, sep));
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]) >= sep - 1e-9, `depth ${depth}: spots ${i} and ${j}`);
  }
});

test("simulation: a crowd waiting for one car stays orderly, never overlaps, and everyone arrives", () => {
  const b = { x0: 0, x1: 12, y0: 0, y1: 16, floors: 4 }, a = makeArch([b], 20)[0], e = new Elevator(), sep = 2.3;
  const N = 14, pos = [], dest = [], done = new Set(), z = [];
  for (let i = 0; i < N; i++) { pos.push([a.ex + (i % 5) * 0.4, b.y0 + 0.2]); z.push(0); dest.push(1 + (i % 3)); }
  const arrivedAt = new Map(); let minGap = Infinity, ridersMoved = 0;
  const dt = 0.05;
  for (let t = 0; t < 400 && done.size < N; t += dt) {
    e.step(dt);
    for (let i = 0; i < N; i++) {
      if (done.has(i)) continue;
      if (t < i * 0.7) continue;                                                  // people turn up one after another
      if (!e.has(i)) e.request(i, 0, dest[i] * FH);
      const ph = e.phase(i);
      const goto_ = (x, y) => { const dx = x - pos[i][0], dy = y - pos[i][1], d = Math.hypot(dx, dy); if (d < 0.05) return true; const s = Math.min(d, 1.4 * dt); pos[i][0] += dx / d * s; pos[i][1] += dy / d * s; return false; };
      if (ph === "waiting") { const s = queueSpot(a, b, e.queueIndex(i), sep); goto_(s[0], s[1]); }
      else if (ph === "boarding") { if (goto_(a.ex, a.ey)) e.boarded(i); }
      else if (ph === "riding") { pos[i][0] = a.ex; pos[i][1] = a.ey; z[i] = e.z; ridersMoved++; }
      else if (ph === "exiting") { z[i] = e.z; assert.equal(z[i], dest[i] * FH, "exits only at their own floor"); e.release(i); done.add(i); arrivedAt.set(i, t); }
    }
    // people standing in line (settled in their spot) must never overlap
    const standing = [...Array(N).keys()].filter((i) => e.phase(i) === "waiting" && Math.hypot(...queueSpot(a, b, e.queueIndex(i), sep).map((v, k) => v - pos[i][k])) < 0.06);
    for (let p = 0; p < standing.length; p++) for (let q = p + 1; q < standing.length; q++) minGap = Math.min(minGap, Math.hypot(pos[standing[p]][0] - pos[standing[q]][0], pos[standing[p]][1] - pos[standing[q]][1]));
    assert.ok(e.inCar() <= CAPACITY);
  }
  assert.equal(done.size, N, "everybody was delivered");
  assert.ok(minGap >= sep - 0.13, `queued people ${minGap} apart`);
  assert.ok(ridersMoved > 0);
  assert.ok([...arrivedAt.values()].every((t) => t > 2), "nobody got there instantly");
});

test("main.js sends every ride leg through the queue instead of riding on the spot", () => {
  assert.match(main, /import \{ CAB_SPEED, Elevator, queueSpot, chooseCar \} from '\.\/elevator\.js'/);
  assert.equal((main.match(/if \(leg && leg\.ride\) \{ if \(rideLeg\(/g) || []).length, 2, "both walk loops (everyday trips and /speak, /salon crowds)");
  assert.ok(!/P_\.hold > 0/.test(main), "no fixed 0.6 s hold any more");
  assert.ok(!/cabBusy/.test(main), "the cabin is driven by the elevator, not by its rider");
});
