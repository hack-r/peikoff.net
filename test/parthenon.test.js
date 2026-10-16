import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const url = (p) => new URL(p, import.meta.url);

test("the Parthenon model is shipped and named in models.json", () => {
  assert.ok(existsSync(url("../public/atlas/models/places/parthenon.glb")));
  assert.equal(JSON.parse(readFileSync(url("../public/atlas/models/models.json"), "utf8")).parthenon, "places/parthenon.glb");
});

test("the Parthenon stands beside Ayn Rand's villa on dry ground, cottages keep clear, and the minimap marks it", () => {
  const main = readFileSync(url("../public/atlas/main.js"), "utf8"), map = readFileSync(url("../public/atlas/minimap.js"), "utf8");
  assert.match(main, /url\('parthenon'\)/);
  assert.match(main, /lakeK\(x, z\) >= 1\.05 && surf_\(x, z\) <= 0\.3/, "dry ground, off the mountains");
  assert.match(main, /inst\.rotation\.y = Math\.atan2\(villa\.a\[0\], villa\.a\[1\]\)/, "faces the city like the villa");
  assert.match(main, /pth\.r \+ 14/, "cottages are moved away from it");
  assert.match(map, /u\.parthenon/);
});
