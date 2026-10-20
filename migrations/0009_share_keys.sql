-- Share-sheet keys, stored as hashes, and a flag for recipes Chef still needs to finish.
-- Existing recipes stay as they are. needs_review starts off. No keys are filled in here.

ALTER TABLE recipes ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;

CREATE TABLE share_keys (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_share_keys_person ON share_keys(person);
CREATE UNIQUE INDEX idx_share_keys_hash ON share_keys(key_hash);
