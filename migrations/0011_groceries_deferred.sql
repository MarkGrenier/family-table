-- 1 when a meal was planned outside the grocery window and has not been shopped yet.
-- Existing rows stay 0, so a deploy does not add groceries for meals already on the calendar.
ALTER TABLE plan_entries ADD COLUMN groceries_deferred INTEGER NOT NULL DEFAULT 0;
