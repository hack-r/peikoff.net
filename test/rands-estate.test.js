import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const url = (p) => new URL(p, import.meta.url);

test("the Rand's Estate model is shipped and named in models.json", () => {
  assert.ok(existsSync(url("../public/atlas/models/places/rands-estate.glb")));
  assert.equal(JSON.parse(readFileSync(url("../public/atlas/models/models.json"), "utf8")).estate, "places/rands-estate.glb");
});

test("Rand's Estate stands beside Ayn Rand's villa on dry ground, cottages keep clear, and the minimap marks it", () => {
  const main = readFileSync(url("../public/atlas/main.js"), "utf8"), map = readFileSync(url("../public/atlas/minimap.js"), "utf8");
  assert.match(main, /url\('estate'\)/);
  assert.match(main, /lakeK\(x, z\) >= 1\.05 && surf_\(x, z\) <= 0\.3/, "dry ground, off the mountains");
  assert.match(main, /inst\.rotation\.y = Math\.atan2\(villa\.a\[0\], villa\.a\[1\]\)/, "faces the city like the villa");
  assert.match(main, /pth\.r \+ 14/, "cottages are moved away from it");
  assert.match(map, /u\.estate/);
  assert.match(main, /label\("Rand's Estate"/, "the label");
});

test("Ayn Rand's Rolls-Royce is parked beside her villa", () => {
  assert.ok(existsSync(url("../public/atlas/models/places/rolls-royce.glb")));
  assert.equal(JSON.parse(readFileSync(url("../public/atlas/models/models.json"), "utf8")).rollsroyce, "places/rolls-royce.glb");
  const main = readFileSync(url("../public/atlas/main.js"), "utf8");
  assert.match(main, /url\('rollsroyce'\)/);
  assert.match(main, /scenery\.userData\.rollsRoyce/);
});
