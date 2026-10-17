import assert from "node:assert/strict";
import test from "node:test";
import { Obstacles, avoidLegs, detour } from "../public/atlas/obstacles.js";

// a small deterministic generator, so the random scenes below are the same on every run
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

const segInside = (O, a, b, ex) => {   // is any sampled point of a -> b inside an obstacle (raw shape, no margin)?
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25);
  for (let k = 0; k <= n; k++) { const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; for (const o of O.query(x - 1, z - 1, x + 1, z + 1)) if (!(ex && ex.has(o.id)) && O.inside(o, x, z, 0)) return o; }
  return null;
};

test("detour: a clear way stays straight, a cottage in the way is walked round with the margin kept", () => {
  const O = new Obstacles();
  assert.deepEqual(detour(O, [0, 0], [100, 0]), [[0, 0], [100, 0]]);
  O.addRect(50, 0, 0.8, 0.6, 8, 6, 1, "cottage");
  const p = detour(O, [0, 0], [100, 0]);
  assert.ok(p.length > 2, "bends round it");
  for (let k = 0; k + 1 < p.length; k++) assert.equal(O.blockers(p[k][0], p[k][1], p[k + 1][0], p[k + 1][1]).length, 0, "no leg of the detour touches the cottage or its margin");
});

test("detour: water or a mountain is avoided too, and a goal walled in by chairs gives null", () => {
  const O = new Obstacles(), lake = (x, z) => !(x > 30 && x < 70 && z > -4 && z < 4);   // a lake in the middle of the way
  const p = detour(O, [0, 0], [100, 0], { walkable: lake }); assert.deepEqual(p, [[0, 0], [100, 0]], "no obstacle: the straight way is returned (water is the bridges' job)");
  O.addCircle(50, 0, 10, 1, "prop");
  const q = detour(O, [0, 0], [100, 0], { walkable: lake }); assert.ok(q && q.length > 2, "round the prop");
  for (const [x, z] of q) assert.ok(lake(x, z), "every bend is on dry ground");
  const ring = new Obstacles(); for (let k = 0; k < 12; k++) ring.addCircle(50 + Math.cos(k / 12 * 6.283) * 6, Math.sin(k / 12 * 6.283) * 6, 4, 1, "chair");
  assert.equal(detour(ring, [0, 0], [50, 0]), null);
});

test("chairs: a person walks to their own chair from its open side and never through another", () => {
  const O = new Obstacles(), R = 11, k = 3, ids = [];
  for (let n = 0; n < 9; n++) { const a = Math.PI * 2 * (n + 0.5) / 10; ids.push(O.addCircle(Math.cos(a) * R, Math.sin(a) * R, 0.38 * k, 0.25 * k, "chair", { n }).id); }
  for (let n = 0; n < 9; n++) {
    const a = Math.PI * 2 * (n + 0.5) / 10, s = [Math.cos(a) * R, Math.sin(a) * R], front = [s[0] - Math.cos(a) * 2.7, s[1] - Math.sin(a) * 2.7];   // chairs face the centre
    const legs = avoidLegs(O, [{ a: [-30, 0, 0], b: [front[0], front[1], 0], len: 1, ride: false }, { a: [front[0], front[1], 0], b: [s[0], s[1], 0], len: 1, ride: false }], { extra: [ids[n]] });
    for (const L of legs) assert.equal(segInside(O, L.a, L.b, L.ex), null, `chair ${n}: leg ${L.a} -> ${L.b}`);
  }
});

test("random scenes: every planned walk keeps out of every cottage, house, prop and chair (zero intersections)", () => {
  const r = rng(7);
  let walks = 0, detoured = 0;
  for (let scene = 0; scene < 40; scene++) {
    const O = new Obstacles();
    for (let n = 0; n < 25; n++) {
      const x = r() * 400 - 200, z = r() * 400 - 200;
      if (n % 3 === 0) O.addCircle(x, z, 2 + r() * 8, 1, "prop"); else { const t = r() * 3.14; O.addRect(x, z, Math.cos(t), Math.sin(t), 3 + r() * 9, 3 + r() * 8, 1, n % 3 === 1 ? "cottage" : "house"); }
    }
    for (let w = 0; w < 25; w++) {
      const a = [r() * 500 - 250, r() * 500 - 250], b = [r() * 500 - 250, r() * 500 - 250];
      if (O.list.some((o) => O.inside(o, a[0], a[1], o.p + 0.1) || O.inside(o, b[0], b[1], o.p + 0.1))) continue;      // a walk starts and ends in the open
      const legs = avoidLegs(O, [{ a: [a[0], a[1], 0], b: [b[0], b[1], 0], len: Math.hypot(b[0] - a[0], b[1] - a[1]), ride: false, hold: 0 }]);
      walks++; if (legs.length > 1) detoured++;
      assert.equal(legs.length > 0 && Math.hypot(legs.at(-1).b[0] - b[0], legs.at(-1).b[1] - b[1]) < 1e-6, true, "ends where it should");
      for (const L of legs) assert.equal(segInside(O, L.a, L.b, L.ex), null, `scene ${scene}: leg ${L.a} -> ${L.b} runs through an obstacle`);
    }
  }
  assert.ok(walks > 500 && detoured > 50, `exercised ${walks} walks, ${detoured} detoured`);
});

test("pushOut: a point inside a cottage or a chair is moved to just outside it; exempt obstacles are left alone", () => {
  const O = new Obstacles(), c = O.addRect(0, 0, 1, 0, 5, 4, 1, "cottage"), ch = O.addCircle(30, 0, 1, 0.5, "chair");
  const [x, z] = O.pushOut(2, 1); assert.ok(!O.inside(c, x, z), "out of the cottage");
  const [x2, z2] = O.pushOut(30.2, 0.1); assert.ok(!O.inside(ch, x2, z2), "out of the chair");
  assert.deepEqual(O.pushOut(2, 1, new Set([c.id])), [2, 1], "its own door: left");
});
