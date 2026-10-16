// Chat log: one row per question in public.chat_log (see supabase/migrations/20261016160000_chat_log.sql), written by the Worker with the service key after the answer is sent.
// Best effort: logging never delays or fails a chat (no key, no table, Supabase down: the row is dropped). Cache hits, refusals and admin chats are logged too, flagged.
// The text is stored, so the privacy page should say so.

/** The row for one exchange. info: { user, personId, personName, messages, reply, cached, refused, model, cost } */
export function chatLogRow({ user, personId, personName, messages, reply, cached = false, refused = false, model = null, cost = 0 }) {
  const question = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  return {
    user_id: user?.admin ? null : user?.id || null, email: user?.email || null, admin: !!user?.admin,
    person_id: String(personId), person_name: personName || null, turn: messages.length,
    question: String(question).slice(0, 4000), answer: reply == null ? null : String(reply).slice(0, 8000),
    cached: !!cached, refused: !!refused, model: model || null, cost_micro: Math.max(0, Math.round(cost || 0)),
  };
}

/** Write it in the background (waitUntil keeps the Worker alive until the request finishes). */
export function logChat(env, info, doFetch = fetch, waitUntil = () => {}) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_KEY) return;
  waitUntil((async () => {
    try {
      await doFetch(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/chat_log`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify([chatLogRow(info)]),
      });
    } catch { /* the chat already worked */ }
  })());
}
