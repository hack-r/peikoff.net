import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const PASSWORD = "open-sesame";

test("forwards requests to the static asset binding", async () => {
  const request = new Request("https://peikoff.net/");
  const response = new Response("website");
  let forwardedRequest;

  const result = await worker.fetch(request, {
    ASSETS: {
      fetch(assetRequest) {
        forwardedRequest = assetRequest;
        return response;
      },
    },
  });

  assert.equal(forwardedRequest, request);
  assert.equal(result, response);
});

test("returns D1 table names from the whoneedsit binding", async () => {
  const request = new Request("https://peikoff.net/api/tables");
  const result = await worker.fetch(request, {
    whoneedsit: {
      prepare(query) {
        assert.match(query, /sqlite_master/);
        return {
          all() {
            return {
              results: [{ name: "posts" }, { name: "users" }],
            };
          },
        };
      },
    },
    ASSETS: {
      fetch() {
        throw new Error("ASSETS.fetch should not be called for /api/tables");
      },
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    tables: [{ name: "posts" }, { name: "users" }],
  });
});

test("auth endpoint accepts correct password", async () => {
  const request = new Request("https://peikoff.net/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });

  const result = await worker.fetch(request, {
    USER_PASSWORD: PASSWORD,
    ASSETS: {
      fetch() {
        throw new Error("ASSETS.fetch should not be called for /api/auth");
      },
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true });
});

test("query endpoint rejects non-SELECT statements", async () => {
  const request = new Request("https://peikoff.net/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD, sql: "DELETE FROM users" }),
  });

  const result = await worker.fetch(request, {
    USER_PASSWORD: PASSWORD,
    whoneedsit: {
      prepare() {
        throw new Error("prepare should not run for non-SELECT SQL");
      },
    },
    ASSETS: {
      fetch() {
        throw new Error("ASSETS.fetch should not be called for /api/query");
      },
    },
  });

  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), {
    error: "Only SELECT statements are allowed.",
  });
});

test("query endpoint rejects multi-statement SQL", async () => {
  const request = new Request("https://peikoff.net/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      password: PASSWORD,
      sql: "SELECT * FROM users; DROP TABLE users",
    }),
  });

  const result = await worker.fetch(request, {
    USER_PASSWORD: PASSWORD,
    whoneedsit: {
      prepare() {
        throw new Error("prepare should not run for multi-statement SQL");
      },
    },
    ASSETS: {
      fetch() {
        throw new Error("ASSETS.fetch should not be called for /api/query");
      },
    },
  });

  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), {
    error: "Only SELECT statements are allowed.",
  });
});

test("query endpoint runs SELECT and returns columns and rows", async () => {
  const request = new Request("https://peikoff.net/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD, sql: "SELECT id, name FROM users" }),
  });

  const result = await worker.fetch(request, {
    USER_PASSWORD: PASSWORD,
    whoneedsit: {
      prepare(query) {
        assert.match(query, /^SELECT\s+id,\s*name\s+FROM\s+users$/i);
        return {
          all() {
            return {
              results: [
                { id: 1, name: "Ari" },
                { id: 2, name: "Lin" },
              ],
            };
          },
        };
      },
    },
    ASSETS: {
      fetch() {
        throw new Error("ASSETS.fetch should not be called for /api/query");
      },
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    columns: ["id", "name"],
    rows: [
      { id: 1, name: "Ari" },
      { id: 2, name: "Lin" },
    ],
    rowCount: 2,
  });
});

test("query endpoint rejects invalid password", async () => {
  const request = new Request("https://peikoff.net/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "wrong", sql: "SELECT 1" }),
  });

  const result = await worker.fetch(request, {
    USER_PASSWORD: PASSWORD,
    whoneedsit: {
      prepare() {
        throw new Error("prepare should not run with invalid password");
      },
    },
    ASSETS: {
      fetch() {
        throw new Error("ASSETS.fetch should not be called for /api/query");
      },
    },
  });

  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), {
    error: "Invalid password.",
  });
});

test("query endpoint returns 500 if USER_PASSWORD secret is missing", async () => {
  const request = new Request("https://peikoff.net/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD, sql: "SELECT 1" }),
  });

  const result = await worker.fetch(request, {
    whoneedsit: {
      prepare() {
        throw new Error("prepare should not run when secret is missing");
      },
    },
    ASSETS: {
      fetch() {
        throw new Error("ASSETS.fetch should not be called for /api/query");
      },
    },
  });

  assert.equal(result.status, 500);
  assert.deepEqual(await result.json(), {
    error: "Worker secret USER_PASSWORD is not configured.",
  });
});

test("returns 500 when whoneedsit binding is missing", async () => {
  const request = new Request("https://peikoff.net/api/tables");
  const result = await worker.fetch(request, {
    ASSETS: {
      fetch() {
        throw new Error("ASSETS.fetch should not be called for /api/tables");
      },
    },
  });

  assert.equal(result.status, 500);
  assert.deepEqual(await result.json(), {
    error: "D1 binding 'whoneedsit' is not configured.",
  });
});
