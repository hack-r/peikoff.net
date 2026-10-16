import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const xml = fs.readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

test("the sitemap lists the home page, the Atlas and the network page, once each", () => {
  assert.deepEqual(locs, ["https://peikoff.net/", "https://peikoff.net/atlas/", "https://peikoff.net/network"]);
});

test("every sitemap address is the canonical address its page declares", () => {
  const pages = { "https://peikoff.net/": "index.html", "https://peikoff.net/atlas/": "atlas/index.html", "https://peikoff.net/network": "network.html" };
  for (const loc of locs) {
    const html = fs.readFileSync(new URL(`../public/${pages[loc]}`, import.meta.url), "utf8");
    assert.ok(html.includes(`<link rel="canonical" href="${loc}"`), `${loc} is not its own canonical`);
  }
});
