import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const xml = fs.readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

test("the sitemap lists the home page, the Atlas, the network page and the legal pages, once each", () => {
  assert.deepEqual(locs, ["https://peikoff.net/", "https://peikoff.net/atlas/", "https://peikoff.net/network", "https://peikoff.net/privacy", "https://peikoff.net/terms", "https://peikoff.net/ai-disclosure"]);
});

test("every sitemap address is the canonical address its page declares", () => {
  const pages = { "https://peikoff.net/": "index.html", "https://peikoff.net/atlas/": "atlas/index.html", "https://peikoff.net/network": "network.html", "https://peikoff.net/privacy": "privacy.html", "https://peikoff.net/terms": "terms.html", "https://peikoff.net/ai-disclosure": "ai-disclosure.html" };
  for (const loc of locs) {
    const html = fs.readFileSync(new URL(`../public/${pages[loc]}`, import.meta.url), "utf8");
    assert.ok(html.includes(`<link rel="canonical" href="${loc}"`), `${loc} is not its own canonical`);
  }
});
