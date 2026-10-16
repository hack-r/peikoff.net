import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("the railway is a freight line, not a loop: depot, through a mountain by tunnel, to the mine", () => {
  assert.ok(!js.includes("loopTunnels") && !js.includes("const edges = [["), "no rounded-rectangle loop any more");
  assert.match(js, /const astar = \(a, g\) =>/, "the route is searched round everything forbidden");
  assert.match(js, /if \(tunnelsOf\(pts\) >= 1\)/, "and must go under a mountain");
  assert.match(js, /run < 24 \|\| run > 900 \|\| peak_ < 26/, "by a tunnel of sensible length, under a tall mountain");
  assert.match(js, /Atlantis Freight Depot/);
});

test("the train shuttles: loads at the mine, runs back with its other locomotive leading, unloads at the depot, goes again", () => {
  assert.match(js, /'cargo-train-wagon', 'cargo-train-front'\]\.map\(CAR\)/, "a locomotive at each end");
  assert.match(js, /if \(i === tr\.cars\.length - 1\) mesh\.userData\.flip = true/, "the rear one faces the other way");
  assert.match(js, /tr\.st = tr\.dir > 0 \? 'stop' : 'unload'/);
  assert.match(js, /delivered \+= load/);
  assert.match(js, /return tr\.v \* tr\.dir;/, "signed speed: it runs backwards");
});
