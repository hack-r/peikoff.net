import assert from "node:assert/strict";
import test from "node:test";
import { chatLogRow, logChat } from "../src/chatlog.js";

const msgs = [{ role: "user", content: "Who are you?" }];
const env = { SUPABASE_URL: "https://p.supabase.co/", SUPABASE_SERVICE_KEY: "svc" };

test("the log row: who, which person, the last question, the answer and the cost", () => {
  const r = chatLogRow({ user: { id: "u1", email: "a@b.co" }, personId: 7, personName: "Amy", messages: [...msgs, { role: "assistant", content: "Hi" }, { role: "user", content: "And you?" }], reply: "Me.", model: "m", cost: 1234.4 });
  assert.deepEqual(r, { user_id: "u1", email: "a@b.co", admin: false, person_id: "7", person_name: "Amy", turn: 3, question: "And you?", answer: "Me.", cached: false, refused: false, model: "m", cost_micro: 1234 });
});

test("the admin is logged without a user id; cache hits and refusals are flagged; long text is trimmed", () => {
  assert.equal(chatLogRow({ user: { id: "admin", admin: true }, personId: 1, messages: msgs, reply: "x" }).user_id, null);
  assert.equal(chatLogRow({ user: { id: "u" }, personId: 1, messages: msgs, reply: "x", cached: true }).cached, true);
  const long = chatLogRow({ user: { id: "u" }, personId: 1, messages: [{ role: "user", content: "q".repeat(9000) }], reply: "a".repeat(20000), refused: true });
  assert.equal(long.question.length, 4000); assert.equal(long.answer.length, 8000); assert.equal(long.refused, true);
});

test("logChat posts to chat_log with the service key, in the background", async () => {
  const calls = [], jobs = [];
  logChat(env, { user: { id: "u" }, personId: 1, messages: msgs, reply: "x" }, async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 201 }); }, (p) => jobs.push(p));
  await Promise.all(jobs);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://p.supabase.co/rest/v1/chat_log");
  assert.equal(calls[0].init.headers.authorization, "Bearer svc"); assert.equal(JSON.parse(calls[0].init.body)[0].question, "Who are you?");
});

test("logging never breaks a chat: no key means no request, a failing request is swallowed", async () => {
  let n = 0; logChat({}, { user: null, personId: 1, messages: msgs, reply: "x" }, async () => { n++; return new Response(); }, (p) => p);
  assert.equal(n, 0);
  const jobs = []; logChat(env, { user: null, personId: 1, messages: msgs, reply: "x" }, async () => { throw new Error("down"); }, (p) => jobs.push(p));
  await assert.doesNotReject(Promise.all(jobs));
});
