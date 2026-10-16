// Accounts on Supabase: Auth (email magic link or Google) for who you are, a `profiles` row for what you may do (plan = free | paid).
// No SDK: plain fetch against Supabase's REST endpoints, so it runs in the Worker and is easy to test.
//
//   Worker variables / secrets:
//     SUPABASE_URL          https://<project>.supabase.co
//     SUPABASE_ANON_KEY     the publishable (anon) key: it is public, and every call here is made as the user, under row level security
//     SUPABASE_SERVICE_KEY  secret, only for the shared chat cache (src/cache.js); not needed for sign-in
//
//   Flow: the page asks POST /api/auth/otp (a magic link is emailed) or opens GET /api/auth/google; Supabase sends the person back to /atlas/ with tokens in the URL hash;
//   the page posts them to POST /api/auth/session, which checks them with Supabase and sets two HttpOnly cookies (a short access token, a long refresh token).
//   Every request then resolves the user from the access token, refreshing it from the refresh token when it has expired.

export const AT = "atlas_at", RT = "atlas_rt";
export const ACCESS_SECONDS = 3600, REFRESH_DAYS = 30;

export const configured = (env) => !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
const base = (env) => String(env.SUPABASE_URL).replace(/\/+$/, "");
const headers = (env, token) => ({ apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token || env.SUPABASE_ANON_KEY}`, "content-type": "application/json" });

export function cookieValue(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
export const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export const sessionCookies = (access, refresh) => [setCookie(AT, access, ACCESS_SECONDS), setCookie(RT, refresh, REFRESH_DAYS * 86400)];
export const clearCookies = () => [setCookie(AT, "", 0), setCookie(RT, "", 0)];

export const validEmail = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Only our own pages may be the place a sign-in link sends the person back to. */
export function safeRedirect(requested, url) {
  const host = url.host.replace(/^atlas\./, "");
  try { const r = new URL(requested); if (r.protocol === "https:" && (r.host === host || r.host === `atlas.${host}`) || r.hostname === "localhost") return r.origin + "/atlas/"; } catch { /* fall through */ }
  return `${url.origin}/atlas/`;
}

/** Emails a magic link (creating the account on first use). Resolves to { ok } or { error }. */
export async function sendMagicLink(env, email, redirectTo, doFetch = fetch) {
  const res = await doFetch(`${base(env)}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", headers: headers(env), body: JSON.stringify({ email, create_user: true }) });
  if (res.ok) return { ok: true };
  const j = await res.json().catch(() => ({}));
  return { error: String(j.msg || j.error_description || j.message || `Supabase said ${res.status}`).slice(0, 200), status: res.status };
}

export const googleUrl = (env, redirectTo) => `${base(env)}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;

const seen = new Map();                                                // access token -> { user, until }: a short memory so a chat does not ask Supabase on every message
const REMEMBER_MS = 60_000;
export const _forget = () => seen.clear();

/** The Supabase user behind an access token, or null. */
export async function userFromToken(env, token, doFetch = fetch, now = Date.now()) {
  if (!token) return null;
  const hit = seen.get(token); if (hit && hit.until > now) return hit.user;
  const res = await doFetch(`${base(env)}/auth/v1/user`, { headers: headers(env, token) });
  if (!res.ok) { seen.delete(token); return null; }
  const user = await res.json().catch(() => null); if (!user?.id) return null;
  if (seen.size > 500) seen.clear();
  seen.set(token, { user, until: now + REMEMBER_MS }); return user;
}

/** New tokens from a refresh token, or null. */
export async function refreshSession(env, refreshToken, doFetch = fetch) {
  if (!refreshToken) return null;
  const res = await doFetch(`${base(env)}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: headers(env), body: JSON.stringify({ refresh_token: refreshToken }) });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null); return j?.access_token && j?.refresh_token ? { access: j.access_token, refresh: j.refresh_token } : null;
}

/** Does this user's profile say they have paid? Read as the user (row level security lets them read only their own row). */
export async function isPaid(env, token, userId, doFetch = fetch, now = Date.now()) {
  const res = await doFetch(`${base(env)}/rest/v1/profiles?select=plan,paid_until&id=eq.${encodeURIComponent(userId)}`, { headers: headers(env, token) });
  if (!res.ok) return false;
  const row = (await res.json().catch(() => []))?.[0]; if (!row || row.plan !== "paid") return false;
  return !row.paid_until || Date.parse(row.paid_until) > now;
}

const shape = (u, paid) => ({ id: u.id, name: u.user_metadata?.full_name || u.email || "Member", email: u.email || "", admin: false, paid });

/** The signed-in Supabase user of a request, or null: { user, cookies } where cookies are new session cookies to send back (after a refresh). */
export async function resolveUser(request, env, doFetch = fetch, now = Date.now()) {
  if (!configured(env)) return { user: null, cookies: [] };
  let access = cookieValue(request, AT), cookies = [], u = await userFromToken(env, access, doFetch, now);
  if (!u) { const fresh = await refreshSession(env, cookieValue(request, RT), doFetch); if (fresh) { access = fresh.access; u = await userFromToken(env, access, doFetch, now); if (u) cookies = sessionCookies(fresh.access, fresh.refresh); } }
  if (!u) return { user: null, cookies: [] };
  return { user: shape(u, await isPaid(env, access, u.id, doFetch, now)), cookies };
}
