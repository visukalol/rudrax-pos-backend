-- Migration 009: Item Return support
-- Run in Neon SQL Editor after migrations 002-008. Safe to re-run.

ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS is_return BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS related_transaction_id INTEGER REFERENCES sales_transactions(transaction_id);

CREATE INDEX IF NOT EXISTS idx_sales_transactions_related ON sales_transactions (related_transaction_id);
