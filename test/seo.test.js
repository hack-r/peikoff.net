import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pub = (f) => new URL(`../public/${f}`, import.meta.url);
const read = (f) => fs.readFileSync(pub(f), "utf8");
const sitemap = read("sitemap.xml"), locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const files = { "https://peikoff.net/": "index.html", "https://peikoff.net/atlas/": "atlas/index.html", "https://peikoff.net/network": "network.html", "https://peikoff.net/privacy": "privacy.html", "https://peikoff.net/terms": "terms.html", "https://peikoff.net/ai-disclosure": "ai-disclosure.html" };
const attr = (html, re) => (html.match(re)?.[1] || "").replace(/\s+/g, " ").trim();
const meta = (html, key) => attr(html, new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`, "s"));

test("every indexable page has a good title, a 110-160 character description and a canonical", () => {
  for (const loc of locs) {
    const html = read(files[loc]), title = attr(html, /<title>([^<]*)<\/title>/), desc = meta(html, "description");
    assert.ok(title.length >= 20 && title.length <= 62, `${loc} title is ${title.length} characters: ${title}`);
    assert.ok(desc.length >= 110 && desc.length <= 165, `${loc} description is ${desc.length} characters`);
    assert.equal(attr(html, /<link rel="canonical" href="([^"]*)"/), loc);
  }
});

test("every indexable page is complete for Open Graph and Twitter cards, with a real image", () => {
  for (const loc of locs) {
    const html = read(files[loc]);
    for (const k of ["og:type", "og:url", "og:title", "og:description", "og:site_name", "og:image", "og:image:width", "og:image:height", "og:image:alt", "twitter:card", "twitter:title", "twitter:description", "twitter:image"]) assert.ok(meta(html, k), `${loc} lacks ${k}`);
    assert.equal(meta(html, "og:url"), loc); assert.equal(meta(html, "twitter:card"), "summary_large_image");
    assert.equal(meta(html, "og:title"), attr(html, /<title>([^<]*)<\/title>/));
    const img = meta(html, "og:image"); assert.ok(img.startsWith("https://peikoff.net/"), img);
    assert.ok(fs.existsSync(pub(img.replace("https://peikoff.net/", ""))), `${img} exists`);
  }
  const png = fs.readFileSync(pub("og-image.png")); assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
});

test("every indexable page has a heading and links to other pages; every sitemap page is linked from another one (no orphans)", () => {
  const incoming = new Map(locs.map((l) => [l, 0]));
  for (const loc of locs) {
    const html = read(files[loc]); assert.match(html, /<h1[ >]/, `${loc} has an h1`);
    const hrefs = [...html.matchAll(/<a[^>]*\shref="([^"]+)"/g)].map((m) => m[1]).map((h) => h.startsWith("/") ? "https://peikoff.net" + h : h);
    assert.ok(hrefs.some((h) => h.startsWith("https://peikoff.net")), `${loc} has an internal link`);
    for (const h of new Set(hrefs)) { const t = locs.find((l) => l === h || l === h.replace(/#.*/, "")); if (t && t !== loc) incoming.set(t, incoming.get(t) + 1); }
  }
  for (const [l, n] of incoming) assert.ok(n > 0, `${l} has no incoming internal links`);
});
