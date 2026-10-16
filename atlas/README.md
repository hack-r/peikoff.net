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

## Legend: what each kind of data looks like in the Atlas

| D1 source | Atlas representation | Notes |
|---|---|---|
| `orgs` (active or not) | Building, one floor per 6 people (min 1) | Defunct orgs stay visible until the Time Machine exists. Peikoff orgs (`PEIKOFF_ORGS`) are red. |
| `people` | Walker (person) in their primary org's building; no org = on the sidewalks | Feminine first names get long hair. Peikoff people are red. |
| `relationships` | Which building a person belongs to; 2+ orgs = a walking route | Doors and elevators are used to enter and leave. |
| `websites` (live) | Fish looping round the stream | Color by kind: gold org, orange Substack, teal personal, green forum/blog, pink store, purple publication. |
| `websites` (defunct) | Pale skeleton fish, slower | Card links only to the archive copy. |
| `social` groups / communities | Cottage; size = members | Mountainside: Facebook, LinkedIn, Goodreads, Google Groups, Reddit (highest). Gulch floor: Meetup. Door color = platform; roof color varies (red only for Peikoff properties). |
| `non_objectivist_orgs` | Not drawn | General universities with no specific Objectivist group. |
| `namesakes` | Planned: drawn differently from `orgs` buildings | Small businesses that borrowed the movement's names. Not read by the pipeline yet. **J. Galt Finance Suite** (c. 2021-2024, defunct) is recorded here and is still drawn as a building through `orgs.id` 181 until the pipeline reads `namesakes`; new namesakes (e.g. from Octoparse scrapes) will get their own look. |
| Scenery only (no data row) | Mountains, lake, stream, the Atlantis Railway (a railway loop with tunnels and three trains), Easter eggs (Kira Peikoff, pirate ship for theVault, "City Forum" lab) | Not searchable or selectable as data. |

## Mapping rules (constants at the top of the makers)

- Every org is a building; one floor per 6 people (min 1); a person stands in their primary org's building, people with no org on the sidewalks.
- Primary org: a founder / CEO / president / chair / owner link wins (best-verified; ARI wins ties), else org 1 (Ayn Rand Institute) if the person has any link to it, else real roles over authorship/grantee links, then better-verified; `PRIMARY_OVERRIDE` pins individuals (Amy Peikoff -> Don't Let It Go).
- Layout: ARI in the center cell; `PEIKOFF_ORGS` in the cells around it; other orgs with >= 5 people spread as far apart as possible; the rest fill in; `NEXT_TO` keeps a pair adjacent. The street grid is what the walkers follow.
- People linked to 2+ orgs get a route (`routes`) and walk between those buildings; `ROUTES_EXTRA` adds destinations by hand (it is currently unused for Barbara Branden Peikoff, who stands and talks instead: see `MEET`).
- `HIGHLIGHT`: people whose name contains "peikoff", plus ids in `ids` (Ayn Rand, Barbara Branden Peikoff), and `PEIKOFF_ORGS` are drawn red whatever the color setting.
- `DISPLAY_NAMES` / `ALIASES`: Poso Press is shown as Postsocialist Press and still found by "Poso".
- `EXCLUDE_ORGS`: orgs removed from the city (no building; their link and relationship rows are dropped, their people stay via other orgs or on the street). Currently org 55 (Critics) and general universities with no specific Objectivist group: 33, 34, 36, 37, 38, 44, 47, 48, 49, 50, 54, 107. Universities stay only through a specific group (Salem Center, Civitas Institute, Hoover Institution, Snow Institute, SPPC) unless the university itself is Objectivist.
- Org links (`urls` in the export): `orgs.url` / `url2` plus `websites` rows for the org, minus defunct sites; the building card lists up to 3 (org site first, Prometheus grantee page and Wikipedia last).
- General universities (no specific Objectivist group) now live in the D1 table `non_objectivist_orgs` (same ids they had in `orgs`; 12 rows: Bowling Green, Carnegie Mellon, Duke, George Mason, Harvey Mudd, Seton Hall, Maryland, Pittsburgh, UT Austin, Wisconsin Madison, Columbia, Francisco Marroquin), and their 11 faculty/grantee rows moved to `non_objectivist_org_relationships`. Groups inside a university (Hoover, Civitas, ...) stay in `orgs`. The export mirror no longer lists them; `EXCLUDE_ORGS` keeps the ids as a guard.
- `OUTSKIRTS`: orgs with walkers placed on lattice cells off the grid, along the road to the lake (Prometheus Foundation, OSI, Anthem Foundation, Ayn Rand Society, Ayn Rand Centre UK).
- Galt's Gulch: the city is Atlantis, the hidden valley of Atlas Shrugged. A gold "Galt's Gulch / Atlantis" sign hangs over the mountains behind the lake (always drawn on top, never picked).
- The gulch: a stream comes out of the mountains (rocky hills line its banks) into the lake and leaves it again, running behind the outskirts and along the city's outer side; a green "Welcome to Atlantis / Pop. N" city sign stands on posts beside the road in, readable from both sides.
- Websites are fish: each row of the D1 `websites` table that is a site in its own right (orgs, publications, Substacks, forums, stores, personal sites; not per-person profile pages or grant sub-pages) is copied into the export's `websites` list and emitted as `websites` in the city JSON. The viewer draws one fish per site, looping round the stream at 2-3 m/s (gold organizations, orange Substacks, teal personal, green forums and blogs, pink stores, purple publications); hover or click for the title, owner and link. **Defunct** sites (dead domain, for sale, hijacked, spam takeover ...) are pale skeletons that drift more slowly and roll over; their card shows why they are defunct and links only to the archive copy, never to the dead address.
- Social media groups are cottages: each `social` row with `account_type` group or community (Meetup, Facebook, Reddit, LinkedIn, Goodreads, Google Groups) is emitted as `groups`. The viewer places one cottage per group: Meetup groups on the gulch floor beside the streams and the lake, the others up the mountainsides (Reddit highest). roofs come in many colors (red is reserved for Peikoff properties, so there are no red roofs unless a group belongs to a Peikoff building), the door color is the platform, size = member count; hover or click for platform, place, members and link. Facebook and LinkedIn groups have no public address in the database, so they show no link.
- Music (optional, off by default): tick "Music" in the panel. With no files it plays a waltz composed live in the browser (`public/atlas/music.js`, original, no recording). To use real recordings, put audio files in `public/atlas/audio/` and list them in `tracks.json` (or try one with `?track=file.mp3`); only use music you have the right to use.
- Cards never show confidence labels (verified, reported, ...) or machine-written bylines ("Byline on N article(s) in D1 ..."); the role and relationship text stays. Cato, Adam Smith Institute, CEVRO, FEE, Goldwater, PragerU and Students For Liberty are in `EXCLUDE_ORGS` (Atlas Network stays). The mountain ring leaves a pass along the inflow so the gulch opens behind the lake.
- No overlaps: at load the viewer pushes apart anyone closer than 1.1 m (same building and floor, or both on the street); a walker who arrives where someone stands steps clear.
- Hair: people with a feminine first name get the long-hair curtain (`city.hair`); Amy Peikoff's is a blend of brown and gray (`HAIR_OVERRIDE` in `main.js`, after the photo on her card). Barbara Branden Peikoff has her own champagne-blonde, full bouffant (regalia kind `bouffant`, after the first photo on barbarapeikoff.com).
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
- Easter eggs (scenery only: not rows of the data, never searchable): Princess Kira Peikoff sits on the back slope of the most distant mountain (hidden from the city; click her for her website and the Baby X page at Barnes & Noble); a toy pirate ship for theVault (the-vault.website, not an Objectivist site), about the size of a fish (`SHIP_SC`), sails the outflow stream (click for the card); and a secret lab labeled "City Forum" stands hidden behind a gulch hill, its sign appearing only when you are near. Clicks cannot reach an egg through a mountain.
- Doors and elevators: every building has a lit door on its south wall and every building of two or more floors an elevator shaft just inside it (one-floor buildings have none; 118 of 124). Walkers use them (walk to the elevator, ride, leave by the door, walk the streets, enter by the next door, ride up) instead of flying through walls. See `public/atlas/paths.js` and MOVEMENT.md section 3c.
- Pictures: a person's `image_url` from the database is shown at the top of their card (https only; hidden if it fails to load). `decisions.json` > `image_rules` drops link-preview graphics and photos of someone else.
- Optional ready-made model (proof of concept): name a `.glb` in `public/atlas/models/models.json` (or try one with `?model=URL`) and the social-group cottages use it instead of the built-in house. The model is centered, grounded, scaled to fit, flattened to one mesh with its material colors, and its top is painted in the cottage's roof color. Nothing is requested unless a file is named. See `public/atlas/models/README.md`.
- No overlaps: at load the viewer pushes apart anyone closer than 1.1 m (same building and floor, or both on the street); a walker who arrives where someone stands steps clear.
- Hair: people with a clearly feminine first name (168 of 614) are drawn with long hair (cap, curtain down the back; five-plus natural colors by person id). It is a guess from the name alone, so `decisions.json` > `hair` keeps the list conservative and allows overrides by full name. Ayn Rand keeps her own bob.
- Defunct orgs stay visible (decision, until the planned Time Machine can filter by year): every org in D1 `orgs`, active or not, is a building. The D1 `active` flag is not used to hide anything.
- Easter-egg models: `models/models.json` slots `princess` (Kira Peikoff is drawn as a Princess Peach model, standing, instead of the built-in seated figure) and `midas` (Midas Peikoff, a dog in a plane recolored Peikoff red, circling high over the gulch; click for the card). Scenery only, no data rows. See `public/atlas/models/README.md`.
- Atlantis Railway: `models/models.json` slot `train` points at the folder `models/train/` (Modular Train Pack). A closed track of straight and curved pieces loops round the buildings, with a locomotive set, a high-speed set and a freight train running on it. Scenery only. The "Welcome to Atlantis" sign has a front and a back face so it reads left to right from both sides.
- The Culture of Reason Center (org 123, Barbara Branden Peikoff's) is one of the Peikoffs' red buildings, placed beside Don't Let It Go (`PEIKOFF_ORGS`, `NEXT_TO`). `MEET` pins Amy Peikoff and Barbara Branden Peikoff in the street midway between their two buildings, 3.6 m apart and facing each other: they do not walk, and the viewer keeps them chatting (output key `meet`; the pair is marked `chatty`).
- Atlantis Railway: `models/models.json` slot `train` points at the folder `models/train/` (Modular Train Pack). A closed track of straight and curved pieces (a loop of rounded-rectangle shape) is placed where it touches nothing of ours: no water, cottages, buildings or streets. Where it meets a mountain it goes through a tunnel with stone portals. A locomotive set (with steam), a high-speed set and a freight train run on it. Scenery only; the cards of the Easter eggs carry no model credits. The "Welcome to Atlantis" sign has a front and a back face so it reads left to right from both sides.
- Props: Ason Peikoff (`STAND`, output key `stand`) stands inside Postsocialist Press, on the ground floor beside the door, and plays his guitar (a held pose, the fretting hand on the neck, the other forearm strumming; he does not walk). One walker rides a scooter at 2.4x walking speed while outside buildings. A car lot (four Range Rovers, six motorcycles) is placed on the nearest open ground, clear of water, mountains, cottages, buildings and the railway. See `public/atlas/models/README.md`.
- Menu: the ‹ button slides the whole menu off to the left (a small › tab brings it back); "Hide menu" still collapses it to the search box.
- Camera: "Stop camera" (or Space) halts every movement (a fly-to, held keys, coasting); "Reset view" (or Home) flies back to the starting view. Places: the castle is labelled Peikoff Manor (about 640 m from the centre), the mother-in-law suite Peikoff Manor Cottage, and Carl Barney's castle Carl's house.
- Kira on `/home`: she closes her book, stands up and walks to Peikoff Manor (over her mountain, shrinking from her Easter-egg size to everyone else's on the way down) and goes in; `/work` brings her back to her ledge to sit and write. The `/home` notice just says everyone is going home (it no longer lists who lives where).
- Atlantis Mine (ore train): a mine shaft with a timber frame is dug into the foot of a slope beside the railway, just out of a tunnel (the first spot with a clear walk to the track). Four people with no organization who stood on the sidewalks work it (they skip `/speak`, `/salon`, `/home` and `/work`): each comes out of the shaft carrying a lump of ore and tips it onto a pile by the track. The freight train brakes to a stop with its open car beside the pile; the pile and the miners' loads go into the car, and it pulls away loaded once full. When the loaded car is out of sight (in a tunnel, or off screen and well away from the mine) the ore is gone, so it comes back empty and the process repeats.
- Midas lands his plane beside the castle on `/home` (about 30 s down, parked until `/work`, then 25 s climbing back to his circle).
- Search box: placeholder "Type a search or / command"; typing `/` lists the commands (arrows to choose, Tab completes, Enter runs).
- Commands (type in the search box, then Enter): `/speak` sends everyone (all 633 people) after Leonard Peikoff to the Ford Hall Forum, a translucent hall with 644 seats and a stage on open ground beyond the street grid; `/salon` takes Ayn Rand, the Peikoffs and the top executives of OSI, The Atlas Society and Prometheus (`SALON_ORGS`, output key `salon`; a founder / CEO / president / executive director / chair link, not a vice) to her mansion; `/home` sends everyone back where they were. People walk the usual lanes through the doors and elevators, then across open ground (`planEventLegs` in `paths.js`), sit with their hips at seat height and legs forward, and the leader stands at the lectern (or the fireplace). The venues are placed by the same open-ground search as the car lot, clear of water, mountains, cottages, buildings, the railway and each other, with a clear straight walk from the street grid.

## Speaking with people (paid; admin testing)

Double click (or double tap) a person. Visitors who are not signed in get a notice to register; a signed-in user without a paid plan gets a "paid plan" notice; a paid user gets a chat panel where the model plays that person. The system prompt (`personaPrompt` in `src/chat.js`) casts it as a character in the Atlas, a virtual world that represents Objectivism, handed the character's card (profile fields and named relationships, no links) and told to be that person and never break character: no mention of prompts, models or role-play, and in-world answers to "what are you?". It must not invent private details or quotations, and never claims to be the real person or a human. The panel itself still shows a one-line notice that this is an AI simulation. Conversations are kept per person until the page reloads ("New" starts over).

- **Admin pass (for testing the paid mode):** type `/admin` in the search box (or open `/atlas/?admin`) and enter the admin password. That is the Worker secret `ADMIN_PASSWORD`, or `USER_PASSWORD` if `ADMIN_PASSWORD` is not set. It sets a signed, HttpOnly session cookie for 30 days; `/logout` signs out, and changing the password signs every session out. Both commands are unlisted.
- **Model (provider-neutral):** `POST /api/chat` makes one OpenAI-style `POST {base}/chat/completions` call with the Worker secret `LLM_KEY` (plain `fetch`, no SDK; OpenAI, Mistral and xAI all accept it). `LLM_PROVIDER` (`openai` default, `mistral`, `xai`) picks the base URL and a default model; `LLM_MODEL` overrides the model; `LLM_BASE_URL` points at any other OpenAI-compatible endpoint (then `LLM_MODEL` is required). Only `model` and `messages` are sent, because token-limit and temperature parameters differ between providers and models. A refusal or content-filter stop comes back as an in-character decline.
- **API:** `GET /api/me`, `POST /api/admin/login` `{ password }`, `POST /api/logout`, `POST /api/chat` `{ personId, messages: [{ role, content }] }` (user first and last, alternating, at most 40 messages of 4000 characters). 401 = not signed in, 402 = signed in but not paid. These four are also served on the `atlas.` host; nothing else under `/api/` is.
- Still to come as separate pull requests: Google sign-in, then billing (which will set `paid` on real users).
