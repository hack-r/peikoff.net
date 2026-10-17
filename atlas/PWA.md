# Atlas of Objectivism as an installable app (Phase 1 of the mobile plan)

Files, all in `public/atlas/`: `site.webmanifest`, `sw.js` (service worker), `offline.html`, `pwa.js` (registration + install prompt), `perf.js` (pixel ratio on phones),
`icon-maskable-192.png` / `icon-maskable-512.png`. Tests: `test/pwa.test.js` (`npm test`). Browser check: `node tools/pwa-check.mjs`.

## Hosts and scope
One manifest, one worker, two hosts. Everything is relative, so the scope follows the page: `/atlas/` on peikoff.net and `/` on atlas.peikoff.net (the Worker serves `/atlas/` there, so
`/sw.js` is `/atlas/sw.js`). Sign-in and Stripe return addresses (`homeUrl()` in `src/accounts.js`) already land inside that scope on both hosts. Each host is its own installed app with its own
cookies; install from whichever address people use.

## Service worker (`sw.js`)
| What | Strategy |
|---|---|
| Page (`/atlas/`, also `?billing=success`) | network first (5 s), then the saved copy, then `offline.html` |
| App scripts, icons, manifest | saved at install; network first, so a deploy shows on the next load |
| `vendor/` (three.js) | saved at install; cache first |
| `data/whoneedsit.json` | network first, saved copy offline |
| `models/*`, `audio/tracks.json` | stale-while-revalidate in `atlas-models-v1`, which survives updates; the page tells the worker what it loaded on the first visit |
| `/api/*`, `/version.json`, other origins (Stripe, Google, GitHub, Supabase), non-GET, Range, other site pages | never touched |

Update: bump `VERSION` in `sw.js` when the `SHELL` list or vendor files change (a test fails if a script is missing from `SHELL`). The new worker installs in the background, takes over at once
and deletes old shell caches; the models cache is kept. Install-time download is about 2.2 MB; the 10 MB of models are saved as they are used.

## Install
Android and desktop Chrome/Edge: the browser prompt is held and offered as "Install the Atlas as an app" in the menu. iPhone/iPad Safari has no prompt: the menu shows "Share, then Add to
Home Screen" (dismissible, remembered). Nothing shows once running standalone.

## Touch and layout
Canvas has `touch-action:none` (OrbitControls sets it too), `overscroll-behavior:none` (no pull-to-refresh), no iOS press-and-hold callout, and a `gesturestart` guard; the rest of the page stays
zoomable. `viewport-fit=cover` plus `--sat/--sar/--sab/--sal` keep the menu, account button, minimap, card, chat, toasts and credit clear of notches and the home bar. Long-press and double-tap menus are
unchanged. Orientation is `any` (landscape gives the 3D view more room). No wake lock: the viewer is interactive, not a video, so the screen timeout is left to the user.

## Performance on phones
Start pixel ratio: 2 on desktop, 1.75 on touch screens, 1.5 with Save-Data, 4 GB or less memory, or 4 or fewer cores. Multisampling is off on 2x+ touch screens. A governor (`perf.js`) steps the
ratio down by a fifth (floor 0.75) when average frames take over 30 ms, after a warm-up. `?pr=1` pins it. The viewer draws no shadows, so there are none to reduce. The Compatibility-mode
self-test (instancing) is unchanged and still picks plain meshes on GPUs that fail it. Measured: 2.2 MB transferred to first interactive view, then models stream in (10 MB in all).

## Accounts and payments inside an installed app (what is tested, what needs a real device)
- Cookies are `HttpOnly; Secure; SameSite=Lax; Path=/`, host-only: they work in a standalone window; sign-in on atlas.peikoff.net and peikoff.net are separate.
- Google / GitHub: full-page redirects (`/api/auth/<provider>` to Supabase to the provider and back to `homeUrl`); the tokens in the address are posted to `/api/auth/session` by the page, so the
  cookies are set in the installed app's own context. The worker does not see any of it.
- Stripe Checkout and the billing portal are full-page navigations out and back (`success_url` / `return_url` are in scope). Android shows them in a Custom Tab over the app; iOS in an in-app sheet.
- Known limit: an emailed magic link opens in the default browser, not the installed app (always on iOS, depends on link handling on Android), so it signs the browser in, not the app. Provider sign-in
  does not have this problem. Fix later: a one-time code typed into the app.
- Not verified on real phones (headless Chromium only): install flows, the OAuth sheet on iOS, safe-area insets on a notched device.
