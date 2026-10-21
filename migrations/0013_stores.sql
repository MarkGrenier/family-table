-- One list of stores. Existing grocery rows are not updated.
-- Seeded ids match items.store so current lines keep Costco, the local store, or Amazon.
CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_stores_name ON stores(name);

INSERT INTO stores (id, name, created_at) VALUES
  ('local', 'Local store', '1970-01-01T00:00:00.000Z'),
  ('costco', 'Costco', '1970-01-01T00:00:01.000Z'),
  ('amazon', 'Amazon', '1970-01-01T00:00:02.000Z');

INSERT INTO stores (id, name, created_at)
SELECT name, name, created_at FROM custom_stores
WHERE NOT EXISTS (
  SELECT 1 FROM stores WHERE stores.name = custom_stores.name
);
