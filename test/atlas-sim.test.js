import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Elevator, chooseCar } from "../public/atlas/elevator.js";
import { signBlocks } from "../public/atlas/names.js";
import { FLOOR_H, stretchFloors } from "../public/atlas/floors.js";

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

test("stretchFloors: every building and every person's floor scales together, so floors still line up; true heights are kept for the cards", () => {
  const city = { floor_h: 3.5, buildings: [{ h: 7, floors: 2 }, { h: 3.5, floors: 1 }, { h: 73.5, floors: 21 }], people: [[0, 0, 0], [0, 0, 3.5], [0, 0, 70]] };
  const f = stretchFloors(city);
  assert.equal(city.floor_h, FLOOR_H);
  assert.ok(city.buildings.every((b) => Math.abs(b.h - b.floors * FLOOR_H) < 1e-9), "height is still floors x floor height");
  assert.ok(city.people.every((p) => Math.abs(p[2] / FLOOR_H - Math.round(p[2] / FLOOR_H)) < 1e-9), "people stand exactly on a floor");
  assert.equal(city.buildings[2].m, 73.5);
  assert.ok(f > 1 && FLOOR_H >= 1.95 * 3, "a default-size (3) figure with its crown fits in one floor");
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
          const fl = P[i][2] / v.floorH;
          if (Math.abs(fl - Math.round(fl)) < 1e-6 && P[i][2] < B[P[i][5]].h - 1e-6 && P[i][2] + 1.95 * v.figK(i, size) > B[P[i][5]].h + 1e-6 && out.tooTall.length < 5) out.tooTall.push([v.ids[i], P[i][2], B[P[i][5]].h]);   // standing on a floor (not on a bridge deck or between floors)
          for (let j = i + 1; j < P.length; j++) {
            if (v.hidden[j] || P[j][3] !== 1 || v.riding[j] || P[j][5] !== P[i][5] || Math.abs(P[i][2] - P[j][2]) >= 1) continue;
            if (Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]) < 0.7 && out.overlaps.length < 5) out.overlaps.push([v.ids[i], v.ids[j], P[i][2]]);
          }
        }
      }
      for (const id of ["P1", "P2"]) { const p = P[v.ids.indexOf(id)]; out.moved[id] = Math.hypot(p[0] - start[id][0], p[1] - start[id][1]); }
      return out;
    }, steps);
    await page.waitForFunction(() => window.__viewer.places.salon, null, { timeout: 90000 });   // the villa loads after the page is ready; /salon does nothing before
    assert.equal(await page.evaluate(() => window.__viewer.figK(0, 3)), 3, "indoors a default-size figure is drawn full size (the floors are tall enough)");
    for (const phase of ["start", "salon", "work"]) {
      if (phase !== "start") await page.evaluate((c) => window.__viewer.command(c), phase);
      if (phase === "salon") {          // the camera follows Ayn Rand until the user touches the view
        const gap = () => page.evaluate(() => { const v = window.__viewer, p = v.people[v.ids.indexOf("P1")], t = v.controls.target; return Math.hypot(t.x - p[0], t.z - p[1]); });
        assert.ok(await page.evaluate(() => window.__viewer.followOf() >= 0), "/salon starts following Ayn");
        for (let n = 0; n < 30; n++) await page.evaluate(() => { window.__viewer.stepWalkers(1 / 30); window.__viewer.stepFollow(1 / 30); });
        assert.ok(await gap() < 40, `the view point is on Ayn (${await gap()} away)`);
        await page.evaluate(() => document.querySelector("canvas").dispatchEvent(new WheelEvent("wheel", { deltaY: 1 })));
        assert.equal(await page.evaluate(() => window.__viewer.followOf()), -1, "scrolling the view ends the follow");
      }
      const r = await run(4000);
      assert.deepEqual(r.overlaps, [], `${phase}: two people on one floor stand inside each other`);
      assert.deepEqual(r.tooTall, [], `${phase}: a head above the ceiling`);
      for (const id of ["P1", "P2"]) assert.ok(r.moved[id] > 5, `${phase}: ${id} moved ${r.moved[id]}`);
    }
    assert.deepEqual(errors, [], "no script errors while everyone walks");
  } finally { await browser.close(); server.close(); }
});
