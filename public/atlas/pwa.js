// Installable web app: registers the service worker and offers installation.
//   Android / desktop Chrome and Edge: the browser's own install prompt is kept and offered from a button in the menu.
//   iPhone / iPad (Safari has no install prompt): a hint says to use Share > Add to Home Screen. Dismissed hints stay dismissed (per browser).
// The pure helpers are exported for tests; init() only runs in a page.

export const HINT_KEY = "atlasInstallHintDismissed";

export const isIos = (ua = "", maxTouchPoints = 0) => /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);   // iPadOS 13+ says "Macintosh"
export const isStandaloneMode = ({ matches = false, navigatorStandalone = false } = {}) => !!(matches || navigatorStandalone);

/** What the menu should show: "installed" (nothing), "prompt" (a browser install prompt is waiting), "ios" (the Add to Home Screen hint) or "none". */
export function installState({ standalone, promptReady, ios, safari, dismissed }) {
  if (standalone) return "installed";
  if (promptReady) return "prompt";
  if (ios && safari && !dismissed) return "ios";
  return "none";
}

/** URLs of the models and data the page has loaded, for the worker to save (first visit: the worker was not in control yet when they arrived). */
export function loadedUrls(entries, origin) {
  return entries.map((e) => e.name).filter((n) => { try { const u = new URL(n); return u.origin === origin && (/\/models\//.test(u.pathname) || /\/data\//.test(u.pathname)); } catch (e) { return false; } });
}

export function init(win = window) {
  const doc = win.document, nav = win.navigator;
  const standalone = () => isStandaloneMode({ matches: win.matchMedia?.("(display-mode: standalone)").matches, navigatorStandalone: nav.standalone });
  const safari = /Safari/.test(nav.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(nav.userAgent);
  let deferred = null, dismissed = false; try { dismissed = win.localStorage.getItem(HINT_KEY) === "1"; } catch (e) { /* private mode */ }

  const row = doc.getElementById("installRow"), btn = doc.getElementById("installBtn"), hint = doc.getElementById("installHint"), close = doc.getElementById("installHintX");
  const render = () => {
    if (!row) return;
    const s = installState({ standalone: standalone(), promptReady: !!deferred, ios: isIos(nav.userAgent, nav.maxTouchPoints), safari, dismissed });
    row.hidden = s === "none" || s === "installed"; btn.hidden = s !== "prompt"; hint.hidden = s !== "ios";
  };
  win.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; render(); });
  win.addEventListener("appinstalled", () => { deferred = null; render(); });
  btn?.addEventListener("click", async () => { if (!deferred) return; const p = deferred; deferred = null; render(); try { await p.prompt(); await p.userChoice; } catch (e) { /* closed */ } });
  close?.addEventListener("click", () => { dismissed = true; try { win.localStorage.setItem(HINT_KEY, "1"); } catch (e) { /* private mode */ } render(); });
  render();

  if (!("serviceWorker" in nav) || (win.location.protocol !== "https:" && win.location.hostname !== "localhost" && win.location.hostname !== "127.0.0.1")) return;
  win.addEventListener("load", async () => {
    try { await nav.serviceWorker.register("./sw.js"); } catch (e) { console.warn("service worker not registered", e); return; }
    const tell = () => { const c = nav.serviceWorker.controller; if (c) setTimeout(() => c.postMessage({ type: "save-loaded", urls: loadedUrls(win.performance.getEntriesByType("resource"), win.location.origin) }), 10000); };
    if (nav.serviceWorker.controller) tell(); else nav.serviceWorker.addEventListener("controllerchange", tell, { once: true });
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") init();
