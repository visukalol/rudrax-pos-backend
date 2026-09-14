-- Migration 002: Item Master screen support
-- Run this in the Neon SQL Editor AFTER schema.sql has already been applied.
-- Safe to re-run (uses IF NOT EXISTS everywhere).

-- 1. Sub-categories (Category -> Sub Category, per "Sub category Add Item" screen)
CREATE TABLE IF NOT EXISTS sub_categories (
    sub_category_id SERIAL PRIMARY KEY,
    category_id     INTEGER NOT NULL REFERENCES categories(category_id),
    name            VARCHAR(120) NOT NULL
);

-- 2. New columns on items to support the Item Master "General" tab + list screen.
--    NOTE: dist_name and item_brand are kept as plain text for this pass rather
--    than full lookup tables (distributors / brands) -- those become real tables
--    when we build the Distributors and E-commerce tabs.
ALTER TABLE items ADD COLUMN IF NOT EXISTS sub_category_id      INTEGER REFERENCES sub_categories(sub_category_id);
ALTER TABLE items ADD COLUMN IF NOT EXISTS item_brand           VARCHAR(120);
ALTER TABLE items ADD COLUMN IF NOT EXISTS scan_data            VARCHAR(50);
ALTER TABLE items ADD COLUMN IF NOT EXISTS dist_name            VARCHAR(120);

-- Item-level age override. NULL = use the department's age_restriction.
ALTER TABLE items ADD COLUMN IF NOT EXISTS item_age_restriction INTEGER;

-- Pricing / quantity flags & values from the General tab
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_open_price        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_open_qty          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_buy_as_case       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS margin_pct           NUMERIC(6,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS markup_pct           NUMERIC(6,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS buydown              NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS case_cost            NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS sale_price           NUMERIC(10,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_qty              INTEGER;
ALTER TABLE items ADD COLUMN IF NOT EXISTS min_warn_qty         INTEGER NOT NULL DEFAULT 0;

-- Right-hand checkbox flags from the General tab
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_deli_plu          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_non_revenue       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_non_discountable  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_negative          BOOLEAN NOT NULL DEFAULT FALSE;

-- Helpful index for the "Starts with" search on the list screen
CREATE INDEX IF NOT EXISTS idx_items_name_lower ON items (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_items_sku_lower  ON items (LOWER(sku));

-- Optional: a couple of sub-categories under your existing seed categories/departments,
-- so the dropdowns aren't empty the first time you open Add Item.
-- Adjust department_id / category names to match what's actually in your DB if these don't apply.
DO $$
DECLARE
  v_cat_id INTEGER;
BEGIN
  -- Only insert demo sub-categories if none exist yet at all.
  IF NOT EXISTS (SELECT 1 FROM sub_categories) THEN
    SELECT category_id INTO v_cat_id FROM categories LIMIT 1;
    IF v_cat_id IS NOT NULL THEN
      INSERT INTO sub_categories (category_id, name) VALUES (v_cat_id, 'General');
    END IF;
  END IF;
END $$;
