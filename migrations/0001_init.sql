-- Empty list. Example items live in seed.sql and are not part of this file.

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  quantity_note TEXT,
  store TEXT NOT NULL,
  category TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  brand TEXT,
  asin TEXT,
  staple INTEGER NOT NULL DEFAULT 0,
  staple_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(name)) > 0),
  CHECK (checked IN (0, 1)),
  CHECK (staple IN (0, 1)),
  CHECK (
    (store = 'costco' AND category IN ('shelf', 'refrigerated', 'frozen')) OR
    (store = 'local' AND category IN ('produce', 'shelf', 'refrigerated', 'frozen')) OR
    (store = 'amazon' AND category = 'general')
  )
);

CREATE TABLE staples (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  store TEXT NOT NULL,
  category TEXT NOT NULL,
  brand TEXT,
  asin TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(name)) > 0),
  CHECK (
    (store = 'costco' AND category IN ('shelf', 'refrigerated', 'frozen')) OR
    (store = 'local' AND category IN ('produce', 'shelf', 'refrigerated', 'frozen')) OR
    (store = 'amazon' AND category = 'general')
  )
);

-- One open (not yet bought) line per staple. Bought copies can pile up until cleared.
CREATE UNIQUE INDEX idx_items_open_staple
  ON items(staple_id)
  WHERE checked = 0 AND staple_id IS NOT NULL;

CREATE INDEX idx_items_store ON items(store, checked, created_at);
CREATE INDEX idx_staples_store ON staples(store, name);
