-- One row per active person with ONE primary org (org 1 if linked to it, else: real roles preferred over article-authorship/grantee links,
-- then better-verified links). Named columns only: contact fields (email, phone, contact_other, contact_source) are never selected.
WITH rel AS (
  SELECT r.person_id, r.org_id, r.relationship_type, r.confidence,
         ROW_NUMBER() OVER (
           PARTITION BY r.person_id
           ORDER BY CASE WHEN r.org_id = 1 THEN 0 ELSE 1 END,   -- any link to org 1 (Ayn Rand Institute) wins
                    CASE WHEN r.relationship_type IN ('TOS Author','TOS Author (republished)','OSI Blog Author','Grantee') THEN 1 ELSE 0 END,
                    CASE r.confidence WHEN 'verified' THEN 0 WHEN 'reported' THEN 1 ELSE 2 END, r.id) AS rn
  FROM relationships r JOIN orgs o ON o.id = r.org_id AND o.active = 1 AND o.name NOT LIKE 'Test Org%'
  WHERE r.person_id IS NOT NULL AND r.org_id IS NOT NULL)
SELECT p.id,
       COALESCE(NULLIF(p.name_full,''), TRIM(p.first_name || ' ' || p.last_name)) AS name,
       SUBSTR(p.title,1,120) AS title, p.birth_year AS born, NULLIF(SUBSTR(p.date_of_death,1,4),'') AS died,
       rel.org_id AS org, rel.relationship_type AS role, rel.confidence AS confidence
FROM people p LEFT JOIN rel ON rel.person_id = p.id AND rel.rn = 1
WHERE p.active = 1
ORDER BY p.id
