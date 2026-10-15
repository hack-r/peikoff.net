# Atlas of Objectivism: data pipeline

The viewer is `public/atlas/` (plain three.js, no build step) and is the source of truth: edit
`public/atlas/main.js` / `index.html` directly. This folder holds what produces its data.

```
D1 (whoneedsit) --export_whoneedsit.{R,py}--> atlas/data/whoneedsit_export.json
                --make_whoneedsit.{R,py}----> public/atlas/data/whoneedsit.json   (what the viewer loads)
```

Run everything from the repo root.

| Step | R | Python |
|---|---|---|
| Re-pull the four tables from D1 (needs `CF_ACCOUNT_ID`, `CF_API_TOKEN` with D1 read; optional `D1_DATABASE_ID`) | `Rscript atlas/export_whoneedsit.R` | `python atlas/export_whoneedsit.py` |
| Rebuild the viewer data (buildings, layout, people, routes, highlight) | `Rscript atlas/make_whoneedsit.R` | `python atlas/make_whoneedsit.py` |

The R and Python makers produce the same buildings, assignments and routes (only random positions differ).
Credentials come from the environment only; do not commit them. The SQL is in `atlas/sql/` and selects named
columns only (no contact fields).

Dependencies: `atlas/requirements.R` (R: pacman, httr2, jsonlite) or `atlas/requirements.txt` (Python: numpy).

## Mapping rules (constants at the top of the makers)

- Every org is a building; one floor per 6 people (min 2); a person stands in their primary org's building, people with no org on the sidewalks.
- Primary org: a founder / CEO / president / chair / owner link wins (best-verified; ARI wins ties), else org 1 (Ayn Rand Institute) if the person has any link to it, else real roles over authorship/grantee links, then better-verified; `PRIMARY_OVERRIDE` pins individuals (Amy Peikoff -> Don't Let It Go).
- Layout: ARI in the center cell; `PEIKOFF_ORGS` in the cells around it; other orgs with >= 5 people spread as far apart as possible; the rest fill in; `NEXT_TO` keeps a pair adjacent. The street grid is what the walkers follow.
- People linked to 2+ orgs get a route (`routes`) and walk between those buildings; `ROUTES_EXTRA` adds destinations by hand (Barbara Branden Peikoff also walks to ARI, Don't Let It Go and Postsocialist Press).
- `HIGHLIGHT`: people whose name contains "peikoff", plus ids in `ids` (Ayn Rand, Barbara Branden Peikoff), and `PEIKOFF_ORGS` are drawn red whatever the color setting.
- `DISPLAY_NAMES` / `ALIASES`: Poso Press is shown as Postsocialist Press and still found by "Poso".
- `EXCLUDE_ORGS`: orgs removed from the city (no building; their link and relationship rows are dropped, their people stay via other orgs or on the street). Currently org 55 (Critics) and general universities with no specific Objectivist group: 33, 34, 36, 37, 38, 44, 47, 48, 49, 50, 54, 107. Universities stay only through a specific group (Salem Center, Civitas Institute, Hoover Institution, Snow Institute, SPPC) unless the university itself is Objectivist.
- Org links (`urls` in the export): `orgs.url` / `url2` plus `websites` rows for the org, minus defunct sites; the building card lists up to 3 (org site first, Prometheus grantee page and Wikipedia last).
- General universities (no specific Objectivist group) now live in the D1 table `non_objectivist_orgs` (same ids they had in `orgs`; 12 rows: Bowling Green, Carnegie Mellon, Duke, George Mason, Harvey Mudd, Seton Hall, Maryland, Pittsburgh, UT Austin, Wisconsin Madison, Columbia, Francisco Marroquin), and their 11 faculty/grantee rows moved to `non_objectivist_org_relationships`. Groups inside a university (Hoover, Civitas, ...) stay in `orgs`. The export mirror no longer lists them; `EXCLUDE_ORGS` keeps the ids as a guard.
- `OUTSKIRTS`: orgs with walkers placed on lattice cells off the grid, along the road to the lake (Prometheus Foundation, OSI, Anthem Foundation, Ayn Rand Society, Ayn Rand Centre UK).
- Galt's Gulch: the city is Atlantis, the hidden valley of Atlas Shrugged. A gold "Galt's Gulch / Atlantis" sign hangs over the mountains behind the lake (always drawn on top, never picked).
- The gulch: a stream comes out of the mountains (rocky hills line its banks) into the lake and leaves it again, running behind the outskirts and along the city's outer side; a green "Welcome to Atlantis / Pop. N" city sign stands on posts beside the road in, readable from both sides.
- Websites are fish: each row of the D1 `websites` table that is a site in its own right (orgs, publications, Substacks, forums, stores, personal sites; not per-person profile pages or grant sub-pages) is copied into the export's `websites` list and emitted as `websites` in the city JSON. The viewer draws one fish per site, looping round the stream at 2-3 m/s (gold organizations, orange Substacks, teal personal, green forums and blogs, pink stores, purple publications); hover or click for the title, owner and link. **Defunct** sites (dead domain, for sale, hijacked, spam takeover ...) are pale skeletons that drift more slowly and roll over; their card shows why they are defunct and links only to the archive copy, never to the dead address.
- Social media groups are cottages: each `social` row with `account_type` group or community (Meetup, Facebook, Reddit, LinkedIn, Goodreads, Google Groups) is emitted as `groups`. The viewer places one cottage per group: Meetup groups on the gulch floor beside the streams and the lake, the others up the mountainsides (Reddit highest). Roof color = platform, size = member count; hover or click for platform, place, members and link. Facebook and LinkedIn groups have no public address in the database, so they show no link.
- Music (optional, off by default): tick "Music" in the panel. With no files it plays a waltz composed live in the browser (`public/atlas/music.js`, original, no recording). To use real recordings, put audio files in `public/atlas/audio/` and list them in `tracks.json` (or try one with `?track=file.mp3`); only use music you have the right to use.
- Cards never show confidence labels (verified, reported, ...) or machine-written bylines ("Byline on N article(s) in D1 ..."); the role and relationship text stays. Cato, Adam Smith Institute, CEVRO, FEE, Goldwater, PragerU and Students For Liberty are in `EXCLUDE_ORGS` (Atlas Network stays). The mountain ring leaves a pass along the inflow so the gulch opens behind the lake.
- Easter egg: Kira Peikoff, an NPC princess, sits on the summit of the furthest tall mountain writing a book (name label above her). She lives only in the scenery (no data row), so she is not searchable, selectable or hoverable. How movement works, and where the shapes come from: see `MOVEMENT.md`.
- Editorial decisions (exclusions, merges, scrubbed notes, website curation) are recorded in `decisions.json` and enforced by `apply_decisions.py`, which both makers run first, so a data refresh cannot undo them. See `DECISIONS.md` (what is protected, the refresh runbook, the limits).
- Scenery (viewer only, `?scenery=0` hides it): a ring of low-poly mountains far out and a lake between the city and them; colors follow the day/night theme.
- Ayn Rand is drawn as herself: short dark bob with straight bangs, dark eyes and brows, black dress with dark stockings, a gold dollar-sign brooch and a cigarette holder (plus the crown). Regalia kinds `hair`, `face`, `dress`, `dollarpin`, `holder`.
- `ROUTES_ONLY` replaces a person's walking route (Carl Barney: Prometheus Foundation, OSI, The Objective Standard); profile links list non-Wikipedia links before Wikipedia.

## Preview locally

```sh
python3 -m http.server -d public/atlas 8000   # then open http://localhost:8000/
# or: npm run dev   (full Worker; the viewer is at /atlas/)
```

Viewer options in the URL: `?theme=day|night`, `?colorBy=...&shadeBy=...`, `?debug=1` (GPU / draw diagnostics).
- Easter eggs (scenery only: not rows of the data, never searchable): Princess Kira Peikoff sits on the back slope of the most distant mountain (hidden from the city; click her for her website and the Baby X page at Barnes & Noble); a toy pirate ship for theVault (the-vault.website, not an Objectivist site) sails the outflow stream (click for the card); and a secret lab labeled "City Forum" stands hidden behind a gulch hill, its sign appearing only when you are near. Clicks cannot reach an egg through a mountain.
- Doors and elevators: every building has a lit door on its south wall and an elevator shaft just inside it. Walkers use them (walk to the elevator, ride, leave by the door, walk the streets, enter by the next door, ride up) instead of flying through walls. See `public/atlas/paths.js` and MOVEMENT.md section 3c.
