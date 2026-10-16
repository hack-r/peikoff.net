import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
const snippet = '<script src="https://analytics.ahrefs.com/analytics.js" data-key="KhiDCR1y9Lo7zHR4nvfocQ" async></script>';

test("cookie-free Ahrefs analytics is on every public page, once, and nowhere else", () => {
  for (const f of ["index.html", "404.html", "atlas/index.html", "network.html", "privacy.html", "terms.html", "ai-disclosure.html"]) {
    const html = read(f);
    assert.equal(html.split(snippet).length - 1, 1, f);
    assert.ok(html.indexOf(snippet) < html.indexOf("</head>"), `${f} loads it in the head`);
  }
  for (const f of ["atlas/main.js", "atlas/chat.js"]) assert.ok(!read(f).includes("analytics.ahrefs.com"), f);
});

test("the privacy policy discloses the analytics on the pages that carry it", () => {
  const privacy = read("privacy.html");
  assert.ok(privacy.includes("Ahrefs") && privacy.includes("without cookies") && privacy.includes("the Atlas, the network page"));
});
