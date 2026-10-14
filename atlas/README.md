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
- Primary org: org 1 (Ayn Rand Institute) if the person has any link to it, else real roles over authorship/grantee links, then better-verified; `PRIMARY_OVERRIDE` pins individuals (Amy Peikoff -> Don't Let It Go).
- Layout: ARI in the centre cell; `PEIKOFF_ORGS` in the cells around it; other orgs with >= 5 people spread as far apart as possible; the rest fill in; `NEXT_TO` keeps a pair adjacent. The street grid is what the walkers follow.
- People linked to 2+ orgs get a route (`routes`) and walk between those buildings; `ROUTES_EXTRA` adds destinations by hand (Barbara Branden also walks to ARI, Don't Let It Go and Postsocialist Press).
- `HIGHLIGHT`: people whose name contains "peikoff", plus ids in `ids` (Ayn Rand, Barbara Branden), and `PEIKOFF_ORGS` are drawn red whatever the colour setting.
- `DISPLAY_NAMES` / `ALIASES`: Poso Press is shown as Postsocialist Press and still found by "Poso".
- `EXCLUDE_ORGS`: orgs removed from the city (no building; their link and relationship rows are dropped, their people stay via other orgs or on the street). Currently org 55, Critics.

## Preview locally

```sh
python3 -m http.server -d public/atlas 8000   # then open http://localhost:8000/
# or: npm run dev   (full Worker; the viewer is at /atlas/)
```

Viewer options in the URL: `?theme=day|night`, `?colorBy=...&shadeBy=...`, `?debug=1` (GPU / draw diagnostics).
