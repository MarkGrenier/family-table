-- A hand-added fresh item can name the day to buy it.
-- Empty for everything already on the list. Meal-linked fresh items still use the dinner date.
ALTER TABLE items ADD COLUMN buy_date TEXT;
