-- Names the kitchen usually has. Recipes skip these when they add groceries.
-- The table starts empty.

CREATE TABLE on_hand (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_on_hand_key ON on_hand(name_key);

-- Remember the amount a recipe contributed, so the shopping note can be rebuilt.
ALTER TABLE grocery_sources ADD COLUMN quantity REAL;
ALTER TABLE grocery_sources ADD COLUMN unit TEXT;
