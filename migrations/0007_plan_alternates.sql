-- Up to three backup recipes for a planned meal.
-- Existing rows keep their date, meal, recipe, and note. The new column starts empty.

ALTER TABLE plan_entries ADD COLUMN alternates_json TEXT NOT NULL DEFAULT '[]';
