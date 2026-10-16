// HubSpot contacts: everyone who signs up is added to HubSpot (name, email) so we can send service messages and, to people who opt in, news. Customers are moved to the "customer" lifecycle stage.
// Needs the Worker secret HUBSPOT_TOKEN (a HubSpot private app token with the crm.objects.contacts.write scope). Without it nothing happens.
// Best effort and in the background: HubSpot being down or misconfigured never affects sign-in or payment. Upserts are keyed on the email address, so repeating one is harmless.

const sent = new Set();                      // contacts already sent by this Worker instance (a sign-in repeats; one upsert per email and stage is enough)

/** The HubSpot properties for a person: email, first and last name when we know them, and the lifecycle stage. */
export function contactProperties({ email, name }, stage = "subscriber") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { email: String(email).trim().toLowerCase(), ...(parts.length ? { firstname: parts[0] } : {}), ...(parts.length > 1 ? { lastname: parts.slice(1).join(" ") } : {}), lifecyclestage: stage };
}

/** Upsert one contact by email. person: { email, name }. stage: "subscriber" (signed up) or "customer" (paid). */
export function captureContact(env, person, stage = "subscriber", doFetch = fetch, waitUntil = () => {}) {
  if (!env?.HUBSPOT_TOKEN || !person?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(person.email) || person.admin) return;
  const props = contactProperties(person, stage), key = `${props.email}|${stage}`;
  if (sent.has(key)) return;
  sent.add(key);
  waitUntil((async () => {
    try {
      const res = await doFetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert", {
        method: "POST", headers: { authorization: `Bearer ${env.HUBSPOT_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ inputs: [{ idProperty: "email", id: props.email, properties: props }] }),
      });
      if (!res.ok) sent.delete(key);          // try again on the next sign-in
    } catch { sent.delete(key); }
  })());
}

export const _forget = () => sent.clear();     // for tests
