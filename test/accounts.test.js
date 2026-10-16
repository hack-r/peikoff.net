import assert from "node:assert/strict";
import test from "node:test";
import { handleChatApi, personaPrompt, _resetCache } from "../src/chat.js";
import { safeRedirect, validEmail, _forget, AT, RT } from "../src/accounts.js";
import { normalizeQuestion, _clear, getCached, cacheKey } from "../src/cache.js";

const SB = "https://proj.supabase.co", env = (extra = {}) => ({ SUPABASE_URL: SB, SUPABASE_ANON_KEY: "anon", LLM_KEY: "sk-test", ASSETS, ...extra });
const city = { meta: { P2: { Name: "Leonard Peikoff", Bio: "Philosopher." }, P139: { Name: "Amy Peikoff" } } };
const ASSETS = { fetch() { return Response.json(city); } };
const req = (path, { method = "GET", body, cookie } = {}) => new Request(`https://peikoff.net${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
const call = (r, e, f, extra = {}) => handleChatApi(r, e, new URL(r.url), { fetch: f, ...extra });

/** A fake Supabase and a fake model in one fetch: users by access token, plans by user id, a table for the cache. */
function world({ users = {}, plans = {}, refresh = {} } = {}) {
  const log = [], table = new Map(); let model = 0;
  const f = async (url, init = {}) => {
    const u = new URL(url), auth = (init.headers?.authorization || "").replace("Bearer ", ""); log.push(`${init.method || "GET"} ${u.host}${u.pathname}`);
    if (u.host === "api.openai.com") { model++; return Response.json({ model: "m", choices: [{ finish_reason: "stop", message: { content: `answer ${model}` } }] }); }
    if (u.pathname === "/auth/v1/otp") return Response.json({}, { status: 200 });
    if (u.pathname === "/auth/v1/user") return users[auth] ? Response.json(users[auth]) : Response.json({}, { status: 401 });
    if (u.pathname === "/auth/v1/token") { const r = refresh[JSON.parse(init.body).refresh_token]; return r ? Response.json(r) : Response.json({}, { status: 400 }); }
    if (u.pathname === "/rest/v1/profiles") { const id = u.searchParams.get("id").replace("eq.", ""); return Response.json(plans[id] ? [plans[id]] : []); }
    if (u.pathname === "/rest/v1/chat_cache" && (init.method || "GET") === "GET") { const row = table.get(u.searchParams.get("key").replace("eq.", "")); return Response.json(row ? [row] : []); }
    if (u.pathname === "/rest/v1/chat_cache") { for (const r of JSON.parse(init.body)) table.set(r.key, r); return new Response(null, { status: 201 }); }
    if (u.pathname === "/rest/v1/rpc/chat_cache_hit") return new Response(null, { status: 204 });
    throw new Error("unexpected " + url);
  };
  return Object.assign(f, { log, table, models: () => model });
}
const alice = { id: "u-alice", email: "alice@example.com", user_metadata: {} }, bob = { id: "u-bob", email: "bob@example.com", user_metadata: { full_name: "Bob" } };
const reset = () => { _forget(); _clear(); _resetCache(); };

test("magic link: a valid email is sent to Supabase with our own page as the way back; junk and a missing setup are refused", async () => {
  reset(); const f = world();
  const ok = await call(req("/api/auth/otp", { method: "POST", body: { email: "a@b.co", redirect: "https://evil.example/x" } }), env(), f);
  assert.equal(ok.status, 200);
  assert.ok(f.log.includes("POST proj.supabase.co/auth/v1/otp"));
  assert.equal((await call(req("/api/auth/otp", { method: "POST", body: { email: "nope" } }), env(), f)).status, 400);
  assert.equal((await call(req("/api/auth/otp", { method: "POST", body: { email: "a@b.co" } }), { ASSETS }, f)).status, 500);
  assert.ok(validEmail("a@b.co") && !validEmail("a@b") && !validEmail("a b@c.de"));
});

test("sign-in links only come back to our own pages", () => {
  const u = new URL("https://peikoff.net/api/auth/otp");
  assert.equal(safeRedirect("https://peikoff.net/atlas/?x=1", u), "https://peikoff.net/atlas/");
  assert.equal(safeRedirect("https://atlas.peikoff.net/", u), "https://atlas.peikoff.net/atlas/");
  assert.equal(safeRedirect("https://evil.example/atlas/", u), "https://peikoff.net/atlas/");
  assert.equal(safeRedirect("javascript:alert(1)", u), "https://peikoff.net/atlas/");
});

test("the page hands over its tokens: checked with Supabase, kept in HttpOnly cookies, and the user and plan come back from /api/me", async () => {
  reset(); const f = world({ users: { "at-1": alice }, plans: { "u-alice": { plan: "free" } } });
  assert.equal((await call(req("/api/auth/session", { method: "POST", body: { access_token: "forged", refresh_token: "r" } }), env(), f)).status, 401);
  const res = await call(req("/api/auth/session", { method: "POST", body: { access_token: "at-1", refresh_token: "rt-1" } }), env(), f);
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie(); assert.equal(cookies.length, 2);
  assert.ok(cookies.every((c) => /HttpOnly; Secure; SameSite=Lax/.test(c)) && cookies[0].startsWith(`${AT}=at-1`) && cookies[1].startsWith(`${RT}=rt-1`));
  const me = await (await call(req("/api/me", { cookie: `${AT}=at-1; ${RT}=rt-1` }), env(), f)).json();
  assert.deepEqual(me.user, { id: "u-alice", name: "alice@example.com", email: "alice@example.com", admin: false, paid: false });
  assert.ok(!JSON.stringify(me).includes("at-1"), "no token in the answer");
});

test("an expired access token is renewed from the refresh token, and the new cookies are sent back", async () => {
  reset(); const f = world({ users: { "at-new": alice }, refresh: { "rt-old": { access_token: "at-new", refresh_token: "rt-new" } }, plans: { "u-alice": { plan: "paid" } } });
  const res = await call(req("/api/me", { cookie: `${AT}=at-stale; ${RT}=rt-old` }), env(), f), body = await res.json();
  assert.equal(body.user.id, "u-alice"); assert.equal(body.user.paid, true);
  assert.deepEqual(res.headers.getSetCookie().map((c) => c.split(";")[0]), [`${AT}=at-new`, `${RT}=rt-new`]);
  const none = await (await call(req("/api/me", { cookie: `${AT}=at-stale; ${RT}=rt-bad` }), env(), f)).json();
  assert.equal(none.user, null);
});

test("the paywall follows the profile: free accounts get 402, paid ones may speak, a lapsed plan is free again", async () => {
  reset();
  const users = { a1: alice, b1: bob }, plans = { "u-alice": { plan: "free" }, "u-bob": { plan: "paid", paid_until: "2999-01-01T00:00:00Z" } };
  const f = world({ users, plans }), chat = (tok) => call(req("/api/chat", { method: "POST", cookie: `${AT}=${tok}`, body: { personId: "P2", messages: [{ role: "user", content: "hello" }] } }), env(), f);
  assert.equal((await chat("a1")).status, 402);
  assert.equal((await chat("b1")).status, 200);
  _forget(); plans["u-bob"] = { plan: "paid", paid_until: "2001-01-01T00:00:00Z" };
  assert.equal((await chat("b1")).status, 402, "lapsed");
});

test("repeated questions: the model is asked once; the same question in other words from another user is a shared cache hit, in memory and in Supabase", async () => {
  reset();
  const paid = { "u-alice": { plan: "paid" }, "u-bob": { plan: "paid" } }, f = world({ users: { a1: alice, b1: bob }, plans: paid }), e = env({ SUPABASE_SERVICE_KEY: "service" });
  const ask = (tok, text, extra = []) => call(req("/api/chat", { method: "POST", cookie: `${AT}=${tok}`, body: { personId: "P2", messages: [...extra, { role: "user", content: text }] } }), e, f);
  const first = await (await ask("a1", "Who are you?")).json();
  assert.equal(first.reply, "answer 1"); assert.ok(!first.cached);
  const second = await (await ask("b1", "  who ARE you!! ")).json();
  assert.equal(second.reply, "answer 1"); assert.equal(second.cached, true);
  assert.equal(f.models(), 1, "one model call for two users");
  assert.equal(f.table.size, 1, "stored in the shared table");
  _clear();                                                           // another Worker: no memory, but the table
  const third = await (await ask("b1", "who are you")).json();
  assert.equal(third.cached, true); assert.equal(third.reply, "answer 1"); assert.equal(f.models(), 1);
  assert.ok(f.log.includes("POST proj.supabase.co/rest/v1/rpc/chat_cache_hit"), "the hit is counted");
  const follow = await ask("a1", "and why?", [{ role: "user", content: "Who are you?" }, { role: "assistant", content: "answer 1" }]);
  assert.ok(!(await follow.json()).cached); assert.equal(f.models(), 2, "a later turn is never taken from the cache");
  await ask("a1", "A different question"); assert.equal(f.models(), 3);
});

test("the admin always gets a fresh answer, and nothing is cached without a real reply", async () => {
  reset(); const f = world(), e = { ADMIN_PASSWORD: "pw", LLM_KEY: "k", ASSETS };
  const login = await call(req("/api/admin/login", { method: "POST", body: { password: "pw" } }), e, f), cookie = login.headers.get("set-cookie").split(";")[0];
  const ask = () => call(req("/api/chat", { method: "POST", cookie, body: { personId: "P2", messages: [{ role: "user", content: "Who are you?" }] } }), e, f);
  await ask(); await ask(); assert.equal(f.models(), 2);
  assert.equal(await getCached(e, await cacheKey("P2", "x", "q"), f), null);
});

test("cache keys: punctuation and case do not matter; the prompt, the character and the wording do", async () => {
  assert.equal(normalizeQuestion("  Who ARE you?!  "), "who are you");
  assert.equal(normalizeQuestion("Café, s'il vous plaît"), "cafe s il vous plait");
  const k = (p, s, q) => cacheKey(p, s, q);
  assert.equal(await k("P2", "sys", "Who are you?"), await k("P2", "sys", "who are you"));
  assert.notEqual(await k("P2", "sys", "who are you"), await k("P4", "sys", "who are you"));
  assert.notEqual(await k("P2", "sys", "who are you"), await k("P2", "sys v2", "who are you"), "editing the prompt starts a fresh cache");
});

test("the system prompt starts with the same text for everyone: only the admin's lines come after it (provider prompt caching)", () => {
  const meta = { Name: "Amy Peikoff", Bio: "Philosopher." }, plain = personaPrompt(meta, "P139", { id: "u", paid: true }), admin = personaPrompt(meta, "P139", { id: "admin", admin: true });
  assert.ok(admin.startsWith(plain), "the visitor's prompt is a prefix of the admin's");
  assert.ok(admin.length > plain.length && /Ason Peikoff/.test(admin.slice(plain.length)));
  assert.equal(personaPrompt(meta, "P139", { id: "u1", paid: true }), personaPrompt(meta, "P139", { id: "u2", paid: false }), "two visitors, the same prompt");
});

import { tokensFromHash, menuItems } from "../public/atlas/chat.js";
test("the page picks the tokens out of the address Supabase sends it back to", () => {
  assert.deepEqual(tokensFromHash("#access_token=aaa&refresh_token=rrr&expires_in=3600&token_type=bearer"), { access_token: "aaa", refresh_token: "rrr" });
  assert.equal(tokensFromHash("#access_token=aaa"), null);
  assert.equal(tokensFromHash(""), null);
  assert.match(menuItems(null, "Amy", true)[0].note, /Google, Apple or your email/);
  assert.match(menuItems(null, "Amy", false)[0].note, /opening soon/);
});
