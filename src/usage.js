// Usage caps, so a paid user can never cost more than the plan earns.
//
//   The plan is $5/month. Stripe keeps about 2.9% + $0.30 (about $0.45) and Stripe Billing about 0.7% ($0.035), so about $4.50 arrives. Each paid user may spend at most
//   CHAT_MONTHLY_BUDGET_USD (default $1.50) of model cost per calendar month (UTC) and CHAT_DAILY_BUDGET_USD (default $0.30) per day, so even a user who uses every cent
//   leaves about $3.00 (two thirds of the price) for fixed costs (Supabase, Cloudflare) and profit.
//
//   The budget is in dollars, not messages, so it holds whatever the model: a call's cost is counted from the token usage the provider reports (prompt and completion tokens times
//   the model's price per million tokens), and BEFORE a call the worst case is estimated (the text sent, at 3 characters per token, plus the longest answer allowed) and refused
//   if it would not fit in what is left. Replies served from the shared cache cost nothing and are not counted. The admin is not capped.
//
//   Fail closed: if usage cannot be read or recorded (no SUPABASE_SERVICE_KEY, Supabase down) a capped user is refused rather than served for free.
//
//   Three limits, whichever comes first, each per calendar month (UTC): CHAT_MONTHLY_QUESTIONS (default 50 questions put to the model), CHAT_MONTHLY_TOKENS (default 1,000,000 tokens, prompt plus answer)
//   and the dollar budget above (the safety net that holds whatever the model costs).
//   Variables (all optional): CHAT_MONTHLY_QUESTIONS, CHAT_MONTHLY_TOKENS, CHAT_MONTHLY_BUDGET_USD, CHAT_DAILY_BUDGET_USD, CHAT_MAX_OUTPUT_TOKENS (default 500), LLM_PRICE_IN and LLM_PRICE_OUT (USD per million tokens; they override the table).

export const DEFAULT_MONTHLY_USD = 1.5, DEFAULT_DAILY_USD = 0.3, DEFAULT_MAX_OUTPUT = 500, CHARS_PER_TOKEN = 3, DEFAULT_QUESTIONS = 50, DEFAULT_TOKENS = 1_000_000;

/** USD per million tokens [input, output]. Unknown models are priced high on purpose, so a new model can never run under budget by accident. Check the provider's price list when the model changes. */
export const PRICES = {
  "gpt-4o-mini": [0.15, 0.6], "gpt-4.1-mini": [0.4, 1.6], "gpt-4.1-nano": [0.1, 0.4], "gpt-4o": [2.5, 10], "gpt-4.1": [2, 8],
  "mistral-small-latest": [0.2, 0.6], "mistral-medium-latest": [0.4, 2], "grok-3-mini": [0.3, 0.5],
};
export const UNKNOWN_PRICE = [5, 15];

export const priceFor = (env, model) => {
  const pin = Number(env.LLM_PRICE_IN), pout = Number(env.LLM_PRICE_OUT);
  if (pin > 0 && pout > 0) return [pin, pout];
  const m = String(model || "").toLowerCase(), key = Object.keys(PRICES).filter((k) => m === k || m.startsWith(k + "-")).sort((a, b) => b.length - a.length)[0];   // "gpt-4o-mini-2024-07-18" is gpt-4o-mini
  return key ? PRICES[key] : UNKNOWN_PRICE;
};
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
export const maxOutput = (env) => Math.round(num(env.CHAT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT));
export const budgets = (env) => ({ month: Math.round(num(env.CHAT_MONTHLY_BUDGET_USD, DEFAULT_MONTHLY_USD) * 1e6), day: Math.round(num(env.CHAT_DAILY_BUDGET_USD, DEFAULT_DAILY_USD) * 1e6),   // micro-dollars
  questions: Math.round(num(env.CHAT_MONTHLY_QUESTIONS, DEFAULT_QUESTIONS)), tokens: Math.round(num(env.CHAT_MONTHLY_TOKENS, DEFAULT_TOKENS)) });

/** What a call cost, in micro-dollars (1e-6 USD), from the provider's usage object. A reply without usage is charged its worst case. */
export function costMicro(env, model, usage, worst = 0) {
  if (!usage || !Number.isFinite(usage.prompt_tokens) || !Number.isFinite(usage.completion_tokens)) return worst;
  const [pi, po] = priceFor(env, model);
  return Math.ceil(usage.prompt_tokens * pi + usage.completion_tokens * po);                 // tokens x USD/M = micro-dollars
}

/** The most a call could cost: the text sent (3 chars per token, which over-counts ordinary English) plus the longest answer allowed. */
export function estimateMicro(env, model, system, messages) {
  const [pi, po] = priceFor(env, model), chars = system.length + messages.reduce((a, m) => a + m.content.length, 0);
  return Math.ceil(Math.ceil(chars / CHARS_PER_TOKEN) * pi + maxOutput(env) * po);
}

/** The most tokens a call could use (prompt plus answer), and what it did use: the provider's number, or the worst case when none is reported. */
export const estimateTokens = (env, system, messages) => Math.ceil((system.length + messages.reduce((a, m) => a + m.content.length, 0)) / CHARS_PER_TOKEN) + maxOutput(env);
export const tokensUsed = (usage, worst) => Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens) ? usage.prompt_tokens + usage.completion_tokens : worst;

const day = (now) => new Date(now).toISOString().slice(0, 10), monthStart = (now) => day(now).slice(0, 8) + "01";
const nextMonth = (now) => { const d = new Date(now); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); };
const root = (env) => String(env.SUPABASE_URL).replace(/\/+$/, "");
const svc = (env) => ({ apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json" });
export const enforceable = (env) => !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);

/** This month's and today's spend of a user in micro-dollars, and this month's questions and tokens: { month, today, questions, tokens }. Throws if it cannot be read. */
export async function readUsage(env, userId, doFetch = fetch, now = Date.now()) {
  const res = await doFetch(`${root(env)}/rest/v1/chat_usage?select=day,cost_micro,messages,tokens&user_id=eq.${encodeURIComponent(userId)}&day=gte.${monthStart(now)}`, { headers: svc(env) });
  if (!res.ok) throw new Error(`chat_usage read failed (${res.status})`);
  const rows = await res.json(); let month = 0, today = 0, questions = 0, tokens = 0;
  for (const r of rows) { month += Number(r.cost_micro) || 0; questions += Number(r.messages) || 0; tokens += Number(r.tokens) || 0; if (r.day === day(now)) today += Number(r.cost_micro) || 0; }
  return { month, today, questions, tokens };
}

/** Adds a call to the user's day. Throws if it cannot be recorded. */
export async function addUsage(env, userId, cost, tokens, doFetch = fetch, now = Date.now()) {
  const res = await doFetch(`${root(env)}/rest/v1/rpc/chat_usage_add`, { method: "POST", headers: svc(env), body: JSON.stringify({ uid: userId, d: day(now), c: Math.round(cost), t: Math.round(tokens) }) });
  if (!res.ok) throw new Error(`chat_usage write failed (${res.status})`);
}

/** May a call go ahead? est = { cost (micro-dollars), tokens }. { ok } or { ok: false, reason: "questions" | "tokens" | "month" | "day", resets } (resets: the date the allowance comes back). */
export function allowance(used, est, b, now = Date.now()) {
  const resets = nextMonth(now);
  if (used.questions >= b.questions) return { ok: false, reason: "questions", resets };
  if (used.tokens + est.tokens > b.tokens) return { ok: false, reason: "tokens", resets };
  if (used.month + est.cost > b.month) return { ok: false, reason: "month", resets };
  if (used.today + est.cost > b.day) return { ok: false, reason: "day", resets: new Date(Date.parse(day(now)) + 864e5).toISOString().slice(0, 10) };
  return { ok: true };
}
/** How much of the tightest limit is used, 0 to 100. */
export const percentUsed = (used, b) => Math.min(100, Math.round(Math.max(used.month / b.month, used.today / b.day, (used.questions || 0) / b.questions, (used.tokens || 0) / b.tokens) * 100));
