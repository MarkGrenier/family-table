-- Practice items for trying the list on your computer.
-- This is not applied to the live list. Run: npm run seed

INSERT OR REPLACE INTO staples (
  id, name, store, category, brand, asin, created_at, updated_at
) VALUES
  (
    'staple-oat-milk',
    'Oat milk',
    'costco',
    'refrigerated',
    'Oatly',
    NULL,
    '2026-01-01T12:00:00.000Z',
    '2026-01-01T12:00:00.000Z'
  ),
  (
    'staple-paper-towels',
    'Paper towels',
    'costco',
    'shelf',
    'Kirkland',
    NULL,
    '2026-01-01T12:01:00.000Z',
    '2026-01-01T12:01:00.000Z'
  ),
  (
    'staple-berries',
    'Frozen mixed berries',
    'costco',
    'frozen',
    NULL,
    NULL,
    '2026-01-01T12:02:00.000Z',
    '2026-01-01T12:02:00.000Z'
  ),
  (
    'staple-bananas',
    'Bananas',
    'local',
    'produce',
    NULL,
    NULL,
    '2026-01-01T12:03:00.000Z',
    '2026-01-01T12:03:00.000Z'
  ),
  (
    'staple-coffee',
    'Coffee beans',
    'amazon',
    'general',
    'Lavazza',
    'B0COFFEE01',
    '2026-01-01T12:04:00.000Z',
    '2026-01-01T12:04:00.000Z'
  );

INSERT OR REPLACE INTO items (
  id, name, quantity_note, store, category, checked, brand, asin, staple, staple_id, created_at, updated_at
) VALUES
  (
    'item-oat-milk',
    'Oat milk',
    '2 cartons',
    'costco',
    'refrigerated',
    0,
    'Oatly',
    NULL,
    1,
    'staple-oat-milk',
    '2026-01-02T12:00:00.000Z',
    '2026-01-02T12:00:00.000Z'
  ),
  (
    'item-paper-towels',
    'Paper towels',
    NULL,
    'costco',
    'shelf',
    1,
    'Kirkland',
    NULL,
    1,
    'staple-paper-towels',
    '2026-01-02T12:01:00.000Z',
    '2026-01-02T15:00:00.000Z'
  ),
  (
    'item-olive-oil',
    'Olive oil',
    NULL,
    'costco',
    'shelf',
    0,
    'Kirkland',
    NULL,
    0,
    NULL,
    '2026-01-02T12:06:00.000Z',
    '2026-01-02T12:06:00.000Z'
  ),
  (
    'item-berries',
    'Frozen mixed berries',
    NULL,
    'costco',
    'frozen',
    0,
    NULL,
    NULL,
    1,
    'staple-berries',
    '2026-01-02T12:02:00.000Z',
    '2026-01-02T12:02:00.000Z'
  ),
  (
    'item-bananas',
    'Bananas',
    'a bunch',
    'local',
    'produce',
    0,
    NULL,
    NULL,
    1,
    'staple-bananas',
    '2026-01-02T12:03:00.000Z',
    '2026-01-02T12:03:00.000Z'
  ),
  (
    'item-bread',
    'Sourdough bread',
    NULL,
    'local',
    'shelf',
    0,
    NULL,
    NULL,
    0,
    NULL,
    '2026-01-02T12:04:00.000Z',
    '2026-01-02T12:04:00.000Z'
  ),
  (
    'item-dish-soap',
    'Dish soap',
    NULL,
    'amazon',
    'general',
    0,
    'Seventh Generation',
    'B0DISHSOAP',
    0,
    NULL,
    '2026-01-02T12:05:00.000Z',
    '2026-01-02T12:05:00.000Z'
  );
