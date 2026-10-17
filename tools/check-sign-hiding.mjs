// Headless check: after searching a person, no visible building sign may cover their head, body or feet on screen.
// Usage: serve public/ (python3 -m http.server 8123 -d public), then: node tools/check-sign-hiding.mjs [baseUrl] [count]
// Needs Playwright (PLAYWRIGHT_BROWSERS_PATH / executablePath via CHROMIUM env, default /opt/pw-browsers/chromium).
import { createRequire } from "node:module";
const { chromium } = createRequire(process.env.PW_DIR || "/opt/node22/lib/node_modules/")("playwright");
const base = process.argv[2] || "http://localhost:8123", count = +process.argv[3] || 30;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const pg = await b.newPage({ viewport: { width: 390, height: 700 } });   // a phone: signs are biggest on screen there
await pg.goto(base + "/atlas/index.html");
await pg.waitForFunction(() => window.__viewer?.people?.length > 0, null, { timeout: 90000 });
await pg.waitForTimeout(3000); await pg.evaluate(() => document.getElementById("welcome")?.remove());
const n = await pg.evaluate(() => window.__viewer.people.length), bad = []; let hiddenTotal = 0;
for (let t = 0; t < count; t++) {
  const i = Math.floor((t + 0.5) * n / count);
  await pg.evaluate(i => { const v = window.__viewer; v.select(i); v.flyTo(i); }, i);
  await pg.waitForFunction(() => { const v = window.__viewer, p = v.people[v.selected], c = v.camera.position; return Math.hypot(c.x - p[0], c.z - p[1]) < 31; }, null, { timeout: 30000 }).catch(() => {});
  await pg.waitForTimeout(600);
  const r = await pg.evaluate(() => {
    const v = window.__viewer, q = v.people[v.selected], cam = v.camera, W = innerWidth, H = innerHeight, f = H / 2 / Math.tan(cam.fov * Math.PI / 360), k = v.figK(v.selected, +document.getElementById("sz").value);
    cam.updateMatrixWorld();
    const pt = (x, y, z) => { const a = { x, y, z }, V = cam.matrixWorldInverse.elements, d = -(V[2] * x + V[6] * y + V[10] * z + V[14]), cl = V[3] * x + V[7] * y + V[11] * z + V[15]; const px = V[0] * x + V[4] * y + V[8] * z + V[12], py = V[1] * x + V[5] * y + V[9] * z + V[13]; return { sx: W / 2 + px * f / d, sy: H / 2 - py * f / d, d }; };
    const feet = pt(q[0], q[2], q[1]), head = pt(q[0], q[2] + 1.95 * k, q[1]);
    const hw = 0.45 * k * f / feet.d, top = Math.min(head.sy, feet.sy), bot = Math.max(head.sy, feet.sy), cx = (head.sx + feet.sx) / 2;
    const hits = []; let hidden = 0;
    for (const s of v.signs.children) {
      if (!s.visible) { hidden++; continue; }
      const c = pt(s.position.x, s.position.y, s.position.z); if (c.d <= 0 || c.d >= Math.min(feet.d, head.d)) continue;
      const sw = s.scale.x / 2 * f / c.d, sh = s.scale.y / 2 * f / c.d;
      if (Math.abs(c.sx - cx) < sw + hw && top < c.sy + sh && bot > c.sy - sh) hits.push(s.userData.text);
    }
    return { hits, hidden, onScreen: feet.sx > -50 && feet.sx < W + 50 };
  });
  hiddenTotal += r.hidden; if (r.hits.length) bad.push({ i, hits: r.hits });
}
console.log(`searched ${count} people on a phone-sized screen; signs hidden along the way: ${hiddenTotal}; still covering the person: ${bad.length}`, JSON.stringify(bad));
await b.close(); process.exit(bad.length ? 1 : 0);
