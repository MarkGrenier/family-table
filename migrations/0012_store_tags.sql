-- Custom store names. Existing item rows keep a null tag and their current store.
ALTER TABLE items ADD COLUMN store_tag TEXT;

CREATE TABLE custom_stores (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  created_at TEXT NOT NULL
);
