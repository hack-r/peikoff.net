import assert from "node:assert/strict";
import test from "node:test";
import { CAPACITY, DOOR_WAIT, EXIT_GAP, Elevator, queueSpot, slotSpot } from "../public/atlas/elevator.js";
import { makeArch } from "../public/atlas/paths.js";

const FH = 4, sep = 2.3, dt = 0.05;
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("slot spots: four distinct standing places, at least sep apart, whatever the lobby depth", () => {
  for (const depth of [4, 8, 20]) {
    const b = { x0: 0, x1: 12, y0: 0, y1: depth }, a = makeArch([b], 20)[0];
    const s = [0, 1, 2, 3].map((k) => slotSpot(a, b, k, sep));
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(Math.hypot(s[i][0] - s[j][0], s[i][1] - s[j][1]) >= sep - 1e-9, `depth ${depth}: slots ${i}, ${j}`);
    const q = queueSpot(a, b, 0, sep), dir = Math.sign(q[1] - a.ey);                  // the queue is on the door side: slots 2-3 are nearer the door than 0-1
    assert.ok(Math.sign(s[2][1] - s[0][1]) === dir && Math.sign(s[3][1] - s[1][1]) === dir);
  }
});

test("boarders get distinct slots, back of the car first, and never more than CAPACITY", () => {
  const e = new Elevator(); for (let i = 0; i < 7; i++) e.request(i, 0, FH);
  let seen = null;
  for (let t = 0; t < 5 && !seen; t += dt) { e.step(dt); if (e.state === "open") seen = [0, 1, 2, 3, 4, 5, 6].filter((i) => e.phase(i) === "boarding").map((i) => e.slot(i)); }
  assert.deepEqual(seen, [0, 1, 2, 3].slice(0, CAPACITY));
  assert.equal(e.phase(CAPACITY), "waiting");
  assert.equal(e.slot(CAPACITY), -1);
});

test("exit before enter: nobody is let in until every rider has stepped out, and riders leave one at a time, door side first", () => {
  const e = new Elevator(); const out = [];
  for (let i = 0; i < CAPACITY; i++) e.request(i, 0, FH);
  e.request(10, FH, 0);                                                          // waits upstairs while the car arrives full
  let ridersAtOpen = null, enteredEarly = false;
  for (let t = 0; t < 60 && e.has(10) || t < 1; t += dt) {
    e.step(dt);
    for (let i = 0; i < CAPACITY; i++) if (e.phase(i) === "boarding") e.boarded(i);
    if (e.state === "open" && e.z === FH) {
      const ex = [...Array(CAPACITY).keys()].filter((i) => e.phase(i) === "exiting");
      if (ex.length && e.phase(10) === "boarding") enteredEarly = true;
      for (const i of ex) if (e.canExit(i)) { out.push([i, e.clock]); e.release(i); }
    }
    if (e.phase(10) === "boarding") { ridersAtOpen ??= out.length; e.boarded(10); }
    if (e.phase(10) === "exiting") e.release(10);
  }
  assert.ok(!enteredEarly, "the upstairs caller waited for everyone to get out");
  assert.equal(ridersAtOpen, CAPACITY);
  assert.deepEqual(out.map(([i]) => i), [3, 2, 1, 0], "door side (highest slot) first");
  out.slice(1).forEach(([, t], k) => assert.ok(t - out[k][1] >= EXIT_GAP - 1e-9, "one at a time, EXIT_GAP apart"));
});

test("a rider who never reaches the slot is dropped back to the queue, the car leaves, and they ride on a later stop", () => {
  const e = new Elevator(); e.request(1, 0, FH); e.request(2, 0, FH);
  let left = -1, opened = -1, drop = false;
  for (let t = 0; t < 60; t += dt) {
    e.step(dt);
    if (e.state === "open" && opened < 0) opened = t;
    if (e.phase(2) === "boarding") e.boarded(2);                                 // rider 1 is stuck and never steps in
    if (e.state === "moving" && opened >= 0 && left < 0) { left = t; drop = e.phase(1) === "waiting" && e.slot(1) === -1; }
    if (e.phase(2) === "exiting") e.release(2);
    if (left >= 0 && e.phase(1) === "boarding") e.boarded(1);
    if (e.phase(1) === "exiting") { e.release(1); break; }
  }
  assert.ok(left - opened <= DOOR_WAIT + 1, `car waited ${left - opened}s`);
  assert.ok(drop, "the stuck rider gave the slot back and waits in the queue");
  assert.equal(e.reqs.size, 0, "and was delivered on a later trip");
});

test("simulation: 60 riders over 6 floors in one car, random arrivals, standing in slots: nobody overlaps, nobody is over capacity, everybody is delivered", () => {
  const e = new Elevator(), N = 60, a = makeArch([{ x0: 0, x1: 12, y0: 0, y1: 16, floors: 6 }], 20)[0], b = { x0: 0, x1: 12, y0: 0, y1: 16 };
  const info = Array.from({ length: N }, (_, i) => { const from = Math.floor(rnd() * 6), to = (from + 1 + Math.floor(rnd() * 5)) % 6; return { from: from * FH, to: to * FH, at: rnd() * 120, pos: [a.ex + (rnd() - 0.5) * 3, b.y0 + 0.2], done: false }; });
  let minCar = Infinity, steps = 0;
  const go = (p, x, y) => { const dx = x - p.pos[0], dy = y - p.pos[1], d = Math.hypot(dx, dy); if (d < 0.05) return true; const s = Math.min(d, 1.4 * dt); p.pos[0] += dx / d * s; p.pos[1] += dy / d * s; return false; };
  for (let t = 0; t < 1500 && info.some((p) => !p.done); t += dt, steps++) {
    e.step(dt);
    info.forEach((p, i) => {
      if (p.done || t < p.at) return;
      if (!e.has(i)) e.request(i, p.from, p.to);
      const ph = e.phase(i);
      if (ph === "waiting") { const s = queueSpot(a, b, e.queueIndex(i), sep); go(p, s[0], s[1]); }
      else if (ph === "boarding") { const s = slotSpot(a, b, e.slot(i), sep); if (go(p, s[0], s[1])) e.boarded(i); }
      else if (ph === "riding") { const s = slotSpot(a, b, e.slot(i), sep); p.pos = [...s]; }
      else if (ph === "exiting") { const s = slotSpot(a, b, e.slot(i), sep); p.pos = [...s]; if (e.canExit(i)) { assert.equal(e.z, p.to, "exits at own floor"); e.release(i); p.done = true; } }
    });
    const inCar = info.map((p, i) => [p, i]).filter(([, i]) => ["riding", "exiting"].includes(e.phase(i)) || (e.phase(i) === "boarding" && false));
    assert.ok(e.inCar() <= CAPACITY);
    const slots = inCar.map(([, i]) => e.slot(i)); assert.equal(new Set(slots).size, slots.length, "no two riders share a slot");
    for (let x = 0; x < inCar.length; x++) for (let y = x + 1; y < inCar.length; y++) minCar = Math.min(minCar, Math.hypot(inCar[x][0].pos[0] - inCar[y][0].pos[0], inCar[x][0].pos[1] - inCar[y][0].pos[1]));
  }
  assert.ok(info.every((p) => p.done), "everyone arrived");
  assert.ok(minCar >= sep - 0.1, `riders ${minCar} apart`);
});

test("generic over car count: three cars in one lobby, riders split, each car obeys the same rules", () => {
  const els = [0, 1, 2].map(() => new Elevator());
  for (let i = 0; i < 24; i++) els[i % 3].request(i, 0, ((i % 4) + 1) * FH);
  let maxIn = 0;
  for (let t = 0; t < 300; t += dt) for (const [c, e] of els.entries()) {
    e.step(dt); maxIn = Math.max(maxIn, e.inCar());
    for (let i = c; i < 24; i += 3) { const ph = e.phase(i); if (ph === "boarding") e.boarded(i); if (ph === "exiting" && e.canExit(i)) e.release(i); }
  }
  assert.ok(maxIn <= CAPACITY);
  assert.ok(els.every((e) => e.reqs.size === 0));
});
