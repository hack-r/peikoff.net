// Speaking with a person in the Atlas. Press and hold a person (a long press: the same as a force press on a phone), double click / double tap, or right-click opens a small menu
// at the finger or pointer; its first item depends on who you are:
//   - the admin or a paid user: "Chat with <name>" opens a chat panel that talks to POST /api/chat (for now only the admin: type /admin in the search box, or open the page with ?admin),
//   - a visitor who is not signed in: "Sign up to chat with <name>" (an encouragement; registration is opening soon),
//   - a signed-in user without a paid plan: "Upgrade to chat with <name>".
//   - everyone also gets "Show details" (the person's card).
// who is signed in comes from GET /api/me ({ user: null } for visitors).
// needsRegistration(), canSpeak(), isDoubleTap(), menuItems(), menuPosition() and nextMessages() are pure, so they are unit-tested in node.

export const DOUBLE_TAP_MS = 400, DOUBLE_TAP_PX = 24, LONG_PRESS_MS = 450, LONG_PRESS_PX = 10;

/** True when the visitor must register (or sign in) before speaking. */
export const needsRegistration = user => !user || !user.id;

/** True when this user may use the paid chat (the paywall). */
export const canSpeak = user => !needsRegistration(user) && !!(user.paid || user.admin);

/** Two taps count as a double tap on the same person if they are close in time and place. prev/next: { pi, t, x, y } */
export function isDoubleTap(prev, next) {
  return !!prev && prev.pi >= 0 && prev.pi === next.pi && next.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX;
}

/** What to show when the chat API fails: its message plus the provider's detail (so "the language model returned an error" says which error). */
export const errorText = (j, status) => { const e = j?.error || `Error (HTTP ${status}).`; return j?.detail ? `${e} (${j.detail})` : e; };

export const registerMessage = name => `To speak with ${name}, please register or sign in. Registration is opening soon.`;
export const paywallMessage = name => `Speaking with ${name} is part of the paid plan. Plans are opening soon.`;

/** What the menu offers: [{ id, label, note?, primary? }]. The first item is the chat, the sign-up encouragement or the upgrade nudge, depending on who is asking. */
export function menuItems(user, name, accounts = false, billing = false) {
  const items = [];
  if (canSpeak(user)) items.push({ id: 'chat', label: `Chat with ${name}`, primary: true });
  else if (needsRegistration(user)) items.push({ id: 'signup', label: `Sign up to chat with ${name}`, note: accounts ? 'Sign in with Google, Apple, GitHub or your email to talk with the people of the Atlas.' : 'Talk with the people of the Atlas. Registration is opening soon.', primary: true });
  else items.push({ id: 'upgrade', label: `Upgrade to chat with ${name}`, note: billing ? 'Subscribe to talk with the people of the Atlas.' : 'Chat is part of the paid plan. Plans are opening soon.', primary: true });
  items.push({ id: 'details', label: 'Show details' });
  return items;
}

/** Where to put a w x h menu opened at (x, y) in a vw x vh window: just below-right of the point, flipped to the other side when it would not fit, never off screen. */
export function menuPosition(x, y, w, h, vw, vh, margin = 8, gap = 10) {
  let left = x + gap, top = y + gap;
  if (left + w + margin > vw) left = x - gap - w;
  if (top + h + margin > vh) top = y - gap - h;
  return { left: Math.round(Math.min(Math.max(margin, left), Math.max(margin, vw - w - margin))), top: Math.round(Math.min(Math.max(margin, top), Math.max(margin, vh - h - margin))) };
}

/** The conversation sent to the API: the history plus the new user text, trimmed from the front to the server's limit (it must start with the user). */
export function nextMessages(history, text, max = 40) {
  let out = [...history, { role: 'user', content: text }];
  while (out.length > max || (out.length && out[0].role !== 'user')) out = out.slice(1);
  return out;
}

/** Tokens in the address after Supabase sends a person back from a sign-in link or from Google (#access_token=...&refresh_token=...): { access_token, refresh_token } or null. */
export function tokensFromHash(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, '')), access_token = p.get('access_token'), refresh_token = p.get('refresh_token');
  return access_token && refresh_token ? { access_token, refresh_token } : null;
}

/** GET /api/me: { user, accounts } (accounts: whether sign-up is set up on the server). */
export async function loadMe(fetchFn = fetch) {
  try { const r = await fetchFn('/api/me', { credentials: 'same-origin' }); return r.ok ? await r.json() : { user: null, accounts: false }; } catch (e) { return { user: null, accounts: false }; }
}

export async function loadUser(fetchFn = fetch) {
  try { const r = await fetchFn('/api/me', { credentials: 'same-origin' }); return r.ok ? (await r.json()).user || null : null; } catch (e) { return null; }
}

const BTN = 'padding:7px 16px;border:0;border-radius:8px;background:#1b2433;color:#fff;font:600 14px system-ui;cursor:pointer';
const CARD = 'max-width:min(420px,90vw);padding:20px 22px;border-radius:14px;background:#fff;color:#1b2433;font:15px/1.45 system-ui;box-shadow:0 12px 40px rgba(0,0,0,.3)';

/** The notice, created on first use. */
function modal(text) {
  let m = document.getElementById('chatGate');
  if (!m) {
    m = document.createElement('div'); m.id = 'chatGate'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-live', 'polite');
    m.style.cssText = 'position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(15,20,30,.45)';
    m.innerHTML = `<div style="${CARD}"><div id="chatGateText" style="margin-bottom:14px"></div><div style="text-align:right"><button id="chatGateOk" style="${BTN}">OK</button></div></div>`;
    document.body.append(m);
    const close = () => { m.style.display = 'none'; };
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#chatGateOk').onclick = close;
    addEventListener('keydown', e => { if (m.style.display !== 'none' && (e.key === 'Escape' || e.key === 'Enter')) close(); });
  }
  m.querySelector('#chatGateText').textContent = text; m.style.display = 'flex'; m.querySelector('#chatGateOk').focus();
}

/** Sign up / sign in: an email box (a magic link is mailed) and Google. */
function signInDialog(fetchFn = fetch, providers = [{ id: 'google', label: 'Google' }, { id: 'apple', label: 'Apple' }]) {
  const m = document.createElement('div'); m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Sign in');
  m.style.cssText = 'position:fixed;inset:0;z-index:61;display:flex;align-items:center;justify-content:center;background:rgba(15,20,30,.45)';
  m.innerHTML = `<div style="${CARD};width:min(380px,90vw)"><div style="font-weight:700;margin-bottom:6px">Sign up or sign in</div><div class="msg" style="font-size:13px;color:#4a5568;margin-bottom:10px">Talk with the people of the Atlas. We email you a link: no password.</div>` +
    '<form><input type="email" required autocomplete="email" placeholder="you@example.com" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #9aa7bb;border-radius:8px;font:15px system-ui">' +
    `<button type="submit" style="${BTN};width:100%;margin-top:8px">Email me a sign-in link</button></form>` +
    providers.map(p => `<a href="/api/auth/${p.id}?redirect=${encodeURIComponent(location.origin + '/atlas/')}" style="${BTN};display:block;box-sizing:border-box;width:100%;margin-top:8px;text-align:center;text-decoration:none;background:#fff;color:#1b2433;border:1px solid #9aa7bb">Continue with ${p.label}</a>`).join('') +
    '<div class="err" style="color:#b3261e;font-size:13px;min-height:18px;margin-top:8px"></div><div style="text-align:right"><button type="button" class="no" style="padding:5px 12px;border:0;border-radius:8px;background:#e6e9ef;cursor:pointer;font:600 13px system-ui">Close</button></div></div>';
  document.body.append(m);
  const input = m.querySelector('input'), err = m.querySelector('.err'), msg = m.querySelector('.msg'), done = () => m.remove();
  m.querySelector('.no').onclick = done; m.addEventListener('click', e => { if (e.target === m) done(); }); m.addEventListener('keydown', e => { if (e.key === 'Escape') done(); e.stopPropagation(); });
  m.querySelector('form').onsubmit = async e => {
    e.preventDefault(); err.textContent = '';
    try {
      const r = await fetchFn('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: input.value.trim(), redirect: location.origin + '/atlas/' }) }), j = await r.json().catch(() => ({}));
      if (r.ok) { msg.textContent = `Check your inbox: we sent a sign-in link to ${input.value.trim()}. Open it on this device.`; m.querySelector('form').style.display = 'none'; } else err.textContent = j.error || `Could not send the link (HTTP ${r.status}).`;
    } catch (x) { err.textContent = 'Could not reach the server.'; }
  };
  input.focus();
}

/** Upgrade: what the paid plan is, and a Subscribe button that goes to Stripe's checkout. */
function upgradeDialog(name, fetchFn = fetch) {
  const m = document.createElement('div'); m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Subscribe');
  m.style.cssText = 'position:fixed;inset:0;z-index:61;display:flex;align-items:center;justify-content:center;background:rgba(15,20,30,.45)';
  m.innerHTML = `<div style="${CARD};width:min(380px,90vw)"><div style="font-weight:700;margin-bottom:6px">Talk with ${name.replace(/[<>&]/g, '')}</div><div style="font-size:13px;color:#4a5568;margin-bottom:12px">Chat with any of the people of the Atlas with a paid plan. Cancel any time from the billing page (type /billing).</div>` +
    `<button class="go" style="${BTN};width:100%">Subscribe</button><div class="err" style="color:#b3261e;font-size:13px;min-height:18px;margin-top:8px"></div><div style="text-align:right"><button class="no" style="padding:5px 12px;border:0;border-radius:8px;background:#e6e9ef;cursor:pointer;font:600 13px system-ui">Not now</button></div></div>`;
  document.body.append(m); const go = m.querySelector('.go'), err = m.querySelector('.err'), done = () => m.remove();
  m.querySelector('.no').onclick = done; m.addEventListener('click', e => { if (e.target === m) done(); }); m.addEventListener('keydown', e => { if (e.key === 'Escape') done(); e.stopPropagation(); });
  go.onclick = async () => { go.disabled = true; err.textContent = ''; try { location.href = await billingUrl('/api/billing/checkout', fetchFn); } catch (e) { err.textContent = e.message; go.disabled = false; } };
  go.focus();
}

/** POST a billing endpoint; resolves to the Stripe URL to go to, or throws an Error with a message for the person. */
export async function billingUrl(path, fetchFn = fetch) {
  const r = await fetchFn(path, { method: 'POST', credentials: 'same-origin' }), j = await r.json().catch(() => ({}));
  if (r.ok && j.url) return j.url;
  throw new Error(errorText(j, r.status));
}

/** Admin sign-in: a password box that posts to /api/admin/login. Resolves to the user, or null if cancelled. */
function adminPrompt(fetchFn = fetch) {
  return new Promise(resolve => {
    const m = document.createElement('div'); m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Admin sign-in');
    m.style.cssText = 'position:fixed;inset:0;z-index:61;display:flex;align-items:center;justify-content:center;background:rgba(15,20,30,.45)';
    m.innerHTML = `<form style="${CARD}"><div style="font-weight:700;margin-bottom:8px">Admin sign-in</div>` +
      '<input type="password" autocomplete="current-password" placeholder="Admin password" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #9aa7bb;border-radius:8px;font:15px system-ui">' +
      '<div class="err" style="color:#b3261e;font-size:13px;min-height:18px;margin:6px 0"></div>' +
      `<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="no" style="${BTN};background:#e6e9ef;color:#1b2433">Cancel</button><button type="submit" style="${BTN}">Sign in</button></div></form>`;
    document.body.append(m);
    const form = m.querySelector('form'), input = m.querySelector('input'), err = m.querySelector('.err');
    const done = u => { m.remove(); resolve(u); };
    m.querySelector('.no').onclick = () => done(null);
    m.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); e.stopPropagation(); });
    form.onsubmit = async e => {
      e.preventDefault(); err.textContent = '';
      try {
        const r = await fetchFn('/api/admin/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.user) done(j.user); else err.textContent = j.error || `Sign-in failed (HTTP ${r.status}).`;
      } catch (x) { err.textContent = 'Could not reach the server.'; }
    };
    input.focus();
  });
}

let closeMenu = () => {};
/** The person menu: a small popup at (x, y); picking an item (or tapping elsewhere, Escape, resizing) closes it. */
function showMenu({ x, y, name, items, onPick }) {
  closeMenu();
  const m = document.createElement('div'); m.id = 'personMenu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', name);
  m.style.cssText = 'position:fixed;z-index:58;left:0;top:0;min-width:220px;max-width:min(300px,calc(100vw - 16px));box-sizing:border-box;padding:6px;border-radius:12px;background:#fff;color:#1b2433;font:14px/1.35 system-ui;border:1px solid #d5dbe6;box-shadow:0 10px 32px rgba(0,0,0,.32);touch-action:none;user-select:none;-webkit-user-select:none';
  const head = document.createElement('div'); head.textContent = name; head.style.cssText = 'padding:6px 10px 8px;font-weight:700;border-bottom:1px solid #e3e7ee;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; m.append(head);
  for (const it of items) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.id = it.id;
    b.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 12px;margin:2px 0;border:0;border-radius:8px;cursor:pointer;font:inherit;' + (it.primary ? 'background:#1b2433;color:#fff;font-weight:600' : 'background:#f1f4f9;color:#1b2433');
    const l = document.createElement('div'); l.textContent = it.label; b.append(l);
    if (it.note) { const n = document.createElement('div'); n.textContent = it.note; n.style.cssText = 'font-weight:400;font-size:12px;opacity:.8;margin-top:2px'; b.append(n); }
    b.onclick = e => { e.stopPropagation(); off(); onPick(it.id); };
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect(), pos = menuPosition(x, y, r.width, r.height, innerWidth, innerHeight);
  m.style.left = pos.left + 'px'; m.style.top = pos.top + 'px';
  const away = e => { if (!m.contains(e.target)) off(); }, key = e => { if (e.key === 'Escape') off(); };
  function off() { m.remove(); removeEventListener('pointerdown', away, true); removeEventListener('keydown', key, true); removeEventListener('resize', off); closeMenu = () => {}; }
  setTimeout(() => { addEventListener('pointerdown', away, true); addEventListener('keydown', key, true); addEventListener('resize', off); }, 0);   // not for the touch that opened it
  closeMenu = off; m.querySelector('button')?.focus({ preventScroll: true });
}

/** The chat panel: one per page, re-used for whoever you double click. Conversations are kept per person until the page reloads. */
function chatPanel(fetchFn = fetch) {
  const box = document.createElement('div'); box.id = 'chatPanel'; box.setAttribute('role', 'dialog');
  box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:55;display:none;flex-direction:column;width:min(400px,calc(100vw - 24px));height:min(520px,calc(100vh - 90px));border-radius:14px;background:#fff;color:#1b2433;font:14px/1.45 system-ui;box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden';
  box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1b2433;color:#fff"><b class="who" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></b>' +
    '<button class="new" title="Start a new conversation" style="background:none;border:1px solid #fff6;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font:12px system-ui">New</button>' +
    '<button class="x" aria-label="Close" style="background:none;border:0;color:#fff;font-size:18px;cursor:pointer">✕</button></div>' +
    '<div class="log" aria-live="polite" style="flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px"></div>' +
    '<form style="display:flex;gap:6px;padding:8px;border-top:1px solid #e3e7ee"><textarea rows="2" maxlength="4000" placeholder="Say something..." style="flex:1;resize:none;padding:7px 9px;border:1px solid #9aa7bb;border-radius:8px;font:14px system-ui"></textarea>' +
    `<button type="submit" style="${BTN}">Send</button></form>`;
  document.body.append(box);
  const log = box.querySelector('.log'), form = box.querySelector('form'), ta = box.querySelector('textarea'), send = form.querySelector('button');
  const talks = new Map(); let cur = null, busy = false;
  const bubble = (role, text) => { const d = document.createElement('div'); d.textContent = text; d.style.cssText = 'max-width:85%;padding:7px 10px;border-radius:10px;white-space:pre-wrap;' + (role === 'user' ? 'align-self:flex-end;background:#1b2433;color:#fff' : role === 'note' ? 'align-self:center;background:#eef1f6;color:#4a5568;font-size:12px;text-align:center' : role === 'error' ? 'align-self:center;background:#fdecea;color:#b3261e;font-size:13px' : 'align-self:flex-start;background:#eef1f6'); log.append(d); log.scrollTop = log.scrollHeight; return d; };
  const render = () => { log.textContent = ''; const t = talks.get(cur.id); if (!t.length) bubble('note', `You are speaking with an AI simulation of ${cur.name}, built from their card. It can be wrong.`); for (const m of t) bubble(m.role, m.content); };
  box.querySelector('.x').onclick = () => { box.style.display = 'none'; };
  box.querySelector('.new').onclick = () => { if (cur && !busy) { talks.set(cur.id, []); render(); } };
  box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') box.style.display = 'none'; else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });   // typing here must not move the camera
  form.onsubmit = async e => {
    e.preventDefault(); const text = ta.value.trim(); if (!text || busy || !cur) return;
    const who = cur, t = talks.get(who.id), messages = nextMessages(t, text);
    t.push({ role: 'user', content: text }); ta.value = ''; bubble('user', text);
    busy = true; send.disabled = true; const wait = bubble('assistant', '…');
    try {
      const r = await fetchFn('/api/chat', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personId: who.id, messages }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.reply) { t.push({ role: 'assistant', content: j.reply }); if (cur === who) wait.textContent = j.reply; }
      else { t.pop(); wait.remove(); bubble('error', errorText(j, r.status)); ta.value = text; }
    } catch (x) { t.pop(); wait.remove(); bubble('error', 'Could not reach the server.'); ta.value = text; }
    busy = false; send.disabled = false; ta.focus();
  };
  return {
    open(id, name) { cur = { id, name }; if (!talks.has(id)) talks.set(id, []); box.querySelector('.who').textContent = name; box.style.display = 'flex'; render(); ta.focus(); },
    close() { box.style.display = 'none'; },
  };
}

export function createChat({ nameOf, idOf, toast = () => {}, details = () => {} }) {
  let user = null, panel = null, accounts = false, billing = false, providers = undefined;
  const takeTokens = async () => {                                  // back from a sign-in link or Google: hand the tokens in the address to the server (it keeps them in HttpOnly cookies) and tidy the address
    const t = typeof location !== 'undefined' ? tokensFromHash(location.hash) : null; if (!t) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* address left as it is */ }
    try { const r = await fetch('/api/auth/session', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(t) }), j = await r.json().catch(() => ({})); toast(r.ok && j.user ? `Signed in as ${j.user.name}.` : 'That sign-in link did not work. Please try again.'); } catch (e) { toast('Could not finish signing in.'); }
  };
  const afterCheckout = async () => {                               // back from Stripe (?billing=success): the webhook may take a few seconds to turn the plan on
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null, b = q?.get('billing'); if (!b) return;
    try { q.delete('billing'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')); } catch (e) { /* address left as it is */ }
    if (b !== 'success') { toast('Checkout cancelled: nothing was charged.'); return; }
    toast('Thank you! Activating your plan...');
    for (let n = 0; n < 8; n++) { const me = await loadMe(); if (me.user?.paid) { user = me.user; toast('Your plan is active. Press and hold a person and choose Chat.'); return; } await new Promise(r => setTimeout(r, 3000)); }
    toast('Your payment went through; the plan will appear in a moment. Reload if it does not.');
  };
  const ready = takeTokens().then(() => loadMe()).then(me => { user = me.user || null; accounts = !!me.accounts; providers = me.providers; billing = !!me.billing; afterCheckout(); });
  return {
    get user() { return user; },
    async menu(pi, x, y) {                                         // press and hold, double click / double tap or right-click on person pi, at screen point (x, y)
      await ready;
      const name = nameOf(pi);
      showMenu({ x, y, name, items: menuItems(user, name, accounts, billing), onPick: id => { if (id === 'details') details(pi); else this.open(pi); } });
    },
    async open(pi) {                                               // "Chat with ...": the chat panel for the admin or a paid user, else the sign-up / upgrade notice
      await ready;
      const name = nameOf(pi);
      if (needsRegistration(user)) { if (accounts) signInDialog(fetch, providers); else modal(registerMessage(name)); }
      else if (!canSpeak(user)) { if (billing) upgradeDialog(name); else modal(paywallMessage(name)); }
      else (panel ||= chatPanel()).open(idOf(pi), name);
    },
    async admin() {                                                // /admin (or ?admin in the URL)
      await ready;
      if (user?.admin) { toast('Signed in as admin: press and hold a person (or double tap) and choose Chat. Type /logout to sign out.'); return; }
      const u = await adminPrompt(); if (u) { user = u; toast('Signed in as admin: press and hold a person (or double tap) and choose Chat. Type /logout to sign out.'); }
    },
    async manage() {                                               // /billing: Stripe's customer portal (cards, invoices, cancelling), or the subscribe page for someone with no plan
      await ready;
      if (needsRegistration(user)) { if (accounts) signInDialog(fetch, providers); else modal('Sign in first.'); return; }
      if (user.admin) { toast('The admin session has everything: nothing to manage.'); return; }
      if (!billing) { toast('Payments are not open yet.'); return; }
      try { location.href = await billingUrl('/api/billing/portal'); } catch (e) { if (!user.paid) upgradeDialog('the Atlas'); else toast(e.message); }
    },
    async logout() {
      try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { /* signed out locally either way */ }
      user = null; panel?.close(); toast('Signed out.');
    },
  };
}
