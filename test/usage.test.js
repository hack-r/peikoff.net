import assert from "node:assert/strict";
import test from "node:test";
import { handleChatApi, _resetCache } from "../src/chat.js";
import { AT, _forget } from "../src/accounts.js";
import { _clear } from "../src/cache.js";
import { costMicro, estimateMicro, estimateTokens, tokensUsed, budgets, allowance, priceFor, percentUsed, UNKNOWN_PRICE, PRICES } from "../src/usage.js";

const SB = "https://proj.supabase.co", ASSETS = { fetch() { return Response.json({ meta: { P2: { Name: "Leonard Peikoff", Bio: "Philosopher." } } }); } };
const env = (x = {}) => ({ SUPABASE_URL: SB, SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_KEY: "s", LLM_KEY: "k", ASSETS, ...x });
const alice = { id: "u-alice", email: "a@example.com", user_metadata: {} };
const req = (text, cookie = `${AT}=at`, extra = []) => new Request("https://peikoff.net/api/chat", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ personId: "P2", messages: [...extra, { role: "user", content: text }] }) });
const call = (r, e, f) => handleChatApi(r, e, new URL(r.url), { fetch: f });
const reset = () => { _forget(); _clear(); _resetCache(); };

/** Fake Supabase + model: the user's usage rows are preset, and every model reply reports `usage`. */
function world({ rows = [], usage = { prompt_tokens: 1000, completion_tokens: 200 }, model = "gpt-4o-mini-2024-07-18", usageDown = false } = {}) {
  const added = []; let calls = 0;
  const f = async (url, init = {}) => {
    const u = new URL(url), m = init.method || "GET";
    if (u.host === "api.openai.com") { calls++; return Response.json({ model, usage, choices: [{ finish_reason: "stop", message: { content: "A reply." } }] }); }
    if (u.pathname === "/auth/v1/user") return Response.json(alice);
    if (u.pathname === "/rest/v1/profiles") return Response.json([{ plan: "paid" }]);
    if (u.pathname === "/rest/v1/chat_usage") return usageDown ? new Response("x", { status: 500 }) : Response.json(rows);
    if (u.pathname === "/rest/v1/rpc/chat_usage_add") { added.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    if (u.pathname.startsWith("/rest/v1/chat_cache") || u.pathname.includes("chat_cache_hit")) return m === "GET" ? Response.json([]) : new Response(null, { status: 201 });
    throw new Error("unexpected " + url);
  };
  return Object.assign(f, { added, calls: () => calls });
}
const today = new Date().toISOString().slice(0, 10);

test("cost is counted from the provider's own token usage, at the model's price; dated model names and unknown models are handled", () => {
  assert.equal(costMicro({}, "gpt-4o-mini", { prompt_tokens: 1000, completion_tokens: 200 }), 150 + 120);           // $0.15/M in, $0.60/M out -> 270 micro-dollars
  assert.equal(costMicro({}, "gpt-4o-mini-2024-07-18", { prompt_tokens: 1e6, completion_tokens: 0 }), 150000);
  assert.deepEqual(priceFor({}, "gpt-4o-mini-2024-07-18"), PRICES["gpt-4o-mini"]);
  assert.deepEqual(priceFor({}, "gpt-4o"), PRICES["gpt-4o"], "gpt-4o is not gpt-4o-mini");
  assert.deepEqual(priceFor({}, "some-new-model"), UNKNOWN_PRICE, "unknown: priced high on purpose");
  assert.deepEqual(priceFor({ LLM_PRICE_IN: "1", LLM_PRICE_OUT: "2" }, "x"), [1, 2], "an override wins");
  assert.equal(costMicro({}, "gpt-4o-mini", undefined, 777), 777, "no usage reported: the worst case is charged");
});

test("the worst case before a call: the text at 3 chars per token plus the longest answer", () => {
  const e = estimateMicro({}, "gpt-4o-mini", "x".repeat(3000), [{ role: "user", content: "y".repeat(300) }]);
  assert.equal(e, Math.ceil(1100 * 0.15 + 500 * 0.6));
  assert.ok(estimateMicro({}, "gpt-4o", "x".repeat(3000), [{ role: "user", content: "hi" }]) > 10 * e / 4, "a dearer model estimates dearer");
});

test("the numbers add up to a profit: the budget is a fraction of the price", () => {
  const b = budgets({}), price = 5e6, stripeFee = 0.029 * price + 0.3e6 + 0.007 * price;
  assert.equal(b.month, 1.5e6); assert.equal(b.day, 0.3e6);
  assert.ok(price - stripeFee - b.month > 0.6 * price - stripeFee, "at least $3.00 of $5 is left after the worst-case user and Stripe's fees");
  assert.ok(price - stripeFee - b.month >= 2.9e6);
});

test("allowance: 100 questions, 2,000,000 tokens, or the dollar budget, whichever comes first; each says when it comes back", () => {
  const b = budgets({}), now = Date.parse("2026-10-16T12:00:00Z"), e = { cost: 1000, tokens: 2000 }, u0 = { month: 0, today: 0, questions: 0, tokens: 0 };
  assert.equal(b.questions, 100); assert.equal(b.tokens, 2_000_000);
  assert.deepEqual(allowance(u0, e, b, now), { ok: true });
  assert.deepEqual(allowance({ ...u0, questions: 99 }, e, b, now), { ok: true }, "the 100th question is allowed");
  assert.deepEqual(allowance({ ...u0, questions: 100 }, e, b, now), { ok: false, reason: "questions", resets: "2026-11-01" });
  assert.deepEqual(allowance({ ...u0, tokens: 1_998_500 }, e, b, now), { ok: false, reason: "tokens", resets: "2026-11-01" }, "the call would go over two million");
  assert.deepEqual(allowance({ ...u0, month: 1.49e6 }, { cost: 20000, tokens: 1 }, b, now), { ok: false, reason: "month", resets: "2026-11-01" });
  assert.deepEqual(allowance({ ...u0, today: 0.299e6 }, { cost: 5000, tokens: 1 }, b, now), { ok: false, reason: "day", resets: "2026-10-17" });
  assert.equal(percentUsed({ ...u0, questions: 50 }, b), 50); assert.equal(percentUsed({ ...u0, tokens: 1_800_000 }, b), 90); assert.equal(percentUsed({ ...u0, today: 0.3e6 }, b), 100);
  assert.equal(budgets({ CHAT_MONTHLY_QUESTIONS: "300", CHAT_MONTHLY_TOKENS: "2000000" }).questions, 300);
  assert.equal(estimateTokens({}, "x".repeat(3000), [{ role: "user", content: "y".repeat(300) }]), 1100 + 500);
  assert.equal(tokensUsed({ prompt_tokens: 900, completion_tokens: 100 }, 5), 1000); assert.equal(tokensUsed(undefined, 5), 5);
});

test("a paid user's call is counted: its real cost is recorded, and the reply says how much of the allowance is used", async () => {
  reset(); const f = world(), res = await call(req("What is Objectivism?"), env(), f), j = await res.json();
  assert.equal(res.status, 200); assert.equal(f.calls(), 1);
  assert.deepEqual(f.added, [{ uid: "u-alice", d: today, c: 270, t: 1200 }]);
  assert.equal(j.allowance.questions_left, 99);
  assert.ok(j.allowance.used_pct >= 0 && j.allowance.used_pct < 5);
});

test("a user at the cap is refused without calling the model; the day cap and the month cap each say so", async () => {
  reset(); const month = world({ rows: [{ day: "2026-01-01", cost_micro: 1_499_900 }] });
  const r1 = await call(req("hello"), env(), month); assert.equal(r1.status, 429);
  const j1 = await r1.json(); assert.equal(j1.code, "allowance"); assert.match(j1.error, /this month's chat allowance/); assert.equal(month.calls(), 0);
  reset(); const q = world({ rows: [{ day: "2026-01-01", cost_micro: 10, messages: 100, tokens: 100 }] }), r3 = await call(req("hello"), env(), q), j3 = await r3.json();
  assert.equal(r3.status, 429); assert.equal(j3.reason, "questions"); assert.match(j3.error, /used your 100 questions/); assert.equal(q.calls(), 0);
  reset(); const t = world({ rows: [{ day: "2026-01-01", cost_micro: 10, messages: 3, tokens: 1_999_000 }] }), r4 = await call(req("hello"), env(), t), j4 = await r4.json();
  assert.equal(r4.status, 429); assert.equal(j4.reason, "tokens"); assert.match(j4.error, /2,000,000 tokens/); assert.equal(t.calls(), 0);
  const monthRows = world({ rows: [{ day: today, cost_micro: 299_900 }] }); reset();
  const r2 = await call(req("hello"), env(), monthRows); const j2 = await r2.json();
  assert.equal(r2.status, 429); assert.equal(j2.reason, "day"); assert.match(j2.error, /today's chat allowance/); assert.equal(monthRows.calls(), 0);
});

test("a dear model cannot overspend: with $0.296 of the day's $0.30 used, a gpt-4o call (worst case about $0.006) is kept out while a gpt-4o-mini call (about $0.0004) still fits", async () => {
  reset(); const dear = world({ rows: [{ day: today, cost_micro: 296_000 }], model: "gpt-4o" });
  const res = await call(req("hello"), env({ LLM_MODEL: "gpt-4o" }), dear); assert.equal(res.status, 429); assert.equal(dear.calls(), 0);
  reset(); const cheap = world({ rows: [{ day: today, cost_micro: 296_000 }] });
  assert.equal((await call(req("hello"), env(), cheap)).status, 200); assert.equal(cheap.calls(), 1);
});

test("fail closed: no service key, or usage unreadable, means no chat for a capped user (and nothing for free)", async () => {
  reset(); const f = world(); const r1 = await call(req("hi"), env({ SUPABASE_SERVICE_KEY: "" }), f); assert.equal(r1.status, 503); assert.equal(f.calls(), 0);
  reset(); const d = world({ usageDown: true }); const r2 = await call(req("hi"), env(), d); assert.equal(r2.status, 503); assert.equal(d.calls(), 0);
});

test("a shared-cache hit costs nothing and is not counted; the admin is not capped", async () => {
  reset(); const f = world(); await call(req("Who are you?"), env(), f); assert.equal(f.added.length, 1);
  const cache = new Map(); const g = async (url, init = {}) => { const u = new URL(url); if (u.pathname.startsWith("/rest/v1/chat_cache")) { if ((init.method || "GET") === "POST") { for (const r of JSON.parse(init.body)) cache.set(r.key, r); return new Response(null, { status: 201 }); } return Response.json([...cache.values()].filter((r) => u.searchParams.get("key") === "eq." + r.key)); } return f(url, init); };
  reset(); await call(req("Who are you?"), env(), g); const before = f.added.length; await call(req("who are YOU"), env(), g); assert.equal(f.added.length, before, "the second, identical question was a cache hit: no cost recorded");
  reset(); const e = { ADMIN_PASSWORD: "pw", LLM_KEY: "k", ASSETS }, login = await call(new Request("https://peikoff.net/api/admin/login", { method: "POST", body: JSON.stringify({ password: "pw" }) }), e, world());
  const a = world({ rows: [{ day: "2026-01-01", cost_micro: 9e9 }] }), ok = await call(req("hello", login.headers.get("set-cookie").split(";")[0]), e, a); assert.equal(ok.status, 200); assert.equal(a.added.length, 0);
});

test("every call asks for a short answer (max_completion_tokens for OpenAI, max_tokens for the others)", async () => {
  reset(); let sent; const f = async (url, init = {}) => { if (new URL(url).host === "api.openai.com") sent = JSON.parse(init.body); return world()(url, init); };
  await call(req("hi"), env({ CHAT_MAX_OUTPUT_TOKENS: "300" }), f); assert.equal(sent.max_completion_tokens, 300);
  reset(); let sent2; const g = async (url, init = {}) => { if (new URL(url).host === "api.mistral.ai") { sent2 = JSON.parse(init.body); return Response.json({ model: "mistral-small-latest", usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }); } return world()(url, init); };
  await call(req("hi"), env({ LLM_PROVIDER: "mistral" }), g); assert.equal(sent2.max_tokens, 500); assert.ok(!("max_completion_tokens" in sent2));
});
