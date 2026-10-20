-- Hide a grocery line without removing it, so Undo can put the same item back.
-- Older migration files stay as they are.

ALTER TABLE items ADD COLUMN deleted_at TEXT;

DROP INDEX IF EXISTS idx_items_open_staple;
CREATE UNIQUE INDEX idx_items_open_staple
  ON items(staple_id)
  WHERE checked = 0 AND staple_id IS NOT NULL AND deleted_at IS NULL;
