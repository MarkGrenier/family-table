-- Extra dinners kept on a day that already has one. Empty for every existing row.
ALTER TABLE plan_entries ADD COLUMN also_json TEXT NOT NULL DEFAULT '[]';
