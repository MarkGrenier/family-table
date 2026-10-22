-- 1 when a grocery line should be bought close to the meal (salmon, herbs, and the like).
-- Existing rows stay 0. Fresh ingredients are marked later, through the recipe API.
ALTER TABLE items ADD COLUMN fresh INTEGER NOT NULL DEFAULT 0;
