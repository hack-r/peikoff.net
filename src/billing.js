// Monetization with Stripe Checkout (a subscription), the Stripe customer portal, and a signed webhook that keeps `profiles.plan` / `paid_until` in step. No SDK: plain fetch.
//
//   Worker secrets / variables:
//     STRIPE_SECRET_KEY      sk_live_... (or sk_test_...)
//     STRIPE_PRICE_ID        price_...   the recurring price of the paid plan
//     STRIPE_WEBHOOK_SECRET  whsec_...   from the webhook endpoint https://peikoff.net/api/stripe/webhook
//     SUPABASE_SERVICE_KEY   the webhook writes profiles as the service role (accounts.js reads them as the user)
//
//   Flow: "Subscribe" -> POST /api/billing/checkout -> Stripe's hosted page -> back to /atlas/?billing=success. Stripe then calls POST /api/stripe/webhook, which is the only thing that grants
//   the plan: the signature is checked (HMAC-SHA256, 5 minutes of tolerance), each event is processed once (table stripe_events), and the profile gets plan = paid with paid_until = the end
//   of the paid period, so a missed cancellation still runs out by itself. "Manage subscription" (/billing) opens Stripe's customer portal: cards, invoices, cancelling.

import { homeUrl } from "./accounts.js";

export const TOLERANCE_S = 300;
export const configured = (env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
const sbOk = (env) => !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
const sb = (env) => String(env.SUPABASE_URL).replace(/\/+$/, "");
const svc = (env, extra = {}) => ({ apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", ...extra });

const form = (obj) => { const p = new URLSearchParams(); const walk = (k, v) => { if (v == null) return; if (typeof v === "object") for (const [a, b] of Object.entries(v)) walk(`${k}[${a}]`, b); else p.append(k, String(v)); }; for (const [k, v] of Object.entries(obj)) walk(k, v); return p; };
async function stripe(env, path, params, doFetch) {
  const res = await doFetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" }, body: form(params).toString() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, detail: String(j?.error?.message || `Stripe said ${res.status}`).slice(0, 200) };
  return j;
}

/** A hosted Checkout page for the paid plan; resolves to its URL. The user's id travels with it, so the webhook knows whose plan to turn on. */
export async function createCheckout(env, user, origin, doFetch = fetch) {
  const s = await stripe(env, "checkout/sessions", {
    mode: "subscription", "line_items": { 0: { price: env.STRIPE_PRICE_ID, quantity: 1 } }, allow_promotion_codes: "true",
    client_reference_id: user.id, ...(user.stripeCustomer ? { customer: user.stripeCustomer } : user.email ? { customer_email: user.email } : {}),
    subscription_data: { metadata: { user_id: user.id } }, metadata: { user_id: user.id },
    custom_text: { submit: { message: "By subscribing you agree to the [Terms of Service](https://peikoff.net/terms) and [Privacy Policy](https://peikoff.net/privacy). Renews monthly; cancel any time with /billing in the Atlas." } },
    success_url: `${homeUrl(origin)}?billing=success`, cancel_url: `${homeUrl(origin)}?billing=cancelled`,
  }, doFetch);
  return s.url;
}

/** Stripe's customer portal for a subscriber; resolves to its URL. */
export async function createPortal(env, customerId, origin, doFetch = fetch) {
  return (await stripe(env, "billing_portal/sessions", { customer: customerId, return_url: homeUrl(origin) }, doFetch)).url;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };   // no early exit

/** Checks the Stripe-Signature header of the raw body: t=<time>,v1=<hmac of "t.body">. Returns true only for a valid, recent signature. */
export async function verifySignature(rawBody, header, secret, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=")).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const t = Number(parts.t), sigs = header.split(",").map((p) => p.trim()).filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > TOLERANCE_S) return false;
  const want = await hmacHex(secret, `${t}.${rawBody}`);
  return sigs.some((s) => same(s, want));
}
/** For tests and tooling: the header Stripe would send. */
export async function signPayload(rawBody, secret, t = Math.floor(Date.now() / 1000)) { return `t=${t},v1=${await hmacHex(secret, `${t}.${rawBody}`)}`; }

/** What a subscription object means for the profile: { plan, paid_until } (an ISO date, or null). Active and trialing: paid to the end of the period. Anything else: paid only until the period already paid for runs out. */
export function planFromSubscription(sub, now = Date.now()) {
  const end = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  if (sub.status === "active" || sub.status === "trialing") return { plan: "paid", paid_until: end };
  if (end && Date.parse(end) > now && sub.status !== "incomplete" && sub.status !== "incomplete_expired") return { plan: "paid", paid_until: end };   // past_due / canceled at period end: what was paid for stays
  return { plan: "free", paid_until: null };
}

async function patchProfile(env, filter, body, doFetch) {
  const res = await doFetch(`${sb(env)}/rest/v1/profiles?${filter}`, { method: "PATCH", headers: svc(env, { prefer: "return=minimal" }), body: JSON.stringify(body) });
  if (!res.ok) throw { status: 500, detail: `profiles update failed (${res.status})` };
}

/** Handles one verified Stripe event once. Returns a short word for the log: "done", "duplicate" or "ignored". */
export async function applyEvent(env, event, doFetch = fetch, now = Date.now()) {
  if (!sbOk(env)) throw { status: 500, detail: "SUPABASE_URL and SUPABASE_SERVICE_KEY are needed to record a plan." };
  const seen = await doFetch(`${sb(env)}/rest/v1/stripe_events?select=id&id=eq.${encodeURIComponent(event.id)}`, { headers: svc(env) });
  if (!seen.ok) throw { status: 500, detail: `stripe_events lookup failed (${seen.status})` };
  if ((await seen.json().catch(() => []))?.length) return "duplicate";                                     // already processed (Stripe retries and sometimes sends twice)
  const out = await handle(env, event, doFetch, now);
  const rec = await doFetch(`${sb(env)}/rest/v1/stripe_events`, { method: "POST", headers: svc(env, { prefer: "resolution=ignore-duplicates,return=minimal" }), body: JSON.stringify([{ id: event.id, type: event.type }]) });
  if (!rec.ok) throw { status: 500, detail: `stripe_events insert failed (${rec.status})` };                 // recorded only after the plan was written, so a failure is retried
  return out;
}

async function handle(env, event, doFetch, now) {
  const o = event.data?.object || {};
  if (event.type === "checkout.session.completed" && o.mode === "subscription") {
    const uid = o.client_reference_id || o.metadata?.user_id; if (!uid) return "ignored";
    await patchProfile(env, `id=eq.${encodeURIComponent(uid)}`, { stripe_customer_id: o.customer || null, stripe_subscription_id: o.subscription || null, ...(o.payment_status === "paid" || o.payment_status === "no_payment_required" ? { plan: "paid" } : {}) }, doFetch);
    return "done";
  }
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const p = event.type === "customer.subscription.deleted" ? { plan: "free", paid_until: null } : planFromSubscription(o, now);
    const uid = o.metadata?.user_id, filter = uid ? `id=eq.${encodeURIComponent(uid)}` : `stripe_customer_id=eq.${encodeURIComponent(o.customer || "")}`;
    if (!uid && !o.customer) return "ignored";
    await patchProfile(env, filter, { ...p, stripe_customer_id: o.customer || null, stripe_subscription_id: event.type === "customer.subscription.deleted" ? null : o.id }, doFetch);
    return "done";
  }
  return "ignored";
}

/** The profile's Stripe ids (read with the service role): { customer, subscription } or nulls. */
export async function stripeIds(env, userId, doFetch = fetch) {
  if (!sbOk(env)) return { customer: null, subscription: null };
  const res = await doFetch(`${sb(env)}/rest/v1/profiles?select=stripe_customer_id,stripe_subscription_id&id=eq.${encodeURIComponent(userId)}`, { headers: svc(env) });
  const row = res.ok ? (await res.json().catch(() => []))?.[0] : null;
  return { customer: row?.stripe_customer_id || null, subscription: row?.stripe_subscription_id || null };
}
