-- Migration 003: Price Change Log
-- Run this in the Neon SQL Editor AFTER migration_002_item_master.sql.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS price_change_log (
    log_id        SERIAL PRIMARY KEY,
    item_id       INTEGER REFERENCES items(item_id),
    sku           VARCHAR(30),
    item_name     VARCHAR(200),
    size          VARCHAR(30),
    pack          VARCHAR(30),
    change_type   VARCHAR(20) NOT NULL, -- 'New Item' | 'Price Change' | 'Sale Price'
    old_price     NUMERIC(10,2),
    new_price     NUMERIC(10,2),
    changed_by    VARCHAR(120),          -- employee name/role, if available
    changed_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_change_log_changed_at ON price_change_log (changed_at);
CREATE INDEX IF NOT EXISTS idx_price_change_log_item_id ON price_change_log (item_id);
