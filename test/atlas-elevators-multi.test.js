import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CAPACITY, Elevator, chooseCar, queueSpot } from "../public/atlas/elevator.js";
import { carCounts, makeArch, planLegs } from "../public/atlas/paths.js";

const city = JSON.parse(readFileSync(new URL("../public/atlas/data/whoneedsit.json", import.meta.url), "utf8"));
const main = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
const B = city.buildings, FH = city.floor_h, PITCH = 36;
const ari = B.findIndex((b) => b.org_id === 1), top = new Set(city.exclusive_top[String(ari)]);
const counts = carCounts(B), arch = makeArch(B, PITCH, { counts, exec: new Set([ari]) });
const tall = B.map((b, i) => i).filter((i) => B[i].floors >= 2).sort((a, b) => B[b].floors - B[a].floors);

test("the tallest building has three elevators, the next tallest two, the rest one, single floors none; shafts are spread apart inside the walls", () => {
  assert.equal(counts[tall[0]], 3); assert.equal(counts[tall[1]], 2);
  B.forEach((b, i) => { if (b.floors < 2) assert.equal(counts[i], 0); else if (i !== tall[0] && i !== tall[1]) assert.equal(counts[i], 1); });
  B.forEach((b, i) => {
    if (b.floors < 2) return;
    const xs = arch[i].cars.map((c) => c.ex).sort((p, q) => p - q);
    assert.ok(xs.every((x) => x > b.x0 + 1 && x < b.x1 - 1));
    xs.slice(1).forEach((x, k) => assert.ok(x - xs[k] >= 4, `building ${i}: shafts ${x - xs[k]} apart`));
  });
});

test("ARI has exactly one executive car on top of its ordinary ones", () => {
  assert.equal(arch[ari].cars.filter((c) => c.exec).length, 1);
  assert.equal(arch[ari].cars.length, counts[ari] + 1);
  B.forEach((b, i) => { if (i !== ari) assert.ok(arch[i].cars.every((c) => !c.exec)); });
  assert.match(main, /xShaftMesh/); assert.match(main, /0xffd36a/);
});

test("simulation: crowds in every tall building spread over the cars, never overlap in line, and only Ayn and Leonard ride the executive car", () => {
  const els = B.map((b) => (b.floors >= 2 ? [] : null));
  B.forEach((b, i) => { if (els[i]) arch[i].cars.forEach(() => els[i].push(new Elevator())); });
  const sep = 2.3, people = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const bi of tall) for (let n = 0; n < 40; n++) people.push({ bi, id: n < 2 && bi === ari ? [...top][n] : `X${bi}_${n}`, z: 0, dest: (1 + Math.floor(rnd() * (B[bi].floors - 1 - (bi === ari ? 1 : 0)))) * FH, car: -1, at: rnd() * 20, pos: [arch[bi].cx, B[bi].y0 + 1.5] });
  for (const p of people) if (top.has(p.id)) p.dest = (B[ari].floors - 1) * FH;
  const used = new Map(), execRiders = new Set(), done = new Set(), dt = 0.05;
  let minGap = Infinity;
  for (let t = 0; t < 900 && done.size < people.length; t += dt) {
    els.forEach((cars) => cars && cars.forEach((e) => e.step(dt)));
    for (const [k, p] of people.entries()) {
      if (done.has(k) || t < p.at) continue;
      const cars = arch[p.bi].cars, es = els[p.bi], a = () => cars[p.car];
      if (p.car < 0) { p.car = chooseCar(cars, es, 0, p.pos[0], p.pos[1], bi_exec(p)); es[p.car].request(k, 0, p.dest); used.set(`${p.bi}:${p.car}`, (used.get(`${p.bi}:${p.car}`) || 0) + 1); }
      const e = es[p.car], ph = e.phase(k);
      const go = (x, y) => { const dx = x - p.pos[0], dy = y - p.pos[1], d = Math.hypot(dx, dy); if (d < 0.05) return true; const s = Math.min(d, 1.4 * dt); p.pos[0] += dx / d * s; p.pos[1] += dy / d * s; return false; };
      if (ph === "waiting") { const s = queueSpot(a(), B[p.bi], e.queueIndex(k), sep); go(s[0], s[1]); }
      else if (ph === "boarding") { if (go(a().ex, a().ey)) { e.boarded(k); if (a().exec) execRiders.add(p.id); else assert.ok(!(p.bi === ari && top.has(p.id)), "Ayn and Leonard ride the executive car only"); } }
      else if (ph === "exiting") { e.release(k); done.add(k); }
      else if (ph === "riding") { p.pos[0] = a().ex; p.pos[1] = a().ey; if (a().exec) execRiders.add(p.id); }
      assert.ok(e.inCar() <= CAPACITY);
    }
    for (const bi of tall) for (let c = 0; c < arch[bi].cars.length; c++) {
      const st = people.filter((p, k) => p.bi === bi && p.car === c && els[bi][c].phase(k) === "waiting" && Math.hypot(...queueSpot(arch[bi].cars[c], B[bi], els[bi][c].queueIndex(k), sep).map((v, j) => v - p.pos[j])) < 0.06);
      for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) minGap = Math.min(minGap, Math.hypot(st[i].pos[0] - st[j].pos[0], st[i].pos[1] - st[j].pos[1]));
    }
    // nobody but the top-floor people is ever in the executive car
    for (const [k, p] of people.entries()) if (p.car >= 0 && arch[p.bi].cars[p.car].exec) assert.ok(top.has(p.id), `${p.id} in the executive car`);
  }
  function bi_exec(p) { return p.bi === ari && top.has(p.id); }
  assert.equal(done.size, people.length, "everybody got where they were going");
  assert.ok(minGap >= sep - 0.13, `people in line ${minGap} apart`);
  assert.deepEqual([...execRiders].sort(), [...top].sort(), "exactly Ayn and Leonard rode the executive car");
  for (const bi of tall.slice(0, 2)) for (let c = 0; c < counts[bi]; c++) assert.ok(used.get(`${bi}:${c}`) > 0, `car ${c} of building ${bi} was used (queues split)`);
});

test("trips of Ayn and Leonard use the executive car for their floor changes; everyone else's rides in ARI use ordinary cars", () => {
  const pick = (id) => (bi, z, x, y) => (bi === ari && top.has(id) ? arch[ari].cars.findIndex((c) => c.exec) : bi === ari ? 0 : 0);
  const A = B[ari], from = [A.x0 + 3, A.y0 + 3, (A.floors - 1) * FH];
  const legs = planLegs({ B, arch, bA: ari, bT: B.findIndex((b, i) => i !== ari && b.floors >= 2), from, tx: 0, ty: 0, tz: FH, o: 3, pitch: PITCH, pick: pick([...top][0]) });
  const rides = legs.filter((l) => l.ride && l.bi === ari);
  assert.ok(rides.length && rides.every((l) => arch[ari].cars[l.ci].exec));
  assert.ok(legs.filter((l) => l.ride).every((l) => l.a[0] === arch[l.bi].cars[l.ci].ex && l.a[1] === arch[l.bi].cars[l.ci].ey), "rides are in the chosen shaft");
  assert.match(main, /execFor = \(bi, i\) =>/);
});
