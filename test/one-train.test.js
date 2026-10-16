import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("one track, one train: the freight train that hauls the ore, so trains cannot drive through each other", () => {
  const block = js.slice(js.indexOf("const consists = ["), js.indexOf("const GAP = 0.25 * TS;"));
  assert.equal((block.match(/name: '/g) || []).length, 1, "exactly one train");
  assert.match(block, /name: 'Freight'/);
  assert.ok(!/locomotive-front|high-speed-front/.test(js), "the other trains' models are not loaded or built");
  assert.ok(!js.includes("emitPuff"), "no steam: the freight train is a diesel");
});
