import assert from "node:assert/strict";
import test from "node:test";
import { captureContact, contactProperties, _forget } from "../src/hubspot.js";

const env = { HUBSPOT_TOKEN: "pat-1" };
const run = async (fn) => { const jobs = []; fn((p) => jobs.push(p)); await Promise.all(jobs); };

test("contact properties: lowercased email, first and last name, lifecycle stage", () => {
  assert.deepEqual(contactProperties({ email: " Amy@X.CO ", name: "Amy Lynn Peikoff" }), { email: "amy@x.co", firstname: "Amy", lastname: "Lynn Peikoff", lifecyclestage: "subscriber" });
  assert.deepEqual(contactProperties({ email: "a@b.co" }, "customer"), { email: "a@b.co", lifecyclestage: "customer" });
});

test("a signup is upserted into HubSpot by email with the private app token", async () => {
  _forget(); const calls = [];
  await run((w) => captureContact(env, { email: "amy@x.co", name: "Amy P" }, "subscriber", async (url, init) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); }, w));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert");
  assert.equal(calls[0].init.headers.authorization, "Bearer pat-1");
  assert.deepEqual(JSON.parse(calls[0].init.body).inputs[0], { idProperty: "email", id: "amy@x.co", properties: { email: "amy@x.co", firstname: "Amy", lastname: "P", lifecyclestage: "subscriber" } });
});

test("no token, no valid email or the admin: nothing is sent; repeats are sent once", async () => {
  _forget(); let n = 0; const f = async () => { n++; return new Response("{}"); };
  await run((w) => { captureContact({}, { email: "a@b.co" }, "subscriber", f, w); captureContact(env, { email: "nope" }, "subscriber", f, w); captureContact(env, { email: "a@b.co", admin: true }, "subscriber", f, w); });
  assert.equal(n, 0);
  await run((w) => { captureContact(env, { email: "a@b.co" }, "subscriber", f, w); captureContact(env, { email: "A@b.co" }, "subscriber", f, w); captureContact(env, { email: "a@b.co" }, "customer", f, w); });
  assert.equal(n, 2, "one upsert per email and stage");
});

test("HubSpot failing never breaks anything and is retried on the next sign-in", async () => {
  _forget(); let n = 0;
  await run((w) => captureContact(env, { email: "r@b.co" }, "subscriber", async () => { n++; throw new Error("down"); }, w));
  await run((w) => captureContact(env, { email: "r@b.co" }, "subscriber", async () => { n++; return new Response("no", { status: 500 }); }, w));
  await run((w) => captureContact(env, { email: "r@b.co" }, "subscriber", async () => { n++; return new Response("{}", { status: 200 }); }, w));
  await run((w) => captureContact(env, { email: "r@b.co" }, "subscriber", async () => { n++; return new Response("{}", { status: 200 }); }, w));
  assert.equal(n, 3);
});
