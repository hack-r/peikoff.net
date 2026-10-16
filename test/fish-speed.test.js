import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("every fish swims at its own constant speed, different from fish to fish", () => {
  assert.match(js, /v: \(1\.2 \+ rnd\(\) \* 3\.3\)/, "own pace, 1.2 to 4.5 m/s");
  assert.match(js, /f\.t \+= f\.v \* Math\.max\(0, dt \|\| 0\) \/ len/, "constant per fish: no change over time");
});
