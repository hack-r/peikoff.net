-- Active orgs (buildings). Shared by export_whoneedsit.py and export_whoneedsit.R
SELECT id, name, short_name AS short, category FROM orgs
WHERE name NOT LIKE 'Test Org%'
ORDER BY id
