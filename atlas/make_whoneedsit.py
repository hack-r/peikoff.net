"""Build public/atlas/data/whoneedsit.json (viewer format) from the D1 export: orgs -> buildings, people -> figures.

  python atlas/make_whoneedsit.py [export.json] [out.json]
  (defaults: atlas/data/whoneedsit_export.json -> public/atlas/data/whoneedsit.json, whatever the working directory)

Simplest version of the mapping:
  * every active org is a building; more people -> taller (one floor per FLOOR_PEOPLE people, min 2 floors)
  * orgs are placed on a square grid: ARI (org 1) in the middle, the other big orgs as far from each other as possible,
    the small ones fill in around the center; NEXT_TO pins an org beside another (Poso Press beside Don't Let It Go)
  * a person stands on a random floor of their primary org's building; people with no org stand on the sidewalks
  * primary org = org 1 (The Ayn Rand Institute) if the person has ANY relationship with it, else the export's pick
    (real roles over authorship/grantee links, then better-verified); all of a person's orgs are listed on their card
  * people linked to 2+ orgs get a walking route (ROUTES_EXTRA adds destinations by hand, ROUTES_ONLY replaces the list) (building ids, primary first) in `routes`; the viewer animates it
  * person id is "P<people.id>"; the click card shows EVERYTHING known about the person: every non-empty person_profile column
    plus a structured Relationships list from the relationships table (older exports without those tables still work)
"""
import json
import math
import os
import re
import sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "data", "whoneedsit_export.json")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "public", "atlas", "data", "whoneedsit.json")
FOOT, PITCH, FLOOR_H, FLOOR_PEOPLE, SEED = 22.0, 36.0, 3.5, 6, 11
PRIORITY_ORG = 1   # The Ayn Rand Institute: anyone linked to it lives in its building
PEIKOFF_ORGS = [121, 122, 120, 42]   # the Peikoffs' buildings, placed right around ARI: Don't Let It Go, Legalizing Privacy, Peikoff Library, Poso Press
PRIMARY_OVERRIDE = {139: 121, 414: 109}   # person id -> org id: Amy Peikoff stands in Don't Let It Go (her ARI link would otherwise win); H.R. McMaster in the Hoover Institution
ROUTES_ONLY = {160: [8, 3, 108]}   # person id -> org ids they walk between, instead of all their linked orgs (Carl Barney: Prometheus Foundation, OSI, The Objective Standard)
ROUTES_EXTRA = {4: [1, 121, 42]}   # person id -> org ids they also walk to (Barbara Branden Peikoff: ARI, Don't Let It Go, Postsocialist Press), after their linked orgs
REGALIA = {1: ["crown", "hair", "face", "dress", "dollarpin", "holder"], 2: ["crown"], 160: ["jacket", "glasses", "bowtie", "book"]}   # person id -> viewer accessories: crowns for Ayn Rand and Leonard Peikoff (Ayn Rand also gets her dark bob, black dress, dollar-sign brooch and cigarette holder); Carl Barney as a college professor. Kinds: crown, hair, face, dress, dollarpin, holder, jacket, glasses, bowtie, book, robe, staff
HIGHLIGHT = {"name": "peikoff", "ids": [1, 4], "color": "#ff2b2b", "label": "Peikoffs, Ayn Rand, Barbara Branden Peikoff & their buildings"}   # people whose name contains "name", person ids in "ids" (1 = Ayn Rand, 4 = Barbara Branden Peikoff), and PEIKOFF_ORGS are drawn red in the viewer
OUTSKIRTS = {8: (-1, -1), 3: (-2, -2), 7: (-3, -2), 5: (-4, -3), 4: (-5, -3)}   # org id -> lattice cell outside the city grid, along the road to the lake: Prometheus Foundation, OSI, Anthem Foundation, Ayn Rand Society, Ayn Rand Centre UK (all have walkers)
NEXT_TO = {42: 121}   # org id -> org id it must sit beside (Poso Press next to Don't Let It Go)
EXCLUDE_ORGS = {55, 33, 48, 50, 54, 34, 36, 37, 38, 44, 47, 49, 107}   # org ids dropped from the city (no building, links and relationship rows removed; their people stay, via their other orgs or on the street): 55 = Critics; 33 = Bowling Green State University, 48 = University of Pittsburgh, 50 = University of Wisconsin Madison (dropped by Ason), 54 = Columbia University (not an Objectivist org); 34, 36, 37, 38, 44, 47, 49, 107 = general universities with no specific Objectivist group (Carnegie Mellon, Duke, George Mason, Harvey Mudd, Seton Hall, Maryland, UT Austin, Francisco Marroquin)
DISPLAY_NAMES = {42: "Postsocialist Press"}   # org id -> name shown everywhere (the export calls it "Poso Press")
ALIASES = {42: "Poso Press"}   # org id -> other name found by search and shown on its card
BIG_MIN = 5        # orgs with at least this many people count as "big" for the spread-apart layout
WEAK_ROLES = {"TOS Author", "TOS Author (republished)", "OSI Blog Author", "Grantee"}
CONF_RANK = {"verified": 0, "reported": 1}
LEADER_RE = re.compile(r"\b(co-?founder|founder|ceo|chief executive|president|executive director|chair(man|woman|person)?|owner)\b", re.I)   # a founder / CEO-type role makes that org the person's primary building

PROFILE_LABELS = {"name": "Name", "pen_name": "Pen name", "birth_name": "Birth name", "married_name": "Married name",
                  "nicknames": "Nicknames", "born": "Born", "died": "Died", "title": "Title", "credentials": "Credentials",
                  "affiliation": "Affiliation", "bio": "Bio", "major_works": "Major works",
                  "articles_written": "Articles written", "works_authored": "Works authored", "works_edited": "Works edited",
                  "works_other_role": "Works (other role)", "first_work_year": "First work year", "last_work_year": "Last work year",
                  "url1": "Link 1", "url2": "Link 2", "url3": "Link 3", "image_url": "Image"}
# derived group_concat() summaries of the relationships table: the structured Relationships list carries the same facts
SKIP_PROFILE = {"person_id", "organizations", "related_people"}
SKIP_IF_ZERO = {"articles_written", "works_authored", "works_edited", "works_other_role"}


def present(v):
    return v is not None and str(v) != ""


data = json.load(open(SRC, encoding="utf-8"))
orgs, people = [o for o in data["orgs"] if o["id"] not in EXCLUDE_ORGS], data["people"]
for p in people:
    if p.get("org") in EXCLUDE_ORGS:   # primary org removed -> street (unless another link is chosen below)
        p["org"], p["role"], p["confidence"] = None, "", ""
for o in orgs:
    o["name"] = DISPLAY_NAMES.get(o["id"], o["name"])
profiles = {r["person_id"]: r for r in data.get("person_profile") or []}
relationships = sorted((r for r in (data.get("relationships") or []) if r.get("org_id") not in EXCLUDE_ORGS and r.get("related_org_id") not in EXCLUDE_ORGS), key=lambda r: r["id"])
org_name = {o["id"]: o["name"] for o in orgs}
person_name = {pr["person_id"]: pr["name"] for pr in profiles.values()}
person_name.update({p["id"]: p["name"] for p in people})
label_person = lambda i: person_name.get(i) or f"person #{i}"
label_org = lambda i: org_name.get(i) or f"org #{i}"


# every person -> org link (relationships rows with both ids), restricted to orgs that become buildings
memberships = {}
for r in relationships:
    if r.get("person_id") is not None and r.get("org_id") in org_name:
        memberships.setdefault(r["person_id"], []).append(r)
for p in people:
    rows = memberships.get(p["id"], [])
    prio = [r for r in rows if r["org_id"] == PRIORITY_ORG]
    if prio:   # best-quality link to the priority org becomes the primary one
        best = min(prio, key=lambda r: (r.get("relationship_type") in WEAK_ROLES, CONF_RANK.get(r.get("confidence"), 2), r["id"]))
        p["org"], p["role"], p["confidence"] = PRIORITY_ORG, best.get("relationship_type") or "", best.get("confidence") or ""


for p in people:   # founder / CEO / president / chair of an org: that org is the primary building (best-verified one; ARI wins ties)
    lead = [r for r in memberships.get(p["id"], []) if LEADER_RE.search(r.get("relationship_type") or "") and not re.search(r"\bvice\b", r.get("relationship_type") or "", re.I)]
    if lead:
        best = min(lead, key=lambda r: (CONF_RANK.get(r.get("confidence"), 2), r["org_id"] != PRIORITY_ORG, r["id"]))
        p["org"], p["role"], p["confidence"] = best["org_id"], best.get("relationship_type") or "", best.get("confidence") or ""


for p in people:   # explicit per-person primary building
    want = PRIMARY_OVERRIDE.get(p["id"])
    if want in org_name:
        rows = [r for r in memberships.get(p["id"], []) if r["org_id"] == want]
        best = min(rows, key=lambda r: (r.get("relationship_type") in WEAK_ROLES, CONF_RANK.get(r.get("confidence"), 2), r["id"])) if rows else {}
        p["org"], p["role"], p["confidence"] = want, best.get("relationship_type") or "", best.get("confidence") or ""


def org_list(p):
    """'Org (role / role); Org (role)...' for every org the person is linked to, primary building first."""
    roles = {}
    for r in sorted(memberships.get(p["id"], []), key=lambda r: (r["org_id"] != p["org"], r["id"])):
        rl = roles.setdefault(r["org_id"], [])
        if r.get("relationship_type") and r["relationship_type"] not in rl:
            rl.append(r["relationship_type"])
    return "; ".join(org_name[o] + (f" ({' / '.join(rl)})" if rl else "") for o, rl in roles.items())


def rel_records(pid):
    """Every relationships row involving this person (direction: out = the person is the subject)."""
    recs = []
    for r in relationships:
        if r.get("person_id") != pid and r.get("related_person_id") != pid:
            continue
        out = r.get("person_id") == pid
        if out:
            with_ = (label_person(r["related_person_id"]) if r.get("related_person_id") is not None
                     else label_org(r["org_id"]) if r.get("org_id") is not None
                     else label_org(r["related_org_id"]) if r.get("related_org_id") is not None else "")
        else:
            with_ = (label_person(r["person_id"]) if r.get("person_id") is not None
                     else label_org(r["org_id"]) if r.get("org_id") is not None else "")
        rec = {"type": r.get("relationship_type") or "", "dir": "out" if out else "in", "with": with_}
        for f in ("start_date", "end_date", "confidence", "evidence", "source_url"):
            if present(r.get(f)):
                rec[f] = str(r[f])
        recs.append(rec)
    return recs


counts = {}
for p in people:
    if p["org"] is not None:
        counts[p["org"]] = counts.get(p["org"], 0) + 1
orgs = sorted(orgs, key=lambda o: (-counts.get(o["id"], 0), o["id"]))

outs = {o: c for o, c in OUTSKIRTS.items() if o in org_name}
side = math.ceil(math.sqrt(len(orgs) - len(outs)))
mid = (side - 1) / 2
free = sorted(((i, j) for i in range(side) for j in range(side)), key=lambda c: (math.hypot(c[0] - mid, c[1] - mid), c))
extent = side * PITCH
# layout: the priority org (ARI) sits in the center; the other big orgs (>= BIG_MIN people) are spread as far apart as possible
# (greedy farthest-point); everything else fills the remaining cells from the center outwards, biggest first
cell_of, big_cells = dict(outs), []
if any(o["id"] == PRIORITY_ORG for o in orgs):
    cell_of[PRIORITY_ORG] = free.pop(0)
    big_cells.append(cell_of[PRIORITY_ORG])
for o in orgs:
    if o["id"] in cell_of or counts.get(o["id"], 0) < BIG_MIN:
        continue
    best = max(free, key=lambda c: (round(min(math.hypot(c[0] - b[0], c[1] - b[1]) for b in big_cells), 9) if big_cells else 0, -c[0], -c[1]))
    free.remove(best)
    cell_of[o["id"]] = best
    big_cells.append(best)
# the Peikoffs' buildings: the free cells touching ARI's cell (3x3 block), nearest first; a NEXT_TO partner goes beside its anchor
if PRIORITY_ORG in cell_of:
    ai, aj = cell_of[PRIORITY_ORG]
    ring = lambda c: max(abs(c[0] - ai), abs(c[1] - aj)) == 1
    for oid in PEIKOFF_ORGS:
        if oid not in org_name or oid in cell_of:
            continue
        anchor = cell_of.get(NEXT_TO.get(oid))
        cands = [c for c in free if ring(c)]
        if not cands:
            break
        best = min(cands, key=lambda c: (round(math.hypot(c[0] - anchor[0], c[1] - anchor[1]), 9) if anchor else 0, round(math.hypot(c[0] - ai, c[1] - aj), 9), c))
        free.remove(best); cell_of[oid] = best
followers = {a: f for f, a in NEXT_TO.items() if any(x["id"] == f for x in orgs)}   # anchor id -> org placed right beside it
for o in orgs:
    if o["id"] in cell_of or (o["id"] in NEXT_TO and any(x["id"] == NEXT_TO[o["id"]] for x in orgs)):
        continue
    cell_of[o["id"]] = free.pop(0)
    f = followers.get(o["id"])
    if f is not None and f not in cell_of:   # nearest free cell to the anchor
        c = cell_of[o["id"]]
        best = min(free, key=lambda k: (round(math.hypot(k[0] - c[0], k[1] - c[1]), 9), k))
        free.remove(best); cell_of[f] = best
for o in orgs:   # anchors that were already placed as big orgs
    f = followers.get(o["id"])
    if f is not None and f not in cell_of:
        c = cell_of[o["id"]]
        best = min(free, key=lambda k: (round(math.hypot(k[0] - c[0], k[1] - c[1]), 9), k))
        free.remove(best); cell_of[f] = best
buildings, bld_of_org = [], {}
for k, o in enumerate(orgs):
    i, j = cell_of[o["id"]]
    cx, cy = (i + .5) * PITCH, (j + .5) * PITCH
    n = counts.get(o["id"], 0)
    floors = max(2, math.ceil(n / FLOOR_PEOPLE))
    bld_of_org[o["id"]] = k
    buildings.append(dict(id=k, org_id=o["id"], name=o["name"], short=o.get("short") or "", alias=ALIASES.get(o["id"], ""), category=o.get("category") or "", urls=o.get("urls") or [],
                          x0=round(cx - FOOT / 2, 2), y0=round(cy - FOOT / 2, 2), x1=round(cx + FOOT / 2, 2), y1=round(cy + FOOT / 2, 2),
                          floors=floors, h=round(floors * FLOOR_H, 2)))

rng = np.random.default_rng(SEED)
out_people, ids, meta, bcounts = [], [], {}, {b["id"]: 0 for b in buildings}
for p in people:
    pid = f"P{p['id']}"
    b = buildings[bld_of_org[p["org"]]] if p["org"] in bld_of_org else None
    if b:
        x, y = rng.uniform(b["x0"] + 1, b["x1"] - 1), rng.uniform(b["y0"] + 1, b["y1"] - 1)
        z, kind, bid = float(rng.integers(0, b["floors"])) * FLOOR_H, 1, b["id"]
        bcounts[bid] += 1
    else:  # sidewalk: a street centerline sits on a cell boundary, offset 3 m to either side
        line = rng.integers(0, side + 1) * PITCH + rng.choice([-3, 3])
        along = rng.uniform(0, extent)
        x, y = (along, line) if rng.random() < .5 else (line, along)
        z, kind, bid = 0.0, 0, -1
    out_people.append([round(float(x), 2), round(float(y), 2), round(z, 2), kind, round(float(rng.uniform(0, 360)), 1), bid])
    ids.append(pid)
    prof = profiles.get(p["id"])
    m = {"Name": str(prof["name"]) if prof and present(prof.get("name")) else p["name"]}
    if b: m["Organization"] = b["name"]
    ol = org_list(p)
    if ol: m["All organizations"] = ol
    if p.get("role"): m["Role at org"] = f"{p['role']} ({p['confidence']})" if p.get("confidence") else p["role"]
    if prof:                                          # every non-empty profile column
        prof = dict(prof)
        urls = [prof.get(c) for c in ("url1", "url2", "url3") if present(prof.get(c))]
        urls.sort(key=lambda u: "wikipedia.org" in str(u).lower())   # stable: non-Wikipedia links first, Wikipedia last
        for c, u in zip(("url1", "url2", "url3"), urls + [None] * 3):
            if c in prof: prof[c] = u
        for col, v in prof.items():
            if col == "name" or col in SKIP_PROFILE or not present(v):
                continue
            if col in SKIP_IF_ZERO and str(v) in ("0", "0.0"):
                continue
            m[PROFILE_LABELS.get(col, col.replace("_", " "))] = str(v)
    else:                                             # old export without person_profile
        if p.get("title"): m["Title"] = p["title"]
        if p.get("born"): m["Born"] = str(p["born"])
        if p.get("died"): m["Died"] = str(p["died"])
    recs = rel_records(p["id"])
    if recs: m["Relationships"] = recs
    meta[pid] = m

# walking routes: people linked to 2+ different orgs walk between those buildings (primary building first, then link order)
routes = {}
for p in people:
    seen = []
    for oid in ROUTES_ONLY.get(p["id"], []):
        b = bld_of_org.get(oid)
        if b is not None and b not in seen:
            seen.append(b)
    for r in ([] if p["id"] in ROUTES_ONLY else sorted(memberships.get(p["id"], []), key=lambda r: (r["org_id"] != p["org"], r["id"]))):
        b = bld_of_org.get(r["org_id"])
        if b is not None and b not in seen:
            seen.append(b)
    for extra in ROUTES_EXTRA.get(p["id"], []):
        b = bld_of_org.get(extra)
        if b is not None and b not in seen:
            seen.append(b)
    if len(seen) >= 2:
        routes[f"P{p['id']}"] = seen

websites = [w for w in data.get("websites", []) if w.get("org_id") not in EXCLUDE_ORGS]   # sites of dropped orgs are dropped too

json.dump(dict(floor_h=FLOOR_H, extent=extent, buildings=buildings, websites=websites, people=out_people, ids=ids, counts=bcounts, meta=meta, routes=routes,
         regalia={f"P{k}": v for k, v in REGALIA.items() if f"P{k}" in meta},
         highlight=dict(color=HIGHLIGHT["color"], label=HIGHLIGHT["label"],
                        people=[i for i, m in meta.items() if HIGHLIGHT["name"] in m["Name"].lower() or int(i[1:]) in HIGHLIGHT["ids"]],
                        buildings=[bld_of_org[o] for o in PEIKOFF_ORGS if o in bld_of_org])),
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{OUT}: {len(buildings)} buildings (orgs), {len(out_people)} people "
      f"({sum(bcounts.values())} in buildings, {len(out_people) - sum(bcounts.values())} on the street)")
