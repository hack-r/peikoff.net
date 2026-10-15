// Speaking with a person in the Atlas (double click / double tap). This file is the front door only:
//   - who is logged in comes from GET /api/me ({ user: null } until accounts exist),
//   - a visitor who is not logged in gets a "register" notice instead,
//   - a logged-in visitor reaches speak(), which the next pull request connects to the chat API.
// needsRegistration() and isDoubleTap() are pure, so they are unit-tested in node.

export const DOUBLE_TAP_MS = 400, DOUBLE_TAP_PX = 24;

/** True when the visitor must register (or sign in) before speaking. */
export const needsRegistration = user => !user || !user.id;

/** Two taps count as a double tap on the same person if they are close in time and place. prev/next: { pi, t, x, y } */
export function isDoubleTap(prev, next) {
  return !!prev && prev.pi >= 0 && prev.pi === next.pi && next.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX;
}

export const registerMessage = name => `To speak with ${name}, please register or sign in. Registration is opening soon.`;

export async function loadUser(fetchFn = fetch) {
  try { const r = await fetchFn('/api/me', { credentials: 'same-origin' }); return r.ok ? (await r.json()).user || null : null; } catch (e) { return null; }
}

/** The notice, created on first use. */
function modal(text) {
  let m = document.getElementById('chatGate');
  if (!m) {
    m = document.createElement('div'); m.id = 'chatGate'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-live', 'polite');
    m.style.cssText = 'position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(15,20,30,.45)';
    m.innerHTML = '<div style="max-width:min(420px,90vw);padding:20px 22px;border-radius:14px;background:#fff;color:#1b2433;font:15px/1.45 system-ui;box-shadow:0 12px 40px rgba(0,0,0,.3)">' +
      '<div id="chatGateText" style="margin-bottom:14px"></div><div style="text-align:right"><button id="chatGateOk" style="padding:7px 16px;border:0;border-radius:8px;background:#1b2433;color:#fff;font:600 14px system-ui;cursor:pointer">OK</button></div></div>';
    document.body.append(m);
    const close = () => { m.style.display = 'none'; };
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#chatGateOk').onclick = close;
    addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') close(); });
  }
  m.querySelector('#chatGateText').textContent = text; m.style.display = 'flex'; m.querySelector('#chatGateOk').focus();
}

export function createChat({ nameOf, speak }) {
  let user = null; const ready = loadUser().then(u => { user = u; });
  return {
    get user() { return user; },
    async open(pi) {                                               // called on a double click / double tap on person pi
      await ready;
      const name = nameOf(pi);
      if (needsRegistration(user)) modal(registerMessage(name)); else speak(pi, user);
    },
  };
}
