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

import { GENERAL, PEOPLE } from "./personas.js";

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
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { ...noStore, ...headers } });
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
export function personaPrompt(meta, id) {
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

/** One chat completion over the OpenAI-style API. Returns { reply, model, refused } or throws { status, detail }. */
export async function complete(env, system, messages, doFetch = fetch) {
  const cfg = llmConfig(env);
  if (cfg.error) throw { status: 500, detail: cfg.error, config: true };
  // Only the fields every provider accepts: no token limit or temperature (names and allowed values differ between models); the system prompt keeps replies short.
  const res = await doFetch(cfg.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_KEY}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "system", content: system }, ...messages] }),
  });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch { /* not JSON: reported below */ }
  if (!res.ok) throw { status: res.status, detail: String(j?.error?.message || j?.message || text).slice(0, 300) };
  const choice = j?.choices?.[0], msg = choice?.message;
  const reply = typeof msg?.content === "string" ? msg.content.trim() : Array.isArray(msg?.content) ? msg.content.map((c) => c?.text || "").join("").trim() : "";
  return { reply, model: j?.model || cfg.model, refused: !!msg?.refusal || choice?.finish_reason === "content_filter" };
}

/** Handles the speaking endpoints; returns null for any other path. deps.fetch lets tests stand in for the provider. */
export async function handleChatApi(request, env, url, deps = {}) {
  const path = url.pathname, method = request.method;

  if (path === "/api/me" && method === "GET") {
    return json({ user: await userOf(request, env) });
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
    return json({ ok: true }, 200, { "set-cookie": setCookie("", 0) });
  }

  if (path === "/api/chat" && method === "POST") {
    const user = await userOf(request, env);
    if (!user) return json({ error: "Please register or sign in to speak with people.", code: "register" }, 401);
    if (!user.paid) return json({ error: "Speaking with people needs a paid plan.", code: "paywall" }, 402);
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
      const out = await complete(env, personaPrompt(meta, personId), b.messages.map((m) => ({ role: m.role, content: m.content })), deps.fetch);
      if (out.refused && !out.reply) return json({ reply: `(${meta.Name || "They"} would rather not answer that.)`, model: out.model, refused: true });
      return json({ reply: out.reply || "(no reply)", model: out.model });
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

export const CHAT_PATHS = new Set(["/api/me", "/api/admin/login", "/api/logout", "/api/chat"]);
