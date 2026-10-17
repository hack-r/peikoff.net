// HubSpot contacts: everyone who signs up is added to HubSpot (name, email) so we can send service messages and, to people who opt in, news. Customers are moved to the "customer" lifecycle stage.
// Needs the Worker secret HUBSPOT_TOKEN (a HubSpot private app token with the crm.objects.contacts.write scope). Without it nothing happens.
// Best effort and in the background: HubSpot being down or misconfigured never affects sign-in or payment. Upserts are keyed on the email address, so repeating one is harmless.

const sent = new Set();                      // contacts already sent by this Worker instance (a sign-in repeats; one upsert per email and stage is enough)
let pausedUntil = 0, today = { day: "", n: 0 };   // per Worker instance: a pause after a quota/auth error, and a daily cap on upserts
export const DAILY_CAP = 200, PAUSE_MS = 3600e3, SENT_MAX = 5000;

/** Masked address for logs: "a***@example.com". */
export const maskEmail = (email) => String(email).replace(/^(.).*(@.*)$/, "$1***$2");

/** True while HubSpot should be left alone: paused after a limit/auth error, or the daily cap is spent. Counts the call when it returns false. */
function throttled(now) {
  if (now < pausedUntil) return true;
  const day = new Date(now).toISOString().slice(0, 10);
  if (today.day !== day) today = { day, n: 0 };
  if (today.n >= DAILY_CAP) return true;
  today.n++; return false;
}

/** The HubSpot properties for a person: email, first and last name when we know them, and the lifecycle stage. */
export function contactProperties({ email, name }, stage = "subscriber") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { email: String(email).trim().toLowerCase(), ...(parts.length ? { firstname: parts[0] } : {}), ...(parts.length > 1 ? { lastname: parts.slice(1).join(" ") } : {}), lifecyclestage: stage };
}

/** Upsert one contact by email. person: { email, name }. stage: "subscriber" (signed up) or "customer" (paid). */
export function captureContact(env, person, stage = "subscriber", doFetch = fetch, waitUntil = () => {}) {
  if (!env?.HUBSPOT_TOKEN || !person?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(person.email) || person.admin) return;
  const props = contactProperties(person, stage), key = `${props.email}|${stage}`;
  if (sent.has(key) || throttled(Date.now())) return;
  if (sent.size >= SENT_MAX) sent.clear();
  sent.add(key);
  waitUntil((async () => {
    try {
      const res = await doFetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert", {
        method: "POST", headers: { authorization: `Bearer ${env.HUBSPOT_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ inputs: [{ idProperty: "email", id: props.email, properties: props }] }),
      });
      if (!res.ok) {
        sent.delete(key);                     // try again on the next sign-in
        const text = await res.text().catch(() => ""); let j = {}; try { j = JSON.parse(text); } catch {}
        const category = String(j.category || ""), limit = res.status === 429 || res.status === 401 || res.status === 403 || /LIMIT|QUOTA/i.test(category + text.slice(0, 300));
        if (limit) pausedUntil = Date.now() + PAUSE_MS;   // over the limit or not allowed: stop calling for an hour
        console.warn(`hubspot upsert failed: status=${res.status} category=${category || "-"} stage=${stage} email=${maskEmail(props.email)} paused=${limit} body=${text.slice(0, 300)}`);
      }
    } catch (e) { sent.delete(key); console.warn(`hubspot upsert error: stage=${stage} email=${maskEmail(props.email)} ${String(e?.message || e).slice(0, 200)}`); }
  })());
}

export const _forget = () => { sent.clear(); pausedUntil = 0; today = { day: "", n: 0 }; };     // for tests
