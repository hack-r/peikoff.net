import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clampInto, legBuilding, steerAround } from "../public/atlas/crowd.js";
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

test("a selected Peikoff stays red (only other people turn the selection color)", () => {
  assert.ok(main.includes("i === selected && !HL?.people.has(i) ? c.set(COL_SEL) : baseColor(i)"));
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
  assert.ok(step.includes("spreadOut(w.i, k)"), "people waiting for or riding the elevator step aside from each other");
});

test("steerAround: riders a floor apart in one shaft are only parted when the vertical tolerance covers a body", () => {
  const others = [[5, 5, 30, 1]], at = [5, 5, 29, 1];
  assert.deepEqual(steerAround(at, others, 0.7), [5, 5], "a metre apart counts as another floor by default");
  const [x, y] = steerAround(at, others, 0.7, 0, () => false, 1.4, 1.8);
  assert.ok(Math.hypot(x - 5, y - 5) >= 0.7 - 1e-9, "parted by a body's width");
});
