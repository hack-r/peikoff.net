import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../public/atlas/main.js", import.meta.url), "utf8");

test("#80 the pirate ship is about the size of a fish", () => {
  const sc = +js.match(/const SHIP_SC = ([\d.]+);/)[1];
  assert.ok(sc >= 5 && sc <= 10, `ship scale ${sc} (fish are 7 m long, scaled 0.8-1.3)`);
  assert.ok(js.includes("ship.scale.setScalar(SHIP_SC)") && js.includes("ship.scale.setScalar(SHIP_SC * Math.max("), "both scale calls use it");
  assert.ok(!/ship\.scale\.setScalar\(14/.test(js), "the old 14x ship is gone");
});

test("#83 Carl's house; /home no longer lists who lives where; Kira closes her book and walks home", () => {
  assert.ok(!js.includes(`"Carl's castle"`) && js.includes(`"Carl's house"`), "label");
  assert.ok(js.includes("home: 'Everyone is going home. Type /work to send everyone back.'"), "short /home message");
  assert.ok(!/to Peikoff Manor Cottage beside it, Carl/.test(js.match(/const msgs = \{[\s\S]*?\};/)[0]), "no who-lives-where in the toast");
  assert.ok(js.includes("scenery.userData.kiraGo?.(true, places.castle && frontSpots(places.castle))") && js.includes("scenery.userData.kiraGo?.(false)"), "/home and /work move Kira");
  assert.ok(js.includes("flap.rotation.z = Math.PI * kira.c"), "the book closes (its right half folds over)");
  assert.ok(!js.includes("princess.visible = nm.visible = false"), "she never disappears into the manor any more");
});

test("#81 an ore train: a mine shaft by the railway, miners with no organization, the freight train stops to load", () => {
  assert.ok(js.includes("signTexture('Atlantis Mine'"), "the mine has a sign");
  assert.ok(js.includes("!metaOf(i).Organization") && js.includes("people[i][3] === 0"), "miners have no organization and stood on the sidewalks");
  assert.ok(js.includes("fr.drive = dt =>") && js.includes("tr.s += (tr.drive ? tr.drive(dt) : tr.speed) * dt;"), "the freight train drives itself and stops");
  assert.ok(js.includes("if (gone) load = 0;"), "the ore disappears once the car is out of sight");
  assert.ok(js.includes("!minerSet.has(i)"), "commands leave the miners at work");
  assert.ok(js.includes("stepMine(dt)"), "the mine runs every frame");
});
