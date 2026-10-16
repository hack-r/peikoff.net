import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const links = JSON.parse(readFileSync(new URL("../public/links/objectivist.json", import.meta.url), "utf8"));
const home = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const atlas = readFileSync(new URL("../public/atlas/index.html", import.meta.url), "utf8");

test("objectivist links: static copy of the websites table, sorted, https, no known-dead sites", () => {
  assert.ok(links.length > 300, "most of the table is kept");
  assert.ok(links.every((l) => l.label && /^https?:\/\//.test(l.href)), "every row has a label and an absolute URL");
  assert.equal(new Set(links.map((l) => l.href)).size, links.length, "no duplicate URLs");
  const dead = ["aynrand.gr", "objektivizam.org", "intellectualactivist.com", "arc-tv.com", "dailyobjectivist.com", "obmov.8m.com", "capitalismcenter.org", "duncanscott.com", "rand-bg.eu", "obiektywizm.pl/", "aynrandcentereurope.org"];
  for (const d of dead) assert.ok(!links.some((l) => l.href.includes(d)), `${d} is known dead and must not be listed`);
});

test("homepage terminal: /links, Ctrl+C, /data unlisted, CSV button hidden until unlocked", () => {
  assert.match(home, /"\/links"/);
  assert.match(home, /event\.ctrlKey/);
  assert.match(home, /id="downloadCsv" type="button" hidden/);
  assert.match(home, /downloadCsvButton\.hidden = false/);
  const help = /println\("Commands:[^"]*"\)/.exec(home)?.[0] ?? "";
  assert.ok(help.includes("/links") && !help.includes("/data"), "help line lists /links but not /data");
});

test("atlas viewer: attribution and canonical on the path that works", () => {
  assert.match(atlas, /&copy; 2026 Ason Peikoff\./);
  assert.match(atlas, /rel="canonical" href="https:\/\/peikoff\.net\/atlas\/"/);
});
