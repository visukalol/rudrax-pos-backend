-- Migration 005: Special Pricing + Tag Along tabs
-- Run in Neon SQL Editor after migrations 002, 003, 004. Safe to re-run.

-- Special Pricing: named promotions on an item (qty break, sale price, min purchase).
CREATE TABLE IF NOT EXISTS item_promotions (
    promotion_id   SERIAL PRIMARY KEY,
    item_id        INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    promotion_name VARCHAR(120) NOT NULL,
    pack           VARCHAR(60),
    quantity       INTEGER NOT NULL DEFAULT 1,
    sale_price     NUMERIC(10,2) NOT NULL DEFAULT 0,
    min_purchase   NUMERIC(10,2) NOT NULL DEFAULT 0,
    min_qty        INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT now()
);

-- Tag Along / Bottle Deposit: one add-on item attached to this item
-- (e.g. a $0.05 bottle deposit that rings up alongside a soda).
-- One per item, per the PDF's single-panel layout (not a list).
CREATE TABLE IF NOT EXISTS item_tag_along (
    tag_along_id     SERIAL PRIMARY KEY,
    item_id          INTEGER NOT NULL UNIQUE REFERENCES items(item_id) ON DELETE CASCADE,
    upc              VARCHAR(30),
    tag_item_name    VARCHAR(200),
    price            NUMERIC(10,2) NOT NULL DEFAULT 0,
    qty              INTEGER NOT NULL DEFAULT 1,
    multiply_by_pack BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_promotions_item_id ON item_promotions (item_id);
