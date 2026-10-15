import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const city = JSON.parse(readFileSync(new URL("../public/atlas/data/whoneedsit.json", import.meta.url), "utf8"));
const center = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

test("atlas data is internally consistent", () => {
  assert.ok(city.buildings.length > 100 && city.people.length > 500);
  assert.equal(city.ids.length, city.people.length);
  for (const [i, p] of city.people.entries()) {
    assert.ok(p.slice(0, 5).every(Number.isFinite), `person ${city.ids[i]} has a finite position`);
    if (p[3] === 1) assert.ok(city.buildings[p[5]], `person ${city.ids[i]} stands in a real building`);
  }
  for (const [pid, route] of Object.entries(city.routes)) {
    assert.ok(city.ids.includes(pid));
    assert.ok(route.length >= 2 && route.every((b) => city.buildings[b]), `route of ${pid} uses real buildings`);
  }
});

test("ARI is in the center, the Peikoffs are red and their buildings touch ARI", () => {
  const ari = city.buildings.find((b) => b.org_id === 1);
  const [ax, ay] = center(ari);
  assert.ok(Math.hypot(ax - city.extent / 2, ay - city.extent / 2) < 40, "ARI near the middle");
  for (const pid of ["P1", "P2", "P4", "P108", "P139"]) assert.ok(city.highlight.people.includes(pid), `${pid} is highlighted`);
  const near = city.highlight.buildings.map((b) => center(city.buildings[b])).filter(([x, y]) => Math.hypot(x - ax, y - ay) < 60);
  assert.equal(near.length, city.highlight.buildings.length, "every Peikoff building is within a cell of ARI");
});

test("Ason is in Postsocialist Press and Amy in Don't Let It Go", () => {
  const stands = (pid) => city.buildings[city.people[city.ids.indexOf(pid)][5]].name;
  assert.equal(stands("P108"), "Postsocialist Press");
  assert.equal(stands("P139"), "Don't Let It Go");
});

test("Barbara Branden Peikoff walks to ARI, Don't Let It Go and Postsocialist Press", () => {
  const route = city.routes.P4.map((b) => city.buildings[b].name);
  for (const name of ["Ayn Rand Institute", "Don't Let It Go", "Postsocialist Press"]) assert.ok(route.includes(name), `route includes ${name}`);
  assert.equal(route[0], "The Culture of Reason Center", "she starts in her own building");
});

test("regalia: Ayn Rand and Leonard Peikoff are crowned; Carl Barney looks like a college professor", () => {
  assert.deepEqual(city.regalia.P1, ["crown", "hair", "face", "dress", "dollarpin", "holder"]);   // crown plus her dark bob, black dress, dollar-sign brooch and cigarette holder
  assert.deepEqual(city.regalia.P2, ["crown"]);
  for (const pid of ["P160"]) assert.deepEqual(city.regalia[pid], ["jacket", "glasses", "bowtie", "book"]);
});


test("Critics is not an org any more; Grossman keeps only her Atlas Society link and the Critics author (Jennifer Burns) stays", () => {
  const burns = city.meta.P519;
  assert.equal(burns.Name, "Jennifer Burns");
  assert.match(burns["Major works"], /Goddess of the Market/);
  assert.ok(!city.buildings.some((b) => b.name === "Critics"), "no Critics building");
  assert.ok(!JSON.stringify(city.meta).includes("Critics"), "no Critics link or relationship left on any card");
  const i = city.ids.indexOf("P22");
  assert.ok(i >= 0, "person is still in the city");
  assert.equal(city.meta.P22.Name, "Jennifer A. Grossman");
  assert.equal(city.buildings[city.people[i][5]].name, "The Atlas Society");
});

test("outskirts: Prometheus Foundation and OSI stand outside the grid, and Carl Barney walks between Prometheus, OSI and TOS", () => {
  const b = (id) => city.buildings.find((x) => x.org_id === id);
  for (const id of [8, 3]) assert.ok(b(id).x1 < 0 && b(id).y1 < 0, `org ${id} is outside the city grid`);
  assert.deepEqual(city.routes.P160.map((i) => city.buildings[i].org_id), [8, 3, 108]);
  assert.ok(!city.ids.includes("P755"), "the duplicate Carl B. Barney record is gone");
});

test("websites: every fish has a title and a link, and none belongs to a dropped org", () => {
  assert.ok(city.websites.length > 100);
  for (const w of city.websites) {
    assert.ok(w.title && /^https?:\/\//.test(w.url), `site ${w.id} has a title and an http(s) link`);
    assert.ok(![55, 33, 48, 50, 54, 34, 36, 37, 38, 44, 47, 49, 107].includes(w.org_id), `site ${w.id} is not an excluded org`);
  }
});

test("cards carry no confidence labels or machine bylines; non-Objectivist think tanks are gone; David Salazar is one person", () => {
  for (const m of Object.values(city.meta)) {
    assert.ok(!/\((verified|reported|unverified|single_source|medium|retired)\)/.test(m["Role at org"] || ""), "no confidence label on Role at org");
    for (const r of m.Relationships || []) {
      assert.equal(r.confidence, undefined, "no confidence on relationship rows");
      assert.ok(!/^Byline on \d+ .*article\(s\) in D1/.test(r.evidence || ""), "no machine-written bylines");
    }
  }
  const names = city.buildings.map((b) => b.name);
  for (const n of ["Cato Institute", "Adam Smith Institute", "Foundation for Economic Education", "Goldwater Institute", "PragerU", "Students For Liberty", "CEVRO Institute"]) assert.ok(!names.includes(n), `${n} is dropped`);
  assert.ok(names.includes("Atlas Network"), "Atlas Network stays");
  assert.equal(Object.values(city.meta).filter((m) => /Salazar/.test(m.Name)).length, 1);
  assert.ok(Object.values(city.meta).every((m) => m.Name), "every person has a name");
});

test("the mountain princess is scenery only: no person, id or building carries her name", () => {
  assert.ok(!city.ids.some((id) => /princess/i.test(id)));
  assert.ok(!Object.values(city.meta).some((m) => /princess/i.test(m.Name || "")));
  assert.ok(!city.buildings.some((b) => /princess/i.test(b.name || "")));
});

test("no sourcing or hedging notes leak onto cards (unverified, directory sheet, unconfirmed)", () => {
  const bad = /otherwise unverified|directory sheet|unconfirmed|current status unverified/i;
  for (const [id, m] of Object.entries(city.meta)) {
    for (const [k, v] of Object.entries(m)) if (k !== "Relationships") assert.ok(!bad.test(String(v)), `${id} ${k}`);
    for (const r of m.Relationships || []) assert.ok(!bad.test(r.evidence || ""), `${id} relationship note`);
  }
});

test("the viewer has an idle-motion switch and the rig splits people at their joints", () => {
  const html = readFileSync(new URL("../public/atlas/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");
  assert.match(html, /id="cbLife"/);
  for (const part of ["legA", "upA", "foreA", "headMesh", "stepLife", "stepPairs"]) assert.ok(js.includes(part), part);
});
