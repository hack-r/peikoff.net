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

test("ARI is in the centre, the Peikoffs are red and their buildings touch ARI", () => {
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

test("Barbara Branden walks to ARI, Don't Let It Go and Postsocialist Press", () => {
  const route = city.routes.P4.map((b) => city.buildings[b].name);
  for (const name of ["Ayn Rand Institute", "Don't Let It Go", "Postsocialist Press"]) assert.ok(route.includes(name), `route includes ${name}`);
  assert.equal(route[0], "The Culture of Reason Center", "she starts in her own building");
});
