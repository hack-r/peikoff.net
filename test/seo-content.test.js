// What a crawler that does not run JavaScript (Ahrefs Site Audit, Googlebot's first pass) sees in the raw HTML.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pub = (f) => new URL(`../public/${f}`, import.meta.url);
const read = (f) => fs.readFileSync(pub(f), "utf8");
const ORIGIN = "https://peikoff.net";
const pages = { "/": "index.html", "/atlas/": "atlas/index.html", "/network": "network.html", "/privacy": "privacy.html", "/terms": "terms.html", "/ai-disclosure": "ai-disclosure.html" };
const strip = (html) => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ");
const text = (html) => strip(html).replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const links = (html) => [...html.matchAll(/<a\s[^>]*href="([^"#][^"]*)"/g)].map((m) => m[1]);
const internal = (href) => href.startsWith("/") || href.startsWith(ORIGIN);
const path = (href) => href.replace(ORIGIN, "").replace(/[?#].*/, "");

test("every page declares lang, viewport and exactly one h1 in the raw HTML", () => {
  for (const [p, f] of Object.entries(pages)) {
    const html = read(f);
    assert.match(html, /<html[^>]*\slang="en"/, `${p} lang`);
    assert.match(html, /<meta\s+name="viewport"/, `${p} viewport`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${p} must have exactly one h1`);
  }
});

test("the home page has real crawlable content without JavaScript: about text, a Projects list, a site map footer and a noscript note", () => {
  const html = read("index.html"), visible = text(html);
  assert.match(html, /<section id="about"/); assert.match(html, /<section id="projects"/); assert.match(html, /<footer>[\s\S]*Site map/);
  assert.match(html, /<noscript>[^]*JavaScript/);
  assert.ok(visible.split(" ").length >= 150, `home page has ${visible.split(" ").length} words outside scripts`);
  const internals = new Set(links(html).filter(internal).map(path));
  for (const p of ["/atlas/", "/network", "/privacy", "/terms", "/ai-disclosure"]) assert.ok(internals.has(p), `home links to ${p}`);
  assert.ok(links(html).filter((h) => h.startsWith("http") && !h.startsWith(ORIGIN)).length >= 3, "home has outgoing external links");
});

test("the terminal is still there and untouched by the content block", () => {
  const html = read("index.html");
  for (const id of ['id="terminal"', 'id="cmdForm"', 'id="cmd"', 'class="terminal"']) assert.ok(html.includes(id), id);
});

test("the Atlas page has a heading that matches its purpose and a noscript section with links", () => {
  const html = read("atlas/index.html");
  assert.match(html, /<h1 id="title">Atlas of Objectivism<\/h1>/);
  const ns = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] || "";
  assert.ok(ns.length > 300, "noscript describes the Atlas");
  const hrefs = links(ns);
  assert.ok(hrefs.includes("https://peikoff.net/") && hrefs.includes("/network") && hrefs.includes("/privacy"), `noscript links: ${hrefs}`);
});

test("every internal link on every page points at a page that exists (no 404s, no redirects to chase)", () => {
  const known = new Set([...Object.keys(pages), "/legal.css"]);
  for (const [p, f] of Object.entries(pages)) {
    for (const h of links(read(f))) {
      if (!internal(h) || /\.(png|svg|ico|css|json|txt|xml|webmanifest)$/.test(path(h))) continue;
      assert.ok(known.has(path(h)), `${p} links to ${h}, which is not a known page`);
    }
  }
});

test("images have alt text and dimensions; JSON-LD parses; nothing in the sitemap is noindex", () => {
  for (const [p, f] of Object.entries(pages)) {
    const html = read(f);
    for (const img of html.match(/<img\b[^>]*>/g) || []) assert.ok(/\salt="/.test(img) && /\swidth="/.test(img) && /\sheight="/.test(img), `${p}: ${img}`);
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { const j = JSON.parse(m[1]); assert.ok(j["@context"] && j["@type"], `${p} JSON-LD`); }
    assert.ok(!/<meta\s+name="robots"[^>]*noindex/i.test(html), `${p} is in the sitemap but noindex`);
  }
  assert.match(read("404.html"), /noindex/);
});

test("robots.txt allows crawling, keeps /api/ out and names the sitemap", () => {
  const r = read("robots.txt");
  assert.match(r, /^User-agent: \*/m); assert.match(r, /^Allow: \//m); assert.match(r, /^Disallow: \/api\//m); assert.match(r, /^Sitemap: https:\/\/peikoff\.net\/sitemap\.xml/m);
});
