-- PROPOSED, not run on D1. Moves Alexa Real Estate (orgs.id 112) into non_objectivist_orgs, keeping the same id like the universities did.
INSERT INTO non_objectivist_orgs (id, name, short_name, description, url, url2, category, active, created_at, email, phone, contact_form_url, contact_other, reason)
SELECT id, name, short_name, description, url, url2, category, active, created_at, email, phone, contact_form_url, contact_other,
       'Objectivist-owned business outside the business of Objectivism'
FROM orgs WHERE id = 112 AND name = 'Alexa Real Estate'
  AND NOT EXISTS (SELECT 1 FROM non_objectivist_orgs WHERE id = 112);
DELETE FROM orgs WHERE id = 112 AND name = 'Alexa Real Estate';
