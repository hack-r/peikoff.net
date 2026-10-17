import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// /salon, /speak, /home, /work are run for real in headless Chromium (skipped where Playwright or Chromium is not installed). On every frame, nobody who is outdoors may stand inside a cottage,
// a house, the villa, a prop, the forum hall, another building than their own, or any chair but their own (the same obstacle set the planner uses, raw shapes without the walking margin).
const root = fileURLToPath(new URL("../public", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".glb": "model/gltf-binary" };

async function launch() {
  let chromium; for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) { try { ({ chromium } = await import(spec)); break; } catch {} }
  if (!chromium) return null;
  const exe = ["/opt/pw-browsers/chromium", process.env.CHROMIUM_PATH].filter(Boolean).find(existsSync);
  try { return await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] }); } catch { return null; }
}

test("Atlas walks: nobody passes through a cottage, house, prop, building, hall or chair on /salon, /speak, /home or /work", { timeout: 900000 }, async (t) => {
  const browser = await launch(); if (!browser) { t.skip("no headless Chromium"); return; }
  const server = createServer((req, res) => { try { const f = join(root, decodeURIComponent(req.url.split("?")[0])); res.setHeader("content-type", TYPES[extname(f)] || "application/octet-stream"); res.end(readFileSync(f)); } catch { res.statusCode = 404; res.end(); } });
  await new Promise((r) => server.listen(0, r));
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } }), errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => { let s = 12345; Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; });   // the same crowd, delays and sides on every run
    await page.goto(`http://localhost:${server.address().port}/atlas/index.html`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
    await page.waitForFunction(() => window.__viewer.places.salon && window.__viewer.places.forum, null, { timeout: 90000 });
    const report = {};
    for (const kind of ["salon", "speak", "home", "work"]) {
      report[kind] = await page.evaluate((kind) => {
        const v = window.__viewer, P = v.people, k = +document.getElementById("sz").value, out = { frames: 0, hits: 0, kinds: {}, examples: [], kira: 0 };
        v.command(kind);
        const O = v.obstacles().O, where = new Map(v.walkers.map((w) => [w.i, w]));
        const own = (i, o) => {                                       // the obstacles a person may be inside: the building they are leaving or entering, the house or hall they are going to, their own chair
          const w = v.walkers.find((q) => q.i === i), home = w && w.ev && w.ev.home;
          const L0 = w && w.ev && w.ev.path.legs[w.ev.path.li];
          if (L0 && L0.ride && (o.tag === "building" || o.tag === "hall")) return true;   // in the line for an elevator (a long line spills out of a shallow lobby: not a walk)
          if (w && w.ev && o.tag !== "chair" && o.tag !== "cottage" && o.tag !== "prop" && w.ev.path.legs.some((L) => L.ex && L.ex.has(o.id))) return true;   // a building, hall or house this walk starts or ends in (its door, its elevator queue)
          if (o.tag === "building") return o.bi === P[i][5] || (home && home.bid === o.bi);
          if (o.tag === "house") return o.key === v.loc[i] || (v.loc[i] === "castle" && o.key === "castle");
          if (o.tag === "hall") return v.loc[i] === "forum" || (w && w.ev && w.ev.path.legs.some((L) => L.ex && L.ex.has(o.id)));
          if (o.tag === "chair") { const L = w && w.ev && w.ev.path.legs[w.ev.path.li]; return (o.venue === v.loc[i] && o.n === v.seatOf[i]) || !!(L && L.ex && L.ex.has(o.id)); }   // their own chair, or the one they are standing up from
          return false;
        };
        for (let n = 0; n < 5400; n++) {
          v.stepWalkers(1 / 30); v.scenery.userData.stepPrincess((n + 1) / 30);
          if (n % 2) continue;
          out.frames++;
          for (let i = 0; i < P.length; i++) {
            if (v.hidden[i] || P[i][3] === 1 || v.riding[i]) continue;                  // indoors in a building (p[3] === 1) or out of sight inside a house
            for (const o of O.query(P[i][0] - 1, P[i][1] - 1, P[i][0] + 1, P[i][1] + 1)) {
              if (!O.inside(o, P[i][0], P[i][1], 0) || own(i, o)) continue;
              out.hits++; out.kinds[o.tag] = (out.kinds[o.tag] || 0) + 1; if (out.examples.length < 5) { const w = v.walkers.find((q) => q.i === i), L = w && w.ev && w.ev.path.legs[w.ev.path.li]; out.examples.push([v.ids[i], o.tag, o.venue, o.n, +P[i][0].toFixed(1), +P[i][1].toFixed(1), n, L && [L.a.map((x) => +x.toFixed(1)), L.b.map((x) => +x.toFixed(1)), L.ex && [...L.ex].map((id) => O.list[id].tag + (O.list[id].n ?? ""))], v.loc[i], v.seatOf[i]]); }
            }
          }
          const kp = v.scenery.userData.kira.pos();
          for (const o of O.query(kp[0] - 1, kp[1] - 1, kp[0] + 1, kp[1] + 1)) if (o.tag !== "building" && O.inside(o, kp[0], kp[1], 0) && !(o.tag === "house")) out.kira++;
        }
        return out;
      }, kind);
    }
    for (const [kind, r] of Object.entries(report)) {
      assert.ok(r.frames > 2000, `${kind}: the simulation ran (${r.frames} frames)`);
      assert.equal(r.hits, 0, `/${kind}: ${r.hits} frames with someone inside an obstacle: ${JSON.stringify(r.kinds)} e.g. ${JSON.stringify(r.examples)}`);
      assert.equal(r.kira, 0, `/${kind}: Kira walks through an obstacle`);
    }
    assert.deepEqual(errors, [], "no script errors while everyone walks");
  } finally { await browser.close(); server.close(); }
});
