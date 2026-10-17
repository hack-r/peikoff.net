// Which commit is live (/version.json, shown by /version) and whether it is the head of main (GET /api/sync, admin only, shown by /sync).
//
// The commit comes from src/build-info.js, written by tools/build-info.mjs at build time and bundled into the Worker; the old
// environment variables remain as fallbacks. The comparison calls the GitHub API (the repo is private, so the Worker secret GITHUB_TOKEN is
// needed: a fine-grained read-only token, Contents and Metadata read, on this repository only).

import BUILD from "./build-info.js";

export const REPO = "hack-r/peikoff.net";
export const BRANCH = "main";
const API = "https://api.github.com";
export const SYNC_TTL_MS = 45000;
export const MAX_LISTED = 5;

const HEX = /^[0-9a-f]{7,40}$/i;
export const isSha = (s) => typeof s === "string" && HEX.test(s);
export const shortSha = (s) => (isSha(s) ? s.slice(0, 7).toLowerCase() : "dev");
export const commitUrl = (s) => (isSha(s) && s.length === 40 ? `https://github.com/${REPO}/commit/${s.toLowerCase()}` : "");
const firstLine = (s) => String(s || "").split("\n")[0].slice(0, 200);

/** What /version.json returns: the deployed commit and where it came from. `commit` is the full SHA, or "dev" when unknown. */
export function versionInfo(env = {}, build = BUILD) {
  const fallback = env.WORKERS_CI_COMMIT_SHA || env.CF_PAGES_COMMIT_SHA || env.GIT_COMMIT || env.COMMIT_SHA || "";
  const fromBuild = isSha(build?.commit), commit = fromBuild ? build.commit : isSha(fallback) ? fallback : "dev";
  return {
    commit: commit === "dev" ? "dev" : commit.toLowerCase(),
    short: shortSha(commit),
    url: commitUrl(commit),
    date: fromBuild ? build.date || "" : "",
    message: fromBuild ? firstLine(build.message) : "",
    version: String(build?.version || ""),
    builtAt: build?.builtAt || "",
    dirty: fromBuild && !!build.dirty,
    source: fromBuild ? "build" : commit === "dev" ? "none" : "env",
  };
}

const sameCommit = (a, b) => !!a && !!b && (a.length >= b.length ? a.startsWith(b) : b.startsWith(a));

/** A commit as the sync report shows it. */
function commitCard(c) {
  const sha = String(c?.sha || "");
  return { sha, short: shortSha(sha), url: commitUrl(sha) || String(c?.html_url || ""), message: firstLine(c?.commit?.message), date: c?.commit?.committer?.date || c?.commit?.author?.date || "" };
}

/** Turns GitHub's compare result (base = deployed, head = main) into a verdict. Pure. */
export function verdictFromCompare(cmp) {
  const status = cmp?.status, ahead = +cmp?.ahead_by || 0, behind = +cmp?.behind_by || 0;
  if (status === "identical") return { state: "in-sync", behindBy: 0, aheadBy: 0 };
  if (status === "ahead") return { state: "behind", behindBy: ahead, aheadBy: 0 };           // main has commits the deploy lacks
  if (status === "behind") return { state: "ahead", behindBy: 0, aheadBy: behind };           // the deploy has commits main lacks (a branch or preview)
  if (status === "diverged") return { state: "diverged", behindBy: ahead, aheadBy: behind };
  return { state: "unreachable", behindBy: 0, aheadBy: 0 };
}

/** Newest first, at most MAX_LISTED. GitHub lists a comparison oldest first. */
export const latestCommits = (cmp) => (Array.isArray(cmp?.commits) ? cmp.commits.slice(-MAX_LISTED).reverse().map(commitCard) : []);

/** One plain-English line for the state. */
export function describeSync(s) {
  switch (s.state) {
    case "in-sync": return "In sync: the live site is running the head of main.";
    case "behind": return `Behind: main is ${s.behindBy} commit${s.behindBy === 1 ? "" : "s"} ahead of the live site. A deploy is missing.`;
    case "ahead": return `Ahead: the live site has ${s.aheadBy} commit${s.aheadBy === 1 ? "" : "s"} that main does not (a branch or preview was deployed).`;
    case "diverged": return `Diverged: the live site is ${s.aheadBy} commit${s.aheadBy === 1 ? "" : "s"} off main and main has ${s.behindBy} it lacks.`;
    case "unknown-deploy": return "The live site does not know its own commit (no build step ran), so it cannot be compared.";
    case "not-on-github": return "The live commit is not on GitHub (a local or unpushed build).";
    case "needs-token": return "GitHub refused the request: the repository is private and the Worker secret GITHUB_TOKEN is not set. Create a fine-grained read-only token (this repository only; Contents and Metadata: read) at github.com/settings/personal-access-tokens/new, then run: npx wrangler secret put GITHUB_TOKEN (or Cloudflare dashboard > peikoff-net > Settings > Variables and Secrets > add a Secret named GITHUB_TOKEN).";
    case "token-rejected": return "GitHub rejected the Worker secret GITHUB_TOKEN (expired, revoked, or not granted this repository with Contents and Metadata read). Create a new fine-grained read-only token and run: npx wrangler secret put GITHUB_TOKEN.";
    case "rate-limited": return "GitHub's rate limit was reached; try again later.";
    default: return "GitHub could not be reached.";
  }
}

async function gh(path, env, doFetch) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "peikoff-net-sync", "x-github-api-version": "2022-11-28" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await doFetch(`${API}${path}`, { headers, signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(8000) : undefined });
  if (res.ok) return { ok: true, json: await res.json() };
  const remaining = res.headers?.get?.("x-ratelimit-remaining"), reset = +res.headers?.get?.("x-ratelimit-reset") || 0;
  const limited = res.status === 429 || (res.status === 403 && (remaining === "0" || /rate limit/i.test(await res.text().catch(() => ""))));
  return { ok: false, status: res.status, limited, resetsAt: reset ? new Date(reset * 1000).toISOString() : "" };
}

let memo = { key: "", at: 0, value: null };
export const _resetSyncCache = () => { memo = { key: "", at: 0, value: null }; };

/** Compares the deployed commit with the head of main. Never throws; never includes the token. deps: { fetch, now }. */
export async function syncStatus(env = {}, deps = {}) {
  const doFetch = deps.fetch || fetch, now = deps.now ? deps.now() : Date.now(), deployed = versionInfo(env, deps.build);
  const base = { checkedAt: new Date(now).toISOString(), repo: REPO, branch: BRANCH, deployed: { short: deployed.short, commit: deployed.commit, url: deployed.url, date: deployed.date, message: deployed.message, builtAt: deployed.builtAt, version: deployed.version } };
  if (deployed.commit === "dev") return { ...base, state: "unknown-deploy", summary: describeSync({ state: "unknown-deploy" }) };

  const key = `${deployed.commit}|${env.GITHUB_TOKEN ? "t" : "n"}`;
  if (memo.key === key && now - memo.at < SYNC_TTL_MS && memo.value) return memo.value;

  const finish = (extra, cache = true) => { const value = { ...base, ...extra, summary: describeSync(extra) }; if (cache) memo = { key, at: now, value }; return value; };
  try {
    const head = await gh(`/repos/${REPO}/commits/${BRANCH}`, env, doFetch);
    if (!head.ok && !head.limited && [401, 403, 404].includes(head.status)) return finish({ state: env.GITHUB_TOKEN ? "token-rejected" : "needs-token", httpStatus: head.status }, false);   // a private repo answers 404 without a valid token
    if (!head.ok) return finish({ state: head.limited ? "rate-limited" : "unreachable", resetsAt: head.resetsAt || "", httpStatus: head.status }, !!head.limited);
    const main = commitCard(head.json);
    if (sameCommit(main.sha, deployed.commit)) return finish({ state: "in-sync", behindBy: 0, aheadBy: 0, head: main, commits: [] });
    const cmp = await gh(`/repos/${REPO}/compare/${deployed.commit}...${BRANCH}`, env, doFetch);
    if (!cmp.ok) {
      if (cmp.status === 404 || cmp.status === 422) return finish({ state: "not-on-github", head: main });
      return finish({ state: cmp.limited ? "rate-limited" : "unreachable", resetsAt: cmp.resetsAt || "", httpStatus: cmp.status, head: main }, !!cmp.limited);
    }
    return finish({ ...verdictFromCompare(cmp.json), head: main, commits: latestCommits(cmp.json), compareUrl: `https://github.com/${REPO}/compare/${deployed.commit}...${BRANCH}` });
  } catch {
    return finish({ state: "unreachable" }, false);
  }
}
