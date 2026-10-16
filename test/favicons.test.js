import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import worker from "../src/index.js";

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url));
const PAGES = [
  { html: "index.html", dir: "", abs: true },
  { html: "privacy.html", dir: "", abs: true },
  { html: "terms.html", dir: "", abs: true },
  { html: "ai-disclosure.html", dir: "", abs: true },
  { html: "404.html", dir: "", abs: true },
  { html: "network.html", dir: "", abs: true },
  { html: "atlas/index.html", dir: "atlas/", abs: false },
];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test("every page links the svg, png, ico, apple-touch icon and manifest, and each file exists", () => {
  for (const { html, dir, abs } of PAGES) {
    const src = read(html).toString();
    for (const name of ["favicon.svg", "favicon-32.png", "favicon.ico", "apple-touch-icon.png", "site.webmanifest"]) {
      const m = src.match(new RegExp(`href="(/?${name.replace(".", "\\.")})"`));
      assert.ok(m, `${html} links ${name}`);
      assert.equal(m[1].startsWith("/"), abs, `${html}: ${name} is ${abs ? "root-relative" : "relative to /atlas/"}`);
      assert.ok(existsSync(new URL(`../public/${dir}${name}`, import.meta.url)), `${dir}${name} exists`);
    }
    assert.match(src, /name="theme-color"/, `${html} sets theme-color`);
  }
});

test("homepage and atlas icons are different, and neither uses red", () => {
  const home = read("favicon.svg").toString();
  const atlas = read("atlas/favicon.svg").toString();
  assert.notEqual(home, atlas);
  assert.notDeepEqual(read("favicon.ico"), read("atlas/favicon.ico"));
  for (const svg of [home, atlas]) {
    for (const [, hex] of svg.matchAll(/#([0-9a-f]{6})/gi)) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      assert.ok(!(r > 150 && g < 100 && b < 100), `#${hex} is not red`);
    }
  }
});

test("PNG and ICO files have the sizes the link tags promise", () => {
  for (const dir of ["", "atlas/"]) {
    for (const [name, size] of [["favicon-32.png", 32], ["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
      const buf = read(dir + name);
      assert.deepEqual(buf.subarray(0, 4), PNG);
      assert.equal(buf.readUInt32BE(16), size, `${dir}${name} width`);
      assert.equal(buf.readUInt32BE(20), size, `${dir}${name} height`);
    }
    const ico = read(`${dir}favicon.ico`);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.deepEqual([...Array(ico.readUInt16LE(4)).keys()].map((i) => ico[6 + 16 * i]), [16, 32, 48]);
  }
});

test("manifests point at icons that exist", () => {
  for (const dir of ["", "atlas/"]) {
    const manifest = JSON.parse(read(`${dir}site.webmanifest`));
    assert.ok(manifest.icons.length >= 2);
    for (const icon of manifest.icons) {
      const file = icon.src.replace(/^\//, "");
      assert.ok(existsSync(new URL(`../public/${dir}${file}`, import.meta.url)), `${dir}${file} exists`);
    }
  }
});

test("the worker serves /favicon.ico from the right folder on each host", async () => {
  const seen = [];
  const env = { ASSETS: { fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response("ok"); } } };
  await worker.fetch(new Request("https://peikoff.net/favicon.ico"), env, {});
  await worker.fetch(new Request("https://atlas.peikoff.net/favicon.ico"), env, {});
  await worker.fetch(new Request("https://atlas.peikoff.net/site.webmanifest"), env, {});
  assert.deepEqual(seen, ["/favicon.ico", "/atlas/favicon.ico", "/atlas/site.webmanifest"]);
});
