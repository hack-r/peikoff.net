import assert from "node:assert/strict";
import test from "node:test";
import worker, { firebaseProxy } from "../src/index.js";
import { handleChatApi } from "../src/chat.js";
import { signInWithIdToken, firebaseConfig, _forget } from "../src/accounts.js";

const env = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon", FIREBASE_API_KEY: "AIzaSyTest-0123456789abcdefghijklmnopq", FIREBASE_PROJECT_ID: "atlas-demo-1" };
const req = (path, init = {}) => new Request(`https://peikoff.net${path}`, init);
const post = (path, body) => req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function supabase({ ok = true, seen = [] } = {}) {
  return async (url, init = {}) => {
    const u = String(url); seen.push({ url: u, init });
    if (u.includes("/auth/v1/token?grant_type=id_token")) return ok ? Response.json({ access_token: "AT", refresh_token: "RT", user: { id: "u1" } }) : Response.json({ msg: "Unacceptable audience in id_token" }, { status: 400 });
    if (u.includes("/auth/v1/user")) return Response.json({ id: "u1", email: "amy@x.co", user_metadata: { full_name: "Amy Q" } });
    if (u.includes("/rest/v1/profiles")) return Response.json([]);
    return new Response("{}", { status: 200 });
  };
}

test("Firebase settings are public values, with this host as the auth domain; nothing when not set up", () => {
  assert.deepEqual(firebaseConfig(env, "peikoff.net"), { apiKey: "AIzaSyTest-0123456789abcdefghijklmnopq", projectId: "atlas-demo-1", authDomain: "peikoff.net" });
  assert.equal(firebaseConfig({ ...env, FIREBASE_API_KEY: "" }, "peikoff.net"), null);
  assert.equal(firebaseConfig({ ...env, FIREBASE_API_KEY: "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0000" }, "peikoff.net"), null);   // an OAuth client secret must never reach the page
  assert.equal(firebaseConfig({ ...env, FIREBASE_PROJECT_ID: "255209920161" }, "peikoff.net"), null);                              // a project number is not the project ID
});

test("/api/me tells the page about Firebase on whichever host it is on", async () => {
  const me = async (host) => (await handleChatApi(new Request(`https://${host}/api/me`), env, new URL(`https://${host}/api/me`), { fetch: supabase() })).json();
  assert.equal((await me("peikoff.net")).firebase.authDomain, "peikoff.net");
  assert.equal((await me("atlas.peikoff.net")).firebase.authDomain, "atlas.peikoff.net");
  const none = await (await handleChatApi(req("/api/me"), { ...env, FIREBASE_API_KEY: undefined }, new URL("https://peikoff.net/api/me"), { fetch: supabase() })).json();
  assert.equal(none.firebase, null);
});

test("a Google ID token from Firebase becomes a Supabase session in HttpOnly cookies", async () => {
  _forget(); const seen = [];
  const res = await handleChatApi(post("/api/auth/firebase", { id_token: "g.id.token" }), env, new URL("https://peikoff.net/api/auth/firebase"), { fetch: supabase({ seen }) });
  assert.equal(res.status, 200);
  const body = await res.json(); assert.equal(body.user.email, "amy@x.co");
  const cookies = res.headers.getSetCookie().join("\n"); assert.match(cookies, /atlas_at=AT/); assert.match(cookies, /atlas_rt=RT/); assert.match(cookies, /HttpOnly/);
  const exch = seen.find((c) => c.url.includes("grant_type=id_token")); assert.deepEqual(JSON.parse(exch.init.body), { provider: "google", id_token: "g.id.token" });
});

test("a rejected token, a missing token and junk are refused with a reason", async () => {
  _forget();
  const bad = await handleChatApi(post("/api/auth/firebase", { id_token: "x.y.z" }), env, new URL("https://peikoff.net/api/auth/firebase"), { fetch: supabase({ ok: false }) });
  assert.equal(bad.status, 401); assert.match((await bad.json()).error, /Unacceptable audience/);
  for (const b of [{}, { id_token: "a b" }, { id_token: "x".repeat(7000) }]) assert.equal((await handleChatApi(post("/api/auth/firebase", b), env, new URL("https://peikoff.net/api/auth/firebase"), { fetch: supabase() })).status, 400);
  assert.deepEqual(await signInWithIdToken(env, "google", "t", async () => Response.json({}, { status: 500 })).then((r) => ({ ok: r.ok, status: r.status })), { ok: false, status: 500 });
});

test("/__/auth/ is proxied to the Firebase project only, never anything else", async () => {
  const seen = [];
  const f = async (url, init) => { seen.push({ url: String(url), method: init.method }); return new Response("<html>handler</html>", { status: 200, headers: { "content-type": "text/html", "set-cookie": "x=1" } }); };
  const res = await firebaseProxy(req("/__/auth/handler?apiKey=k&mode=signIn"), env, new URL("https://peikoff.net/__/auth/handler?apiKey=k&mode=signIn"), f);
  assert.equal(res.status, 200); assert.equal(await res.text(), "<html>handler</html>"); assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(seen[0].url, "https://atlas-demo-1.firebaseapp.com/__/auth/handler?apiKey=k&mode=signIn");
  assert.equal((await firebaseProxy(req("/__/auth/handler"), { ...env, FIREBASE_PROJECT_ID: "" }, new URL("https://peikoff.net/__/auth/handler"), f)).status, 404);
  assert.equal((await firebaseProxy(req("/__/auth/x", { method: "DELETE" }), env, new URL("https://peikoff.net/__/auth/x"), f)).status, 404);
  assert.equal((await firebaseProxy(req("/x"), { ...env, FIREBASE_PROJECT_ID: "../evil" }, new URL("https://peikoff.net/__/auth/x"), f)).status, 404);
});

test("the Worker serves the proxy on the main host and on atlas.<domain>", async () => {
  const realFetch = globalThis.fetch, seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response("ok"); };
  try { for (const host of ["peikoff.net", "atlas.peikoff.net"]) await worker.fetch(new Request(`https://${host}/__/firebase/init.json`), env, {}); } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(seen, ["https://atlas-demo-1.firebaseapp.com/__/firebase/init.json", "https://atlas-demo-1.firebaseapp.com/__/firebase/init.json"]);
});
