import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bodyRadius, clampInto, legBuilding, steerAround } from "../public/atlas/crowd.js";
import { makeArch, planLegs } from "../public/atlas/paths.js";
import { orderHits, peikoffsOnly } from "../public/atlas/search.js";

const city = JSON.parse(readFileSync(new URL("../public/atlas/data/whoneedsit.json", import.meta.url), "utf8"));
const main = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
const fold = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

test("searching Leonard finds Leonard Peikoff first, not Leonard Esmond", () => {
  const rows = city.ids.map((id, i) => ({ i, label: city.meta[id].Name, hay: fold(`${city.meta[id].Name} | ${id}`) }));
  const red = new Set(city.highlight.people);
  const hits = orderHits(rows, "leonard", (r) => red.has(city.ids[r.i]));
  assert.equal(hits[0].label, "Leonard Peikoff");
  assert.ok(hits.some((r) => r.label === "Leonard Esmond"), "Leonard Esmond is still listed");
  assert.equal(orderHits(rows, "leonard")[0].label, "Leonard Esmond", "without the preference it is alphabetical (the old order)");
});

test("orderHits: name start beats word start beats anywhere, and every word must match", () => {
  const rows = [{ label: "B Ann", hay: "b ann" }, { label: "Ann Z", hay: "ann z" }, { label: "Xann", hay: "xann" }];
  assert.deepEqual(orderHits(rows, "ann").map((r) => r.label), ["Ann Z", "B Ann", "Xann"]);
  assert.deepEqual(orderHits(rows, "ann z").map((r) => r.label), ["Ann Z"]);
});

test("only Peikoffs are red: the highlight group holds nobody else, and the viewer filters it again", () => {
  const names = city.highlight.people.map((id) => city.meta[id].Name);
  assert.ok(names.length >= 4 && names.every((n) => /peikoff/i.test(n)), names.join(", "));
  assert.ok(!city.highlight.people.includes("P1"), "Ayn Rand");
  assert.deepEqual(peikoffsOnly(["P1", "P2", "P4"], { P1: { Name: "Ayn Rand" }, P2: { Name: "Leonard Peikoff" }, P4: { Name: "Barbara Branden Peikoff" } }), ["P2", "P4"]);
  assert.deepEqual(peikoffsOnly(["P9"], {}), []);
  assert.ok(main.includes("peikoffsOnly(city.highlight.people, city.meta)"), "main.js builds the red group through peikoffsOnly");
  const palette = /const PALETTE = \[([^\]]*)\]/.exec(main)[1].match(/#[0-9a-f]{6}/gi);
  for (const hex of palette) { const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)); assert.ok(!(r > 150 && g < 0.55 * r && b < 0.55 * r), `${hex} is not red`); }
});

test("a selected person keeps their own color; the ring and beam are a light accent, never black or red, in both themes", () => {
  assert.ok(main.includes("const col = baseColor(i);") && !main.includes("COL_SEL"), "no selection color is painted on a body");
  for (const theme of ["night", "day"]) {
    const hl = new RegExp(`${theme}:\\s*\\{[^\\n]*?\\bhl: 0x([0-9a-f]{6})`).exec(main)?.[1];
    assert.ok(hl, `${theme} has a highlight color`);
    const [r, g, b] = [0, 2, 4].map((k) => parseInt(hl.slice(k, k + 2), 16));
    assert.ok(Math.max(r, g, b) > 100, `${theme} highlight is not dark`);
    assert.ok(!(r > 150 && g < 0.55 * r && b < 0.55 * r), `${theme} highlight is not red`);
  }
  assert.ok(main.includes("ring.material.color.set(TH.hl); beam.material.color.set(TH.hl);"));
});

test("a leg along the street or through a door has no building to be kept in; a leg inside a building does", () => {
  const B = city.buildings, arch = makeArch(B, 36), ari = B.findIndex((b) => b.org_id === 1);
  const A = B[ari], from = [A.x0 + 3, A.y0 + 3, 0];
  const legs = planLegs({ B, arch, bA: ari, bT: B.findIndex((b) => b.org_id === 121), from, tx: 0, ty: 0, tz: 0, o: 3, pitch: 36 });
  const kinds = legs.filter((l) => !l.ride).map((l) => legBuilding(B, l.a, l.b));
  assert.ok(kinds.includes(-1), "there are street legs");
  assert.ok(legs.some((l) => !l.ride && l.a[1] >= A.y0 && l.b[1] < A.y0) && !legs.filter((l) => !l.ride && l.a[1] >= A.y0 && l.b[1] < A.y0).some((l) => legBuilding(B, l.a, l.b) >= 0), "the leg out of the door crosses the wall, so it is not clamped");
  assert.equal(legBuilding(B, [A.x0 + 2, A.y0 + 2], [A.x1 - 2, A.y1 - 2]), ari);
  assert.equal(legBuilding(B, [A.x0 + 2, A.y0 + 2], [A.x1 + 20, A.y1 + 20]), -1);
});

test("clampInto keeps a point inside the walls with a margin", () => {
  const q = { x0: 10, x1: 20, y0: 30, y1: 40 };
  const p = [0, 100]; clampInto(p, q); assert.deepEqual(p, [10.7, 39.3]);
  const r = [15, 35]; clampInto(r, q); assert.deepEqual(r, [15, 35]);
});

test("a walker on the street is not pulled back into the building they left (they all ended up on that building's corner)", () => {
  const step = /function stepWalkers\(dt\) \{[\s\S]*?\n\}\n/.exec(main)[0];
  assert.ok(!/clampTo\(/.test(step), "stepWalkers no longer clamps to the building a person is filed under (people[i][5])");
  assert.ok(step.includes("legBuilding(B, a, b)") && step.includes("clampInto(p, B[leg.in])"));
  const ride = /function rideLeg\([\s\S]*?\n\}\n/.exec(main)[0];
  assert.ok(step.includes("rideLeg(w.i") && !ride.includes("spreadOut(i, k)") && ride.includes("steerAround("), "people queueing for the elevator step aside from each other; riders in the cabin are not pushed (that made them flicker)");
});

test("steerAround: riders a floor apart in one shaft are only parted when the vertical tolerance covers a body", () => {
  const others = [[5, 5, 30, 1]], at = [5, 5, 29, 1];
  assert.deepEqual(steerAround(at, others, 0.7), [5, 5], "a metre apart counts as another floor by default");
  const [x, y] = steerAround(at, others, 0.7, 0, () => false, 1.4, 1.8);
  assert.ok(Math.hypot(x - 5, y - 5) >= 0.7 - 1e-9, "parted by a body's width");
});

test("steerAround: someone exactly on top of another steps out a full radius", () => {
  const [x, y] = steerAround([5, 5, 0, 1], [[5, 5, 0, 1]], 0.7, 0, () => false, 0.7);
  assert.ok(Math.abs(Math.hypot(x - 5, y - 5) - 0.7) < 1e-9);
});

test("the /speak, /salon and /home walkers steer round people and wait for the elevator apart, like everyday walkers", () => {
  const ev = /function advanceEv\([\s\S]*?\n\}\n/.exec(main)[0];
  assert.ok(ev.includes("laneShift(") && ev.includes("steerAround(") && ev.includes("legBuilding(B, a, b)") && ev.includes("rideLeg(i, leg"));
});

test("selecting a figure with per-part colors (Ayn Rand's dress) only moves the ring and beam: no costume or body is recolored", () => {
  const lay = /function layoutPeople\(\) \{[\s\S]*?\n\}\n/.exec(main)[0];
  assert.ok(lay.includes("const col = baseColor(i);") && lay.includes("for (const mesh of colorMeshes) mesh.setColorAt(i, col);"));
  assert.ok(!/regalia/.test(lay), "layoutPeople does not touch the costume meshes");
  assert.ok(!/regalia[^\n]*setColorAt|setColorAt[^\n]*regalia/.test(main), "nothing sets an instance color on a costume");
  const veil = /const beam = [\s\S]*?opacity: ([0-9.]+)/.exec(main)[1];
  assert.ok(+veil <= 0.25, "the selection beam is a light veil");
});

test('a crowd dropped on one spot spreads out within a moment, and event walkers keep stepping apart', () => {
  const R = bodyRadius(1), people = Array.from({ length: 12 }, () => [10, 10, 0, 1, 0]);   // twelve people on exactly the same point
  for (let step = 0; step < 60; step++) for (let i = 0; i < people.length; i++) {
    const s = steerAround(people[i], people, R, 0, j => j === i, 2 * R, 1.8); people[i][0] = s[0]; people[i][1] = s[1];
  }
  let worst = Infinity;
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) worst = Math.min(worst, Math.hypot(people[i][0] - people[j][0], people[i][1] - people[j][1]));
  assert.ok(worst > 0.35, `closest pair ${worst}`);
  const stepEv = main.slice(main.indexOf('function stepEv('), main.indexOf('function frontSpots('));
  assert.ok((stepEv.match(/spreadOut\(i,/g) || []).length >= 2, 'people waiting for their turn and people standing about step apart');
});
