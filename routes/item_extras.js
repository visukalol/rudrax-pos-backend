// backend/routes/item_extras.js
//
// Extra endpoints for the redesigned Add item screen. Kept in its own file so
// the existing routes/items.js does not need to change.
// Mounted in server.js as:  app.use('/api/item-extras', require('./routes/item_extras'));
// Needs migration_010_item_screen_extras.sql to have been run in Neon.

const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

const fail = (res, e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
};

// ---------------------------------------------------------------------------
// Pick lists: sizes, packs, brands, scan data, attributes
// ---------------------------------------------------------------------------
const KINDS = ['size', 'pack', 'brand', 'scan_data', 'attribute'];

// GET /api/item-extras/lookups?kind=size   -> [{ lookup_id, kind, value, parent }]
router.get('/lookups', async (req, res) => {
  const { kind } = req.query;
  try {
    const params = [];
    let sql = 'SELECT lookup_id, kind, value, parent FROM lookup_values';
    if (kind) {
      params.push(kind);
      sql += ' WHERE kind = $1';
    }
    sql += ' ORDER BY kind, parent NULLS FIRST, lookup_id';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
});

// POST /api/item-extras/lookups  { kind, value, parent? }  -> the row (new or existing)
router.post('/lookups', async (req, res) => {
  const { kind, value, parent } = req.body;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` });
  if (!value || !String(value).trim()) return res.status(400).json({ error: 'value is required' });
  try {
    await pool.query(
      'INSERT INTO lookup_values (kind, value, parent) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [kind, String(value).trim(), parent || null]
    );
    const { rows } = await pool.query(
      `SELECT lookup_id, kind, value, parent FROM lookup_values
        WHERE kind = $1 AND value = $2 AND COALESCE(parent, '') = COALESCE($3, '')`,
      [kind, String(value).trim(), parent || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Item extras: attributes + "Show in dialog at checkout"
// ---------------------------------------------------------------------------
router.get('/items/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT product_attribute, parent_attribute, show_pack_dialog FROM items WHERE item_id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

router.put('/items/:id', async (req, res) => {
  const { productAttribute, parentAttribute, showPackDialog } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE items
          SET product_attribute = $2,
              parent_attribute  = $3,
              show_pack_dialog  = $4
        WHERE item_id = $1
        RETURNING item_id, product_attribute, parent_attribute, show_pack_dialog`,
      [req.params.id, productAttribute || null, parentAttribute || null, !!showPackDialog]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Price level Active toggle
// ---------------------------------------------------------------------------
router.put('/price-levels/:id/active', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE item_price_levels SET is_active = $2 WHERE price_level_id = $1 RETURNING *',
      [req.params.id, req.body.isActive !== false]
    );
    if (!rows.length) return res.status(404).json({ error: 'Price level not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Special hours: time window for a date range
// ---------------------------------------------------------------------------
router.put('/special-hours/:id/times', async (req, res) => {
  const { startTime, endTime } = req.body; // 'HH:MM' or 'HH:MM:SS'
  try {
    const { rows } = await pool.query(
      'UPDATE item_special_hours SET start_time = $2, end_time = $3 WHERE special_hours_id = $1 RETURNING *',
      [req.params.id, startTime || null, endTime || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Special hours not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// GET /api/item-extras/items/:id/special-hours -> rows including the times
router.get('/items/:id/special-hours', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM item_special_hours WHERE item_id = $1 ORDER BY start_date, special_hours_id',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Department defaults + category product attributes
// ---------------------------------------------------------------------------
router.put('/departments/:id', async (req, res) => {
  const b = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE departments SET
          age_restriction         = $2,
          is_non_taxable_override = $3,
          allow_ebt               = $4,
          pricing_method          = $5,
          pricing_value_pct       = $6,
          surcharge               = $7,
          flags                   = $8,
          product_attributes      = $9,
          weekly_hours            = $10
        WHERE department_id = $1
        RETURNING *`,
      [
        req.params.id,
        b.ageRestriction ?? null,
        !!b.isNonTaxable,
        !!b.allowEbt,
        b.pricingMethod || null,
        b.pricingValuePct ?? null,
        b.surcharge ?? null,
        Array.isArray(b.flags) ? b.flags.join(',') : (b.flags || null),
        b.productAttributes || null,
        b.weeklyHours ? JSON.stringify(b.weeklyHours) : null,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Department not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE categories SET product_attributes = $2 WHERE category_id = $1 RETURNING *',
      [req.params.id, req.body.productAttributes || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Category not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Store-wide sales (Special pricing "Existing sale" dropdown)
// ---------------------------------------------------------------------------
router.get('/sales-events', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM sales_events ORDER BY start_date NULLS LAST, name');
    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
});

router.post('/sales-events', async (req, res) => {
  const { name, startDate, endDate } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO sales_events (name, start_date, end_date) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
       RETURNING *`,
      [String(name).trim(), startDate || null, endDate || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Department management screen (migration 011)
// ---------------------------------------------------------------------------

// GET /api/item-extras/departments -> every department with its item count
router.get('/departments', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, COUNT(i.item_id)::int AS item_count
         FROM departments d
         LEFT JOIN items i ON i.department_id = d.department_id AND i.is_active = TRUE
        GROUP BY d.department_id
        ORDER BY d.name`
    );
    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
});

// PUT /api/item-extras/departments/:id/basic  { name, taxPct, isActive }
router.put('/departments/:id/basic', async (req, res) => {
  const { name, taxPct, isActive } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE departments SET name = $2, tax_pct = $3, is_active = $4
        WHERE department_id = $1 RETURNING *`,
      [req.params.id, String(name).trim(), taxPct ?? 0, isActive !== false]
    );
    if (!rows.length) return res.status(404).json({ error: 'Department not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Item groups screen (migration 011)
// ---------------------------------------------------------------------------

// GET /api/item-extras/groups -> every group with its item count
router.get('/groups', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, COUNT(m.item_id)::int AS item_count
         FROM item_groups g
         LEFT JOIN item_group_members m ON m.group_id = g.group_id
        GROUP BY g.group_id
        ORDER BY g.name`
    );
    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
});

// GET /api/item-extras/groups/:id/items -> [item_id, ...]
router.get('/groups/:id/items', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT item_id FROM item_group_members WHERE group_id = $1', [req.params.id]);
    res.json(rows.map((r) => r.item_id));
  } catch (e) {
    fail(res, e);
  }
});

const groupValues = (b) => [
  String(b.name || '').trim(),
  b.message || null,
  b.groupType === 'MIX_MATCH' ? 'MIX_MATCH' : 'ITEM_GROUP',
  b.ageRestriction ?? null,
  !!b.isFavourite,
  b.isActive !== false,
];

// POST /api/item-extras/groups  { name, message, groupType, ageRestriction, isFavourite, isActive }
router.post('/groups', async (req, res) => {
  if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ error: 'Group name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO item_groups (name, message, group_type, age_restriction, is_favourite, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      groupValues(req.body)
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'A group with that name already exists' });
    fail(res, e);
  }
});

// PUT /api/item-extras/groups/:id  (same body as POST)
router.put('/groups/:id', async (req, res) => {
  if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ error: 'Group name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE item_groups SET name = $2, message = $3, group_type = $4,
              age_restriction = $5, is_favourite = $6, is_active = $7
        WHERE group_id = $1 RETURNING *`,
      [req.params.id, ...groupValues(req.body)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Group not found' });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'A group with that name already exists' });
    fail(res, e);
  }
});

// PUT /api/item-extras/groups/:id/members  { itemIds: [1, 2, 3] }  -> replaces the members
router.put('/groups/:id/members', async (req, res) => {
  const ids = Array.isArray(req.body.itemIds) ? req.body.itemIds.map(Number).filter(Boolean) : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM item_group_members WHERE group_id = $1', [req.params.id]);
    for (const itemId of ids) {
      await client.query(
        'INSERT INTO item_group_members (group_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.id, itemId]
      );
    }
    await client.query('COMMIT');
    res.json({ groupId: Number(req.params.id), itemCount: ids.length });
  } catch (e) {
    await client.query('ROLLBACK');
    fail(res, e);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Item history screen
// GET /api/item-extras/items/:id/history?period=month|week|day&range=12
// -> { item, summary, buckets: [{start, qty}], priceChanges, transactions, purchases }
// The sale time column is read from sales_transactions via to_jsonb so it
// works whether the column is transaction_date, created_at or sale_date.
// ---------------------------------------------------------------------------
const SALES_CTE = `
  WITH s AS (
    SELECT sti.qty::numeric AS qty,
           sti.unit_price,
           t.transaction_id,
           t.pos_order_id,
           COALESCE((to_jsonb(t)->>'transaction_date')::timestamptz,
                    (to_jsonb(t)->>'created_at')::timestamptz,
                    (to_jsonb(t)->>'sale_date')::timestamptz) AS ts,
           COALESCE((to_jsonb(t)->>'is_return')::boolean, false) AS is_return
      FROM sales_transaction_items sti
      JOIN sales_transactions t ON t.transaction_id = sti.transaction_id
     WHERE sti.item_id = $1
  )`;

router.get('/items/:id/history', async (req, res) => {
  const id = Number(req.params.id);
  const period = ['month', 'week', 'day'].includes(req.query.period) ? req.query.period : 'month';
  const range = Math.min(Math.max(parseInt(req.query.range, 10) || (period === 'day' ? 15 : 12), 1), 60);
  try {
    const item = (await pool.query('SELECT item_id, sku, name, qty_on_hand FROM items WHERE item_id = $1', [id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const buckets = (await pool.query(
      `${SALES_CTE},
       b AS (
         SELECT generate_series(
                  date_trunc($2::text, now()) - ($3::int - 1) * ('1 ' || $2::text)::interval,
                  date_trunc($2::text, now()),
                  ('1 ' || $2::text)::interval) AS start
       )
       SELECT b.start, COALESCE(SUM(s.qty), 0)::int AS qty
         FROM b
         LEFT JOIN s ON NOT s.is_return AND s.ts >= b.start AND s.ts < b.start + ('1 ' || $2::text)::interval
        GROUP BY b.start
        ORDER BY b.start`,
      [id, period, range]
    )).rows;

    const total = (await pool.query(
      `${SALES_CTE} SELECT COALESCE(SUM(qty), 0)::int AS total FROM s WHERE NOT is_return`, [id]
    )).rows[0].total;

    const last = (await pool.query(
      `${SALES_CTE} SELECT qty::int AS qty, ts FROM s WHERE NOT is_return ORDER BY ts DESC NULLS LAST LIMIT 1`, [id]
    )).rows[0];

    const transactions = (await pool.query(
      `${SALES_CTE} SELECT transaction_id, pos_order_id, ts, qty::int AS qty, unit_price, is_return
                    FROM s ORDER BY ts DESC NULLS LAST LIMIT 200`, [id]
    )).rows;

    let priceChanges = [];
    try {
      priceChanges = (await pool.query(
        'SELECT * FROM price_change_log WHERE item_id = $1 ORDER BY changed_at DESC LIMIT 200', [id]
      )).rows;
    } catch (_) { /* price_change_log not created (migration 003) */ }

    res.json({
      item,
      summary: {
        lastSoldQty: last ? last.qty : null,
        lastSoldDate: last ? last.ts : null,
        totalSoldQty: total,
        qtyOnHand: item.qty_on_hand,
        lastPurchaseQty: null,   // no purchase / receiving table yet
        lastPurchaseDate: null,
      },
      buckets,
      priceChanges,
      transactions,
      purchases: [],
    });
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Quick change (Item catalog)
// Price and qty of the base item go through the existing
// PATCH /api/items/:id/quick-change (so the price log is kept);
// these two cover what that route doesn't: base cost, and split packs.
// ---------------------------------------------------------------------------

// PUT /api/item-extras/items/:id/cost  { unitCost }
router.put('/items/:id/cost', async (req, res) => {
  const cost = Number(req.body.unitCost);
  if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'unitCost must be a number' });
  try {
    const { rows } = await pool.query(
      'UPDATE items SET unit_cost = $2 WHERE item_id = $1 RETURNING item_id, unit_cost', [req.params.id, cost]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// PUT /api/item-extras/packs/:id  { cost, price, qtyOnHand }  -> margin / markup recalculated
router.put('/packs/:id', async (req, res) => {
  const cost = Number(req.body.cost);
  const price = Number(req.body.price);
  const qty = parseInt(req.body.qtyOnHand, 10);
  if (![cost, price].every(Number.isFinite) || !Number.isFinite(qty)) {
    return res.status(400).json({ error: 'cost, price and qtyOnHand are required numbers' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE item_packs
          SET cost = $2,
              price = $3,
              qty_on_hand = $4,
              margin_pct = CASE WHEN $3 > 0 THEN ROUND((($3 - ($2 - buydown)) / $3 * 100)::numeric, 2) END,
              markup_pct = CASE WHEN ($2 - buydown) > 0 THEN ROUND((($3 - ($2 - buydown)) / ($2 - buydown) * 100)::numeric, 2) END
        WHERE pack_id = $1
        RETURNING *`,
      [req.params.id, cost, price, qty]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pack not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

module.exports = router;
