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
import { handleChatApi, checkMessages, personaPrompt, makeToken, readToken, llmConfig, COOKIE, _resetCache } from "../src/chat.js";

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

const CHAT_URL = new URL("https://peikoff.net/api/chat");
const ok = (extra = {}) => Response.json({ model: "gpt-test", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "A philosophy for living on earth." } }], ...extra });
function stub(respond) { const calls = []; const f = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return respond(calls.length); }; f.calls = calls; return f; }

test("/api/chat: 401 for visitors; with the admin session it asks the provider to speak as the person (OpenAI by default)", async () => {
  _resetCache();
  const env = { ADMIN_PASSWORD: ADMIN, LLM_KEY: "sk-test", ASSETS: assets };
  const body = { personId: "P2", messages: [{ role: "user", content: "What is Objectivism?" }] };
  const anon = await worker.fetch(post("/api/chat", body), env);
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).code, "register");

  const cookie = await adminCookie(env);
  const f = stub(() => ok());
  const res = await handleChatApi(post("/api/chat", body, cookie), env, CHAT_URL, { fetch: f });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reply: "A philosophy for living on earth.", model: "gpt-test" });
  const { url, init, body: sent } = f.calls[0];
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  assert.equal(init.headers.authorization, "Bearer sk-test");
  assert.equal(sent.model, "gpt-4o-mini");
  assert.deepEqual(Object.keys(sent).sort(), ["messages", "model"], "only fields every provider accepts");
  assert.equal(sent.messages[0].role, "system");
  assert.deepEqual(sent.messages.slice(1), body.messages);
  assert.match(sent.messages[0].content, /character in the Atlas of Objectivism, a virtual world/);
  assert.match(sent.messages[0].content, /playing Leonard Peikoff/);
  assert.match(sent.messages[0].content, /Never break character/);
  assert.match(sent.messages[0].content, /never claim to be the actual living person or a human being/);
  assert.match(sent.messages[0].content, /Bio: Philosopher\./);
  assert.ok(!/x\.jpg|https:\/\/x|org #5/.test(sent.messages[0].content), "no image, links or unnamed orgs in the prompt");

  const bad = await handleChatApi(post("/api/chat", { personId: "P999", messages: body.messages }, cookie), env, CHAT_URL, { fetch: f });
  assert.equal(bad.status, 404);
  const noKey = await worker.fetch(post("/api/chat", body, cookie), { ADMIN_PASSWORD: ADMIN, ASSETS: assets });
  assert.equal(noKey.status, 500);
});

test("switching provider is configuration only: Mistral, xAI, a custom endpoint, and a model override", () => {
  assert.deepEqual(llmConfig({}), { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" });
  assert.equal(llmConfig({ LLM_PROVIDER: "mistral" }).url, "https://api.mistral.ai/v1/chat/completions");
  assert.equal(llmConfig({ LLM_PROVIDER: "XAI" }).url, "https://api.x.ai/v1/chat/completions");
  assert.equal(llmConfig({ LLM_PROVIDER: "mistral", LLM_MODEL: "mistral-large-latest" }).model, "mistral-large-latest");
  assert.deepEqual(llmConfig({ LLM_BASE_URL: "https://llm.example.com/v1/", LLM_MODEL: "m1" }), { url: "https://llm.example.com/v1/chat/completions", model: "m1" });
  assert.match(llmConfig({ LLM_PROVIDER: "nope" }).error, /Unknown LLM_PROVIDER/);
  assert.match(llmConfig({ LLM_BASE_URL: "http://insecure.example.com" , LLM_MODEL: "m"}).error, /https/);
  assert.match(llmConfig({ LLM_BASE_URL: "https://llm.example.com/v1" }).error, /LLM_MODEL/);
});

test("the request goes to whichever provider is configured", async () => {
  _resetCache();
  const env = { ADMIN_PASSWORD: ADMIN, LLM_KEY: "k", LLM_PROVIDER: "mistral", LLM_MODEL: "mistral-large-latest", ASSETS: assets };
  const cookie = await adminCookie(env);
  const f = stub(() => ok());
  const res = await handleChatApi(post("/api/chat", { personId: "P2", messages: [{ role: "user", content: "hm" }] }, cookie), env, CHAT_URL, { fetch: f });
  assert.equal(res.status, 200);
  assert.equal(f.calls[0].url, "https://api.mistral.ai/v1/chat/completions");
  assert.equal(f.calls[0].body.model, "mistral-large-latest");
});

test("a refusal or content filter comes back as an in-character decline; provider errors map to clear messages", async () => {
  _resetCache();
  const env = { ADMIN_PASSWORD: ADMIN, LLM_KEY: "k", ASSETS: assets };
  const cookie = await adminCookie(env), req = () => post("/api/chat", { personId: "P2", messages: [{ role: "user", content: "hm" }] }, cookie);
  const run = async (respond) => handleChatApi(req(), env, CHAT_URL, { fetch: stub(respond) });

  let j = await (await run(() => Response.json({ model: "m", choices: [{ finish_reason: "stop", message: { content: null, refusal: "I cannot help with that." } }] }))).json();
  assert.equal(j.refused, true);
  j = await (await run(() => Response.json({ model: "m", choices: [{ finish_reason: "content_filter", message: { content: "" } }] }))).json();
  assert.equal(j.refused, true);

  const rate = await run(() => Response.json({ error: { message: "slow down" } }, { status: 429 }));
  assert.equal(rate.status, 429);
  const key = await run(() => Response.json({ error: { message: "Incorrect API key" } }, { status: 401 }));
  assert.equal(key.status, 502);
  assert.match((await key.json()).error, /LLM_KEY secret was rejected/);
  const other = await run(() => new Response("upstream exploded", { status: 500 }));
  const oj = await other.json();
  assert.equal(other.status, 502);
  assert.match(oj.detail, /500 upstream exploded/);
  const down = await handleChatApi(req(), env, CHAT_URL, { fetch: async () => { throw new Error("network down"); } });
  assert.equal(down.status, 502);
  assert.match((await down.json()).detail, /network down/);
  const cfg = await handleChatApi(req(), { ...env, LLM_PROVIDER: "nope" }, CHAT_URL, { fetch: stub(() => ok()) });
  assert.equal(cfg.status, 500);
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

import { errorText } from "../public/atlas/chat.js";
test("a failed chat shows the provider's detail, not only the generic message", () => {
  assert.equal(errorText({ error: "The language model returned an error.", detail: "404 model not found" }, 502), "The language model returned an error. (404 model not found)");
  assert.equal(errorText({ error: "Invalid password." }, 401), "Invalid password.");
  assert.equal(errorText({}, 500), "Error (HTTP 500).");
  assert.equal(errorText(null, 503), "Error (HTTP 503).");
});

test("src/personas.js: general text for everyone, extra instructions, facts and never-lines per person", () => {
  const p = personaPrompt(city.meta.P1, "P1");
  assert.match(p, /right now you are playing Ayn Rand\./, "{name} is filled in");
  assert.match(p, /EXAMPLE \(replace\): Speak in a direct/, "P1 instructions");
  assert.match(p, /Never:\nEXAMPLE \(replace\): Do not give investment/);
  assert.ok(p.indexOf("Speak in a direct") < p.indexOf("Character card for"), "instructions come before the card");
  assert.match(personaPrompt(city.meta.P2, "P2"), /A string works too/, "a single string is accepted");
  const none = personaPrompt(city.meta.P2, "P999");
  assert.ok(!none.includes("EXAMPLE") && !none.includes("Never:"), "no entry: general + card only");
});
