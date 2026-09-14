-- Migration 006: Distributors + E-commerce tabs
-- Run in Neon SQL Editor after migrations 002-005. Safe to re-run.

-- Master list of distributors (the dropdown in the Distributors tab).
CREATE TABLE IF NOT EXISTS distributors (
    distributor_id SERIAL PRIMARY KEY,
    name           VARCHAR(120) NOT NULL UNIQUE
);

-- Per-item links to distributors: product code, purchase cost, min order qty,
-- running qty/last cost, and which one is "Primary" (drives the list screen's
-- Dist. Name column - see note below).
CREATE TABLE IF NOT EXISTS item_distributors (
    item_distributor_id      SERIAL PRIMARY KEY,
    item_id                  INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    distributor_id           INTEGER NOT NULL REFERENCES distributors(distributor_id),
    distributor_product_code VARCHAR(60),
    purchase_cost            NUMERIC(10,2) NOT NULL DEFAULT 0,
    min_order_qty            INTEGER NOT NULL DEFAULT 0,
    qty                      INTEGER NOT NULL DEFAULT 0,
    last_cost                NUMERIC(10,2),
    is_primary               BOOLEAN NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (item_id, distributor_id)
);

CREATE INDEX IF NOT EXISTS idx_item_distributors_item_id ON item_distributors (item_id);

-- E-commerce channel pricing (e.g. Doordash: add a flat amount to retail
-- price, or override it outright). One row per item+channel; this pass
-- only surfaces "Doordash" in the UI, but the table supports more channels
-- later without another migration.
CREATE TABLE IF NOT EXISTS item_ecommerce_channels (
    channel_row_id   SERIAL PRIMARY KEY,
    item_id          INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    channel_name     VARCHAR(60) NOT NULL DEFAULT 'Doordash',
    add_amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
    override_price   BOOLEAN NOT NULL DEFAULT FALSE,
    override_amount  NUMERIC(10,2),
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (item_id, channel_name)
);
