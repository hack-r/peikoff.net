import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("Midas's plane is half its earlier size (13 units), including the height it parks at", () => {
  assert.equal(+js.match(/const MIDAS_SC = (\d+);/)[1], 13);
  assert.ok(js.includes("plane.scale.setScalar(MIDAS_SC)"), "the plane uses it");
  assert.ok(js.includes("const halfH = geo.userData.height * MIDAS_SC / 2,"), "so it still rests on the ground when parked");
  assert.ok(!/geo\.userData\.height \* 26/.test(js) && !/plane\.scale\.setScalar\(26\)/.test(js), "no leftover full-size numbers");
});

test("Midas is searchable by name with a minimal card, and is still no row in the data", () => {
  assert.ok(/index\.push\(\{ egg: 'Midas Peikoff', label: 'Midas Peikoff', hay: fold\('Midas Peikoff dog'\) \}\)/.test(js), "a search entry");
  assert.ok(js.includes("r.egg === undefined || eggs.some(e => e.title === r.egg)"), "listed only once his plane has loaded");
  assert.ok(js.includes("if (r.egg !== undefined) flyToMidas();"), "picking it opens his card and flies to him");
  const card = js.match(/title: 'Midas Peikoff', rows: \(\) => \[([\s\S]*?)\]\s*\}\);/)[1];
  assert.equal((card.match(/\[/g) || []).length, 1, "one short line on his card");
  assert.ok(!/https?:|<a /.test(card), "no links");
  assert.ok(js.includes("scenery.userData.midasPlane = { plane, spin }"), "his plane and Easter egg are untouched");
});

test("Ayn Rand's Estate is searchable (estate, villa, mansion, lakeside) with a one-line card, and flies the camera there", () => {
  const entry = js.match(/index\.push\(\{ egg: "Ayn Rand's Estate"[^\n]*hay: fold\("([^"]*)"\)/)[1].toLowerCase();
  for (const w of ["ayn rand's estate", "estate", "villa", "mansion", "lakeside"]) assert.ok(entry.includes(w), w);
  assert.ok(js.includes("if (r.egg === \"Ayn Rand's Estate\") flyToEstate(); else if (r.egg !== undefined) flyToMidas();"), "picking it flies there");
  const card = js.match(/title: "Ayn Rand's Estate", rows: \(\) => \[([\s\S]*?)\]\s*\}\);/)[1];
  assert.equal((card.match(/\[/g) || []).length, 1, "one short line");
  assert.ok(!/https?:|<a /.test(card), "no links");
  assert.ok(js.includes("scenery.userData.estateView = { x: villa.cx"), "set once the villa is built, so the entry is hidden otherwise");
  assert.ok(js.includes("places.salon = v"), "/salon is untouched");
});
