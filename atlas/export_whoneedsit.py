"""Pull people + orgs from the whoneedsit D1 database via Cloudflare's REST API -> atlas/data/whoneedsit_export.json.

  CF_ACCOUNT_ID=... CF_API_TOKEN=... python atlas/export_whoneedsit.py

Token needs the "D1 Read" permission. Only named public-profile columns are selected: contact fields
(email, phone, contact_other, contact_source) are deliberately never queried. Writes orgs, people, person_profile (view) and relationships.
REST endpoint: POST /accounts/{account_id}/d1/database/{database_id}/query  with {"sql": ..., "params": [...]}.
"""
import json
import os
import urllib.request

ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "PASTE_ACCOUNT_ID")   # prototype: hardcode here if you prefer
API_TOKEN = os.environ.get("CF_API_TOKEN", "PASTE_TOKEN")
DATABASE_ID = os.environ.get("D1_DATABASE_ID", "82c55bae-2ae2-4502-bd8e-1a790ba981c4")  # whoneedsit
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "whoneedsit_export.json")

ORGS_SQL = open(os.path.join(HERE, "sql", "whoneedsit_orgs.sql"), encoding="utf-8").read()
PEOPLE_SQL = open(os.path.join(HERE, "sql", "whoneedsit_people.sql"), encoding="utf-8").read()
PROFILE_SQL = open(os.path.join(HERE, "sql", "whoneedsit_person_profile.sql"), encoding="utf-8").read()
RELATIONSHIPS_SQL = open(os.path.join(HERE, "sql", "whoneedsit_relationships.sql"), encoding="utf-8").read()


def query(sql):
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query"
    req = urllib.request.Request(url, data=json.dumps({"sql": sql}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_TOKEN}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.load(resp)
    if not body.get("success"):
        raise RuntimeError(body.get("errors"))
    return body["result"][0]["results"]


if __name__ == "__main__":
    orgs, people = query(ORGS_SQL), query(PEOPLE_SQL)
    profiles, relationships = query(PROFILE_SQL), query(RELATIONSHIPS_SQL)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(dict(orgs=orgs, people=people, person_profile=profiles, relationships=relationships),
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{OUT}: {len(orgs)} orgs, {len(people)} people ({sum(p['org'] is not None for p in people)} with an org), "
          f"{len(profiles)} profiles, {len(relationships)} relationships")
