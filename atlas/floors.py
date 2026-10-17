"""Floors of the Ayn Rand Institute building: Leonard Peikoff and Ayn Rand alone on the top floor, everyone else below them,
ordered vertically by seniority (most senior highest).

  python atlas/floors.py [whoneedsit.json]      (post-processes the viewer file in place; both makers run it last)

Seniority is a guess from the Role-at-org and Title text on each card: rules in atlas/decisions.json > floors > rules (a regex and a
score; the best match wins), minus a penalty for former / deceased / retired. Ties break by person id. People are spread evenly over
the floors below the top one; x, y and heading are left alone. Idempotent. Adds `exclusive_top` = {building id: [person ids]}
so the viewer keeps everybody else off that floor when a walker visits.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "decisions.json"), encoding="utf-8"))["floors"]
RULES = [(re.compile(p, re.I), s) for p, s in CFG["rules"]]
PENALTY = re.compile(CFG["penalty_pattern"], re.I)


def seniority(meta):
    text = f"{meta.get('Role at org') or ''} | {meta.get('Title') or ''}"
    score = max([s for rx, s in RULES if rx.search(text)] or [CFG["default"]])
    return score - (CFG["penalty"] if PENALTY.search(text) else 0)


def assign(city):
    bi = next((b["id"] for b in city["buildings"] if b["org_id"] == CFG["org"]), None)
    if bi is None or city["buildings"][bi]["floors"] < 2:
        return city
    floors = city["buildings"][bi]["floors"]
    top = [f"P{i}" for i in CFG["top_floor_people"] if f"P{i}" in city["ids"]]
    ks = [k for k, p in enumerate(city["people"]) if p[3] == 1 and p[5] == bi]
    rest = sorted((k for k in ks if city["ids"][k] not in top), key=lambda k: (-seniority(city["meta"][city["ids"][k]]), int(city["ids"][k][1:])))
    for k in ks:
        if city["ids"][k] in top:
            city["people"][k][2] = round((floors - 1) * city["floor_h"], 2)
    low = floors - 1                                    # floors 0 .. floors-2 hold everybody else
    for r, k in enumerate(rest):
        city["people"][k][2] = round((low - 1 - r * low // len(rest)) * city["floor_h"], 2)
    city["exclusive_top"] = {str(bi): top}
    return city


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "public", "atlas", "data", "whoneedsit.json")
    json.dump(assign(json.load(open(path, encoding="utf-8"))), open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
