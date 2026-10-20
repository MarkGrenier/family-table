-- Mealime-style groceries, cookware, cooked days, and feedback.
-- Older columns and tables stay as they are.

ALTER TABLE items ADD COLUMN section TEXT;
ALTER TABLE items ADD COLUMN image_url TEXT;
ALTER TABLE items ADD COLUMN substitute TEXT;
ALTER TABLE items ADD COLUMN notes TEXT;

ALTER TABLE recipes ADD COLUMN cookware_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE recipe_made (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  made_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_recipe_made_recipe ON recipe_made (recipe_id, made_on);

CREATE TABLE recipe_feedback (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  stars INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  CHECK (stars >= 1 AND stars <= 5)
);

CREATE INDEX idx_recipe_feedback_recipe ON recipe_feedback (recipe_id, created_at);
