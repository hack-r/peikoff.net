-- D1 table for businesses owned by Objectivists that are not in the business of Objectivism (not drawn in the Atlas).
-- Moved out of `orgs` the same way `non_objectivist_orgs` holds general universities; atlas/decisions.json > exclude_orgs
-- keeps them out of the city by name even if a refresh puts them back into `orgs`.
CREATE TABLE IF NOT EXISTS objectivist_businesses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT,
  category TEXT,
  former_org_id INTEGER,
  note TEXT
);
INSERT INTO objectivist_businesses (name, short_name, category, former_org_id)
SELECT name, short_name, category, id FROM orgs WHERE id = 112 AND name = 'Alexa Real Estate'
  AND NOT EXISTS (SELECT 1 FROM objectivist_businesses WHERE name = 'Alexa Real Estate');
DELETE FROM orgs WHERE id = 112 AND name = 'Alexa Real Estate';
