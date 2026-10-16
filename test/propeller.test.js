import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8"), models = readFileSync(new URL("../public/atlas/models.js", import.meta.url), "utf8");

test("Midas's propeller is its own mesh and spins about the nose axis while he flies", () => {
  assert.match(models, /split\?\.\(g, mat\) \? side : parts/, "flattenScene can keep a part apart");
  assert.match(main, /m_\?\.name === 'mat15'/, "the propeller is the model's mat15");
  assert.match(main, /spin\.rotation\.x \+= 32 \* dtm \* \(1 - ease\(w\)\)/, "fast in the air, still when parked");
});
