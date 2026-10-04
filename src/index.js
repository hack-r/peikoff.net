export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(new URL("/data", url), 302);
    }

    if (url.pathname === "/data" || url.pathname === "/data/") {
      return env.ASSETS.fetch(request);
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

    if (url.pathname === "/api/meta") {
      return Response.json({
        commit:
          env.GIT_COMMIT ||
          env.COMMIT_SHA ||
          env.CF_PAGES_COMMIT_SHA ||
          env.CF_COMMIT_SHA ||
          "unknown",
        timestamp: new Date().toISOString(),
      });
    }

    return env.ASSETS.fetch(request);
  },
};

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
