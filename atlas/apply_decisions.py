"""Apply the editorial decisions in atlas/decisions.json to a raw D1 export, so a data refresh cannot undo them.

  python atlas/apply_decisions.py raw_export.json decided_export.json

Both makers (make_whoneedsit.py and .R) run this first. It is idempotent: running it on its own output changes nothing.
What it enforces, by NAME where possible so it still works if a refresh renumbers rows:
  * exclude_orgs     orgs dropped from the city (with their relationship rows); matched on the exact normalized full name
  * merged_people    duplicate people folded into one keeper: relationships, profile fields and websites are re-pointed, the fuller name wins
  * scrub_patterns   sourcing / hedging notes ("bio otherwise unverified", "User directory sheet: ...") removed from every card text
  * website_rules    which websites become fish (no per-person profile pages, grant sub-pages, reference sites or dead domains)
  * expected_names   the id-keyed constants in the makers (primary orgs, routes, regalia, ...) must still point at the same records;
                     otherwise it stops with DECISION DRIFT (exit 2) instead of silently placing the wrong people. ATLAS_ALLOW_DRIFT=1 overrides.
"""
import json
import os
import re
import sys
import unicodedata
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
DEC = json.load(open(os.path.join(HERE, "decisions.json"), encoding="utf-8"))


def nrm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s.lower()).split())


def core(s):                       # first + last name, initials dropped: "Carl B. Barney" and "Carl Barney" are the same person
    t = [x for x in nrm(s).split() if len(x) > 1]
    return f"{t[0]} {t[-1]}" if t else ""


def tokens(s):
    return {x for x in nrm(s).split() if len(x) > 2}


SCRUB = [(re.compile(p, re.I), r) for p, r in DEC.get("scrub_patterns", [])]


def scrub(text):
    """Remove sourcing / hedging notes. Text with no match is returned untouched (byte for byte)."""
    if not isinstance(text, str) or not text:
        return text
    out = text
    for rx, rep in SCRUB:
        out = rx.sub(rep, out)
    if out == text:
        return text
    out = re.sub(r"\s{2,}", " ", out).strip()
    out = re.sub(r"\s+([.;,])", r"\1", out)
    out = re.sub(r"\.(\s*\.)+", ".", out)
    out = re.sub(r"[;,]\s*$", "", out).strip()
    return out


def website_ok(w, rules, always):
    url = str(w.get("url") or "")
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    key = nrm(url)
    if key in always:
        return True
    if rules.get("require_title") and not str(w.get("title") or "").strip():
        return False
    if any(host == d or host.endswith("." + d) for d in rules["drop_domains"]):
        return False
    if any(s in url for s in rules["drop_url_contains"]) and not any(host == d or host.endswith("." + d) for d in rules.get("keep_domains", [])):
        return False
    if w.get("person_id") is not None and w.get("org_id") is None and not str(w.get("type") or w.get("site_type") or "").strip() and host != "substack.com" and not host.endswith(".substack.com"):
        return False                                    # a bare per-person profile page, not a site of its own
    return True


def apply(data):
    data = json.loads(json.dumps(data))                # work on a copy
    report = []
    # ---- 1. excluded orgs, by name
    names = {nrm(e["name"]) for e in DEC["exclude_orgs"]}
    gone = {o["id"] for o in data["orgs"] if nrm(o.get("name")) in names}    # exact full name only; see decisions.json
    if gone:
        report.append(f"excluded {len(gone)} org(s) by name: {sorted(gone)}")
    data["orgs"] = [o for o in data["orgs"] if o["id"] not in gone]
    data["relationships"] = [r for r in data.get("relationships") or [] if r.get("org_id") not in gone and r.get("related_org_id") not in gone]
    for p in data["people"]:
        if p.get("org") in gone:
            p["org"], p["role"], p["confidence"] = None, "", ""
    data["websites"] = [w for w in data.get("websites") or [] if w.get("org_id") not in gone]
    # ---- 2. merged people
    people = {p["id"]: p for p in data["people"]}
    keeper_of = {}
    for m in DEC["merged_people"]:
        k = people.get(m["keep_id"])
        if k is None or core(k["name"]) != core(m["keep"]):
            cands = sorted(p["id"] for p in data["people"] if core(p["name"]) == core(m["keep"]))
            k = people[cands[0]] if cands else None
        if k is not None:
            keeper_of[core(m["keep"])] = k["id"]
    dup = {p["id"]: keeper_of[core(p["name"])] for p in data["people"] if core(p["name"]) in keeper_of and keeper_of[core(p["name"])] != p["id"]}
    if dup:
        profiles = {x["person_id"]: x for x in data.get("person_profile") or []}
        for d_id, k_id in dup.items():
            kp, dp = people[k_id], people[d_id]
            if len(nrm(dp["name"]).split()) > len(nrm(kp["name"]).split()):
                kp["name"] = dp["name"]
                if k_id in profiles:
                    profiles[k_id]["name"] = dp["name"]
            for f, v in dp.items():
                if kp.get(f) in (None, "") and v not in (None, ""):
                    kp[f] = v
            if d_id in profiles and k_id in profiles:
                for f, v in profiles[d_id].items():
                    if profiles[k_id].get(f) in (None, "") and v not in (None, ""):
                        profiles[k_id][f] = v
        data["people"] = [p for p in data["people"] if p["id"] not in dup]
        data["person_profile"] = [x for x in data.get("person_profile") or [] if x["person_id"] not in dup]
        seen, rels = set(), []
        for r in sorted(data["relationships"], key=lambda r: r["id"]):
            r["person_id"] = dup.get(r.get("person_id"), r.get("person_id"))
            r["related_person_id"] = dup.get(r.get("related_person_id"), r.get("related_person_id"))
            if r["person_id"] is not None and r["person_id"] == r["related_person_id"]:
                continue
            key = (r["person_id"], r["related_person_id"], r.get("org_id"), r.get("related_org_id"), r.get("relationship_type"))
            if key in seen:
                continue
            seen.add(key)
            rels.append(r)
        data["relationships"] = rels
        for w in data.get("websites") or []:
            w["person_id"] = dup.get(w.get("person_id"), w.get("person_id"))
        report.append(f"merged {len(dup)} duplicate person row(s): {sorted(dup.items())}")
    # ---- 3. scrub card text
    n = 0
    for x in data.get("person_profile") or []:
        for f in ("bio", "title", "affiliation", "credentials", "major_works"):
            if isinstance(x.get(f), str):
                new = scrub(x[f])
                if new != x[f]:
                    x[f], n = new, n + 1
    for r in data["relationships"]:
        if isinstance(r.get("evidence"), str):
            new = scrub(r["evidence"]) or None
            if new != r["evidence"]:
                r["evidence"], n = new, n + 1
    if n:
        report.append(f"scrubbed {n} text field(s)")
    # ---- 3b. pictures: only https, and never a link-preview graphic or a photo of someone else
    ir, ni = DEC.get("image_rules", {}), 0
    for x in data.get("person_profile") or []:
        u = str(x.get("image_url") or "")
        if u and ((ir.get("https_only") and not u.lower().startswith("https://")) or any(s in u for s in ir.get("drop_url_contains", []))):
            x["image_url"], ni = "", ni + 1
    if ni:
        report.append(f"pictures: dropped {ni} unsuitable image URL(s)")
    # ---- 4. websites
    rules = DEC["website_rules"]
    always = {nrm(u) for u in rules.get("always_include_urls", [])}
    before = len(data.get("websites") or [])
    data["websites"] = [w for w in data.get("websites") or [] if website_ok(w, rules, always)]
    if before != len(data["websites"]):
        report.append(f"websites: kept {len(data['websites'])} of {before}")
    # defunct sites (dead, hijacked, for sale, taken over by spam ...) stay in the atlas as skeleton fish: flagged, titled by their owner, linked to the archive copy only
    org_name = {o["id"]: o["name"] for o in data["orgs"]}
    nd = 0
    for w in data["websites"]:
        st = str(w.pop("status", "") or "")
        wb = w.pop("wayback_url", None)
        if st in rules["defunct_status"]:
            w["defunct"], w["why"], nd = True, st, nd + 1
            if wb:
                w["archive"] = wb
            if str(w.get("title") or "").lower().startswith("(spam)"):                   # a spam takeover's own title is advertising: use the real owner's name
                w["title"] = org_name.get(w.get("org_id")) or re.sub(r"^\(spam\)\s*", "", w["title"], flags=re.I)
    if nd:
        report.append(f"websites: {nd} defunct site(s) kept as skeleton fish")
    # ---- 4b. social media groups and communities (cottages)
    sr = DEC["social_rules"]
    groups = []
    for s_ in data.get("social") or []:
        if s_.get("account_type") not in sr["account_types"] or str(s_.get("status") or "") in sr["drop_status"] or not str(s_.get("display_name") or "").strip():
            continue
        if s_.get("org_id") in gone:
            continue
        g = dict(id=s_["id"], platform=s_["platform"], kind=s_["account_type"], name=s_["display_name"].strip())
        if s_.get("url"):
            g["url"] = s_["url"]
        if s_.get("member_count") is not None:
            g["members"] = s_["member_count"]
        if s_.get("org_id") is not None:
            g["org_id"] = s_["org_id"]
        if s_.get("is_private"):
            g["private"] = True
        bio = str(s_.get("bio") or "").strip()
        if bio:
            g["where" if s_["platform"] == "meetup" else "about"] = bio
        groups.append(g)
    data["groups"] = groups
    if groups:
        report.append(f"social groups: {len(groups)} cottage(s)")
    # ---- 5. drift guard for the id-keyed constants in the makers
    drift = []
    org_name = {o["id"]: o["name"] for o in data["orgs"]}
    per_name = {p["id"]: p["name"] for p in data["people"]}
    for kind, names_by_id in (("org", org_name), ("person", per_name)):
        for sid, want in DEC["expected_names"][kind].items():
            have = names_by_id.get(int(sid))
            if have is None or not (tokens(want) & tokens(have)):
                drift.append(f"{kind} {sid}: expected '{want}', found {have!r}")
    return data, report, drift


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    data, report, drift = apply(json.load(open(src, encoding="utf-8")))
    for line in report:
        print("decisions:", line, file=sys.stderr)
    if drift and not os.environ.get("ATLAS_ALLOW_DRIFT"):
        print("DECISION DRIFT: an id used by the makers now points at a different record. Update atlas/decisions.json and the constants.", file=sys.stderr)
        for d in drift:
            print("  ", d, file=sys.stderr)
        sys.exit(2)
    json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
