import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = /<style>([\s\S]*?)<\/style>/.exec(home)[1];

const hexes = [...css.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1]);
const rgbs = [...css.matchAll(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/g)].map((m) => m.slice(1, 4).map(Number));
const colours = [...hexes.map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))), ...rgbs];

test("landing page palette is warm: no blue-dominant colours and no red styling", () => {
  const blue = colours.filter(([r, g, b]) => b > r + 20 && b >= g);
  assert.deepEqual(blue, [], "no colour should lean blue");
  const red = colours.filter(([r, g, b]) => r > 200 && g < 110 && b < 110);
  assert.deepEqual(red, [], "red is reserved for the Peikoffs");
});

test("Atlas link is always labelled, a 44px+ tap target, and reachable from the terminal too", () => {
  assert.match(home, /<span class="label">Explore the Atlas of Objectivism/);
  assert.match(css, /\.atlas-pill \{[^}]*min-height: 46px/);
  assert.match(css, /\.atlas-pill button \{[^}]*min-width: 46px/);
  assert.match(home, /printLink\("Explore the Atlas of Objectivism[^"]*", "\/atlas\/", true\)/);
  assert.match(home, /atlasHide/);
});

test("legal footer, analytics and terminal commands are untouched", () => {
  for (const href of ["/privacy", "/terms", "/ai-disclosure", "/network"]) assert.ok(home.includes(`href="${href}"`));
  assert.ok(home.includes("analytics.ahrefs.com/analytics.js"));
  assert.match(home, /Commands: \/whois, \/whoare, \/random, \/links, \/atlas/);
});

test("palette menu: seven colour-only swatches, a random one on load, and ?theme= still works", () => {
  const names = [...home.matchAll(/\["([a-z-]+)", "#[0-9a-f]{6}", "#[0-9a-f]{6}"\]/g)].map((m) => m[1]);
  assert.deepEqual(names, ["dusk", "forest", "olive", "plum", "graphite", "forest-light", "olive-light"]);
  assert.match(home, /Math\.floor\(Math\.random\(\) \* THEMES\.length\)/);
  assert.match(home, /new URLSearchParams\(location\.search\)\.get\("theme"\)/);
  for (const n of names.filter((x) => x !== "dusk")) assert.ok(home.includes(`data-theme="${n}"`), `${n} has CSS`);
  assert.match(home, /id="themeBtn"[^>]*aria-label="Colour theme"/);
  assert.ok(!/class="swatch"[^>]*>[A-Za-z]/.test(home), "swatches carry no visible words");
});
