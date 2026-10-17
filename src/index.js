import { CHAT_PATHS, handleChatApi } from "./chat.js";
import { versionInfo } from "./version.js";

const APEX = "peikoff.net";

// Security headers for every response. Set only when the response has not chosen its own (the Firebase proxy and static assets may).
// No Content-Security-Policy yet: the pages use inline scripts and several third-party hosts, so a policy needs its own review.
export const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export function withSecurityHeaders(response) {
  const set = (res) => { for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v); return res; };
  try { return set(response); } catch { return set(new Response(response.body, response)); }   // redirects and fetched responses have immutable headers: copy them
}

/** One address per page: http -> https and www -> the bare domain, both permanent (301), so a crawler follows one hop and never sees a duplicate host. */
export function canonicalHostRedirect(url) {
  const onSite = url.hostname === APEX || url.hostname.endsWith("." + APEX);
  if (!onSite || (url.protocol !== "http:" && url.hostname !== `www.${APEX}`)) return null;
  const target = new URL(url);
  target.protocol = "https:"; target.port = "";
  if (target.hostname === `www.${APEX}`) target.hostname = APEX;
  return Response.redirect(target.toString(), 301);
}

export default {
  async fetch(request, env, ctx) {
    const redirect = canonicalHostRedirect(new URL(request.url));
    return withSecurityHeaders(redirect || (await route(request, env, ctx)));
  },
};

async function route(request, env, ctx) {
    const url = new URL(request.url);

    // Firebase sign-in on our own domain: the Google consent screen shows this site instead of supabase.co. Firebase's handler pages are proxied from <project>.firebaseapp.com.
    if (url.pathname.startsWith("/__/auth/") || url.pathname.startsWith("/__/firebase/")) return firebaseProxy(request, env, url);

    // /atlas -> the visualization page (same origin, so it works whether or not the atlas subdomain is attached)
    if (url.pathname === "/atlas" && !url.hostname.startsWith("atlas.")) {
      return Response.redirect(new URL("/atlas/", url).toString(), 301);
    }

    // atlas.<domain>: the Atlas of Objectivism (static viewer under public/atlas/). No API on this host.
    if (url.hostname.startsWith("atlas.")) {
      return serveAtlas(request, env, url, ctx);
    }

    if (url.pathname === "/") {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/version.json") {
      return versionResponse(env);
    }

    if (CHAT_PATHS.has(url.pathname)) {
      // Who is signed in, the admin pass, and speaking with people in the Atlas (src/chat.js)
      const response = await handleChatApi(request, env, url, { waitUntil: (p) => ctx?.waitUntil?.(p) });
      if (response) return response;
    }

    if (url.pathname === "/api/auth" && request.method === "POST") {
      const parsed = await safeJson(request);
      if (!parsed.ok) {
        return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
      }

      const password = getString(parsed.value.password);
      if (!password) {
        return Response.json({ error: "Password is required." }, { status: 400 });
      }

      const authError = validatePassword(env, password);
      if (authError) {
        return authError;
      }

      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/query" && request.method === "POST") {
      const parsed = await safeJson(request);
      if (!parsed.ok) {
        return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
      }

      const password = getString(parsed.value.password);
      const sql = getString(parsed.value.sql);

      if (!password) {
        return Response.json({ error: "Password is required." }, { status: 400 });
      }

      if (!sql) {
        return Response.json({ error: "SQL is required." }, { status: 400 });
      }

      const authError = validatePassword(env, password);
      if (authError) {
        return authError;
      }

      if (!env.whoneedsit) {
        return Response.json(
          {
            error: "D1 binding 'whoneedsit' is not configured.",
          },
          { status: 500 },
        );
      }

      // Allow read-only SQL in this endpoint.
      if (!isReadOnlySelect(sql)) {
        return Response.json(
          { error: "Only SELECT statements are allowed." },
          { status: 400 },
        );
      }

      try {
        const { results } = await env.whoneedsit.prepare(sql).all();
        const rows = Array.isArray(results) ? results : [];
        const columns = getColumns(rows);
        return Response.json({ columns, rows, rowCount: rows.length });
      } catch (error) {
        return Response.json(
          { error: "SQL execution failed.", detail: String(error?.message || error) },
          { status: 400 },
        );
      }
    }

    if (url.pathname === "/api/tables") {
      if (!env.whoneedsit) {
        return Response.json(
          {
            error: "D1 binding 'whoneedsit' is not configured.",
          },
          { status: 500 },
        );
      }

      const query = `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name;
      `;

      const { results } = await env.whoneedsit.prepare(query).all();
      return Response.json({ tables: results });
    }

    return env.ASSETS.fetch(request);
}

/** Proxy Firebase's auth handler (/__/auth/*) and init.json (/__/firebase/*) so the page can use this site as its Firebase authDomain. Only for the configured project. */
export async function firebaseProxy(request, env, url, doFetch = fetch) {
  const project = String(env.FIREBASE_PROJECT_ID || "");
  if (!/^[a-z0-9-]{4,40}$/.test(project) || !["GET", "HEAD", "POST"].includes(request.method)) return new Response("Not found", { status: 404 });
  const headers = new Headers(); for (const h of ["accept", "accept-language", "content-type", "user-agent"]) if (request.headers.get(h)) headers.set(h, request.headers.get(h));
  const res = await doFetch(`https://${project}.firebaseapp.com${url.pathname}${url.search}`, { method: request.method, headers, body: request.method === "POST" ? await request.arrayBuffer() : undefined, redirect: "manual" });
  const out = new Headers(res.headers); out.delete("set-cookie");
  return new Response(res.body, { status: res.status, headers: out });
}

const SHARED_PATHS = new Set(["/privacy", "/terms", "/ai-disclosure", "/legal.css"]);   // the legal pages live at the site root and are served as they are on atlas.<domain> too

async function serveAtlas(request, env, url, ctx) {
  if (SHARED_PATHS.has(url.pathname)) return env.ASSETS.fetch(request);

  // The same Atlas page lives at https://peikoff.net/atlas/. Search engines get one canonical address (the page says so too; the header covers crawlers that read headers first).
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\nDisallow: /api/\n", { headers: { "content-type": "text/plain; charset=utf-8" } });

  if (CHAT_PATHS.has(url.pathname)) {
    // the viewer calls these on its own origin; nothing else under /api/ is exposed on this host
    const response = await handleChatApi(request, env, url, { waitUntil: (p) => ctx?.waitUntil?.(p) });
    if (response) return response;
  }

  if (url.pathname === "/version.json" && (request.method === "GET" || request.method === "HEAD")) return versionResponse(env);      // the same public build info as on the main host

  if (url.pathname.startsWith("/api/") || url.pathname === "/version.json") {
    return new Response("Not found", { status: 404 });
  }

  const target = new URL(url);
  target.pathname = url.pathname === "/" ? "/atlas/" : `/atlas${url.pathname}`;      // "/atlas/" not "/atlas/index.html": the assets handler would answer the file name with a redirect to /atlas/, which does not exist on this host
  const response = await env.ASSETS.fetch(new Request(target, request));
  if (url.pathname !== "/") return response;
  const out = new Response(response.body, response); out.headers.set("link", `<https://${APEX}/atlas/>; rel="canonical"`);
  return out;
}

function versionResponse(env) {
  return Response.json(versionInfo(env), { headers: { "cache-control": "no-store" } });
}

function getString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isReadOnlySelect(sql) {
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed)) {
    return false;
  }

  const noTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  return !noTrailingSemicolon.includes(";");
}

function getColumns(rows) {
  if (!rows.length) {
    return [];
  }

  const columnSet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columnSet.add(key);
    }
  }

  return Array.from(columnSet);
}

async function safeJson(request) {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object") {
      return { ok: false };
    }

    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function validatePassword(env, password) {
  if (!env.USER_PASSWORD) {
    return Response.json(
      { error: "Worker secret USER_PASSWORD is not configured." },
      { status: 500 },
    );
  }

  if (password !== env.USER_PASSWORD) {
    return Response.json({ error: "Invalid password." }, { status: 401 });
  }

  return null;
}
