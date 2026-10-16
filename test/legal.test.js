import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import worker from "../src/index.js";

const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
const pages = { privacy: "privacy.html", terms: "terms.html", "ai-disclosure": "ai-disclosure.html" };

test("the legal pages exist, are indexable, share one contact address and link to each other", () => {
  for (const [slug, file] of Object.entries(pages)) {
    const html = read(file);
    assert.ok(html.includes(`<link rel="canonical" href="https://peikoff.net/${slug}"`), `${slug} canonical`);
    assert.ok(html.includes("Effective October 16, 2026"), `${slug} dated`);
    assert.ok(html.includes('href="mailto:contact@peikoff.net"'), `${slug} contact`);
    for (const other of Object.keys(pages)) assert.ok(html.includes(`href="/${other}"`), `${slug} links to /${other}`);
  }
});

test("the policies say what the site really does", () => {
  const privacy = read("privacy.html"), terms = read("terms.html");
  for (const word of ["Stripe", "Supabase", "Cloudflare", "atlas_at", "atlas_rt", "chat", "18"]) assert.ok(privacy.includes(word), `privacy mentions ${word}`);
  for (const word of ["$5 per month", "/billing", "Texas", "not the real people"]) assert.ok(terms.includes(word), `terms mention ${word}`);
});

test("sign-in and the Atlas menu point at the policies", () => {
  const chat = read("atlas/chat.js"), atlas = read("atlas/index.html");
  for (const p of ["/terms", "/privacy", "/ai-disclosure"]) { assert.ok(chat.includes(`href="${p}"`), `chat.js links ${p}`); assert.ok(atlas.includes(`href="${p}"`), `menu links ${p}`); }
  assert.ok(read("index.html").includes('class="legal-links"'));
});

test("atlas.<domain> serves the legal pages from the site root, not from /atlas/", async () => {
  const seen = [];
  const env = { ASSETS: { fetch: (req) => { seen.push(new URL(req.url).pathname); return new Response("ok"); } } };
  for (const path of ["/privacy", "/terms", "/ai-disclosure", "/legal.css"]) await worker.fetch(new Request(`https://atlas.peikoff.net${path}`), env, {});
  assert.deepEqual(seen, ["/privacy", "/terms", "/ai-disclosure", "/legal.css"]);
});
