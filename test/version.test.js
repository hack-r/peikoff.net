import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../src/index.js";
import { makeToken, COOKIE } from "../src/chat.js";
import { versionInfo, shortSha, verdictFromCompare, latestCommits, describeSync, syncStatus, _resetSyncCache, SYNC_TTL_MS } from "../src/version.js";
import { versionModel, versionLines, syncModel, loadSync } from "../public/atlas/version.js";

const A = "a".repeat(40), B = "b".repeat(40);
const BUILD = { commit: A, date: "2026-10-17T14:09:55-04:00", message: "Fix the thing\nlong body", version: "1.2.3", builtAt: "2026-10-17T18:30:00.000Z", dirty: false };
const ASSETS = { fetch() { throw new Error("no assets"); } };
const commit = (sha, message = "m") => ({ sha, html_url: `https://github.com/hack-r/peikoff.net/commit/${sha}`, commit: { message, committer: { date: "2026-10-17T12:00:00Z" } } });
const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

// a stubbed GitHub: head of main plus a compare result (or an error for either)
function github({ head = commit(B, "main tip"), cmp, headRes, cmpRes } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers || {} });
    if (String(url).endsWith("/commits/main")) return headRes ? headRes() : reply(head);
    return cmpRes ? cmpRes() : reply(cmp);
  };
  fn.calls = calls;
  return fn;
}
const cmpOf = (status, ahead_by, behind_by, commits = []) => ({ status, ahead_by, behind_by, commits });

test("short ids are 7 characters, and anything that is not a sha is dev", () => {
  assert.equal(shortSha(A), "aaaaaaa");
  assert.equal(shortSha("dev"), "dev");
  assert.equal(shortSha(undefined), "dev");
  assert.equal(shortSha("not a sha"), "dev");
});

test("versionInfo: build info wins, with link, date, message, version and build time", () => {
  const v = versionInfo({ GIT_COMMIT: B }, BUILD);
  assert.equal(v.commit, A);
  assert.equal(v.short, "aaaaaaa");
  assert.equal(v.url, `https://github.com/hack-r/peikoff.net/commit/${A}`);
  assert.equal(v.message, "Fix the thing");
  assert.equal(v.version, "1.2.3");
  assert.equal(v.builtAt, BUILD.builtAt);
  assert.equal(v.source, "build");
});

test("versionInfo: falls back to the environment, then to dev", () => {
  const blank = { commit: "", date: "", message: "", version: "", builtAt: "", dirty: false };
  assert.equal(versionInfo({ WORKERS_CI_COMMIT_SHA: B }, blank).commit, B);
  assert.equal(versionInfo({ CF_PAGES_COMMIT_SHA: "1234567890abcdef" }, blank).source, "env");
  const none = versionInfo({}, blank);
  assert.equal(none.commit, "dev");
  assert.equal(none.url, "");
  assert.equal(none.source, "none");
  assert.equal(versionInfo({ GIT_COMMIT: "<script>" }, blank).commit, "dev");
});

test("/version.json is served on both hosts (GET), never cached", async () => {
  for (const host of ["peikoff.net", "atlas.peikoff.net"]) {
    const res = await worker.fetch(new Request(`https://${host}/version.json`), { ASSETS, GIT_COMMIT: B });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body.commit.length === 40 || body.commit === "dev", true);
    assert.ok("short" in body && "builtAt" in body && "version" in body);
  }
  const post = await worker.fetch(new Request("https://atlas.peikoff.net/version.json", { method: "POST" }), { ASSETS });
  assert.equal(post.status, 404);
});

test("compare verdicts: identical, behind, ahead, diverged, unknown", () => {
  assert.deepEqual(verdictFromCompare(cmpOf("identical", 0, 0)), { state: "in-sync", behindBy: 0, aheadBy: 0 });
  assert.deepEqual(verdictFromCompare(cmpOf("ahead", 3, 0)), { state: "behind", behindBy: 3, aheadBy: 0 });
  assert.deepEqual(verdictFromCompare(cmpOf("behind", 0, 2)), { state: "ahead", behindBy: 0, aheadBy: 2 });
  assert.deepEqual(verdictFromCompare(cmpOf("diverged", 4, 1)), { state: "diverged", behindBy: 4, aheadBy: 1 });
  assert.equal(verdictFromCompare({}).state, "unreachable");
  assert.match(describeSync({ state: "behind", behindBy: 1 }), /1 commit ahead/);
  assert.match(describeSync({ state: "behind", behindBy: 2 }), /2 commits ahead/);
});

test("latestCommits lists the newest few, newest first", () => {
  const commits = Array.from({ length: 8 }, (_, n) => commit(String(n).repeat(40), `c${n}`));
  const out = latestCommits({ commits });
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((c) => c.message), ["c7", "c6", "c5", "c4", "c3"]);
  assert.equal(out[0].short, "7777777");
});

test("sync: in sync when the deployed commit is the head of main (one call, no compare)", async () => {
  _resetSyncCache();
  const f = github({ head: commit(A, "tip") });
  const r = await syncStatus({}, { fetch: f, build: BUILD });
  assert.equal(r.state, "in-sync");
  assert.equal(r.head.short, "aaaaaaa");
  assert.equal(f.calls.length, 1);
});

test("sync: behind by N, with the newest commit messages", async () => {
  _resetSyncCache();
  const commits = ["one", "two", "three"].map((m, n) => commit(String(n + 1).repeat(40), m));
  const r = await syncStatus({}, { fetch: github({ cmp: cmpOf("ahead", 3, 0, commits) }), build: BUILD });
  assert.equal(r.state, "behind");
  assert.equal(r.behindBy, 3);
  assert.deepEqual(r.commits.map((c) => c.message), ["three", "two", "one"]);
  assert.match(r.summary, /3 commits ahead.*deploy is missing/);
  assert.equal(r.deployed.short, "aaaaaaa");
  assert.equal(r.head.short, "bbbbbbb");
});

test("sync: ahead (the deploy came from a branch) and diverged", async () => {
  _resetSyncCache();
  const ahead = await syncStatus({}, { fetch: github({ cmp: cmpOf("behind", 0, 2) }), build: BUILD });
  assert.equal(ahead.state, "ahead");
  assert.equal(ahead.aheadBy, 2);
  _resetSyncCache();
  const div = await syncStatus({}, { fetch: github({ cmp: cmpOf("diverged", 4, 1) }), build: BUILD });
  assert.equal(div.state, "diverged");
  assert.equal(div.behindBy, 4);
  assert.equal(div.aheadBy, 1);
});

test("sync: a commit GitHub does not know is reported, not an error", async () => {
  _resetSyncCache();
  const r = await syncStatus({}, { fetch: github({ cmpRes: () => reply({ message: "Not Found" }, 404) }), build: BUILD });
  assert.equal(r.state, "not-on-github");
});

test("sync: rate limited, with when to retry", async () => {
  _resetSyncCache();
  const limited = () => reply({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1792260000" });
  const r = await syncStatus({}, { fetch: github({ headRes: limited }), build: BUILD });
  assert.equal(r.state, "rate-limited");
  assert.match(r.resetsAt, /^2026-/);
});

test("sync: GitHub down or a network failure is unreachable, and failures are not cached", async () => {
  _resetSyncCache();
  const down = await syncStatus({}, { fetch: github({ headRes: () => reply({}, 503) }), build: BUILD });
  assert.equal(down.state, "unreachable");
  const boom = await syncStatus({}, { fetch: async () => { throw new Error("socket closed"); }, build: BUILD });
  assert.equal(boom.state, "unreachable");
  const ok = await syncStatus({}, { fetch: github({ head: commit(A) }), build: BUILD });
  assert.equal(ok.state, "in-sync");
});

test("sync: a deploy that does not know its commit cannot be compared (no GitHub call)", async () => {
  _resetSyncCache();
  const f = github();
  const r = await syncStatus({}, { fetch: f, build: { commit: "" } });
  assert.equal(r.state, "unknown-deploy");
  assert.equal(f.calls.length, 0);
});

test("sync: cached for 45 seconds, then asked again", async () => {
  _resetSyncCache();
  const f = github({ head: commit(A) });
  await syncStatus({}, { fetch: f, build: BUILD, now: () => 1000 });
  await syncStatus({}, { fetch: f, build: BUILD, now: () => 1000 + SYNC_TTL_MS - 1 });
  assert.equal(f.calls.length, 1);
  await syncStatus({}, { fetch: f, build: BUILD, now: () => 1000 + SYNC_TTL_MS + 1 });
  assert.equal(f.calls.length, 2);
});

test("sync: sends a User-Agent, and the token only when one is set; the token never appears in the report", async () => {
  _resetSyncCache();
  const f = github({ cmp: cmpOf("ahead", 1, 0, [commit(B)]) });
  const r = await syncStatus({ GITHUB_TOKEN: "ghp_SECRETSECRET" }, { fetch: f, build: BUILD });
  assert.ok(f.calls.every((c) => c.headers["user-agent"]));
  assert.ok(f.calls.every((c) => c.headers.authorization === "Bearer ghp_SECRETSECRET"));
  assert.ok(!JSON.stringify(r).includes("SECRETSECRET"));
  _resetSyncCache();
  const g = github({ head: commit(A) });
  await syncStatus({}, { fetch: g, build: BUILD });
  assert.equal(g.calls[0].headers.authorization, undefined);
});

// the admin gate on the API
const syncReq = (cookie) => new Request("https://atlas.peikoff.net/api/sync", { headers: cookie ? { cookie } : {} });

test("/api/sync: a visitor is refused (401) and GitHub is never called", async () => {
  _resetSyncCache();
  const realFetch = globalThis.fetch, f = github({ head: commit(A) });
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(syncReq(), { ASSETS, ADMIN_PASSWORD: "pw", GIT_COMMIT: A }, { waitUntil() {} });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /admin/);
    assert.equal(body.deployed, undefined);
    assert.equal(f.calls.length, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("/api/sync: a bad or forged session is refused", async () => {
  const res = await worker.fetch(syncReq(`${COOKIE}=admin.9999999999999.deadbeef`), { ASSETS, ADMIN_PASSWORD: "pw" }, {});
  assert.equal(res.status, 401);
});

test("/api/sync: the admin session gets the report", async () => {
  _resetSyncCache();
  const env = { ASSETS, ADMIN_PASSWORD: "pw" };
  const token = await makeToken(env);
  const realFetch = globalThis.fetch, f = github({ head: commit(A) });
  globalThis.fetch = f;
  try {
    const res = await worker.fetch(syncReq(`${COOKIE}=${token}`), { ...env, GIT_COMMIT: A }, {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body.state, "in-sync");
    assert.equal(body.repo, "hack-r/peikoff.net");
    assert.equal(f.calls.length, 1);
  } finally { globalThis.fetch = realFetch; }
});

// the browser side
test("/version card rows: link, message, dates, version", () => {
  const m = versionModel(versionInfo({}, BUILD));
  const row = (l) => m.rows.find((r) => r.label === l);
  assert.equal(row("Commit").text, "aaaaaaa");
  assert.equal(row("Commit").href, `https://github.com/hack-r/peikoff.net/commit/${A}`);
  assert.equal(row("Message").text, "Fix the thing");
  assert.match(row("Committed").text, /2026-10-17 18:09 UTC/);
  assert.match(row("Built").text, /2026-10-17 18:30 UTC/);
  assert.equal(row("Version").text, "1.2.3");
  assert.deepEqual(versionLines(versionInfo({}, BUILD))[0], { text: "commit: aaaaaaa", href: `https://github.com/hack-r/peikoff.net/commit/${A}` });
});

test("/version when the commit is unknown says so, and omits the rest", () => {
  const m = versionModel(versionInfo({}, { commit: "" }));
  assert.match(m.rows[0].text, /^dev/);
  assert.equal(m.rows.length, 1);
  assert.match(versionModel(null).rows[0].text, /unavailable/);
});

test("/sync card: green when in sync, amber when behind, red when GitHub is down", async () => {
  _resetSyncCache();
  const green = syncModel(await syncStatus({}, { fetch: github({ head: commit(A) }), build: BUILD }));
  assert.equal(green.tone, "green");
  _resetSyncCache();
  const amber = syncModel(await syncStatus({}, { fetch: github({ cmp: cmpOf("ahead", 7, 0, [1, 2, 3, 4, 5, 6, 7].map((n) => commit(String(n).repeat(40), `m${n}`))) }), build: BUILD }));
  assert.equal(amber.tone, "amber");
  assert.equal(amber.commits.length, 5);
  assert.equal(amber.more, 2);
  _resetSyncCache();
  const red = syncModel(await syncStatus({}, { fetch: github({ headRes: () => reply({}, 500) }), build: BUILD }));
  assert.equal(red.tone, "red");
});

test("loadSync gives a polite message for a refusal and for a network failure", async () => {
  const refused = await loadSync(async () => new Response(JSON.stringify({ error: "/sync is for the admin only." }), { status: 403 }));
  assert.deepEqual(refused, { ok: false, message: "/sync is for the admin only." });
  assert.equal((await loadSync(async () => { throw new Error("offline"); })).ok, false);
  const ok = await loadSync(async () => new Response(JSON.stringify({ state: "in-sync" })));
  assert.equal(ok.ok, true);
});

// the build step
test("tools/build-info.mjs writes the commit it is given", () => {
  const out = join(mkdtempSync(join(tmpdir(), "bi-")), "build-info.js");
  execFileSync("node", ["tools/build-info.mjs", "--out", out], { env: { ...process.env, WORKERS_CI_COMMIT_SHA: A }, stdio: "pipe" });
  const text = readFileSync(out, "utf8");
  assert.match(text, new RegExp(`"commit": "${A}"`));
  assert.match(text, /"builtAt": "20\d\d-/);
  assert.match(text, /"dirty": false/);
});

test("tools/build-info.mjs falls back to git, and ignores a malformed CI value", () => {
  const out = join(mkdtempSync(join(tmpdir(), "bi-")), "build-info.js");
  execFileSync("node", ["tools/build-info.mjs", "--out", out], { env: { ...process.env, WORKERS_CI_COMMIT_SHA: "nonsense" }, stdio: "pipe" });
  assert.match(readFileSync(out, "utf8"), /"commit": "[0-9a-f]{40}"/);
});

test("sync: a private repo without a token says the secret is missing; a rejected token says so", async () => {
  _resetSyncCache();
  const priv = () => reply({ message: "Not Found" }, 404);
  const none = await syncStatus({}, { fetch: github({ headRes: priv }), build: BUILD });
  assert.equal(none.state, "needs-token");
  assert.match(none.summary, /GITHUB_TOKEN is not set/);
  assert.match(none.summary, /wrangler secret put GITHUB_TOKEN/);
  const bad = await syncStatus({ GITHUB_TOKEN: "ghp_SECRETSECRET" }, { fetch: github({ headRes: () => reply({ message: "Bad credentials" }, 401) }), build: BUILD });
  assert.equal(bad.state, "token-rejected");
  assert.ok(!JSON.stringify(bad).includes("SECRETSECRET"));
  assert.equal(syncModel(none).tone, "red");
});
