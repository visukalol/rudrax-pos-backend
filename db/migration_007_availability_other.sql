-- Migration 007: Availability tab + Other tab
-- Run in Neon SQL Editor after migrations 002-006. Safe to re-run.

-- Availability: weekly hours grid (Sun-Sat), matching the PDF's Item Hours panel.
-- One row per day per item; day_of_week 0=Sunday .. 6=Saturday.
CREATE TABLE IF NOT EXISTS item_availability_hours (
    hours_id    SERIAL PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time  TIME NOT NULL DEFAULT '00:00',
    end_time    TIME NOT NULL DEFAULT '23:59',
    UNIQUE (item_id, day_of_week)
);

-- Availability: special date-range overrides (holidays, temporary blocks, etc.)
CREATE TABLE IF NOT EXISTS item_special_hours (
    special_hours_id SERIAL PRIMARY KEY,
    item_id          INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    is_available     BOOLEAN NOT NULL DEFAULT TRUE,
    note             VARCHAR(200),
    created_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_availability_hours_item_id ON item_availability_hours (item_id);
CREATE INDEX IF NOT EXISTS idx_item_special_hours_item_id ON item_special_hours (item_id);

-- Other tab (no PDF reference screen was provided for this one - see the
-- app's Other tab for the assumption made: Notes, Favourite, Print Label
-- Copies, External Reference Code).
ALTER TABLE items ADD COLUMN IF NOT EXISTS notes               TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_favourite        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS print_label_copies  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE items ADD COLUMN IF NOT EXISTS external_ref_code   VARCHAR(60);
