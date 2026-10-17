// /version (everyone) and /sync (admin): what the live site is running, as a small card in the Atlas and as lines in the home page terminal.
// The data comes from GET /version.json and GET /api/sync (src/version.js); everything here is formatting.

export const REPO_URL = 'https://github.com/hack-r/peikoff.net';

const when = iso => { const d = new Date(iso); return iso && !isNaN(d) ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : ''; };
const known = info => !!info && info.commit && info.commit !== 'dev';

/** The card for /version: [{ label, text, href? }] rows under a title. */
export function versionModel(info) {
  if (!info) return { title: 'Version', rows: [{ label: 'Commit', text: 'unavailable' }] };
  const rows = [];
  if (known(info)) rows.push({ label: 'Commit', text: info.short + (info.dirty ? ' (+ uncommitted changes)' : ''), href: info.url || '' });
  else rows.push({ label: 'Commit', text: 'dev (this deploy does not know its commit)' });
  if (info.message) rows.push({ label: 'Message', text: info.message });
  if (info.date) rows.push({ label: 'Committed', text: when(info.date) });
  if (info.builtAt) rows.push({ label: 'Built', text: when(info.builtAt) });
  if (info.version) rows.push({ label: 'Version', text: info.version });
  return { title: 'Live site version', rows };
}

/** The same facts as plain lines (the home page terminal). Each line is { text, href? }. */
export const versionLines = info => versionModel(info).rows.map(r => ({ text: `${r.label.toLowerCase()}: ${r.text}`, href: r.href }));

export const SYNC_TONES = { 'in-sync': 'green', behind: 'amber', ahead: 'amber', diverged: 'amber', 'unknown-deploy': 'grey', 'not-on-github': 'amber', 'rate-limited': 'grey', 'needs-token': 'red', 'token-rejected': 'red', unreachable: 'red' };

/** The card for /sync. tone: green (in sync), amber (a deploy is missing or came from elsewhere), grey (cannot tell), red (GitHub unreachable). */
export function syncModel(res) {
  if (!res || !res.state) return { title: 'Sync', tone: 'red', summary: 'No answer from the server.', rows: [], commits: [] };
  const rows = [];
  const d = res.deployed || {}, h = res.head || {};
  rows.push({ label: 'Live', text: d.short && d.commit !== 'dev' ? d.short : 'unknown', href: d.url || '' });
  if (h.short) rows.push({ label: 'main', text: h.short + (h.date ? `, ${when(h.date)}` : ''), href: h.url || '' });
  if (res.resetsAt) rows.push({ label: 'Retry after', text: when(res.resetsAt) });
  if (res.checkedAt) rows.push({ label: 'Checked', text: when(res.checkedAt) });
  const commits = (res.commits || []).map(c => ({ text: `${c.short} ${c.message}`.trim(), href: c.url || '' }));
  const more = res.state === 'behind' && res.behindBy > commits.length ? res.behindBy - commits.length : 0;
  return { title: 'Sync with GitHub', tone: SYNC_TONES[res.state] || 'grey', summary: res.summary || '', rows, commits, more, compareUrl: res.compareUrl || '' };
}

const COLORS = { green: '#2e7d32', amber: '#c77700', red: '#c62828', grey: '#6b7280' };

/** Shows a model as a card at the bottom of the page (links work; click x or wait to dismiss). Returns the element. */
export function showCard(doc, model, ms = 20000) {
  doc.getElementById('verCard')?.remove();
  const el = doc.createElement('div'); el.id = 'verCard'; el.setAttribute('role', 'status');
  el.style.cssText = `position:fixed;left:50%;bottom:22px;transform:translateX(-50%);width:min(440px,92vw);box-sizing:border-box;padding:10px 14px 12px;border-radius:12px;background:rgba(27,36,51,.96);color:#fff;font:13px/1.4 system-ui;z-index:60;border-left:6px solid ${COLORS[model.tone] || '#4b6cb7'};box-shadow:0 8px 28px rgba(0,0,0,.35)`;
  const add = (tag, css, text, href) => { const n = doc.createElement(href ? 'a' : tag); n.style.cssText = css; n.textContent = text; if (href) { n.href = href; n.target = '_blank'; n.rel = 'noreferrer noopener'; n.style.color = '#9ec5ff'; } return n; };
  const head = doc.createElement('div'); head.style.cssText = 'display:flex;justify-content:space-between;gap:10px;font-weight:700;font-size:14px';
  const x = add('button', 'all:unset;cursor:pointer;opacity:.7;padding:0 2px', '×'); x.setAttribute('aria-label', 'Close'); x.onclick = () => el.remove();
  head.append(add('span', '', model.title), x); el.append(head);
  if (model.summary) el.append(add('div', 'margin:4px 0 6px;font-weight:600', model.summary));
  for (const r of model.rows) { const row = doc.createElement('div'); row.style.cssText = 'display:flex;gap:8px'; row.append(add('span', 'opacity:.65;min-width:74px', r.label), add('span', 'word-break:break-word', r.text, r.href)); el.append(row); }
  if (model.commits?.length) { el.append(add('div', 'margin-top:6px;opacity:.65', 'Missing from the live site:')); for (const c of model.commits) el.append(add('div', 'display:block;word-break:break-word', '• ' + c.text, c.href)); if (model.more) el.append(add('div', 'display:block;opacity:.65', `and ${model.more} more`, model.compareUrl)); }
  doc.body.append(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

/** GET /version.json -> the model's source data, or null. */
export async function loadVersion(fetchFn = fetch) {
  try { const r = await fetchFn('/version.json', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}

/** GET /api/sync -> { ok, data } or { ok: false, message } with a polite message for a refusal. */
export async function loadSync(fetchFn = fetch) {
  try {
    const r = await fetchFn('/api/sync', { credentials: 'same-origin', cache: 'no-store' }), j = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, data: j };
    return { ok: false, message: r.status === 401 || r.status === 403 ? (j.error || '/sync is for the admin only.') : `Could not check (HTTP ${r.status}).` };
  } catch (e) { return { ok: false, message: 'Could not reach the server.' }; }
}
