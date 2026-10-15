# Editorial decisions and the weekly data refresh

Every inclusion, exclusion and merge decision is recorded so a refresh of the data cannot undo it.
The registry is `atlas/decisions.json`; `atlas/apply_decisions.py` enforces it. Both makers (`make_whoneedsit.py` and `.R`)
run that one step first, so Python and R can never disagree. `test/decisions.test.js` feeds it a deliberately "dirty" refresh.

## Where each decision lives, and what protects it

| Decision | Recorded in | Key | If a refresh brings it back | Protection |
|---|---|---|---|---|
| Orgs dropped from the city (Critics, general universities, Cato, Adam Smith Institute, CEVRO, FEE, Goldwater, PragerU, Students For Liberty) | `decisions.json` > `exclude_orgs` | exact normalized **full name** (not id, not short name) | org, its relationship rows and its sites are dropped again, even under a new id | `decisions.test.js` (new ids; a legitimate group like the Salem Center is not caught by a short-name collision) |
| General universities moved out of the database | D1 table `non_objectivist_orgs` (+ `non_objectivist_org_relationships`) | name | same name-based exclusion | as above |
| Duplicate people merged (Carl Barney, David Salazar, Salsman, Bowden, Begley, Hersey, Berliner, Ridpath, Tracinski) | `decisions.json` > `merged_people` | first + last name, initials ignored | the duplicate is folded into its keeper again: relationships, profile fields and sites re-pointed, fuller name wins, duplicate relationship rows removed | `decisions.test.js` |
| Sourcing / hedging notes ("bio otherwise unverified", "User directory sheet: ...", "exact group unconfirmed", "unconfirmed which") | `decisions.json` > `scrub_patterns` | text pattern | removed from every bio, title, affiliation, credential, major work and relationship note | `decisions.test.js`; text with no match is left byte for byte |
| Confidence labels (verified, reported, ...) never on cards | the makers (never emitted) | n/a | cannot reappear | `atlas.test.js` |
| Which websites become fish | `decisions.json` > `website_rules` | status, domain, URL pattern, title | profile pages, grant sub-pages, reference sites and untitled rows are dropped; Substack pages always kept. Defunct sites (`defunct_status`: dead, hijacked, for sale, spam takeover ...) are **kept as skeleton fish**, titled by their owner (never the spam title) and linked only to the archive copy | `decisions.test.js` |
| Which social media accounts become cottages | `decisions.json` > `social_rules` | `account_type` (group, community) and status | individuals, pages, channels, organizations and deleted / suspended rows are not cottages | `decisions.test.js` |
| Long hair for feminine first names | `decisions.json` > `hair` (`female_first_names`, `overrides` by full name) | first name | a refresh keeps the same rule; a guess from the name alone, so the list is conservative (ambiguous names like Alex, Jean, Robin, Casey are left out; Andrea, Michele, Kim and Taylor were added on request; fix a mistake with an override: `long` or `none`) | `atlas.test.js` |
| Id-keyed constants in the makers (primary orgs, routes, outskirts, regalia, highlights, display names) | `decisions.json` > `expected_names` + the constants at the top of each maker | id, **verified against a name** | if an id now points at a different record the run stops with `DECISION DRIFT` (exit 2) instead of mis-placing people | `decisions.test.js` |

## Refresh runbook

1. Export the fresh data from D1 into `atlas/data/whoneedsit_export.json` (including the `websites` list, with `status` and `wayback_url`, and the `social` list).
2. Regenerate: `python atlas/make_whoneedsit.py` (and `Rscript atlas/make_whoneedsit.R` to cross-check). The run prints what the decisions did (`decisions: ...` lines).
3. If it stops with `DECISION DRIFT`, ids were renumbered. Fix the constants and `expected_names`, then re-run. Do not use `ATLAS_ALLOW_DRIFT=1` except to inspect.
4. `npm test`, then open a PR (never push a refresh straight to main) and read the diff for new orgs and people nobody has reviewed yet.
5. New exclusions or merges: add them to `decisions.json` (by name), not only to the database.

## Limits

* The database itself is not protected: if the refresh job overwrites tables in D1 (re-inserting a deleted duplicate, restoring a moved university), the atlas still ignores the result, but D1 is dirty again. Ask whoever runs the refresh to honor `non_objectivist_orgs` and the merges above.
* The website rules are heuristics derived from how the current list was curated; a genuinely new kind of page needs a rule or an `always_include_urls` entry.
