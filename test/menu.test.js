import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the menu can slide off to the left and a tab brings it back", () => {
  const html = readFileSync(new URL("../public/atlas/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.ok(html.includes('id="hudSlide"') && html.includes('id="hudTab"'), "slide button and tab exist");
  assert.ok(html.includes("#hud.away { transform:translateX("), "the menu moves off the left edge");
  assert.ok(js.includes("$('hudSlide').onclick = () => slide(true)") && js.includes("tab.onclick = () => slide(false)"), "both are wired");
});
