import assert from "node:assert/strict";
import test from "node:test";
import { handleChatApi } from "../src/chat.js";
import { verifySignature, signPayload, planFromSubscription, TOLERANCE_S } from "../src/billing.js";
import { AT, _forget } from "../src/accounts.js";
import { oauthUrl } from "../src/accounts.js";

const SB = "https://proj.supabase.co", SECRET = "whsec_test", NOW = 1_800_000_000_000;
const env = (x = {}) => ({ SUPABASE_URL: SB, SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_KEY: "svc", STRIPE_SECRET_KEY: "sk_test", STRIPE_PRICE_ID: "price_1", STRIPE_WEBHOOK_SECRET: SECRET, ASSETS: { fetch() { return Response.json({ meta: {} }); } }, ...x });
const req = (path, { method = "POST", body, cookie, headers = {} } = {}) => new Request(`https://peikoff.net${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const call = (r, e, f) => handleChatApi(r, e, new URL(r.url), { fetch: f });
const alice = { id: "u-alice", email: "alice@example.com", user_metadata: {} };

function world({ plans = { "u-alice": { plan: "free" } }, ids = {} } = {}) {
  const log = [], events = new Set(), patches = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), m = init.method || "GET", auth = (init.headers?.authorization || "").replace("Bearer ", ""); log.push(`${m} ${u.host}${u.pathname}`);
    if (u.pathname === "/auth/v1/user") return auth === "at-alice" ? Response.json(alice) : Response.json({}, { status: 401 });
    if (u.pathname === "/rest/v1/profiles" && m === "GET") { const sel = u.searchParams.get("select"); const id = u.searchParams.get("id").replace("eq.", ""); return Response.json(sel.includes("stripe") ? [ids[id] || {}] : plans[id] ? [plans[id]] : []); }
    if (u.pathname === "/rest/v1/profiles" && m === "PATCH") { patches.push({ filter: u.search, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
    if (u.pathname === "/rest/v1/stripe_events" && m === "GET") return Response.json(events.has(u.searchParams.get("id").replace("eq.", "")) ? [{ id: "x" }] : []);
    if (u.pathname === "/rest/v1/stripe_events") { for (const r of JSON.parse(init.body)) events.add(r.id); return new Response(null, { status: 201 }); }
    if (u.host === "api.stripe.com") { log.push("body " + init.body); return Response.json(u.pathname.includes("billing_portal") ? { url: "https://billing.stripe.test/p" } : { url: "https://checkout.stripe.test/c" }); }
    throw new Error("unexpected " + url);
  };
  return Object.assign(f, { log, events, patches });
}

test("signature: valid, wrong secret, tampered body, old timestamp, missing header", async () => {
  const body = '{"id":"evt_1","type":"x"}', t = Math.floor(NOW / 1000), good = await signPayload(body, SECRET, t);
  assert.equal(await verifySignature(body, good, SECRET, NOW), true);
  assert.equal(await verifySignature(body, good, "other", NOW), false);
  assert.equal(await verifySignature(body + " ", good, SECRET, NOW), false);
  assert.equal(await verifySignature(body, await signPayload(body, SECRET, t - TOLERANCE_S - 5), SECRET, NOW), false, "replayed too late");
  assert.equal(await verifySignature(body, "", SECRET, NOW), false);
  assert.equal(await verifySignature(body, good, "", NOW), false);
});

test("a subscription turns into a plan: active is paid to the period's end, a cancelled one only until what was paid for runs out", () => {
  const end = Math.floor((NOW + 5 * 864e5) / 1000), endIso = new Date(end * 1000).toISOString();
  assert.deepEqual(planFromSubscription({ status: "active", current_period_end: end }, NOW), { plan: "paid", paid_until: endIso });
  assert.deepEqual(planFromSubscription({ status: "trialing", current_period_end: end }, NOW), { plan: "paid", paid_until: endIso });
  assert.deepEqual(planFromSubscription({ status: "past_due", current_period_end: end }, NOW), { plan: "paid", paid_until: endIso });
  assert.deepEqual(planFromSubscription({ status: "canceled", current_period_end: end - 10 * 864e5 / 1000 }, NOW), { plan: "free", paid_until: null });
  assert.deepEqual(planFromSubscription({ status: "incomplete", current_period_end: end }, NOW), { plan: "free", paid_until: null });
});

test("checkout: needs a signed-in user, sends the user's id to Stripe, returns the page; the admin and an already paid user are refused", async () => {
  _forget(); const f = world();
  assert.equal((await call(req("/api/billing/checkout"), env(), f)).status, 401);
  const res = await call(req("/api/billing/checkout", { cookie: `${AT}=at-alice` }), env(), f), j = await res.json();
  assert.equal(res.status, 200); assert.equal(j.url, "https://checkout.stripe.test/c");
  const sent = decodeURIComponent(f.log.find((l) => l.startsWith("body ")).slice(5));
  assert.match(sent, /mode=subscription/); assert.match(sent, /line_items\[0\]\[price\]=price_1/); assert.match(sent, /client_reference_id=u-alice/); assert.match(sent, /customer_email=alice@example.com/);
  assert.match(sent, /success_url=https:\/\/peikoff\.net\/atlas\/\?billing=success/); assert.match(sent, /subscription_data\[metadata\]\[user_id\]=u-alice/);
  assert.equal((await call(req("/api/billing/checkout", { cookie: `${AT}=at-alice` }), env({ STRIPE_SECRET_KEY: "" }), f)).status, 500, "not configured");
  _forget(); const paid = world({ plans: { "u-alice": { plan: "paid" } } });
  assert.equal((await call(req("/api/billing/checkout", { cookie: `${AT}=at-alice` }), env(), paid)).status, 409);
});

test("portal: only for someone with a Stripe customer", async () => {
  _forget(); const none = world();
  assert.equal((await call(req("/api/billing/portal", { cookie: `${AT}=at-alice` }), env(), none)).status, 404);
  _forget(); const has = world({ plans: { "u-alice": { plan: "paid" } }, ids: { "u-alice": { stripe_customer_id: "cus_9" } } });
  const j = await (await call(req("/api/billing/portal", { cookie: `${AT}=at-alice` }), env(), has)).json();
  assert.equal(j.url, "https://billing.stripe.test/p"); assert.match(decodeURIComponent(has.log.find((l) => l.startsWith("body "))), /customer=cus_9/);
});

async function hook(f, event, e = env(), t = Math.floor(Date.now() / 1000)) { const raw = JSON.stringify(event); return call(req("/api/stripe/webhook", { body: raw, headers: { "stripe-signature": await signPayload(raw, SECRET, t) } }), e, f); }

test("webhook: an unsigned or badly signed call changes nothing; a signed checkout turns the plan on; the same event twice is applied once", async () => {
  const f = world(), ev = { id: "evt_1", type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: "u-alice", customer: "cus_1", subscription: "sub_1", payment_status: "paid" } } };
  assert.equal((await call(req("/api/stripe/webhook", { body: ev }), env(), f)).status, 400);
  assert.equal((await call(req("/api/stripe/webhook", { body: ev, headers: { "stripe-signature": "t=1,v1=00" } }), env(), f)).status, 400);
  assert.equal(f.patches.length, 0);
  const ok = await hook(f, ev); assert.equal(ok.status, 200); assert.equal((await ok.json()).result, "done");
  assert.deepEqual(f.patches[0].body, { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", plan: "paid" }); assert.match(f.patches[0].filter, /id=eq\.u-alice/);
  assert.equal((await (await hook(f, ev)).json()).result, "duplicate"); assert.equal(f.patches.length, 1);
});

test("webhook: subscription updates set paid_until; a deleted subscription ends the plan; unrelated events are ignored", async () => {
  const f = world(), end = Math.floor(Date.now() / 1000) + 86400 * 30;
  await hook(f, { id: "evt_2", type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "active", current_period_end: end, metadata: { user_id: "u-alice" } } } });
  assert.deepEqual(f.patches[0].body, { plan: "paid", paid_until: new Date(end * 1000).toISOString(), stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  await hook(f, { id: "evt_3", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", metadata: {} } } });
  assert.deepEqual(f.patches[1].body, { plan: "free", paid_until: null, stripe_customer_id: "cus_1", stripe_subscription_id: null }); assert.match(f.patches[1].filter, /stripe_customer_id=eq\.cus_1/);
  assert.equal((await (await hook(f, { id: "evt_4", type: "charge.refunded", data: { object: {} } })).json()).result, "ignored");
});

test("webhook: if the plan cannot be written the event is not recorded and Stripe is told to retry", async () => {
  const f = world(); const base = f; const broken = async (url, init = {}) => (new URL(url).pathname === "/rest/v1/profiles" && init.method === "PATCH") ? new Response("no", { status: 500 }) : base(url, init);
  const res = await hook(broken, { id: "evt_5", type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: "u-alice", customer: "c", subscription: "s", payment_status: "paid" } } });
  assert.equal(res.status, 500); assert.equal(f.events.has("evt_5"), false);
});

test("Apple and Google both sign in through Supabase", async () => {
  assert.match(oauthUrl(env(), "apple", "https://peikoff.net/atlas/"), /provider=apple&redirect_to=https%3A%2F%2Fpeikoff\.net%2Fatlas%2F/);
  assert.match(oauthUrl(env(), "google", "x"), /provider=google/);
  assert.match(oauthUrl(env(), "evil", "x"), /provider=google/, "only the known providers");
  for (const p of ["apple", "google"]) { const res = await call(req(`/api/auth/${p}?redirect=https://evil.example/`, { method: "GET" }), env(), world()); assert.equal(res.status, 302); assert.match(res.headers.get("location"), new RegExp(`provider=${p}`)); assert.ok(res.headers.get("location").includes(encodeURIComponent("https://peikoff.net/atlas/"))); }
});

import { createCheckout, createPortal } from "../src/billing.js";
test("on atlas.<domain> the return addresses are the root (where that host serves the Atlas), on the main host /atlas/", async () => {
  const sent = []; const f = async (_u, init) => { sent.push(decodeURIComponent(init.body)); return Response.json({ url: "https://x" }); };
  await createCheckout(env(), { id: "u", email: "a@b.co" }, "https://atlas.peikoff.net", f); await createCheckout(env(), { id: "u" }, "https://peikoff.net", f); await createPortal(env(), "cus_1", "https://atlas.peikoff.net", f);
  assert.match(sent[0], /success_url=https:\/\/atlas\.peikoff\.net\/\?billing=success/); assert.match(sent[1], /success_url=https:\/\/peikoff\.net\/atlas\/\?billing=success/); assert.match(sent[2], /return_url=https:\/\/atlas\.peikoff\.net\/$/);
});
