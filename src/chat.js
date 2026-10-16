// Speaking with people in the Atlas: who is signed in, the admin pass into the paid (paywalled) mode, and the chat API.
//
//   GET  /api/me           { user: null } for visitors; { user: { id: "admin", admin: true, paid: true } } with a valid admin session
//   POST /api/admin/login  { password } -> sets the admin session cookie (password = ADMIN_PASSWORD, or USER_PASSWORD when that is not set)
//   POST /api/logout       clears the cookie
//   POST /api/chat         { personId: "P2", messages: [{ role: "user" | "assistant", content }] } -> { reply, model }
//
// Chat is paywalled: a visitor gets 401, a signed-in user without a paid plan 402. Billing and Google sign-in do not exist yet,
// so for now only the admin session gets through.
//
// The model call is provider-neutral: one plain fetch to an OpenAI-style `POST {base}/chat/completions` (OpenAI, Mistral and xAI all speak it), no SDK.
//   LLM_KEY       Worker secret: the provider's API key
//   LLM_PROVIDER  Worker variable: openai (default) | mistral | xai. Picks the base URL and a default model.
//   LLM_BASE_URL  Worker variable, optional: any other OpenAI-compatible endpoint (overrides the provider's URL)
//   LLM_MODEL     Worker variable, optional: the model name (overrides the provider's default)
// Switching provider is therefore: `wrangler secret put LLM_KEY`, then set LLM_PROVIDER (and LLM_MODEL if you want something else). No code change.

import { GENERAL, PEOPLE, ADMIN } from "./personas.js";
import * as acct from "./accounts.js";
import { cacheKey, getCached, putCached } from "./cache.js";
import { logChat } from "./chatlog.js";
import { captureContact } from "./hubspot.js";
import * as bill from "./billing.js";
import * as use from "./usage.js";

export const COOKIE = "atlas_session";
export const SESSION_DAYS = 30;
export const PROVIDERS = {
  openai: { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  mistral: { base: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  xai: { base: "https://api.x.ai/v1", model: "grok-3-mini" },
};
export const LIMITS = { messages: 40, chars: 4000, totalChars: 40000 };

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const adminSecret = (env) => env.ADMIN_PASSWORD || env.USER_PASSWORD || "";

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

async function sameSecret(a, b) {                                     // compare two strings without leaking where they differ
  const k = "compare";
  return (await hmac(k, a)) === (await hmac(k, b));
}

/** A session token: "admin.<expiry ms>.<signature>". Changing the admin password signs everyone out. */
export async function makeToken(env, now = Date.now()) {
  const body = `admin.${now + SESSION_DAYS * 864e5}`;
  return `${body}.${await hmac(adminSecret(env), body)}`;
}

export async function readToken(env, token, now = Date.now()) {
  const secret = adminSecret(env);
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "admin" || !(+parts[1] > now)) return null;
  if (!(await sameSecret(parts[2], await hmac(secret, `${parts[0]}.${parts[1]}`)))) return null;
  return { id: "admin", name: "Admin", admin: true, paid: true };
}

function cookieOf(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export const userOf = (request, env) => readToken(env, cookieOf(request, COOKIE));

const noStore = { "cache-control": "no-store" };
const json = (body, status = 200, headers = {}, cookies = []) => {          // cookies: an array of Set-Cookie strings (a response can carry several)
  const h = new Headers({ ...noStore, ...headers }); for (const c of cookies) h.append("set-cookie", c);
  return Response.json(body, { status, headers: h });
};
const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, admin: !!u.admin, paid: !!u.paid };
/** Who is asking: the admin session first, else a signed-in Supabase account. { user, cookies } (cookies: refreshed session cookies to send back). */
async function who(request, env, doFetch) {
  const admin = await userOf(request, env); if (admin) return { user: admin, cookies: [] };
  return acct.resolveUser(request, env, doFetch);
}
const setCookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function body(request) {
  try { const v = await request.json(); return v && typeof v === "object" ? v : null; } catch { return null; }
}

/** Validates the conversation: user first and last, roles alternating, plain text only, within LIMITS. Returns an error string or null. */
export function checkMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return "messages must be a non-empty array.";
  if (messages.length > LIMITS.messages) return `At most ${LIMITS.messages} messages per conversation.`;
  let total = 0;
  for (let n = 0; n < messages.length; n++) {
    const m = messages[n];
    if (!m || m.role !== (n % 2 ? "assistant" : "user")) return "Messages must alternate user / assistant, starting with the user.";
    if (typeof m.content !== "string" || !m.content.trim()) return "Every message needs text.";
    if (m.content.length > LIMITS.chars) return `Each message is limited to ${LIMITS.chars} characters.`;
    total += m.content.length;
  }
  if (messages.length % 2 === 0) return "The last message must be from the user.";
  if (total > LIMITS.totalChars) return "This conversation is too long. Start a new one.";
  return null;
}

let cityCache = null;
async function personMeta(env, request, personId) {                 // the person's card, from the same data file the viewer draws
  if (!cityCache) {
    const r = await env.ASSETS.fetch(new Request(new URL("/atlas/data/whoneedsit.json", request.url)));
    if (!r.ok) throw new Error(`atlas data: HTTP ${r.status}`);
    cityCache = await r.json();
  }
  return cityCache.meta?.[personId] || null;
}
export const _resetCache = () => { cityCache = null; };

/** The system prompt: the model plays the person on the card, as a character in the Atlas (a virtual world), and never breaks character. */
export function personaPrompt(meta, id, user) {
  const name = meta.Name || "this person", extra = PEOPLE[id] || {}, list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string" && x.trim());
  const facts = Object.entries(meta)
    .filter(([k, v]) => !["Name", "Image", "Relationships"].includes(k) && !/^Link \d+$/.test(k) && v !== "" && v != null)
    .map(([k, v]) => `${k}: ${v}`);
  const rels = (meta.Relationships || []).filter((r) => r.with && !/^org #\d+$/.test(r.with)).slice(0, 40)
    .map((r) => (r.dir === "in" ? `${r.with} -> ${r.type} -> ${name}` : `${r.type}: ${r.with}`) + (r.start_date ? ` (${r.start_date}${r.end_date ? "-" + r.end_date : ""})` : ""));
  return [
    ...GENERAL.map((l) => l.replaceAll("{name}", name)),
    ...list(extra.instructions),
    "",
    `Character card for ${name}:`,
    ...facts,
    ...list(extra.facts),
    ...(rels.length ? ["", "Relationships:", ...rels] : []),
    ...(list(extra.never).length ? ["", "Never:", ...list(extra.never)] : []),
    // what depends on who is asking comes last, so everything above is the same text for every visitor and the provider's prompt cache can reuse it
    ...(user?.admin && [...list(ADMIN.all), ...list(ADMIN.people?.[id])].length ? ["", ...list(ADMIN.all), ...list(ADMIN.people?.[id])] : []),
  ].join("\n");
}

/** Which endpoint and model to call, from the Worker variables. Returns { url, model } or { error }. */
export function llmConfig(env) {
  const name = (env.LLM_PROVIDER || "openai").toLowerCase(), preset = PROVIDERS[name];
  if (!preset && !env.LLM_BASE_URL) return { error: `Unknown LLM_PROVIDER "${env.LLM_PROVIDER}" (use ${Object.keys(PROVIDERS).join(", ")}, or set LLM_BASE_URL).` };
  const base = (env.LLM_BASE_URL || preset.base).replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) return { error: "LLM_BASE_URL must start with https://." };
  const model = env.LLM_MODEL || (env.LLM_BASE_URL ? "" : preset.model);                 // a provider's default model only goes to that provider's own URL
  if (!model) return { error: "LLM_MODEL is not set (needed with a custom LLM_BASE_URL)." };
  return { url: `${base}/chat/completions`, model };
}

const isOpenAI = (env) => (env.LLM_PROVIDER || "openai").toLowerCase() === "openai" && !env.LLM_BASE_URL;   // only OpenAI is sent prompt_cache_key; other providers cache a repeated prefix on their own

/** One chat completion over the OpenAI-style API. Returns { reply, model, refused } or throws { status, detail }. */
export async function complete(env, system, messages, doFetch = fetch, cacheHint = "") {
  const cfg = llmConfig(env);
  if (cfg.error) throw { status: 500, detail: cfg.error, config: true };
  // Only the fields every provider accepts: no token limit or temperature (names and allowed values differ between models); the system prompt keeps replies short.
  const res = await doFetch(cfg.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_KEY}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "system", content: system }, ...messages], ...(cacheHint && isOpenAI(env) ? { prompt_cache_key: cacheHint } : {}), [isOpenAI(env) ? "max_completion_tokens" : "max_tokens"]: use.maxOutput(env) }),   // OpenAI: requests with the same key (one per character) are routed together, so the shared system prompt is served from its cache
  });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch { /* not JSON: reported below */ }
  if (!res.ok) throw { status: res.status, detail: String(j?.error?.message || j?.message || text).slice(0, 300) };
  const choice = j?.choices?.[0], msg = choice?.message;
  const reply = typeof msg?.content === "string" ? msg.content.trim() : Array.isArray(msg?.content) ? msg.content.map((c) => c?.text || "").join("").trim() : "";
  return { reply, model: j?.model || cfg.model, usage: j?.usage, refused: !!msg?.refusal || choice?.finish_reason === "content_filter" };
}

/** Handles the speaking endpoints; returns null for any other path. deps.fetch lets tests stand in for the provider. */
export async function handleChatApi(request, env, url, deps = {}) {
  const path = url.pathname, method = request.method, doFetch = deps.fetch || fetch, waitUntil = deps.waitUntil || (() => {});

  if (path === "/api/me" && method === "GET") {
    const { user, cookies } = await who(request, env, doFetch); return json({ user: publicUser(user), accounts: acct.configured(env), providers: acct.configured(env) ? acct.enabledProviders(env).map(id => ({ id, label: acct.PROVIDERS[id].label })) : [], billing: acct.configured(env) && bill.configured(env) }, 200, {}, cookies);
  }

  if (path === "/api/admin/login" && method === "POST") {
    if (!adminSecret(env)) return json({ error: "Worker secret ADMIN_PASSWORD (or USER_PASSWORD) is not configured." }, 500);
    const b = await body(request), password = typeof b?.password === "string" ? b.password : "";
    if (!password) return json({ error: "Password is required." }, 400);
    if (!(await sameSecret(password, adminSecret(env)))) return json({ error: "Invalid password." }, 401);
    const token = await makeToken(env);
    return json({ user: await readToken(env, token) }, 200, { "set-cookie": setCookie(token, SESSION_DAYS * 86400) });
  }

  if (path === "/api/logout" && method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": setCookie("", 0) }, acct.clearCookies());
  }

  if (path === "/api/auth/otp" && method === "POST") {                         // email a magic link (creates the account on first use)
    if (!acct.configured(env)) return json({ error: "Accounts are not configured (Worker variables SUPABASE_URL and SUPABASE_ANON_KEY)." }, 500);
    const b = await body(request), email = typeof b?.email === "string" ? b.email.trim() : "";
    if (!acct.validEmail(email)) return json({ error: "Please enter a valid email address." }, 400);
    const r = await acct.sendMagicLink(env, email, acct.safeRedirect(b?.redirect || request.headers.get("referer") || "", url), doFetch);
    return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status === 429 ? 429 : 502);
  }

  if (/^\/api\/auth\/[a-z]+$/.test(path) && acct.enabledProviders(env).includes(path.split("/").pop()) && method === "GET") {   // off to a provider (Google, Apple, GitHub, ...) through Supabase; it sends the person back to /atlas/ with tokens in the URL
    if (!acct.configured(env)) return json({ error: "Accounts are not configured." }, 500);
    return new Response(null, { status: 302, headers: { location: acct.oauthUrl(env, path.split("/").pop(), acct.safeRedirect(url.searchParams.get("redirect") || "", url)), ...noStore } });
  }

  if (path === "/api/auth/session" && method === "POST") {                         // the page hands over the tokens it came back with; they are checked, then kept in HttpOnly cookies
    if (!acct.configured(env)) return json({ error: "Accounts are not configured." }, 500);
    const b = await body(request), at = typeof b?.access_token === "string" ? b.access_token : "", rt = typeof b?.refresh_token === "string" ? b.refresh_token : "";
    if (!at || !rt || at.length > 4000 || rt.length > 1000 || /[;\s]/.test(at + rt)) return json({ error: "Missing or malformed tokens." }, 400);
    if (!(await acct.userFromToken(env, at, doFetch))) return json({ error: "Those sign-in tokens were not accepted." }, 401);
    const cookies = acct.sessionCookies(at, rt), { user } = await acct.resolveUser(new Request(url, { headers: { cookie: `${acct.AT}=${at}` } }), env, doFetch);
    if (user) captureContact(env, user, "subscriber", doFetch, waitUntil);                                // everyone who signs in is on the HubSpot contact list
    return json({ user: publicUser(user) }, 200, {}, cookies);
  }

  if (path === "/api/billing/checkout" && method === "POST") {                      // a Stripe Checkout page for the paid plan
    const { user, cookies } = await who(request, env, doFetch);
    if (!user) return json({ error: "Please sign in first.", code: "register" }, 401);
    if (user.admin) return json({ error: "The admin session already has everything." }, 400);
    if (!acct.configured(env) || !bill.configured(env)) return json({ error: "Payments are not configured (STRIPE_SECRET_KEY and STRIPE_PRICE_ID)." }, 500);
    if (user.paid) return json({ error: "You already have the paid plan. Use /billing to manage it.", code: "already" }, 409, {}, cookies);
    try { const ids = await bill.stripeIds(env, user.id, doFetch); return json({ url: await bill.createCheckout(env, { ...user, stripeCustomer: ids.customer }, url.origin, doFetch) }, 200, {}, cookies); }
    catch (e) { return json({ error: "Could not start the checkout.", detail: String(e?.detail || e?.message || e) }, 502); }
  }

  if (path === "/api/billing/portal" && method === "POST") {                        // Stripe's customer portal: cards, invoices, cancelling
    const { user, cookies } = await who(request, env, doFetch);
    if (!user) return json({ error: "Please sign in first.", code: "register" }, 401);
    if (user.admin || !bill.configured(env)) return json({ error: "There is no subscription to manage." }, 400);
    const ids = await bill.stripeIds(env, user.id, doFetch); if (!ids.customer) return json({ error: "You have no subscription yet.", code: "none" }, 404, {}, cookies);
    try { return json({ url: await bill.createPortal(env, ids.customer, url.origin, doFetch) }, 200, {}, cookies); }
    catch (e) { return json({ error: "Could not open the billing portal.", detail: String(e?.detail || e?.message || e) }, 502); }
  }

  if (path === "/api/stripe/webhook" && method === "POST") {                         // called by Stripe, never by the page: the signature is the only credential
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not configured." }, 500);
    const raw = await request.text();
    if (!(await bill.verifySignature(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) return json({ error: "Bad signature." }, 400);
    let event; try { event = JSON.parse(raw); } catch { return json({ error: "Bad JSON." }, 400); }
    if (!event?.id || !event?.type) return json({ error: "Not an event." }, 400);
    try {
      const result = await bill.applyEvent(env, event, doFetch), co = event.data?.object, email = co?.customer_details?.email || co?.customer_email;
      if (event.type === "checkout.session.completed" && result !== "duplicate" && email) captureContact(env, { email, name: co?.customer_details?.name }, "customer", doFetch, waitUntil);   // a payer becomes a HubSpot customer
      return json({ received: true, result });
    }
    catch (e) { return json({ error: "Could not record the event; Stripe will retry.", detail: String(e?.detail || e?.message || e) }, 500); }
  }

  if (path === "/api/chat" && method === "POST") {
    const { user, cookies } = await who(request, env, doFetch);
    if (!user) return json({ error: "Please register or sign in to speak with people.", code: "register" }, 401);
    if (!user.paid) return json({ error: "Speaking with people needs a paid plan.", code: "paywall" }, 402, {}, cookies);
    if (!env.LLM_KEY) return json({ error: "Worker secret LLM_KEY is not configured." }, 500);

    const b = await body(request);
    if (!b) return json({ error: "Request body must be valid JSON." }, 400);
    const personId = typeof b.personId === "string" ? b.personId : "";
    if (!/^P\d+$/.test(personId)) return json({ error: "personId is required." }, 400);
    const bad = checkMessages(b.messages);
    if (bad) return json({ error: bad }, 400);

    let meta;
    try { meta = await personMeta(env, request, personId); } catch (e) { return json({ error: "Could not load the atlas data.", detail: String(e?.message || e) }, 500); }
    if (!meta) return json({ error: "No such person." }, 404);

    try {
      const system = personaPrompt(meta, personId, user), messages = b.messages.map((m) => ({ role: m.role, content: m.content }));
      const first = messages.length === 1 && !user.admin, key = first ? await cacheKey(personId, system, messages[0].content) : "";          // the opening question is shared by everybody; the admin always gets a fresh answer
      if (first) { const hit = await getCached(env, key, doFetch); if (hit) { logChat(env, { user, personId, personName: meta.Name, messages, reply: hit.reply, cached: true }, doFetch, waitUntil); return json({ reply: hit.reply, cached: true }, 200, {}, cookies); } }
      const cfg = llmConfig(env), capped = !user.admin;                                                   // the admin is not capped; everyone else has a dollar budget (src/usage.js)
      let used = null, est = 0, estTok = 0, bud = null;
      if (capped) {
        if (!use.enforceable(env)) return json({ error: "Chat is paused: usage caps cannot be enforced (the Worker secret SUPABASE_SERVICE_KEY is not set).", code: "caps" }, 503, {}, cookies);
        bud = use.budgets(env); est = use.estimateMicro(env, cfg.model || "", system, messages); estTok = use.estimateTokens(env, system, messages);
        try { used = await use.readUsage(env, user.id, doFetch); } catch { return json({ error: "Chat is paused for a moment: usage could not be checked. Try again shortly.", code: "caps" }, 503, {}, cookies); }
        const a = use.allowance(used, { cost: est, tokens: estTok }, bud);
        if (!a.ok) return json({ error: a.reason === "day" ? `You have reached today's chat allowance. It comes back tomorrow (${a.resets}).` : a.reason === "questions" ? `You have used your ${bud.questions} questions for this month. They come back on ${a.resets}.` : a.reason === "tokens" ? `You have used this month's chat allowance (${bud.tokens.toLocaleString("en-US")} tokens). It resets on ${a.resets}.` : `You have used this month's chat allowance. It resets on ${a.resets}.`, code: "allowance", reason: a.reason, resets: a.resets }, 429, {}, cookies);
      }
      const out = await complete(env, system, messages, doFetch, personId);
      let spent = 0; if (capped) { spent = use.costMicro(env, out.model || cfg.model, out.usage, est); try { await use.addUsage(env, user.id, spent, use.tokensUsed(out.usage, estTok), doFetch); } catch { /* served already; the next call re-reads the usage before it is allowed */ } }
      const pct = capped ? use.percentUsed({ month: used.month + spent, today: used.today + spent, questions: used.questions + 1, tokens: used.tokens + use.tokensUsed(out.usage, estTok) }, bud) : 0;
      logChat(env, { user, personId, personName: meta.Name, messages, reply: out.reply, refused: !!out.refused, model: out.model, cost: spent }, doFetch, waitUntil);
      if (out.refused && !out.reply) return json({ reply: `(${meta.Name || "They"} would rather not answer that.)`, model: out.model, refused: true }, 200, {}, cookies);
      if (first && out.reply && !out.refused) putCached(env, key, personId, out.reply, doFetch, waitUntil);
      return json({ reply: out.reply || "(no reply)", model: out.model, ...(capped ? { allowance: { used_pct: pct, questions_left: Math.max(0, bud.questions - used.questions - 1) } } : {}) }, 200, {}, cookies);
    } catch (e) {
      if (e?.config) return json({ error: e.detail }, 500);
      if (e?.status === 429) return json({ error: "Too many conversations right now. Try again in a minute." }, 429);
      if (e?.status === 401 || e?.status === 403) return json({ error: "The LLM_KEY secret was rejected by the provider." }, 502);
      if (e?.status) return json({ error: "The language model returned an error.", detail: `${e.status} ${e.detail}`.trim() }, 502);
      return json({ error: "Could not reach the language model.", detail: String(e?.message || e) }, 502);
    }
  }

  return null;
}

export const CHAT_PATHS = new Set(["/api/me", "/api/admin/login", "/api/logout", "/api/chat", "/api/auth/otp", ...Object.keys(acct.PROVIDERS).map(p => `/api/auth/${p}`), "/api/auth/session", "/api/billing/checkout", "/api/billing/portal", "/api/stripe/webhook"]);
