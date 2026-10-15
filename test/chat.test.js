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

import { canSpeak, nextMessages, paywallMessage } from "../public/atlas/chat.js";
import { handleChatApi, checkMessages, personaPrompt, makeToken, readToken, COOKIE, _resetCache } from "../src/chat.js";

const ADMIN = "letmein";
const city = { meta: { P2: { Name: "Leonard Peikoff", Bio: "Philosopher.", Image: "x.jpg", "Link 1": "https://x", Relationships: [{ type: "Intellectual_heir", dir: "out", with: "Ayn Rand" }, { type: "member", dir: "out", with: "org #5" }] } } };
const assets = { fetch(r) { assert.match(new URL(r.url).pathname, /^\/atlas\/data\/whoneedsit\.json$/); return Response.json(city); } };
const post = (path, body, cookie, host = "peikoff.net") => new Request(`https://${host}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
async function adminCookie(env) {
  const res = await worker.fetch(post("/api/admin/login", { password: ADMIN }), env);
  assert.equal(res.status, 200);
  const sc = res.headers.get("set-cookie");
  assert.match(sc, new RegExp(`^${COOKIE}=admin\\.\\d+\\.[0-9a-f]{64}; Path=/; HttpOnly; Secure; SameSite=Lax`));
  return sc.split(";")[0];
}

test("paywall: only paid users (for now: the admin) may speak", () => {
  assert.equal(canSpeak(null), false);
  assert.equal(canSpeak({ id: "u1" }), false);
  assert.equal(canSpeak({ id: "u1", paid: true }), true);
  assert.equal(canSpeak({ id: "admin", admin: true }), true);
  assert.match(paywallMessage("Leonard Peikoff"), /paid plan/);
});

test("the client trims a conversation to the limit and starts it with the user", () => {
  const h = Array.from({ length: 40 }, (_, n) => ({ role: n % 2 ? "assistant" : "user", content: "m" + n }));
  const out = nextMessages(h, "new");
  assert.ok(out.length <= 40 && out[0].role === "user" && out.at(-1).content === "new");
  assert.equal(checkMessages(out), null);
});

test("server checks the conversation shape", () => {
  assert.equal(checkMessages([{ role: "user", content: "hi" }]), null);
  assert.match(checkMessages([]), /non-empty/);
  assert.match(checkMessages([{ role: "assistant", content: "hi" }]), /alternate/);
  assert.match(checkMessages([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]), /last message/);
  assert.match(checkMessages([{ role: "user", content: "x".repeat(4001) }]), /4000/);
});

test("admin login: wrong password 401, right one sets a signed cookie and /api/me reports the admin", async () => {
  const env = { ADMIN_PASSWORD: ADMIN, ASSETS: assets };
  assert.equal((await worker.fetch(post("/api/admin/login", { password: "nope" }), env)).status, 401);
  const cookie = await adminCookie(env);
  const me = await worker.fetch(new Request("https://peikoff.net/api/me", { headers: { cookie } }), env);
  assert.deepEqual((await me.json()).user, { id: "admin", name: "Admin", admin: true, paid: true });
  const forged = cookie.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  assert.equal((await (await worker.fetch(new Request("https://peikoff.net/api/me", { headers: { cookie: forged } }), env)).json()).user, null, "a tampered cookie is nobody");
  assert.equal(await readToken({ ADMIN_PASSWORD: "changed" }, cookie.split("=")[1]), null, "changing the password signs the admin out");
  assert.equal(await readToken(env, await makeToken(env, Date.now() - 31 * 864e5)), null, "sessions expire");
  const out = await worker.fetch(post("/api/logout", {}), env);
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
});

test("admin login falls back to USER_PASSWORD when ADMIN_PASSWORD is not set", async () => {
  const env = { USER_PASSWORD: ADMIN, ASSETS: assets };
  await adminCookie(env);
  assert.equal((await worker.fetch(post("/api/admin/login", { password: ADMIN }), { ASSETS: assets })).status, 500, "no secret at all: not configured");
});

test("/api/chat: 401 for visitors; with the admin session it asks Claude to speak as the person", async () => {
  _resetCache();
  const env = { ADMIN_PASSWORD: ADMIN, LLM_KEY: "sk-ant-test", ASSETS: assets };
  const body = { personId: "P2", messages: [{ role: "user", content: "What is Objectivism?" }] };
  const anon = await worker.fetch(post("/api/chat", body), env);
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).code, "register");

  const cookie = await adminCookie(env);
  let sent;
  const client = { beta: { messages: { create: async (req) => { sent = req; return { model: req.model, stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "A philosophy for living on earth." }] }; } } } };
  const res = await handleChatApi(post("/api/chat", body, cookie), env, new URL("https://peikoff.net/api/chat"), { client });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reply: "A philosophy for living on earth.", model: "claude-opus-5-5" });
  assert.equal(sent.model, "claude-opus-5-5");
  assert.equal(sent.fallbacks, "default");
  assert.deepEqual(sent.betas, ["server-side-fallback-2026-07-01"]);
  assert.deepEqual(sent.messages, body.messages);
  assert.match(sent.system, /speaking as Leonard Peikoff/);
  assert.match(sent.system, /AI simulation/);
  assert.match(sent.system, /Bio: Philosopher\./);
  assert.ok(!/x\.jpg|https:\/\/x|org #5/.test(sent.system), "no image, links or unnamed orgs in the prompt");

  const bad = await handleChatApi(post("/api/chat", { personId: "P999", messages: body.messages }, cookie), env, new URL("https://peikoff.net/api/chat"), { client });
  assert.equal(bad.status, 404);
  const noKey = await worker.fetch(post("/api/chat", body, cookie), { ADMIN_PASSWORD: ADMIN, ASSETS: assets });
  assert.equal(noKey.status, 500);
});

test("a refusal comes back as an in-character decline, not an error", async () => {
  _resetCache();
  const env = { ADMIN_PASSWORD: ADMIN, LLM_KEY: "k", LLM_MODEL: "claude-sonnet-5-5", ASSETS: assets };
  const cookie = await adminCookie(env);
  const client = { beta: { messages: { create: async (req) => ({ model: req.model, stop_reason: "refusal", content: [] }) } } };
  const res = await handleChatApi(post("/api/chat", { personId: "P2", messages: [{ role: "user", content: "hm" }] }, cookie), env, new URL("https://peikoff.net/api/chat"), { client });
  const j = await res.json();
  assert.equal(j.refused, true);
  assert.equal(j.model, "claude-sonnet-5-5", "LLM_MODEL overrides the model");
});

test("persona prompt keeps relationships but drops links", () => {
  const p = personaPrompt(city.meta.P2);
  assert.match(p, /Intellectual_heir: Ayn Rand/);
  assert.ok(!p.includes("Link 1"));
});

test("the atlas subdomain exposes only the speaking endpoints", async () => {
  const env = { ADMIN_PASSWORD: ADMIN, ASSETS: assets };
  const me = await worker.fetch(new Request("https://atlas.peikoff.net/api/me"), env);
  assert.equal(me.status, 200);
  assert.equal((await worker.fetch(post("/api/admin/login", { password: ADMIN }, null, "atlas.peikoff.net"), env)).status, 200);
  assert.equal((await worker.fetch(post("/api/chat", {}, null, "atlas.peikoff.net"), env)).status, 401);
  assert.equal((await worker.fetch(post("/api/query", {}, null, "atlas.peikoff.net"), env)).status, 404);
});
