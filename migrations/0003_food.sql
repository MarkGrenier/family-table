-- Family food: recipes, the week plan, and the family calendar.
-- The grocery items table is unchanged.

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  servings INTEGER NOT NULL DEFAULT 4,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  steps_json TEXT NOT NULL DEFAULT '[]',
  total_time TEXT,
  source_url TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_recipes_favorite_name ON recipes (favorite DESC, name);

CREATE TABLE plan_entries (
  id TEXT PRIMARY KEY,
  plan_date TEXT NOT NULL,
  meal TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  recipe_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (plan_date, meal)
);

CREATE INDEX idx_plan_date ON plan_entries (plan_date);

CREATE TABLE family_events (
  id TEXT PRIMARY KEY,
  event_date TEXT NOT NULL,
  event_time TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_events_date ON family_events (event_date);

-- Remembers which recipe or planned meal already contributed to a grocery item,
-- so adding the week's ingredients twice does not stack them.
CREATE TABLE grocery_sources (
  item_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  PRIMARY KEY (item_id, source_key)
);
