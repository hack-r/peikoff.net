import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeArch, planLegs, planEventLegs } from "../public/atlas/paths.js";

const city = JSON.parse(readFileSync(new URL("../public/atlas/data/whoneedsit.json", import.meta.url), "utf8"));
const B = city.buildings, PITCH = 36, FH = city.floor_h, arch = makeArch(B, PITCH);
let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const near = (a, b) => Math.abs(a - b) < 1e-6;

function trips(n) {
  const out = [];
  for (let t = 0; t < n; t++) {
    const bA = Math.floor(rnd() * B.length); let bT = Math.floor(rnd() * B.length); if (bT === bA) bT = (bT + 1) % B.length;
    const A = B[bA], T = B[bT], z = Math.floor(rnd() * A.floors) * FH, tz = Math.floor(rnd() * T.floors) * FH;
    const from = [A.x0 + 1 + rnd() * 20, A.y0 + 1 + rnd() * 20, z], tx = T.x0 + 1 + rnd() * 20, ty = T.y0 + 1 + rnd() * 20, o = rnd() < 0.5 ? 3 : -3;
    out.push({ bA, bT, from, tx, ty, tz, o, legs: planLegs({ B, arch, bA, bT, from, tx, ty, tz, o, pitch: PITCH }) });
  }
  return out;
}

test("a trip is one connected path from where the person stands to the chosen spot", () => {
  for (const t of trips(400)) {
    const L = t.legs; assert.ok(L.length > 0);
    L.slice(1).forEach((l, i) => assert.ok(l.a.every((v, k) => near(v, L[i].b[k])), "legs join up"));
    assert.ok(L[0].a.every((v, k) => near(v, t.from[k])), "starts where the person stands");
    assert.ok(near(L.at(-1).b[0], t.tx) && near(L.at(-1).b[1], t.ty) && near(L.at(-1).b[2], t.tz), "ends at the chosen spot");
  }
});

test("floors are changed only in an elevator: a ride is vertical, in the shaft of its building, and walking never changes height", () => {
  for (const t of trips(400)) for (const l of t.legs) {
    if (l.ride) {
      assert.ok(near(l.a[0], l.b[0]) && near(l.a[1], l.b[1]) && !near(l.a[2], l.b[2]), "vertical");
      assert.ok(near(l.a[0], arch[l.bi].ex) && near(l.a[1], arch[l.bi].ey), "in the shaft");
      assert.ok(l.hold > 0, "waits for the cabin");
    } else assert.ok(near(l.a[2], l.b[2]), "walking stays on one floor");
  }
});

test("people leave and enter only through the south door and walk the streets between: no leg at street level crosses another building", () => {
  for (const t of trips(400)) {
    const own = new Set([t.bA, t.bT]);
    for (const l of t.legs) {
      if (l.ride || l.a[2] !== 0) continue;
      for (let s = 0; s <= 40; s++) {
        const x = l.a[0] + (l.b[0] - l.a[0]) * s / 40, y = l.a[1] + (l.b[1] - l.a[1]) * s / 40;
        B.forEach((b, i) => { if (!own.has(i) && x > b.x0 + 1e-6 && x < b.x1 - 1e-6 && y > b.y0 + 1e-6 && y < b.y1 - 1e-6) assert.fail(`walks through building ${i}`); });
      }
    }
    // the only way through a wall is the door: the legs that cross a building's south wall do so at the door's x
    for (const [bi, tag] of [[t.bA, "out"], [t.bT, "in"]]) {
      const b = B[bi], cross = t.legs.filter(l => !l.ride && l.a[2] === 0 && (l.a[1] - b.y0) * (l.b[1] - b.y0) < 0 && l.a[0] >= b.x0 && l.a[0] <= b.x1);
      for (const l of cross) assert.ok(near(l.a[0], arch[bi].cx) && near(l.b[0], arch[bi].cx), `${tag}: through the door`);
    }
  }
});

test("every building has a door on its south wall and a shaft just inside it", () => {
  B.forEach((b, i) => { const a = arch[i]; assert.ok(near(a.door, b.y0) && a.ex > b.x0 && a.ex < b.x1 && a.ey > b.y0 && a.ey < b.y1); });
});

test("event trips (to a venue outside the city and back) are connected and never cut through a building they do not start or end in", () => {
  const inside = (x, y, b) => x > b.x0 + 0.5 && x < b.x1 - 0.5 && y > b.y0 + 0.5 && y < b.y1 - 0.5;
  const venue = [[-300, 600], [700, -250], [200, 650], [650, 500], [-260, -240]];
  for (let n = 0; n < 300; n++) {
    const bA = Math.floor(rnd() * B.length), A = B[bA], z = Math.floor(rnd() * A.floors) * FH, o = rnd() < 0.5 ? 3 : -3, v = venue[n % venue.length];
    const there = planEventLegs({ B, arch, pitch: PITCH, from: [A.x0 + 1 + rnd() * 20, A.y0 + 1 + rnd() * 20, z], fromB: bA, to: v, o });
    const back = planEventLegs({ B, arch, pitch: PITCH, from: [v[0], v[1], 0], to: [A.x0 + 3, A.y0 + 4], toB: bA, tz: z, o });
    for (const [legs, own] of [[there, bA], [back, bA]]) {
      legs.slice(1).forEach((l, i) => assert.ok(l.a.every((c, k) => near(c, legs[i].b[k])), "legs join up"));
      for (const l of legs) if (!l.ride) for (let f = 0; f <= 1; f += 0.05) {
        const x = l.a[0] + (l.b[0] - l.a[0]) * f, y = l.a[1] + (l.b[1] - l.a[1]) * f;
        B.forEach((b, i) => { if (i !== own) assert.ok(!inside(x, y, b), `crosses building ${i}`); });
      }
    }
    assert.ok(near(there.at(-1).b[0], v[0]) && near(there.at(-1).b[1], v[1]), "arrives at the venue");
    assert.ok(near(back.at(-1).b[0], A.x0 + 3) && near(back.at(-1).b[1], A.y0 + 4) && near(back.at(-1).b[2], z), "gets home");
  }
});

test("a person on a street lane reaches a venue and returns to the same lane spot", () => {
  const spot = [PITCH * 3 + 3, PITCH * 2.4, 0], v = [-250, 620];
  const there = planEventLegs({ B, arch, pitch: PITCH, from: spot, to: v, o: 3 }), back = planEventLegs({ B, arch, pitch: PITCH, from: [v[0], v[1], 0], to: [spot[0], spot[1]], o: 3 });
  assert.ok(near(there.at(-1).b[0], v[0]) && near(back.at(-1).b[0], spot[0]) && near(back.at(-1).b[1], spot[1]));
  for (const l of [...there, ...back]) assert.ok(l.a.every(Number.isFinite) && l.b.every(Number.isFinite));
});
