// On-screen controls for touch screens: a joystick that moves the camera over the ground (what WASD does) and + / - buttons that zoom.
// Two-finger pan and pinch still work; these are for one-handed use and for getting somewhere without a keyboard or a right mouse button.
//   - shown on touch devices (primary pointer is coarse); add ?touch to the address to show them anywhere, ?touch=0 to never show them
//   - the joystick sits bottom-left, the zoom buttons halfway down the right edge; both keep clear of the menu and the person card
// stickVector(), groundStep(), zoomOffset() and wantsTouch() are pure, so they are unit-tested in node. createTouchControls() needs the page.

export const DEADZONE = 0.14, ZOOM_RATE = 1.1, MIN_DISTANCE = 3;

/** A stick pushed (dx, dy) screen pixels from its centre, radius r: { x, y, mag } with x right, y forward (up the screen), mag 0..1 after a dead zone. */
export function stickVector(dx, dy, r) {
  const d = Math.hypot(dx, dy);
  if (!(r > 0) || !(d > 0)) return { x: 0, y: 0, mag: 0 };
  const m = Math.min(1, d / r);
  if (m < DEADZONE) return { x: 0, y: 0, mag: 0 };
  const mag = (m - DEADZONE) / (1 - DEADZONE);
  return { x: dx / d * mag, y: -dy / d * mag, mag };
}

/** How far to move the camera and its target over the ground this frame: [dx, dz] in world units. Same speed as WASD (0.8 x the zoom distance per second at full tilt). */
export function groundStep(cam, target, vec, distance, dt) {
  let fx = target.x - cam.x, fz = target.z - cam.z; const l = Math.hypot(fx, fz);
  if (l < 1e-6) { fx = 0; fz = -1; } else { fx /= l; fz /= l; }
  const rx = -fz, rz = fx, s = distance * 0.8 * dt;                       // right = forward x up, as in the keyboard code
  return [(fx * vec.y + rx * vec.x) * s, (fz * vec.y + rz * vec.x) * s];
}

/** The camera's offset from its target after zooming for dt seconds: dir +1 zooms in, -1 out, 0 holds. Clamped to [min, max]. */
export function zoomOffset(off, dir, dt, min = MIN_DISTANCE, max = Infinity) {
  if (!dir) return { ...off };
  const len = Math.hypot(off.x, off.y, off.z); if (!(len > 0)) return { ...off };
  const k = Math.min(max, Math.max(min, len * Math.exp(-dir * ZOOM_RATE * dt))) / len;
  return { x: off.x * k, y: off.y * k, z: off.z * k };
}

/** Whether to show the controls: touch devices, or ?touch forced on, or ?touch=0 forced off. */
export function wantsTouch(search, coarse) {
  const v = new URLSearchParams(search).get('touch');
  if (v === '0' || v === 'false' || v === 'off') return false;
  return v !== null || !!coarse;
}

const CSS = `
#touchStick,#touchZoom button{background:var(--panel);color:var(--fg);border:1px solid var(--line);touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;backdrop-filter:blur(6px)}
#touchStick{position:fixed;left:18px;bottom:36px;z-index:4;width:112px;height:112px;border-radius:50%;box-sizing:border-box}
#touchStick .knob{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;background:var(--accent);opacity:.8;pointer-events:none}
#touchStick::before{content:"";position:absolute;inset:14px;border-radius:50%;border:1px dashed var(--line);pointer-events:none}
#touchZoom{position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:4;display:flex;flex-direction:column;gap:10px}
#touchZoom button{width:54px;height:54px;border-radius:50%;padding:0;font:600 28px/1 system-ui,sans-serif;cursor:pointer}
#touchZoom button.on{background:var(--accent);color:#fff}
.touch-off{visibility:hidden!important}`;

/**
 * createTouchControls({ camera, controls, onUse, maxDistance })
 *   onUse(): called when a finger lands on a control (the viewer stops any fly-to so it does not fight the finger)
 */
export function createTouchControls({ camera, controls, onUse = () => {}, maxDistance = Infinity }) {
  const api = { shown: false, stick: null, zoomIn: null, zoomOut: null, vec: { x: 0, y: 0, mag: 0 }, zoom: 0 };
  const doc = document;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!wantsTouch(location.search, coarse)) return api;
  api.shown = true;

  const style = doc.createElement('style'); style.textContent = CSS; doc.head.append(style);
  const stick = doc.createElement('div'); stick.id = 'touchStick'; stick.setAttribute('role', 'application'); stick.setAttribute('aria-label', 'Move the camera: drag the knob');
  const knob = doc.createElement('div'); knob.className = 'knob'; stick.append(knob);
  const zoom = doc.createElement('div'); zoom.id = 'touchZoom';
  const mk = (label, aria) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', aria); return b; };
  const zIn = mk('+', 'Zoom in'), zOut = mk('−', 'Zoom out'); zoom.append(zIn, zOut);
  doc.body.append(stick, zoom);
  Object.assign(api, { stick, zoomIn: zIn, zoomOut: zOut });

  // the joystick: the knob follows the finger inside the ring, and the offset from the centre is the push
  let pid = null;
  const radius = () => stick.getBoundingClientRect().width / 2 - 8;
  const push = e => {
    const r = stick.getBoundingClientRect(), R = radius();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px,${dy}px)`; api.vec = stickVector(dx, dy, R);
  };
  const release = () => { pid = null; knob.style.transform = ''; api.vec = { x: 0, y: 0, mag: 0 }; };
  stick.addEventListener('pointerdown', e => { if (pid !== null) return; pid = e.pointerId; try { stick.setPointerCapture(pid); } catch (x) { /* synthetic pointer */ } onUse(); push(e); e.preventDefault(); e.stopPropagation(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === pid) { push(e); e.preventDefault(); } });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(t, e => { if (e.pointerId === pid) release(); });

  // zoom: hold a button to keep zooming
  const hold = (btn, dir) => {
    btn.addEventListener('pointerdown', e => { onUse(); api.zoom = dir; btn.classList.add('on'); try { btn.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ } e.preventDefault(); e.stopPropagation(); });
    const stop = () => { if (api.zoom === dir) api.zoom = 0; btn.classList.remove('on'); };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(t, stop);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  };
  hold(zIn, 1); hold(zOut, -1);
  for (const el of [stick, zoom]) for (const t of ['wheel', 'dblclick']) el.addEventListener(t, e => e.stopPropagation(), { passive: true });

  // keep clear of the menu and the person card
  const narrow = window.matchMedia('(max-width:700px),(max-height:560px)'), hud = doc.getElementById('hud'), card = doc.getElementById('card');
  let lastKey = '';
  const layout = () => {
    const hudOpen = hud && !hud.classList.contains('collapsed') && !hud.classList.contains('away');
    const cover = narrow.matches && hudOpen;                                                         // on a phone the open menu fills the screen
    let left = 18, bottom = 36;
    if (!narrow.matches && hudOpen) left = Math.round(hud.getBoundingClientRect().right + 16);       // beside the menu on a tablet
    if (narrow.matches && card && card.style.display === 'block') bottom = Math.round(innerHeight - card.getBoundingClientRect().top + 8);   // above the card
    const key = [cover, left, bottom].join();
    if (key === lastKey) return; lastKey = key;
    stick.classList.toggle('touch-off', cover); zoom.classList.toggle('touch-off', cover);
    stick.style.left = left + 'px'; stick.style.bottom = bottom + 'px';
  };

  // each frame: move over the ground and zoom
  let prev = 0;
  const step = dt => {
    const c = camera.position, t = controls.target;
    if (api.vec.mag > 0) {
      const [dx, dz] = groundStep(c, t, api.vec, controls.getDistance(), dt);
      c.x += dx; c.z += dz; t.x += dx; t.z += dz;
    }
    if (api.zoom) {
      const o = zoomOffset({ x: c.x - t.x, y: c.y - t.y, z: c.z - t.z }, api.zoom, dt, MIN_DISTANCE, maxDistance);
      c.set(t.x + o.x, t.y + o.y, t.z + o.z);
    }
  };
  api.step = step;
  const loop = now => { requestAnimationFrame(loop); const dt = Math.min(0.1, Math.max(0, (now - prev) / 1000)); prev = now; layout(); if (dt > 0) step(dt); };
  requestAnimationFrame(loop);
  return api;
}
