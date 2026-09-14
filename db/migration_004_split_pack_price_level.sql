-- Migration 004: Split-Pack + Price-Level tabs
-- Run in Neon SQL Editor after migrations 002 and 003. Safe to re-run.

-- Split-Pack: alternate packaging for an item (e.g. "Each" vs "Case of 12"),
-- each with its own UPC/cost/price/margin/markup/quantity on hand.
CREATE TABLE IF NOT EXISTS item_packs (
    pack_id     SERIAL PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    pack_name   VARCHAR(120) NOT NULL,
    upc         VARCHAR(30),
    cost        NUMERIC(10,2) NOT NULL DEFAULT 0,
    buydown     NUMERIC(10,2) NOT NULL DEFAULT 0,
    price       NUMERIC(10,2) NOT NULL DEFAULT 0,
    margin_pct  NUMERIC(6,2),
    markup_pct  NUMERIC(6,2),
    qty_on_hand INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- Price-Level: named price tiers for an item (e.g. "Level 1", "Wholesale", "Member").
CREATE TABLE IF NOT EXISTS item_price_levels (
    price_level_id SERIAL PRIMARY KEY,
    item_id        INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    level_name     VARCHAR(60) NOT NULL,
    price          NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_packs_item_id ON item_packs (item_id);
CREATE INDEX IF NOT EXISTS idx_item_price_levels_item_id ON item_price_levels (item_id);
