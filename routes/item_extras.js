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
    let dept = rows[0];
    // Special hours exceptions (migration 012). Only saved when the screen
    // sends them, so screens that don't show them never wipe them.
    if (Array.isArray(b.specialHours)) {
      const r2 = await pool.query(
        'UPDATE departments SET special_hours = $2 WHERE department_id = $1 RETURNING *',
        [req.params.id, JSON.stringify(b.specialHours)]
      );
      dept = r2.rows[0] || dept;
    }
    res.json(dept);
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

// ---- Group pricing (migration 013) ----------------------------------------
// Copies the group's price (and cost, if set) to every item in the group and
// recalculates margin / markup. Returns how many items changed.
async function applyGroupPrice(db, groupId) {
  let g;
  try {
    g = (await db.query('SELECT group_price, group_cost, price_sync FROM item_groups WHERE group_id = $1', [groupId])).rows[0];
  } catch (e) {
    if (e.code === '42703') return 0; // migration 013 not run yet
    throw e;
  }
  if (!g || !g.price_sync || g.group_price == null) return 0;
  const { rowCount } = await db.query(
    `UPDATE items i
        SET retail_price = $2::numeric,
            unit_cost    = COALESCE($3::numeric, i.unit_cost),
            margin_pct   = CASE WHEN $2::numeric > 0
                             THEN ROUND((($2::numeric - (COALESCE($3::numeric, i.unit_cost) - COALESCE(i.buydown, 0))) / $2::numeric * 100)::numeric, 2)
                             ELSE i.margin_pct END,
            markup_pct   = CASE WHEN (COALESCE($3::numeric, i.unit_cost) - COALESCE(i.buydown, 0)) > 0
                             THEN ROUND((($2::numeric - (COALESCE($3::numeric, i.unit_cost) - COALESCE(i.buydown, 0)))
                                         / (COALESCE($3::numeric, i.unit_cost) - COALESCE(i.buydown, 0)) * 100)::numeric, 2)
                             ELSE i.markup_pct END
       FROM item_group_members m
      WHERE m.group_id = $1 AND m.item_id = i.item_id
        AND (i.retail_price IS DISTINCT FROM $2::numeric
             OR ($3::numeric IS NOT NULL AND i.unit_cost IS DISTINCT FROM $3::numeric))`,
    [groupId, g.group_price, g.group_cost]
  );
  return rowCount;
}

// Saves { priceSync, groupPrice, groupCost } when the body has them.
async function saveGroupPricing(db, groupId, b) {
  if (b.priceSync === undefined) return null;
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  try {
    const { rows } = await db.query(
      `UPDATE item_groups SET price_sync = $2, group_price = $3, group_cost = $4 WHERE group_id = $1 RETURNING *`,
      [groupId, !!b.priceSync, num(b.groupPrice), num(b.groupCost)]
    );
    return rows[0] || null;
  } catch (e) {
    if (e.code === '42703') return null; // migration 013 not run yet
    throw e;
  }
}

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
    const priced = await saveGroupPricing(pool, rows[0].group_id, req.body);
    res.status(201).json(priced || rows[0]);
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
    const priced = await saveGroupPricing(pool, rows[0].group_id, req.body);
    const applied = await applyGroupPrice(pool, rows[0].group_id);
    res.json({ ...(priced || rows[0]), applied });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'A group with that name already exists' });
    fail(res, e);
  }
});

// GET /api/item-extras/items/:id/price-groups -> groups that set this item's price
router.get('/items/:id/price-groups', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.group_id, g.name, g.group_price, g.group_cost
         FROM item_groups g
         JOIN item_group_members m ON m.group_id = g.group_id
        WHERE m.item_id = $1 AND g.price_sync = TRUE AND g.group_price IS NOT NULL
        ORDER BY g.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42703') return res.json([]); // migration 013 not run yet
    fail(res, e);
  }
});

// POST /api/item-extras/items/:id/apply-group-price -> re-applies the price of
// every priced group this item is in (used after adding it to a group).
router.post('/items/:id/apply-group-price', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.group_id FROM item_groups g JOIN item_group_members m ON m.group_id = g.group_id
        WHERE m.item_id = $1 AND g.price_sync = TRUE AND g.group_price IS NOT NULL`,
      [req.params.id]
    );
    let applied = 0;
    for (const r of rows) applied += await applyGroupPrice(pool, r.group_id);
    res.json({ applied });
  } catch (e) {
    if (e.code === '42703') return res.json({ applied: 0 });
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
    // after the commit, so a missing migration can't undo the member change
    const applied = await applyGroupPrice(pool, req.params.id);
    res.json({ groupId: Number(req.params.id), itemCount: ids.length, applied });
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

    let purchases = [];
    try {
      purchases = (await pool.query(
        `SELECT l.line_id, l.qty_units, l.cases, l.units_per_case, l.extra_units, l.unit_cost, l.line_total,
                i.invoice_id, i.invoice_number, i.invoice_date, i.created_at, d.name AS distributor_name
           FROM purchase_invoice_lines l
           JOIN purchase_invoices i ON i.invoice_id = l.invoice_id
           LEFT JOIN distributors d ON d.distributor_id = i.distributor_id
          WHERE l.item_id = $1
          ORDER BY i.invoice_date DESC, i.created_at DESC
          LIMIT 200`, [id]
      )).rows;
    } catch (_) { /* migration 015 not run yet */ }

    res.json({
      item,
      summary: {
        lastSoldQty: last ? last.qty : null,
        lastSoldDate: last ? last.ts : null,
        totalSoldQty: total,
        qtyOnHand: item.qty_on_hand,
        lastPurchaseQty: purchases.length ? purchases[0].qty_units : null,
        lastPurchaseDate: purchases.length ? purchases[0].invoice_date : null,
      },
      buckets,
      priceChanges,
      transactions,
      purchases,
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

// ---------------------------------------------------------------------------
// Item catalog filters: which groups, distributors and online (DoorDash)
// pricing each item has. Each part is read on its own, so a missing table
// just leaves that list empty.
// GET /api/item-extras/filter-meta
//   -> { groups: [{item_id, name}], distributors: [{item_id, name}],
//        ecommerce: [{item_id, channel_name, override_price, add_amount}],
//        lastSold: [{item_id, last_sold}] }   (last sale date, for Dead stock)
// ---------------------------------------------------------------------------
router.get('/filter-meta', async (_req, res) => {
  const out = { groups: [], distributors: [], ecommerce: [], lastSold: [] };
  const parts = [
    ['groups', `SELECT m.item_id, g.name FROM item_group_members m JOIN item_groups g ON g.group_id = m.group_id`],
    ['distributors', `SELECT d.item_id, x.name FROM item_distributors d JOIN distributors x ON x.distributor_id = d.distributor_id`],
    ['ecommerce', `SELECT item_id, channel_name, override_price, add_amount FROM item_ecommerce_channels
                    WHERE override_price = TRUE OR add_amount <> 0`],
    ['lastSold', `SELECT sti.item_id,
                         MAX(COALESCE((to_jsonb(t)->>'transaction_date')::timestamptz,
                                      (to_jsonb(t)->>'created_at')::timestamptz,
                                      (to_jsonb(t)->>'sale_date')::timestamptz)) AS last_sold
                    FROM sales_transaction_items sti
                    JOIN sales_transactions t ON t.transaction_id = sti.transaction_id
                   WHERE NOT COALESCE((to_jsonb(t)->>'is_return')::boolean, false)
                   GROUP BY sti.item_id`],
  ];
  for (const [key, sql] of parts) {
    try {
      out[key] = (await pool.query(sql)).rows;
    } catch (e) {
      console.error(`filter-meta ${key}:`, e.message);
    }
  }
  res.json(out);
});

// ---------------------------------------------------------------------------
// "Manage" lists in Add item (Category / Sub category panels)
// ---------------------------------------------------------------------------

// GET /api/item-extras/categories -> every category with its department and item count
router.get('/categories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, d.name AS department_name, COUNT(i.item_id)::int AS item_count
         FROM categories c
         LEFT JOIN departments d ON d.department_id = c.department_id
         LEFT JOIN items i ON i.category_id = c.category_id AND i.is_active = TRUE
        GROUP BY c.category_id, d.name
        ORDER BY c.name`
    );
    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
});

// PUT /api/item-extras/categories/:id/basic  { name, departmentId }
router.put('/categories/:id/basic', async (req, res) => {
  const { name, departmentId } = req.body;
  if (!name || !String(name).trim() || !departmentId) {
    return res.status(400).json({ error: 'name and departmentId are required' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE categories SET name = $2, department_id = $3 WHERE category_id = $1 RETURNING *',
      [req.params.id, String(name).trim(), departmentId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Category not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// GET /api/item-extras/subcategories -> every sub category with its category, department and item count
router.get('/subcategories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, c.name AS category_name, d.name AS department_name, COUNT(i.item_id)::int AS item_count
         FROM sub_categories s
         LEFT JOIN categories c ON c.category_id = s.category_id
         LEFT JOIN departments d ON d.department_id = c.department_id
         LEFT JOIN items i ON i.sub_category_id = s.sub_category_id AND i.is_active = TRUE
        GROUP BY s.sub_category_id, c.name, d.name
        ORDER BY s.name`
    );
    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
});

// PUT /api/item-extras/subcategories/:id  { name, categoryId }
router.put('/subcategories/:id', async (req, res) => {
  const { name, categoryId } = req.body;
  if (!name || !String(name).trim() || !categoryId) {
    return res.status(400).json({ error: 'name and categoryId are required' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE sub_categories SET name = $2, category_id = $3 WHERE sub_category_id = $1 RETURNING *',
      [req.params.id, String(name).trim(), categoryId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Sub category not found' });
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Delivery reminders (migration 014)
// ---------------------------------------------------------------------------

// GET /api/item-extras/deliveries/schedule
//   -> [{ distributor_id, name, delivery_time, delivery_note, days: [0..6] }]
router.get('/deliveries/schedule', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.distributor_id, d.name, d.delivery_time, d.delivery_note,
              COALESCE(array_agg(dd.day_of_week ORDER BY dd.day_of_week)
                       FILTER (WHERE dd.day_of_week IS NOT NULL), '{}') AS days
         FROM distributors d
         LEFT JOIN distributor_delivery_days dd ON dd.distributor_id = d.distributor_id
        GROUP BY d.distributor_id
        ORDER BY d.name`
    );
    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
});

// PUT /api/item-extras/deliveries/schedule/:distributorId  { days: [1, 4], deliveryTime: '10:00', note }
router.put('/deliveries/schedule/:id', async (req, res) => {
  const days = (Array.isArray(req.body.days) ? req.body.days : [])
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const time = /^\d{1,2}:\d{2}/.test(String(req.body.deliveryTime || '')) ? String(req.body.deliveryTime) : null;
  const note = String(req.body.note || '').trim() || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM distributor_delivery_days WHERE distributor_id = $1', [req.params.id]);
    for (const d of [...new Set(days)]) {
      await client.query('INSERT INTO distributor_delivery_days (distributor_id, day_of_week) VALUES ($1, $2)', [req.params.id, d]);
    }
    await client.query('UPDATE distributors SET delivery_time = $2, delivery_note = $3 WHERE distributor_id = $1', [req.params.id, time, note]);
    await client.query('COMMIT');
    res.json({ distributorId: Number(req.params.id), days, deliveryTime: time, note });
  } catch (e) {
    await client.query('ROLLBACK');
    fail(res, e);
  } finally {
    client.release();
  }
});

// GET /api/item-extras/deliveries/due?date=2026-10-21&dow=3
//   date/dow come from the device so "today" is the store's local day.
//   -> deliveries expected that day that nobody has handled yet
//      (snoozed ones come back once the snooze is over).
router.get('/deliveries/due', async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
  const dow = parseInt(req.query.dow, 10);
  if (!date || !(dow >= 0 && dow <= 6)) return res.status(400).json({ error: 'date (YYYY-MM-DD) and dow (0-6) are required' });
  try {
    const { rows } = await pool.query(
      `SELECT d.distributor_id, d.name, d.delivery_time, d.delivery_note
         FROM distributors d
         JOIN distributor_delivery_days dd ON dd.distributor_id = d.distributor_id AND dd.day_of_week = $2
         LEFT JOIN delivery_reminders r ON r.distributor_id = d.distributor_id AND r.delivery_date = $1::date
        WHERE r.status IS NULL OR (r.status = 'snoozed' AND r.snoozed_until <= now())
        ORDER BY d.delivery_time NULLS LAST, d.name`,
      [date, dow]
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return res.json([]); // migration 014 not run yet
    fail(res, e);
  }
});

// POST /api/item-extras/deliveries/remind
//   { distributorId, date, status: 'received' | 'dismissed' | 'snoozed', snoozeMinutes, actedBy }
router.post('/deliveries/remind', async (req, res) => {
  const b = req.body;
  const status = ['received', 'dismissed', 'snoozed'].includes(b.status) ? b.status : null;
  if (!b.distributorId || !b.date || !status) {
    return res.status(400).json({ error: 'distributorId, date and status are required' });
  }
  const minutes = Math.min(Math.max(parseInt(b.snoozeMinutes, 10) || 60, 5), 24 * 60);
  try {
    const { rows } = await pool.query(
      `INSERT INTO delivery_reminders (distributor_id, delivery_date, status, snoozed_until, acted_by)
       VALUES ($1, $2::date, $3, CASE WHEN $3 = 'snoozed' THEN now() + ($4::int * interval '1 minute') END, $5)
       ON CONFLICT (distributor_id, delivery_date) DO UPDATE
         SET status = EXCLUDED.status, snoozed_until = EXCLUDED.snoozed_until,
             acted_by = EXCLUDED.acted_by, acted_at = now()
       RETURNING *`,
      [b.distributorId, b.date, status, minutes, b.actedBy || null]
    );
    res.json(rows[0]);
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------------------
// Purchase invoices (migration 015)
// ---------------------------------------------------------------------------

// GET /api/item-extras/invoices -> latest invoices with distributor and totals
router.get('/invoices', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, d.name AS distributor_name,
              COUNT(l.line_id)::int AS line_count,
              COALESCE(SUM(l.qty_units), 0)::int AS total_units
         FROM purchase_invoices i
         LEFT JOIN distributors d ON d.distributor_id = i.distributor_id
         LEFT JOIN purchase_invoice_lines l ON l.invoice_id = i.invoice_id
        GROUP BY i.invoice_id, d.name
        ORDER BY i.invoice_date DESC, i.invoice_id DESC
        LIMIT 300`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.status(400).json({ error: 'Run migration_015_purchase_invoices.sql in Neon first' });
    fail(res, e);
  }
});

// GET /api/item-extras/invoices/:id -> { ...invoice, lines: [...] }
router.get('/invoices/:id', async (req, res) => {
  try {
    const head = (await pool.query(
      `SELECT i.*, d.name AS distributor_name FROM purchase_invoices i
         LEFT JOIN distributors d ON d.distributor_id = i.distributor_id WHERE i.invoice_id = $1`, [req.params.id]
    )).rows[0];
    if (!head) return res.status(404).json({ error: 'Invoice not found' });
    const lines = (await pool.query(
      `SELECT l.*, it.name, it.sku FROM purchase_invoice_lines l
         LEFT JOIN items it ON it.item_id = l.item_id
        WHERE l.invoice_id = $1 ORDER BY l.line_id`, [req.params.id]
    )).rows;
    res.json({ ...head, lines });
  } catch (e) {
    fail(res, e);
  }
});

// POST /api/item-extras/invoices
//   { distributorId, invoiceNumber, invoiceDate: 'YYYY-MM-DD', notes, updateCost, createdBy,
//     lines: [{ itemId, cases, unitsPerCase, extraUnits, unitCost }] }
// One transaction: saves the invoice, adds the units to stock and (with
// updateCost) sets each item's cost, recalculating margin / markup.
router.post('/invoices', async (req, res) => {
  const b = req.body;
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const lines = (Array.isArray(b.lines) ? b.lines : [])
    .map((l) => {
      const cases = Math.max(num(l.cases), 0);
      const upc = Math.max(Math.round(num(l.unitsPerCase, 1)), 1);
      const extra = Math.max(Math.round(num(l.extraUnits)), 0);
      const qty = Math.round(cases * upc) + extra;
      const cost = Math.max(num(l.unitCost), 0);
      return { itemId: Number(l.itemId), cases, upc, extra, qty, cost, total: Math.round(qty * cost * 100) / 100 };
    })
    .filter((l) => l.itemId && l.qty > 0);
  const invoiceNumber = String(b.invoiceNumber || '').trim();
  if (!b.distributorId || !invoiceNumber) return res.status(400).json({ error: 'Distributor and invoice number are required' });
  if (!lines.length) return res.status(400).json({ error: 'Add at least one item with a quantity' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.invoiceDate || '')) ? b.invoiceDate : null;
  const total = lines.reduce((s, l) => s + l.total, 0);
  const updateCost = b.updateCost !== false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const head = (await client.query(
      `INSERT INTO purchase_invoices (distributor_id, invoice_number, invoice_date, total_amount, cost_updated, notes, created_by)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7) RETURNING *`,
      [b.distributorId, invoiceNumber, date, total, updateCost, b.notes || null, b.createdBy || null]
    )).rows[0];

    for (const l of lines) {
      const before = (await client.query('SELECT unit_cost, qty_on_hand FROM items WHERE item_id = $1 FOR UPDATE', [l.itemId])).rows[0];
      if (!before) throw Object.assign(new Error(`Item ${l.itemId} not found`), { status: 400 });
      await client.query(
        `INSERT INTO purchase_invoice_lines
           (invoice_id, item_id, cases, units_per_case, extra_units, qty_units, unit_cost, line_total, old_cost, old_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [head.invoice_id, l.itemId, l.cases, l.upc, l.extra, l.qty, l.cost, l.total, before.unit_cost, before.qty_on_hand]
      );
      if (updateCost && l.cost > 0) {
        await client.query(
          `UPDATE items
              SET qty_on_hand = COALESCE(qty_on_hand, 0) + $2,
                  unit_cost   = $3::numeric,
                  margin_pct  = CASE WHEN retail_price > 0
                                  THEN ROUND(((retail_price - ($3::numeric - COALESCE(buydown, 0))) / retail_price * 100)::numeric, 2)
                                  ELSE margin_pct END,
                  markup_pct  = CASE WHEN ($3::numeric - COALESCE(buydown, 0)) > 0
                                  THEN ROUND(((retail_price - ($3::numeric - COALESCE(buydown, 0))) / ($3::numeric - COALESCE(buydown, 0)) * 100)::numeric, 2)
                                  ELSE markup_pct END
            WHERE item_id = $1`,
          [l.itemId, l.qty, l.cost]
        );
      } else {
        await client.query('UPDATE items SET qty_on_hand = COALESCE(qty_on_hand, 0) + $2 WHERE item_id = $1', [l.itemId, l.qty]);
      }
    }
    await client.query('COMMIT');

    // The delivery for that distributor and day counts as received (migration 014; optional).
    try {
      await pool.query(
        `INSERT INTO delivery_reminders (distributor_id, delivery_date, status, acted_by)
         VALUES ($1, $2::date, 'received', $3)
         ON CONFLICT (distributor_id, delivery_date) DO UPDATE SET status = 'received', acted_at = now()`,
        [b.distributorId, head.invoice_date, b.createdBy || null]
      );
    } catch (_) { /* reminders table not there - fine */ }

    res.status(201).json({ ...head, lineCount: lines.length, totalUnits: lines.reduce((s, l) => s + l.qty, 0) });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ error: `Invoice ${invoiceNumber} is already saved for this distributor` });
    if (e.code === '42P01') return res.status(400).json({ error: 'Run migration_015_purchase_invoices.sql in Neon first' });
    if (e.status === 400) return res.status(400).json({ error: e.message });
    fail(res, e);
  } finally {
    client.release();
  }
});

module.exports = router;
