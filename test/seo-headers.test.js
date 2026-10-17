// Redirects, canonical hosts and security headers that a crawler (or a security scanner) sees on every response.
import assert from "node:assert/strict";
import test from "node:test";

import worker, { SECURITY_HEADERS } from "../src/index.js";

const env = { ASSETS: { fetch: (req) => new Response(`asset ${new URL(req.url).pathname}`, { headers: { "content-type": "text/html" } }) } };
const get = (url) => worker.fetch(new Request(url, { redirect: "manual" }), env, {});

test("every response carries the security headers: pages, the atlas host, API errors and redirects", async () => {
  for (const url of ["https://peikoff.net/", "https://peikoff.net/privacy", "https://peikoff.net/atlas", "https://atlas.peikoff.net/", "https://atlas.peikoff.net/api/nope", "https://peikoff.net/version.json", "http://peikoff.net/"]) {
    const res = await get(url);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(k), v, `${url} lacks ${k}`);
  }
  assert.match(SECURITY_HEADERS["strict-transport-security"], /max-age=\d{7,}/);
});

test("http and www redirect once, permanently, to the https bare domain, keeping path and query", async () => {
  for (const [from, to] of [["http://peikoff.net/", "https://peikoff.net/"], ["http://peikoff.net/network?a=1", "https://peikoff.net/network?a=1"], ["https://www.peikoff.net/atlas/", "https://peikoff.net/atlas/"], ["http://www.peikoff.net/privacy", "https://peikoff.net/privacy"], ["http://atlas.peikoff.net/", "https://atlas.peikoff.net/"]]) {
    const res = await get(from);
    assert.equal(res.status, 301, from); assert.equal(res.headers.get("location"), to, from);
  }
  assert.equal((await get("http://localhost:8787/")).status, 200, "local dev is not forced to https");
});

test("/atlas is a permanent redirect to /atlas/ (one hop)", async () => {
  const res = await get("https://peikoff.net/atlas");
  assert.equal(res.status, 301); assert.equal(res.headers.get("location"), "https://peikoff.net/atlas/");
});

test("atlas.peikoff.net points search engines at https://peikoff.net/atlas/ and has its own robots.txt", async () => {
  const page = await get("https://atlas.peikoff.net/");
  assert.equal(page.headers.get("link"), '<https://peikoff.net/atlas/>; rel="canonical"');
  assert.equal(page.status, 200);
  const robots = await (await get("https://atlas.peikoff.net/robots.txt")).text();
  assert.match(robots, /^User-agent: \*/); assert.match(robots, /Allow: \//); assert.match(robots, /Disallow: \/api\//); assert.doesNotMatch(robots, /Disallow: \/\s*$/m);
  assert.equal((await get("https://peikoff.net/")).headers.get("link"), null, "the main host page is its own canonical");
});
