import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Elevator, chooseCar } from "../public/atlas/elevator.js";
import { signBlocks } from "../public/atlas/names.js";

const root = fileURLToPath(new URL("../public", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".glb": "model/gltf-binary" };

test("chooseCar copes with a building that has no elevators (one floor): it never reads a missing car", () => {
  assert.equal(chooseCar([{ ex: 1, ey: 1 }], [], 0, 0, 0, false), 0);
  const e = new Elevator();
  assert.equal(chooseCar([{ ex: 1, ey: 1 }, { ex: 9, ey: 1, exec: true }], [e, new Elevator()], 0, 8, 1, true), 1, "an executive passenger gets the executive car");
});

test("a sign blocks the whole figure, head to feet, not only the point at its middle", () => {
  const sign = { sx: 400, sy: 100, dist: 30, hw: 60, hh: 15 };
  assert.ok(!signBlocks(sign, { sx: 400, sy: 300, dist: 50 }), "a point figure well below the sign");
  assert.ok(signBlocks(sign, { sx: 400, sy: 300, dist: 50, ry: 190 }), "the head of a tall figure reaches the sign");
  assert.ok(signBlocks(sign, { sx: 470, sy: 100, dist: 50, rx: 15 }), "the side of the body reaches under the sign's edge");
  assert.ok(!signBlocks({ ...sign, dist: 90 }, { sx: 400, sy: 100, dist: 50 }), "a sign far behind the figure stays");
});

// The scene is run for real in headless Chromium (skipped where Playwright or Chromium is not installed).
async function launch() {
  let chromium; for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) { try { ({ chromium } = await import(spec)); break; } catch {} }
  if (!chromium) return null;
  const exe = ["/opt/pw-browsers/chromium", process.env.CHROMIUM_PATH].filter(Boolean).find(existsSync);
  try { return await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] }); } catch { return null; }
}

test("Atlas simulation: Ayn Rand and Leonard keep moving (also after /salon), nobody overlaps on a floor, nobody's head is above the ceiling", { timeout: 240000 }, async (t) => {
  const browser = await launch(); if (!browser) { t.skip("no headless Chromium"); return; }
  const server = createServer((req, res) => { try { const f = join(root, decodeURIComponent(req.url.split("?")[0])); res.setHeader("content-type", TYPES[extname(f)] || "application/octet-stream"); res.end(readFileSync(f)); } catch { res.statusCode = 404; res.end(); } });
  await new Promise((r) => server.listen(0, r));
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } }), errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://localhost:${server.address().port}/atlas/index.html`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
    const run = (steps) => page.evaluate((steps) => {
      const v = window.__viewer, P = v.people, B = v.buildings, size = +document.getElementById("sz").value, out = { overlaps: [], tooTall: [], moved: {} };
      const start = {}; for (const id of ["P1", "P2"]) start[id] = P[v.ids.indexOf(id)].slice(0, 2);
      for (let n = 0; n < steps; n++) {
        v.stepWalkers(1 / 30);
        if (n % 25) continue;
        for (let i = 0; i < P.length; i++) {
          if (v.hidden[i] || P[i][3] !== 1) continue;
          if (v.riding[i]) continue;                                                       // riders are in a cabin (p[5] still names the building they left)
          if (P[i][2] < B[P[i][5]].h - 1e-6 && P[i][2] + 1.95 * v.figK(i, size) > B[P[i][5]].h + 1e-6 && out.tooTall.length < 5) out.tooTall.push([v.ids[i], P[i][2], B[P[i][5]].h]);
          for (let j = i + 1; j < P.length; j++) {
            if (v.hidden[j] || P[j][3] !== 1 || v.riding[j] || P[j][5] !== P[i][5] || Math.abs(P[i][2] - P[j][2]) >= 1) continue;
            if (Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]) < 0.7 && out.overlaps.length < 5) out.overlaps.push([v.ids[i], v.ids[j], P[i][2]]);
          }
        }
      }
      for (const id of ["P1", "P2"]) { const p = P[v.ids.indexOf(id)]; out.moved[id] = Math.hypot(p[0] - start[id][0], p[1] - start[id][1]); }
      return out;
    }, steps);
    for (const phase of ["start", "salon", "work"]) {
      if (phase !== "start") await page.evaluate((c) => window.__viewer.command(c), phase);
      const r = await run(4000);
      assert.deepEqual(r.overlaps, [], `${phase}: two people on one floor stand inside each other`);
      assert.deepEqual(r.tooTall, [], `${phase}: a head above the ceiling`);
      for (const id of ["P1", "P2"]) assert.ok(r.moved[id] > 5, `${phase}: ${id} moved ${r.moved[id]}`);
    }
    assert.deepEqual(errors, [], "no script errors while everyone walks");
  } finally { await browser.close(); server.close(); }
});
