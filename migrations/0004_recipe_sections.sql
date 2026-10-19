-- Optional sections for a full weekly menu: night-before, prep, timed cook steps, and notes.

ALTER TABLE recipes ADD COLUMN covers_nights INTEGER;
ALTER TABLE recipes ADD COLUMN night_before_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE recipes ADD COLUMN prep_steps_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE recipes ADD COLUMN cook_steps_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE recipes ADD COLUMN kids_plates TEXT;
ALTER TABLE recipes ADD COLUMN reheating TEXT;
ALTER TABLE recipes ADD COLUMN external_id TEXT;

CREATE UNIQUE INDEX idx_recipes_external_id ON recipes (external_id);
