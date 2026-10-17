import { test } from "node:test";
import assert from "node:assert/strict";
import { captureContact, maskEmail, _forget, DAILY_CAP } from "../src/hubspot.js";

const env = { HUBSPOT_TOKEN: "t" };
const run = (email, fetch, stage = "subscriber") => { const jobs = []; captureContact(env, { email }, stage, fetch, (p) => jobs.push(p)); return Promise.all(jobs); };
const quiet = (fn) => async () => { const w = console.warn; const lines = []; console.warn = (m) => lines.push(m); try { await fn(lines); } finally { console.warn = w; _forget(); } };

test("maskEmail hides the local part", () => assert.equal(maskEmail("jane@example.com"), "j***@example.com"));

test("a failure is logged with status, category and a masked email, never the token", quiet(async (lines) => {
  await run("jane@example.com", async () => new Response(JSON.stringify({ category: "RATE_LIMITS" }), { status: 429 }));
  assert.match(lines[0], /status=429 category=RATE_LIMITS/); assert.match(lines[0], /j\*\*\*@example\.com/);
  assert.ok(!lines[0].includes("jane@") && !lines[0].includes("Bearer"));
}));

test("after a limit error HubSpot is left alone", quiet(async () => {
  let calls = 0; const f = async () => { calls++; return new Response("{}", { status: 429 }); };
  await run("a@example.com", f); await run("b@example.com", f);
  assert.equal(calls, 1);
}));

test("the daily cap stops upserts", quiet(async () => {
  let calls = 0; const f = async () => { calls++; return new Response("{}", { status: 200 }); };
  for (let i = 0; i < DAILY_CAP + 5; i++) await run(`u${i}@example.com`, f);
  assert.equal(calls, DAILY_CAP);
}));
