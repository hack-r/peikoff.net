import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const url = (p) => new URL(p, import.meta.url), main = readFileSync(url("../public/atlas/main.js"), "utf8"), models = JSON.parse(readFileSync(url("../public/atlas/models/models.json"), "utf8"));

test("the oil pump and the rover are shipped and named in models.json", () => {
  for (const [k, f] of [["oilpump", "props/oil-pump.glb"], ["rover", "props/rover.glb"]]) { assert.equal(models[k], f); assert.ok(existsSync(url("../public/atlas/models/" + f))); }
});

test("oil pumps stand beside the freight line, off the track; rovers beside the mine", () => {
  assert.match(main, /url\('oilpump'\)/);
  assert.match(main, /\* 80 \* side\]?, a_\.z/, "80 m to the side of the line");
  assert.match(main, /\], 16, 40, null\)/, "at least 40 m from the track");
  assert.match(main, /url\('rover'\)/);
  assert.match(main, /mine \? mine\.shaft/, "beside the mine");
});
