-- Remember product barcodes on the list and on staples.
-- Older rows stay, with no barcode, until someone scans them.

ALTER TABLE items ADD COLUMN barcode TEXT;
ALTER TABLE staples ADD COLUMN barcode TEXT;

CREATE INDEX idx_items_barcode ON items(barcode);
CREATE UNIQUE INDEX idx_staples_barcode ON staples(barcode) WHERE barcode IS NOT NULL;
