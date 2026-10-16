import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chooseLabels, onScreen } from "../public/atlas/names.js";

test("labels: nearest first, capped, and overlapping ones dropped", () => {
  const c = [{ i: 1, sx: 100, sy: 100, dist: 50 }, { i: 2, sx: 110, sy: 105, dist: 10 }, { i: 3, sx: 400, sy: 300, dist: 30 }, { i: 4, sx: 700, sy: 50, dist: 90 }];
  assert.deepEqual(chooseLabels(c).map(o => o.i), [2, 3, 4], "2 is nearer than 1 and hides it");
  assert.deepEqual(chooseLabels(c, { max: 2 }).map(o => o.i), [2, 3]);
  assert.deepEqual(chooseLabels([]), []);
});

test("onScreen respects the margin", () => {
  assert.ok(onScreen(10, 10, 100, 100) && !onScreen(-5, 10, 100, 100) && onScreen(-5, 10, 100, 100, 20));
});

test("/names is a registered Atlas command with a checkbox, a layer and help text", () => {
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../public/atlas/index.html", import.meta.url), "utf8");
  assert.ok(js.includes("['/names',") && js.includes("c === 'names'") && js.includes("stepNames();"));
  assert.ok(js.includes("/names (name labels over people)"), "listed in the commands toast");
  assert.ok(html.includes('id="cbNames"') && html.includes('id="names"') && html.includes("/names"));
});
