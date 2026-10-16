// The shared reply cache: the same opening question to the same character is answered once for everybody.
//
// Many visitors will ask the same things first ("Who are you?", "What is Objectivism?"), so the first message of a conversation is looked up before the model is called.
//   key  = sha256( character id | the full system prompt | the normalized question )
// Putting the system prompt itself in the key means editing src/personas.js (or the character's card) starts a fresh cache with no extra bookkeeping, and the admin's family lines
// give admin chats their own entries. Only the first message of a conversation is cached (later ones depend on the history), and only a real reply (never an error or a refusal).
//
// Two levels: this Worker's memory (instant, lost when the isolate restarts) and the Supabase table `chat_cache` (shared by every Worker; needs SUPABASE_URL and the secret
// SUPABASE_SERVICE_KEY, and is skipped quietly without them). Replies older than TTL_DAYS are not served, so wording can refresh.
//
// Separately, the provider's own prompt caching helps every turn: the system prompt is built with its stable part first (src/chat.js), and OpenAI is sent a prompt_cache_key per character.

export const TTL_DAYS = 14;
const L1_MAX = 400, L1_MS = 3600_000;
const mem = new Map();                                              // key -> { reply, until }
export const _clear = () => mem.clear();

/** Lower case, accents and punctuation gone, spaces collapsed: "Who are YOU?!" and "who are you" are the same question. */
export const normalizeQuestion = (q) => String(q).normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const cacheKey = (personId, system, question) => sha256(`${personId}\n${system}\n${normalizeQuestion(question)}`);

const sb = (env) => env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY;
const h = (env) => ({ apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json" });
const root = (env) => String(env.SUPABASE_URL).replace(/\/+$/, "");

/** A cached reply for the key, or null. Never throws: a failing cache is a miss. */
export async function getCached(env, key, doFetch = fetch, now = Date.now()) {
  const m = mem.get(key); if (m && m.until > now) return { reply: m.reply, from: "memory" };
  if (!sb(env)) return null;
  try {
    const since = new Date(now - TTL_DAYS * 864e5).toISOString();
    const res = await doFetch(`${root(env)}/rest/v1/chat_cache?select=reply&key=eq.${key}&created_at=gt.${encodeURIComponent(since)}`, { headers: h(env) });
    if (!res.ok) return null;
    const row = (await res.json().catch(() => []))?.[0]; if (!row?.reply) return null;
    remember(key, row.reply, now);
    doFetch(`${root(env)}/rest/v1/rpc/chat_cache_hit`, { method: "POST", headers: h(env), body: JSON.stringify({ k: key }) }).catch(() => {});   // count the hit; not waited for
    return { reply: row.reply, from: "supabase" };
  } catch { return null; }
}

function remember(key, reply, now) { if (mem.size >= L1_MAX) mem.delete(mem.keys().next().value); mem.set(key, { reply, until: now + L1_MS }); }

/** Stores a reply (memory now, Supabase in the background: pass waitUntil from the Worker so it finishes after the response). Never throws. */
export function putCached(env, key, personId, reply, doFetch = fetch, waitUntil = () => {}, now = Date.now()) {
  remember(key, reply, now);
  if (!sb(env)) return;
  waitUntil((async () => {
    try { await doFetch(`${root(env)}/rest/v1/chat_cache?on_conflict=key`, { method: "POST", headers: { ...h(env), prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ key, person_id: personId, reply, created_at: new Date(now).toISOString() }]) }); } catch { /* a missed write is only a missed saving */ }
  })());
}
