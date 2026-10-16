import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { ROSS, petitionState, pickClip, walkOut } from "../public/atlas/ross-story.js";

const url = (p) => new URL(p, import.meta.url);

test("the petition button is locked until the visitor has talked to him, then ready, and gone once he is free", () => {
  assert.equal(petitionState(0, false), "locked");
  assert.equal(petitionState(ROSS.petitionAfter - 1, false), "locked");
  assert.equal(petitionState(ROSS.petitionAfter, false), "ready");
  assert.equal(petitionState(10, true), "hidden");
});

test("he walks from the cell to the spot outside at a steady pace, then stops", () => {
  const a = walkOut([0, 0], [14, 0], 0), b = walkOut([0, 0], [14, 0], 2, 3), c = walkOut([0, 0], [14, 0], 10, 3);
  assert.deepEqual([a.x, a.walking], [0, true]);
  assert.ok(Math.abs(b.x - 6) < 1e-9 && b.walking);
  assert.deepEqual([c.x, c.z, c.walking], [14, 0, false]);
});

test("clips are found by name across the models' naming styles", () => {
  assert.equal(pickClip(["CharacterArmature|Idle", "CharacterArmature|Walk"], "walk"), "CharacterArmature|Walk");
  assert.equal(pickClip(["Armature|Walking", "Armature|Idle"], "walk"), "Armature|Walking");
  assert.equal(pickClip(["Man_Idle"], "idle"), "Man_Idle");
  assert.equal(pickClip(["Run"], "walk"), null);
});

test("the jail and his figure are shipped, and the viewer wires them to the chat", () => {
  const models = JSON.parse(readFileSync(url("../public/atlas/models/models.json"), "utf8")), main = readFileSync(url("../public/atlas/main.js"), "utf8");
  for (const k of ["jail", "ross"]) assert.ok(existsSync(url("../public/atlas/models/" + models[k])), k);
  assert.match(main, /npcs: \{ \[ROSS\.id\]/);
  assert.match(main, /url\('jail'\)/);
  assert.match(main, /if \(ross\.hit\?\.\(\)\) return ROSS_I/, "he can be picked for the menu");
});
