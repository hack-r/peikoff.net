import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("fish swim at different speeds, and each one surges and eases off (never backwards)", () => {
  assert.match(js, /v: \(1\.2 \+ rnd\(\) \* 3\.3\)/, "own pace, 1.2 to 4.5 m/s");
  const [, a, b] = js.match(/surge: ([\d.]+) \+ rnd\(\) \* ([\d.]+)/);
  assert.ok(+a + +b < 1, "the surge factor stays below 1, so the speed never reaches zero or reverses");
  assert.match(js, /f\.v \* \(1 \+ f\.surge \* Math\.sin\(time \* f\.pace \+ f\.ph \* 2\)\)/);
});
