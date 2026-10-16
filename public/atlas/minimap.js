// A small top-down map of the city in the corner of the viewer. Tap or drag on it to fly the camera there.
//   - north-up: world x runs to the right and world z down (the viewer's ground plane); the map shows the buildings, the lake, the streams, the mountains' footprints,
//     the railway and the places (Peikoff Manor, the forum, the mine, ...). Peikoff buildings are red, as in the city.
//   - a white dot with a cone is the camera and the way it looks; a ring is the point it looks at.
//   - the map hides behind a "Map" tab (remembered), and on a phone it keeps out of the way of the menu and the person card.
// squareBounds(), makeProjection(), wedge() and nearestPlace() are pure, so they are unit-tested in node. createMinimap() needs the page.

export const MAP_PAD = 0.08;

/** Square world bounds { cx, cz, half } around [x, z] points, padded. */
export function squareBounds(points, pad = MAP_PAD, minHalf = 100) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  if (!Number.isFinite(x0)) return { cx: 0, cz: 0, half: minHalf };
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, half: Math.max(minHalf, Math.max(x1 - x0, z1 - z0) / 2 * (1 + pad * 2)) };
}

/** World <-> map pixels for a square map of `size` pixels. */
export function makeProjection(b, size) {
  const k = size / (2 * b.half);
  return { k, toMap: (x, z) => [(x - b.cx) * k + size / 2, (z - b.cz) * k + size / 2], fromMap: (px, py) => [(px - size / 2) / k + b.cx, (py - size / 2) / k + b.cz] };
}

/** The camera's view cone on the map: the direction (radians, map orientation) and its half-angle. aspect = width / height, vfov in degrees. */
export function wedge(cam, target, aspect = 1.6, vfov = 55) {
  const half = Math.min(1.05, Math.atan(Math.tan(vfov * Math.PI / 360) * aspect));
  return { dir: Math.atan2(target.z - cam.z, target.x - cam.x), half };
}

/** The named place within `r` pixels of a map point, or null. places: [{ name, x, z }] in world units. */
export function nearestPlace(places, proj, px, py, r = 10) {
  let best = null, bd = r;
  for (const p of places) { const [qx, qy] = proj.toMap(p.x, p.z), d = Math.hypot(qx - px, qy - py); if (d <= bd) { bd = d; best = p; } }
  return best;
}

const PALETTE = {
  day: { land: '#e6edd9', water: '#8fc2ea', mount: 'rgba(104,116,138,.42)', bld: '#7b8798', hot: '#d0242b', rail: '#3a3f4a', place: '#1b2433', cam: '#ffffff', ring: '#c2410c' },
  night: { land: '#18202f', water: '#1f4a73', mount: 'rgba(150,160,185,.30)', bld: '#8b97ad', hot: '#ff5a5f', rail: '#cfd6e4', place: '#ffd9a0', cam: '#ffffff', ring: '#ffb454' },
};

const CSS = `
#minimap{position:fixed;top:12px;right:12px;z-index:4;width:190px;height:190px;box-sizing:border-box;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
#minimap canvas{display:block;width:100%;height:100%;cursor:crosshair;touch-action:none}
#minimap .mmx,#minimapTab{background:var(--panel);color:var(--fg);border:1px solid var(--line);cursor:pointer;font:600 12px system-ui,sans-serif}
#minimap .mmx{position:absolute;top:4px;right:4px;width:24px;height:24px;padding:0;border-radius:6px;line-height:1}
#minimapTab{position:fixed;top:12px;right:12px;z-index:4;display:none;padding:6px 12px;border-radius:8px}
#minimap.off,#minimapTab.off{display:none!important}
#minimapTab.show{display:block}
body.mm-open #card{max-height:calc(100vh - 42px - 214px)}
@media (max-width:700px),(max-height:560px){
  #minimap{top:auto;bottom:34px;width:112px;height:112px}
  #minimapTab{top:auto;bottom:34px}
  body.mm-open #card{max-height:55vh;max-height:55dvh}
}`;

const KEY = 'atlasMinimap';
const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
const write = v => { try { localStorage.setItem(KEY, v); } catch (e) { /* the map still works without it */ } };

/**
 * createMinimap({ camera, controls, scenery, buildings, highlighted, goTo })
 *   buildings: [{ x0, x1, y0, y1 }] (city x, y = world x, z); highlighted(i): is building i a Peikoff building
 *   goTo(x, z, instant): fly the camera to the world point (instant while dragging)
 */
export function createMinimap({ camera, controls, scenery, buildings, highlighted = () => false, goTo }) {
  const api = { ready: false, el: null, places: [] };
  const doc = document, root = doc.documentElement;
  const style = doc.createElement('style'); style.textContent = CSS; doc.head.append(style);

  const ready = async () => {                                                            // wait for the railway and the places (they are built after the page loads), but not forever
    try { await scenery.userData.railwayDone; } catch (e) { /* no railway */ }
    const t0 = performance.now();
    while (!scenery.userData.places && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 250));
  };

  ready().then(() => {
    const u = scenery.userData, T = u.terrain, RW = u.railway, P = { ...(u.places || {}) };
    if (P.salon?.villa) P.villa = P.salon.villa;                                           // the villa is stored inside the salon (the lawn in front of it)
    const named = [['castle', 'Peikoff Manor'], ['suite', 'Peikoff Manor Cottage'], ['carl', "Carl's house"], ['apartment', 'Apartment building'], ['villa', "Ayn Rand's villa"], ['forum', 'Ford Hall Forum']];
    const places = named.filter(([k]) => P[k]).map(([k, name]) => ({ name, x: P[k].cx, z: P[k].cz, key: k }));
    if (u.mine) places.push({ name: 'Atlantis Mine', x: u.mine.shaft[0], z: u.mine.shaft[1], key: 'mine' });
    if (u.carLot) places.push({ name: 'Car lot', x: u.carLot.x, z: u.carLot.z, key: 'lot' });
    api.places = places;

    const pts = [];
    for (const b of buildings) pts.push([b.x0, b.y0], [b.x1, b.y1]);
    if (RW) pts.push([RW.rect.x0, RW.rect.z0], [RW.rect.x1, RW.rect.z1]);
    for (const p of places) pts.push([p.x - 50, p.z - 50], [p.x + 50, p.z + 50]);
    const bounds = squareBounds(pts);

    const wrap = doc.createElement('div'); wrap.id = 'minimap'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'Map of the city: tap to fly there');
    const canvas = doc.createElement('canvas'), ctx = canvas.getContext('2d');
    const hide = doc.createElement('button'); hide.className = 'mmx'; hide.type = 'button'; hide.textContent = '–'; hide.title = 'Hide the map'; hide.setAttribute('aria-label', 'Hide the map');
    const tab = doc.createElement('button'); tab.id = 'minimapTab'; tab.type = 'button'; tab.textContent = 'Map'; tab.title = 'Show the map'; tab.setAttribute('aria-label', 'Show the map');
    wrap.append(canvas, hide); doc.body.append(wrap, tab);
    api.el = wrap; api.canvas = canvas; api.bounds = bounds;

    let open = read() !== 'off';
    const apply = () => { wrap.classList.toggle('off', !open); tab.classList.toggle('show', !open); doc.body.classList.toggle('mm-open', open); };
    hide.onclick = () => { open = false; write('off'); apply(); };
    tab.onclick = () => { open = true; write('on'); apply(); };
    apply();

    // static layer (rebuilt when the size, the theme or what exists changes), then the camera on top of it
    const stat = doc.createElement('canvas'), sctx = stat.getContext('2d');
    let size = 0, dpr = 1, proj = null, sig = '';
    const signature = () => [canvas.clientWidth, root.dataset.theme || 'night', !!u.railway, !!u.places, !!u.mine, !!u.carLot].join();
    const drawStatic = () => {
      const pal = PALETTE[root.dataset.theme === 'day' ? 'day' : 'night'], g = sctx, k = proj.k;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, size, size);
      g.fillStyle = pal.land; g.fillRect(0, 0, size, size);
      if (T) {
        g.fillStyle = pal.water; const step = Math.max(10, bounds.half / 60), cell = step * k + 0.6;
        for (let x = bounds.cx - bounds.half; x <= bounds.cx + bounds.half; x += step) for (let z = bounds.cz - bounds.half; z <= bounds.cz + bounds.half; z += step) if (T.inLake(x, z)) { const [px, py] = proj.toMap(x, z); g.fillRect(px - cell / 2, py - cell / 2, cell, cell); }
        g.fillStyle = pal.mount; for (const p of T.peaks) { const [px, py] = proj.toMap(p.x, p.z); if (Math.abs(px - size / 2) > size / 2 + p.r * k || Math.abs(py - size / 2) > size / 2 + p.r * k) continue; g.beginPath(); g.arc(px, py, p.r * k, 0, Math.PI * 2); g.fill(); }
      }
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = pal.water; for (const S of u.streams || []) { g.lineWidth = Math.max(1.4, (S.w0 + S.w1) / 2 * k); g.beginPath(); for (let i = 0; i <= 80; i++) { const q = S.curve.getPointAt(i / 80), [px, py] = proj.toMap(q.x, q.z); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); }
      if (RW) { g.strokeStyle = pal.rail; g.lineWidth = 1.2; g.setLineDash([3, 2]); g.beginPath(); const n = Math.max(60, Math.round(RW.total / 12)); for (let i = 0; i <= n; i++) { const q = RW.pos(RW.total * i / n), [px, py] = proj.toMap(q.x, q.z); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); g.setLineDash([]); }
      buildings.forEach((b, i) => { const [px, py] = proj.toMap(b.x0, b.y0); g.fillStyle = highlighted(i) ? pal.hot : pal.bld; g.fillRect(px, py, Math.max(2, (b.x1 - b.x0) * k), Math.max(2, (b.y1 - b.y0) * k)); });
      for (const p of places) { const [px, py] = proj.toMap(p.x, p.z); g.fillStyle = p.key === 'castle' || p.key === 'suite' ? pal.hot : pal.place; g.strokeStyle = pal.land; g.lineWidth = 1.5; g.beginPath(); g.rect(px - 3.5, py - 3.5, 7, 7); g.fill(); g.stroke(); }
    };
    const resize = () => {
      size = Math.max(60, Math.round(canvas.clientWidth)); dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = stat.width = Math.round(size * dpr); canvas.height = stat.height = Math.round(size * dpr);
      proj = makeProjection(bounds, size); api.proj = proj; drawStatic(); sig = signature();
    };

    const clampEdge = (px, py) => [Math.min(size - 4, Math.max(4, px)), Math.min(size - 4, Math.max(4, py))];
    const draw = () => {
      const pal = PALETTE[root.dataset.theme === 'day' ? 'day' : 'night'], g = ctx;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.drawImage(stat, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [cx, cy] = proj.toMap(camera.position.x, camera.position.z), [tx, ty] = proj.toMap(controls.target.x, controls.target.z);
      const w = wedge(camera.position, controls.target, camera.aspect, camera.fov), len = Math.max(14, size * 0.16);
      const [ex, ey] = clampEdge(cx, cy);
      g.fillStyle = 'rgba(255,255,255,.28)'; g.strokeStyle = pal.ring; g.lineWidth = 1;
      g.beginPath(); g.moveTo(ex, ey); g.arc(ex, ey, len, w.dir - w.half, w.dir + w.half); g.closePath(); g.fill(); g.stroke();
      const [rx, ry] = clampEdge(tx, ty); g.strokeStyle = pal.ring; g.lineWidth = 2; g.beginPath(); g.arc(rx, ry, 4.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = pal.cam; g.strokeStyle = pal.ring; g.lineWidth = 2; g.beginPath(); g.arc(ex, ey, 3.6, 0, Math.PI * 2); g.fill(); g.stroke();
    };

    // fly there: a tap flies, a drag follows the finger at once
    const worldAt = e => { const r = canvas.getBoundingClientRect(); return proj.fromMap((e.clientX - r.left) * size / r.width, (e.clientY - r.top) * size / r.height); };
    let down = false;
    canvas.addEventListener('pointerdown', e => { down = true; try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ } const [x, z] = worldAt(e); goTo(x, z, false); e.preventDefault(); e.stopPropagation(); });
    canvas.addEventListener('pointermove', e => {
      if (down) { const [x, z] = worldAt(e); goTo(x, z, true); return; }
      const r = canvas.getBoundingClientRect(), p = nearestPlace(places, proj, (e.clientX - r.left) * size / r.width, (e.clientY - r.top) * size / r.height);
      canvas.title = p ? p.name : '';
    });
    const up = () => { down = false; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    for (const t of ['wheel', 'dblclick', 'contextmenu']) wrap.addEventListener(t, e => { e.stopPropagation(); if (t !== 'wheel') e.preventDefault(); }, { passive: true });

    // on a phone the menu may fill the screen and the person card sits along the bottom: keep out of their way
    const narrow = window.matchMedia('(max-width:700px),(max-height:560px)'), hud = doc.getElementById('hud'), card = doc.getElementById('card');
    let lastLift = '';
    const place = () => {
      const covered = narrow.matches && hud && !hud.classList.contains('collapsed') && !hud.classList.contains('away');
      wrap.style.visibility = tab.style.visibility = covered ? 'hidden' : '';
      let lift = '';
      if (narrow.matches && card && card.style.display === 'block') lift = Math.round(innerHeight - card.getBoundingClientRect().top + 8) + 'px';
      if (lift !== lastLift) { lastLift = lift; wrap.style.bottom = tab.style.bottom = lift; }
    };

    let nextDraw = 0;
    const loop = t => {
      requestAnimationFrame(loop);
      if (t < nextDraw) return; nextDraw = t + 60;
      place();
      if (!open) return;
      if (signature() !== sig) resize();
      draw();
    };
    resize(); api.ready = true; api.redraw = () => { if (signature() !== sig) resize(); draw(); }; api.goTo = goTo;
    requestAnimationFrame(loop);
  });
  return api;
}
