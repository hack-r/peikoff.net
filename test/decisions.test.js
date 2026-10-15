import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A weekly data refresh must not undo editorial decisions (exclusions, merges, scrubbed notes, website curation).
// These tests feed atlas/apply_decisions.py a deliberately "dirty" refresh and check every decision still holds.

const raw = JSON.parse(readFileSync(new URL("../atlas/data/whoneedsit_export.json", import.meta.url), "utf8"));
const dir = mkdtempSync(join(tmpdir(), "decisions-"));
const run = (data, env = {}) => {
  const inp = join(dir, "in.json"), out = join(dir, "out.json");
  writeFileSync(inp, JSON.stringify(data));
  const r = spawnSync("python3", ["atlas/apply_decisions.py", inp, out], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, stderr: r.stderr, data: r.status === 0 ? JSON.parse(readFileSync(out, "utf8")) : null };
};
const clone = (x) => JSON.parse(JSON.stringify(x));

test("the committed export passes the decisions cleanly and unchanged (idempotent, no drift)", () => {
  const a = run(raw);
  assert.equal(a.status, 0, a.stderr);
  const b = run(a.data);
  assert.equal(b.status, 0, b.stderr);
  assert.deepEqual(b.data, a.data, "applying the decisions twice changes nothing");
  assert.equal(a.data.websites.length, raw.websites.length, "every curated website survives the website rules");
});

test("a dirty refresh cannot bring back excluded orgs, duplicate people, hedging notes or junk websites", () => {
  const d = clone(raw);
  // excluded orgs come back under NEW ids, and one of those ids was once used by a legitimate org
  d.orgs.push({ id: 9101, name: "Duke University", short: "Duke University", category: "", urls: [] });
  d.orgs.push({ id: 9102, name: "Cato Institute", short: "Cato Institute", category: "", urls: [] });
  d.people.push({ id: 9201, name: "Carl Barney", title: "", born: null, died: null, org: 9101, role: "Donor", confidence: "verified" });   // duplicate of Carl B. Barney
  d.people.push({ id: 9202, name: "Robert Tracinski", title: "", born: null, died: null, org: null, role: "", confidence: "" });          // duplicate of Robert W. Tracinski
  d.relationships.push({ id: 99001, person_id: 9201, related_person_id: null, org_id: 8, related_org_id: null, relationship_type: "Founder", evidence: "User directory sheet: x", confidence: "verified" });
  const bio = d.person_profile.find((p) => p.person_id === 750);
  bio.bio = "Founder of SOLO (Sense of Life Objectivists), per user directory sheet; bio otherwise unverified.";
  d.websites.push({ id: 9301, title: "Some Wikipedia page", url: "https://en.wikipedia.org/wiki/Some_Page", type: "reference", person_id: 4 });
  d.websites.push({ id: 9302, title: "A grantee page", url: "https://prometheusfdn.org/grantees/someone/", type: "other", person_id: 5 });
  d.websites.push({ id: 9303, title: "A dead site", url: "https://dead.example.org/", type: "org", org_id: 1, status: "dns_failed" });
  d.websites.push({ id: 9304, title: "Staff page", url: "https://courses.aynrand.org/people/somebody/", person_id: 6 });
  const r = run(d);
  assert.equal(r.status, 0, r.stderr);
  const names = r.data.orgs.map((o) => o.name);
  assert.ok(!names.includes("Duke University") && !names.includes("Cato Institute"), "excluded orgs stay excluded even under new ids");
  assert.ok(!r.data.people.some((p) => p.id === 9201 || p.id === 9202), "duplicate people are folded into their keepers");
  const carl = r.data.people.find((p) => p.id === 160);
  assert.ok(carl, "the keeper survives");
  assert.ok(r.data.relationships.some((x) => x.id === 99001 && x.person_id === 160), "the duplicate's relationship now points at the keeper");
  assert.equal(r.data.person_profile.find((p) => p.person_id === 750).bio, "Founder of SOLO (Sense of Life Objectivists).", "hedging notes are scrubbed again");
  assert.equal(r.data.relationships.find((x) => x.id === 99001).evidence ?? null, null, "sourcing notes on relationships are scrubbed again");
  for (const id of [9301, 9302, 9303, 9304]) assert.ok(!r.data.websites.some((w) => w.id === id), `junk website ${id} is not a fish`);
  assert.equal(r.data.websites.length, raw.websites.length, "and no curated website was lost");
});

test("legitimate groups inside a university are not excluded by a short-name collision", () => {
  const d = clone(raw);
  d.orgs.push({ id: 9401, name: "Salem Center, University of Texas at Austin", short: "University of Texas at Austin", category: "", urls: [] });
  d.orgs.push({ id: 9402, name: "University of Texas at Austin", short: "University of Texas at Austin", category: "", urls: [] });
  const r = run(d);
  const names = r.data.orgs.map((o) => o.name);
  assert.ok(names.includes("Salem Center, University of Texas at Austin"), "the Salem Center stays");
  assert.ok(!names.includes("University of Texas at Austin"), "the general university goes");
});

test("if an id used by the makers now points at a different record, the run stops instead of mis-placing people", () => {
  const d = clone(raw);
  d.people.find((p) => p.id === 160).name = "Somebody Else";   // e.g. a refresh renumbered the people table
  const r = run(d);
  assert.equal(r.status, 2, "exit code 2");
  assert.match(r.stderr, /DECISION DRIFT/);
  assert.match(r.stderr, /person 160/);
  assert.equal(run(d, { ATLAS_ALLOW_DRIFT: "1" }).status, 0, "ATLAS_ALLOW_DRIFT=1 overrides");
});

test("regenerating the city from the committed export reproduces the committed city exactly", () => {
  const out = join(dir, "city.json");
  execFileSync("python3", ["atlas/make_whoneedsit.py", "atlas/data/whoneedsit_export.json", out], { stdio: "pipe" });
  assert.equal(readFileSync(out, "utf8"), readFileSync(new URL("../public/atlas/data/whoneedsit.json", import.meta.url), "utf8"));
});
