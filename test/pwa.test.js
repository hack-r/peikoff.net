import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import worker from "../src/index.js";
import { homeUrl } from "../src/accounts.js";
import { HINT_KEY, installState, isIos, isStandaloneMode, loadedUrls } from "../public/atlas/pwa.js";
import { PR_FLOOR, SLOW_MS, WARMUP, WINDOW, createGovernor, initialPixelRatio, nextPixelRatio, useAntialias } from "../public/atlas/perf.js";

const dir = new URL("../public/atlas/", import.meta.url);
const read = (p) => readFileSync(new URL(p, dir), "utf8");
const manifest = JSON.parse(read("site.webmanifest"));
const html = read("index.html");

function pngSize(p) { const b = readFileSync(new URL(p, dir)); assert.deepEqual([...b.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${p} is a PNG`); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }

test("the manifest makes the Atlas installable: name, start_url, scope, standalone, colours", () => {
  assert.equal(manifest.name, "Atlas of Objectivism");
  assert.ok(manifest.short_name && manifest.short_name.length <= 12);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./", "relative, so it is /atlas/ on peikoff.net and / on atlas.peikoff.net");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.id, "./");
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.ok(manifest.description);
});

test("the manifest icons exist at their declared sizes, with 192 and 512 for both any and maskable", () => {
  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL(icon.src, dir)), `${icon.src} exists`);
    if (icon.type === "image/png") { const [w, h] = pngSize(icon.src); assert.equal(`${w}x${h}`, icon.sizes, icon.src); }
  }
  for (const purpose of ["any", "maskable"]) for (const sizes of ["192x192", "512x512"])
    assert.ok(manifest.icons.some((i) => i.purpose === purpose && i.sizes === sizes && i.type === "image/png"), `${purpose} ${sizes}`);
  assert.ok(manifest.icons.every((i) => !/\s/.test(i.purpose || "any")), "any and maskable are separate icons (a shared 'any maskable' icon is cropped badly)");
});

test("the page links the manifest and the Apple tags, fits under notches and loads pwa.js", () => {
  assert.match(html, /<link rel="manifest" href="site\.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon" href="apple-touch-icon\.png"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-title"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /name="theme-color" content="#17241d"/);
  assert.match(html, /<script type="module" src="\.\/pwa\.js">/);
  assert.ok(!/user-scalable=no|maximum-scale/.test(html), "the page itself stays zoomable; only the 3D canvas owns its touches");
  assert.match(html, /canvas \{[^}]*touch-action:none/, "the canvas takes every touch (no page pinch-zoom or scroll fighting the camera)");
  assert.match(html, /overscroll-behavior:none/, "no pull-to-refresh while dragging");
});

test("the fixed controls keep clear of the notch and the home bar (safe-area insets)", () => {
  assert.match(html, /--sat:env\(safe-area-inset-top/);
  assert.match(html, /#hud \{[^}]*top:calc\(12px \+ var\(--sat\)\)/);
  assert.match(html, /#card \{[^}]*bottom:calc\(30px \+ var\(--sab\)\)/);
  assert.match(read("chat.js"), /#acct\{position:fixed;top:calc\(12px \+ var\(--sat/);
  assert.match(read("minimap.js"), /#minimap\{position:fixed;top:calc\(12px \+ var\(--sat/);
});

// ---- the service worker, run in a sandbox with its own location

function loadWorker(base) {
  const listeners = {}, test_ = {};
  const sandbox = { self: null, __swTest: test_, URL, Request, Response, Promise, setTimeout, clearTimeout, console };
  sandbox.self = { location: new URL(`${base}sw.js`), addEventListener: (t, f) => { listeners[t] = f; }, __swTest: test_, skipWaiting() {}, clients: { claim() {} } };
  vm.runInNewContext(read("sw.js"), sandbox);
  return { ...test_, listeners };
}
const req = (url, init = {}) => { const r = new Request(url, init); return r; };
const nav = (url) => ({ method: "GET", url, mode: "navigate", headers: new Headers() });

for (const [host, base, root] of [["https://peikoff.net", "https://peikoff.net/atlas/", "/atlas/"], ["https://atlas.peikoff.net", "https://atlas.peikoff.net/", "/"]]) {
  test(`service worker routes on ${host}: shell, vendor, data and models are handled`, () => {
    const sw = loadWorker(base);
    assert.equal(sw.here.pathname, root);
    assert.equal(sw.classify(nav(base)), "page");
    assert.equal(sw.classify(req(`${base}main.js`)), "shell");
    assert.equal(sw.classify(req(`${base}offline.html`)), "shell");
    assert.equal(sw.classify(req(`${base}site.webmanifest`)), "shell");
    assert.equal(sw.classify(req(`${base}vendor/three.module.js`)), "vendor");
    assert.equal(sw.classify(req(`${base}data/whoneedsit.json`)), "data");
    assert.equal(sw.classify(req(`${base}models/places/castle.glb`)), "media");
    assert.equal(sw.classify(req(`${base}models/models.json`)), "media");
  });

  test(`service worker on ${host} never touches the API, billing, sign-in, other origins, writes or Range requests`, () => {
    const sw = loadWorker(base);
    for (const path of ["/api/me", "/api/chat", "/api/auth/google", "/api/auth/session", "/api/billing/checkout", "/api/billing/portal", "/api/stripe/webhook", "/version.json"])
      assert.equal(sw.classify(req(`${host}${path}`)), null, path);
    assert.equal(sw.classify(nav(`${host}/api/me`)), null);
    assert.equal(sw.classify(req("https://checkout.stripe.com/c/pay/x")), null);
    assert.equal(sw.classify(req("https://billing.stripe.com/p/session/x")), null);
    assert.equal(sw.classify(req("https://accounts.google.com/o/oauth2/v2/auth")), null);
    assert.equal(sw.classify(req(`${base}main.js`, { method: "POST", body: "x" })), null);
    assert.equal(sw.classify(req(`${base}models/places/castle.glb`, { headers: { range: "bytes=0-99" } })), null);
    assert.equal(sw.classify(req(`${host}/privacy`)), null, "other pages of the site are left alone");
    assert.equal(sw.classify(nav(`${host}/terms`)), null);
  });
}

test("service worker: every file it precaches exists, and the list covers every script of the viewer", () => {
  const sw = loadWorker("https://peikoff.net/atlas/");
  for (const rel of sw.SHELL) assert.ok(rel === "./" || existsSync(new URL(rel, dir)), `${rel} exists`);
  const shell = new Set(sw.SHELL);
  for (const f of readdirSync(dir)) if (f.endsWith(".js") && f !== "sw.js") assert.ok(shell.has(f), `${f} is precached`);
  for (const f of readdirSync(new URL("vendor/", dir))) if (f.endsWith(".js")) assert.ok(shell.has(`vendor/${f}`), `vendor/${f} is precached`);
  for (const [, spec] of read("main.js").matchAll(/from '\.\/([^']+)'/g)) assert.ok(shell.has(spec), `main.js imports ${spec}`);
  for (const icon of manifest.icons) if (icon.src.endsWith(".png")) assert.ok(shell.has(icon.src), `${icon.src} is precached`);
  assert.ok(shell.has("offline.html") && shell.has("data/whoneedsit.json") && shell.has("site.webmanifest") && shell.has("./"));
});

test("service worker: the install-time download stays small (the models are saved as they are used, not at install)", () => {
  const sw = loadWorker("https://peikoff.net/atlas/");
  const bytes = sw.SHELL.reduce((n, rel) => n + (rel === "./" ? statSync(new URL("index.html", dir)).size : statSync(new URL(rel, dir)).size), 0);
  assert.ok(bytes < 3.5 * 1024 * 1024, `precache is ${(bytes / 1048576).toFixed(2)} MB, budget 3.5 MB`);
  assert.ok(!sw.SHELL.some((r) => r.startsWith("models/")));
});

test("service worker: never caches /api/ (source check), skips non-basic responses, and cleans up old versions", () => {
  const src = read("sw.js");
  assert.match(src, /startsWith\("\/api\/"\)/);
  assert.match(src, /res\.status === 200 && res\.type === "basic" && !res\.redirected/);
  assert.match(src, /name\.startsWith\("atlas-"\) && !KEEP\.has\(name\)/);
  assert.match(src, /clients\.claim\(\)/);
  assert.match(src, /offline\.html/);
});

test("the Worker serves the service worker and the manifest at the root of atlas.<domain>, the scope the page needs", async () => {
  const seen = [];
  const env = { ASSETS: { fetch(r) { seen.push(new URL(r.url).pathname); return new Response("asset"); } } };
  for (const path of ["/sw.js", "/site.webmanifest", "/offline.html"]) assert.equal((await worker.fetch(new Request(`https://atlas.peikoff.net${path}`), env)).status, 200);
  assert.deepEqual(seen, ["/atlas/sw.js", "/atlas/site.webmanifest", "/atlas/offline.html"]);
});

test("sign-in and Stripe return addresses land inside the installed app's scope on both hosts", () => {
  assert.equal(homeUrl("https://peikoff.net"), "https://peikoff.net/atlas/");
  assert.equal(homeUrl("https://atlas.peikoff.net"), "https://atlas.peikoff.net/");
  const sw = loadWorker("https://peikoff.net/atlas/"), sw2 = loadWorker("https://atlas.peikoff.net/");
  assert.equal(sw.classify(nav(`${homeUrl("https://peikoff.net")}?billing=success`)), "page");
  assert.equal(sw2.classify(nav(`${homeUrl("https://atlas.peikoff.net")}?billing=success`)), "page");
});

// ---- install prompt and device helpers

test("installState: nothing in the installed app, the prompt button when the browser offers one, the Add to Home Screen hint on Safari for iOS", () => {
  const base = { standalone: false, promptReady: false, ios: false, safari: false, dismissed: false };
  assert.equal(installState({ ...base, standalone: true, promptReady: true }), "installed");
  assert.equal(installState({ ...base, promptReady: true }), "prompt");
  assert.equal(installState({ ...base, ios: true, safari: true }), "ios");
  assert.equal(installState({ ...base, ios: true, safari: true, dismissed: true }), "none");
  assert.equal(installState({ ...base, ios: true, safari: false }), "none", "Chrome on iOS cannot add to the home screen from the page");
  assert.equal(installState(base), "none");
  assert.equal(HINT_KEY, "atlasInstallHintDismissed");
});

test("isIos knows iPhone, iPad and the iPad that says Macintosh; isStandaloneMode reads both signals", () => {
  assert.ok(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"));
  assert.ok(isIos("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"));
  assert.ok(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5));
  assert.ok(!isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0));
  assert.ok(!isIos("Mozilla/5.0 (Linux; Android 14; Pixel 8)"));
  assert.ok(isStandaloneMode({ matches: true }) && isStandaloneMode({ navigatorStandalone: true }) && !isStandaloneMode({}));
});

test("loadedUrls keeps only this origin's models and data", () => {
  const o = "https://peikoff.net";
  const urls = loadedUrls([{ name: `${o}/atlas/models/places/castle.glb` }, { name: `${o}/atlas/data/whoneedsit.json` }, { name: `${o}/api/me` }, { name: "https://x.test/models/a.glb" }, { name: "not a url" }], o);
  assert.deepEqual(urls, [`${o}/atlas/models/places/castle.glb`, `${o}/atlas/data/whoneedsit.json`]);
});

// ---- performance on phones

test("initialPixelRatio: desktop keeps 2, phones cap at 1.75, weak devices and Save-Data at 1.5, never below the floor", () => {
  assert.equal(initialPixelRatio({ dpr: 3 }), 2);
  assert.equal(initialPixelRatio({ dpr: 3, coarse: true }), 1.75);
  assert.equal(initialPixelRatio({ dpr: 3, coarse: true, memory: 4 }), 1.5);
  assert.equal(initialPixelRatio({ dpr: 3, coarse: true, saveData: true }), 1.5);
  assert.equal(initialPixelRatio({ dpr: 1 }), 1);
  assert.equal(initialPixelRatio({ dpr: 0.5 }), PR_FLOOR);
  assert.equal(useAntialias({ dpr: 3, coarse: true }), false);
  assert.equal(useAntialias({ dpr: 1.5, coarse: true }), true);
  assert.equal(useAntialias({ dpr: 2, coarse: false }), true);
});

test("nextPixelRatio steps down by a fifth only when frames are slow", () => {
  assert.equal(nextPixelRatio(2, 16), 2);
  assert.equal(nextPixelRatio(2, SLOW_MS + 1), 1.6);
  assert.equal(nextPixelRatio(1, 50), 0.8);
  assert.equal(nextPixelRatio(0.8, 50), PR_FLOOR);
  assert.equal(nextPixelRatio(PR_FLOOR, 90), PR_FLOOR);
});

test("the governor waits out the warm-up, measures a window, steps down, and ignores stalls", () => {
  const seen = []; const g = createGovernor({ ratio: 2, onChange: (r) => seen.push(r) });
  for (let i = 0; i < WARMUP + WINDOW - 1; i++) g.frame(60);
  assert.deepEqual(seen, [], "no decision before a full window after the warm-up");
  g.frame(60); assert.deepEqual(seen, [1.6]);
  for (let i = 0; i < 30 + WINDOW; i++) g.frame(60);
  assert.deepEqual(seen, [1.6, 1.28], "settles 30 frames, then measures again");
  const calm = []; const g2 = createGovernor({ ratio: 2, onChange: (r) => calm.push(r) });
  for (let i = 0; i < WARMUP + 5 * WINDOW; i++) g2.frame(16);
  g2.frame(5000); for (let i = 0; i < 200; i++) g2.frame(16);
  assert.deepEqual(calm, [], "fast frames and a one-off stall change nothing");
});

test("main.js wires the pixel ratio, the antialias choice and the governor; ?pr= pins the ratio", () => {
  const js = read("main.js");
  assert.match(js, /import \{ createGovernor, initialPixelRatio, useAntialias \} from '\.\/perf\.js'/);
  assert.match(js, /new THREE\.WebGLRenderer\(\{ antialias: useAntialias\(devInfo\) \}\)/);
  assert.match(js, /prFixed > 0 \? prFixed : initialPixelRatio\(devInfo\)/);
  assert.match(js, /governor\?\.frame\(t - last\)/);
});
