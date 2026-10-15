import test from "node:test";
import assert from "node:assert/strict";
import { needsRegistration, isDoubleTap, registerMessage, DOUBLE_TAP_MS } from "../public/atlas/chat.js";
import worker from "../src/index.js";

test("visitors without an account must register", () => {
  assert.equal(needsRegistration(null), true);
  assert.equal(needsRegistration({}), true);
  assert.equal(needsRegistration({ id: "u1" }), false);
});

test("double tap: same person, close in time and place", () => {
  const a = { pi: 5, t: 1000, x: 100, y: 100 };
  assert.equal(isDoubleTap(a, { pi: 5, t: 1000 + DOUBLE_TAP_MS - 1, x: 110, y: 105 }), true);
  assert.equal(isDoubleTap(a, { pi: 5, t: 1000 + DOUBLE_TAP_MS + 1, x: 100, y: 100 }), false);
  assert.equal(isDoubleTap(a, { pi: 6, t: 1100, x: 100, y: 100 }), false);
  assert.equal(isDoubleTap(a, { pi: 5, t: 1100, x: 200, y: 100 }), false);
  assert.equal(isDoubleTap(null, a), false);
  assert.equal(isDoubleTap({ pi: -1, t: 1000, x: 0, y: 0 }, { pi: -1, t: 1100, x: 0, y: 0 }), false);
});

test("the register notice names the person", () => {
  assert.match(registerMessage("Leonard Peikoff"), /speak with Leonard Peikoff.*register/);
});

test("/api/me reports nobody logged in", async () => {
  const res = await worker.fetch(new Request("https://peikoff.net/api/me"), { ASSETS: { fetch() { throw new Error("no assets"); } } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { user: null });
});
