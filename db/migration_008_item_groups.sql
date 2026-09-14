-- Migration 008: Add to Group (Item Groups)
-- Run in Neon SQL Editor after migrations 002-007. Safe to re-run.

CREATE TABLE IF NOT EXISTS item_groups (
    group_id    SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL UNIQUE,
    message     VARCHAR(200),
    group_type  VARCHAR(20) NOT NULL DEFAULT 'ITEM_GROUP', -- 'ITEM_GROUP' | 'MIX_MATCH'
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS item_group_members (
    member_id  SERIAL PRIMARY KEY,
    group_id   INTEGER NOT NULL REFERENCES item_groups(group_id) ON DELETE CASCADE,
    item_id    INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    UNIQUE (group_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_item_group_members_group_id ON item_group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_item_group_members_item_id ON item_group_members (item_id);
