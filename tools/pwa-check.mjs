// Headless-Chromium check of the Atlas as an installable app (run from the repo root: node tools/pwa-check.mjs).
// Serves public/ on two local ports the way the Worker does (peikoff.net/atlas/ and atlas.peikoff.net/), then checks on each:
// Chrome's own installability errors, service worker scope, what is cached (and that /api/ is not), real offline start (the server is stopped,
// because Playwright's setOffline does not cover service-worker fetches), the ?billing=success return offline, the offline fallback page,
// pixel ratio on a phone viewport, bytes to first ready, and the install button (Android) and Add to Home Screen hint (iOS).
// Needs Playwright: PLAYWRIGHT=/path/to/playwright/index.js (default /opt/node22/lib/node_modules/playwright/index.js). Prints JSON.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url); const { chromium, devices } = require(process.env.PLAYWRIGHT || "/opt/node22/lib/node_modules/playwright/index.js");
const PUB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../public");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".ico": "image/x-icon", ".gif": "image/gif", ".mp4": "video/mp4" };
const hits = []; const servers = {};
function serve(port, prefix) {   // prefix "" = like peikoff.net, "/atlas" = like atlas.peikoff.net (the Worker maps / to /atlas/)
  return new Promise((res) => servers[port] = http.createServer((rq, rs) => {
    const u = new URL(rq.url, "http://x"); hits.push(port + u.pathname);
    if (u.pathname.startsWith("/api/")) { rs.writeHead(u.pathname === "/api/me" ? 200 : 404, { "content-type": "application/json", "cache-control": "no-store" }); return rs.end(JSON.stringify({ user: null, accounts: false, providers: [], billing: false })); }
    let p = u.pathname; if (prefix) p = p === "/" ? "/atlas/" : prefix + p; if (p.endsWith("/")) p += "index.html";
    const f = path.join(PUB, p); if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end("nf"); }
    const b = fs.readFileSync(f); rs.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream", "cache-control": "public, max-age=0, must-revalidate", etag: `"${b.length}-${fs.statSync(f).mtimeMs}"` }); rs.end(b);
  }).listen(port, () => res()));
}
await serve(8741, ""); await serve(8742, "/atlas");
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const out = {};
for (const [name, url] of [["peikoff.net/atlas/", "http://localhost:8741/atlas/"], ["atlas.peikoff.net/", "http://localhost:8742/"]]) {
  const r = {}; const ctx = await browser.newContext({ viewport: { width: 412, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 }); const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  let bytes = 0; const cdp0 = await ctx.newCDPSession(page); await cdp0.send("Network.enable"); cdp0.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; });
  const t0 = Date.now(); await page.goto(url); await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }); await page.waitForTimeout(500); r.coldReadyMs = Date.now() - t0; r.coldBytesMB = +(bytes / 1048576).toFixed(2);
  const cdp = await ctx.newCDPSession(page);
  const man = await cdp.send("Page.getAppManifest"); r.manifestUrl = man.url; r.manifestErrors = man.errors; const mj = JSON.parse(man.data); r.manifest = { start_url: mj.start_url, scope: mj.scope, display: mj.display, icons: mj.icons.length };
  const inst = await cdp.send("Page.getInstallabilityErrors"); r.installabilityErrors = inst.installabilityErrors;
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated", null, { timeout: 30000 });
  r.swScope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
  await page.waitForTimeout(13000);   // pwa.js tells the worker what loaded, after 10 s
  r.caches = await page.evaluate(async () => { const o = {}; for (const n of await caches.keys()) o[n] = (await (await caches.open(n)).keys()).length; return o; });
  r.apiCached = await page.evaluate(async () => { for (const n of await caches.keys()) for (const k of await (await caches.open(n)).keys()) if (new URL(k.url).pathname.startsWith("/api/")) return k.url; return null; });
  r.pixelRatio = await page.evaluate(() => window.__viewer && document.querySelector("canvas").width / innerWidth);
  // warm (service worker in control): bytes
  bytes = 0; const t1 = Date.now(); await page.reload(); await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }); r.warmReadyMs = Date.now() - t1; r.warmBytesMB = +(bytes / 1048576).toFixed(2); r.warmControlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  // offline
  const port = +new URL(url).port; servers[port].closeAllConnections(); await new Promise((r) => servers[port].close(r)); const t2 = Date.now(); await page.reload(); await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }); r.offlineReadyMs = Date.now() - t2; r.offlineCanvas = await page.evaluate(() => !!document.querySelector("canvas")); r.offlineErrs = errs.filter((e) => !/Failed to load resource|net::ERR/.test(e)).length;
  // offline navigation to an unsaved in-scope url in a brand new context -> nothing cached: offline page can't be served without a worker; so check the worker's fallback with a search string instead
  await page.goto(url + "?billing=success"); await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }); r.offlineBillingReturn = await page.evaluate(() => !!document.querySelector("canvas"));
  await page.evaluate(async () => { await (await caches.open((await caches.keys()).find((k) => k.startsWith("atlas-shell")))).delete(new URL("./", location.href).href); });
  await page.goto(url); r.offlineFallbackPage = await page.evaluate(() => document.title); 
  r.errs = errs.slice(0, 5); out[name] = r; await ctx.close();
}
await serve(8741, ""); { // iOS Safari: hint; Android: install button
  const ios = await browser.newContext({ ...devices["iPhone 13"] }); const p = await ios.newPage(); await p.goto("http://localhost:8741/atlas/"); await p.waitForTimeout(1500);
  out.iosHintVisible = await p.evaluate(() => { const h = document.getElementById("installHint"); return !!h && !h.hidden && !document.getElementById("installRow").hidden; });
  await p.evaluate(() => document.getElementById("installHintX").click()); out.iosHintDismissedHides = await p.evaluate(() => document.getElementById("installRow").hidden); await ios.close();
  const an = await browser.newContext({ ...devices["Pixel 7"] }); const q = await an.newPage(); await q.goto("http://localhost:8741/atlas/"); await q.waitForTimeout(1000);
  await q.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__prompted = true; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(e); });
  out.androidButtonVisible = await q.evaluate(() => !document.getElementById("installBtn").hidden); await q.evaluate(() => document.getElementById("installBtn").click()); await q.waitForTimeout(300);
  out.androidPrompted = await q.evaluate(() => window.__prompted === true); out.androidButtonHiddenAfter = await q.evaluate(() => document.getElementById("installRow").hidden); await an.close();
}
console.log(JSON.stringify(out, null, 1)); await browser.close(); process.exit(0);
