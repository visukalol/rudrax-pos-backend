const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

const ITEM_SELECT = `
  SELECT
    i.*,
    d.name  AS department_name,
    d.tax_pct,
    d.age_restriction AS department_age_restriction,
    c.name  AS category_name,
    sc.name AS sub_category_name
  FROM items i
  LEFT JOIN departments    d  ON d.department_id = i.department_id
  LEFT JOIN categories     c  ON c.category_id = i.category_id
  LEFT JOIN sub_categories sc ON sc.sub_category_id = i.sub_category_id
`;

// ---------------------------------------------------------------------------
// GET /api/items                      -> list, for the Item Management table
//   query params:
//     search      - matches name OR sku (contains, case-insensitive)
//     startsWith  - matches name OR sku (starts with, case-insensitive)
//     upc         - exact UPC lookup filter (used by the UPC dropdown filter)
//     departmentId
//     includeInactive=true            -> also return soft-deleted items
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const { search, startsWith, upc, departmentId, includeInactive } = req.query;
  try {
    let query = ITEM_SELECT;
    const where = [];
    const params = [];

    if (!includeInactive) {
      where.push('i.is_active = TRUE');
    }
    if (upc) {
      params.push(upc);
      where.push(`i.item_id IN (SELECT item_id FROM item_upc WHERE upc = $${params.length})`);
    }
    if (startsWith) {
      params.push(`${startsWith}%`);
      where.push(`(i.name ILIKE $${params.length} OR i.sku ILIKE $${params.length})`);
    } else if (search) {
      params.push(`%${search}%`);
      where.push(`(i.name ILIKE $${params.length} OR i.sku ILIKE $${params.length})`);
    }
    if (departmentId) {
      params.push(departmentId);
      where.push(`i.department_id = $${params.length}`);
    }

    if (where.length) query += ' WHERE ' + where.join(' AND ');
    query += ' ORDER BY i.name LIMIT 500';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Price Change Log - list with date range + type filter
// IMPORTANT: declared before "/:id" so "/meta/..." style paths aren't
// swallowed by the ":id" param route.
// ---------------------------------------------------------------------------
router.get('/meta/price-change-log', async (req, res) => {
  const { from, to, type } = req.query;
  try {
    const where = [];
    const params = [];
    if (from) {
      params.push(from);
      where.push(`changed_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`changed_at <= $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`change_type = $${params.length}`);
    }
    let query = 'SELECT * FROM price_change_log';
    if (where.length) query += ' WHERE ' + where.join(' AND ');
    query += ' ORDER BY changed_at DESC LIMIT 500';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/items/upc/:upc  (barcode scan lookup - used by Cash Register)
router.get('/upc/:upc', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${ITEM_SELECT} WHERE i.item_id IN (SELECT item_id FROM item_upc WHERE upc = $1)`,
      [req.params.upc]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found for UPC' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/items/:id/history  -> Item History: qty-sold-by-month + summary stats
router.get('/:id/history', async (req, res) => {
  try {
    const { rows: itemRows } = await pool.query(
      'SELECT item_id, sku, name, qty_on_hand FROM items WHERE item_id = $1',
      [req.params.id]
    );
    if (!itemRows.length) return res.status(404).json({ error: 'Item not found' });
    const item = itemRows[0];

    const { rows: monthly } = await pool.query(
      `SELECT date_trunc('month', st.created_at) AS month, SUM(sti.qty) AS qty_sold
       FROM sales_transaction_items sti
       JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
       WHERE sti.item_id = $1
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 12`,
      [req.params.id]
    );

    const { rows: totals } = await pool.query(
      `SELECT
         COALESCE(SUM(sti.qty), 0) AS total_sold_qty,
         MAX(st.created_at) AS last_sold_date,
         (SELECT sti2.qty FROM sales_transaction_items sti2
            JOIN sales_transactions st2 ON st2.transaction_id = sti2.transaction_id
            WHERE sti2.item_id = $1
            ORDER BY st2.created_at DESC LIMIT 1) AS last_sold_qty
       FROM sales_transaction_items sti
       JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
       WHERE sti.item_id = $1`,
      [req.params.id]
    );

    res.json({
      item,
      monthly: monthly.reverse(), // oldest -> newest, easier to chart left-to-right
      totalSoldQty: Number(totals[0]?.total_sold_qty || 0),
      lastSoldQty: totals[0]?.last_sold_qty ?? null,
      lastSoldDate: totals[0]?.last_sold_date ?? null,
      // No purchasing/receiving module yet in this POC, so these are not tracked.
      lastPurchaseQty: null,
      lastPurchaseDate: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/items/:id   -> single item + its UPC list, for the Edit Item screen
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`${ITEM_SELECT} WHERE i.item_id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    const { rows: upcRows } = await pool.query(
      'SELECT upc_id, upc FROM item_upc WHERE item_id = $1 ORDER BY upc_id',
      [req.params.id]
    );
    res.json({ ...rows[0], upcs: upcRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

function itemFieldsFromBody(body) {
  return {
    sku: body.sku,
    name: body.name,
    departmentId: body.departmentId || null,
    categoryId: body.categoryId || null,
    subCategoryId: body.subCategoryId || null,
    size: body.size || null,
    pack: body.pack || null,
    itemType: body.itemType || 'Standard',
    itemBrand: body.itemBrand || null,
    scanData: body.scanData || null,
    distName: body.distName || null,
    itemAgeRestriction: body.itemAgeRestriction ?? null,
    unitCost: body.unitCost || 0,
    caseCost: body.caseCost || 0,
    buydown: body.buydown || 0,
    marginPct: body.marginPct ?? null,
    markupPct: body.markupPct ?? null,
    retailPrice: body.retailPrice || 0,
    salePrice: body.salePrice ?? null,
    qtyOnHand: body.qtyOnHand ?? 0,
    reorderQty: body.reorderQty || 0,
    maxQty: body.maxQty ?? null,
    minWarnQty: body.minWarnQty || 0,
    isOpenPrice: !!body.isOpenPrice,
    isOpenQty: !!body.isOpenQty,
    isBuyAsCase: !!body.isBuyAsCase,
    isTaxable: body.isTaxable !== false,
    isAgeRestricted: !!body.isAgeRestricted,
    isEbt: !!body.isEbt,
    isDeliPlu: !!body.isDeliPlu,
    isNonRevenue: !!body.isNonRevenue,
    isNonDiscountable: !!body.isNonDiscountable,
    isNegative: !!body.isNegative,
    notes: body.notes || null,
    isFavourite: !!body.isFavourite,
    printLabelCopies: body.printLabelCopies || 1,
    externalRefCode: body.externalRefCode || null,
  };
}

async function logPriceChange(client, { itemId, sku, itemName, size, pack, changeType, oldPrice, newPrice, changedBy }) {
  await client.query(
    `INSERT INTO price_change_log (item_id, sku, item_name, size, pack, change_type, old_price, new_price, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [itemId, sku, itemName, size, pack, changeType, oldPrice, newPrice, changedBy || null]
  );
}

// POST /api/items   (Add Item - General tab)
router.post('/', async (req, res) => {
  const f = itemFieldsFromBody(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO items (
         sku, name, department_id, category_id, sub_category_id, size, pack, item_type,
         item_brand, scan_data, dist_name, item_age_restriction,
         unit_cost, case_cost, buydown, margin_pct, markup_pct,
         retail_price, sale_price, qty_on_hand, reorder_qty, max_qty, min_warn_qty,
         is_open_price, is_open_qty, is_buy_as_case, is_taxable, is_age_restricted, is_ebt,
         is_deli_plu, is_non_revenue, is_non_discountable, is_negative,
         notes, is_favourite, print_label_copies, external_ref_code
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,
         $9,$10,$11,$12,
         $13,$14,$15,$16,$17,
         $18,$19,$20,$21,$22,$23,
         $24,$25,$26,$27,$28,$29,
         $30,$31,$32,$33,
         $34,$35,$36,$37
       ) RETURNING *`,
      [
        f.sku, f.name, f.departmentId, f.categoryId, f.subCategoryId, f.size, f.pack, f.itemType,
        f.itemBrand, f.scanData, f.distName, f.itemAgeRestriction,
        f.unitCost, f.caseCost, f.buydown, f.marginPct, f.markupPct,
        f.retailPrice, f.salePrice, f.qtyOnHand, f.reorderQty, f.maxQty, f.minWarnQty,
        f.isOpenPrice, f.isOpenQty, f.isBuyAsCase, f.isTaxable, f.isAgeRestricted, f.isEbt,
        f.isDeliPlu, f.isNonRevenue, f.isNonDiscountable, f.isNegative,
        f.notes, f.isFavourite, f.printLabelCopies, f.externalRefCode,
      ]
    );
    const item = rows[0];
    if (req.body.upc) {
      await client.query('INSERT INTO item_upc (item_id, upc) VALUES ($1,$2)', [item.item_id, req.body.upc]);
    }
    await logPriceChange(client, {
      itemId: item.item_id, sku: item.sku, itemName: item.name, size: item.size, pack: item.pack,
      changeType: 'New Item', oldPrice: null, newPrice: item.retail_price, changedBy: req.body.changedBy,
    });
    await client.query('COMMIT');
    res.status(201).json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'SKU or UPC already exists' });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// PUT /api/items/:id   (Edit Item - General tab)
router.put('/:id', async (req, res) => {
  const f = itemFieldsFromBody(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: beforeRows } = await client.query(
      'SELECT retail_price, sale_price FROM items WHERE item_id = $1',
      [req.params.id]
    );
    if (!beforeRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }
    const before = beforeRows[0];

    const { rows } = await client.query(
      `UPDATE items SET
         sku=$1, name=$2, department_id=$3, category_id=$4, sub_category_id=$5, size=$6, pack=$7, item_type=$8,
         item_brand=$9, scan_data=$10, dist_name=$11, item_age_restriction=$12,
         unit_cost=$13, case_cost=$14, buydown=$15, margin_pct=$16, markup_pct=$17,
         retail_price=$18, sale_price=$19, qty_on_hand=$20, reorder_qty=$21, max_qty=$22, min_warn_qty=$23,
         is_open_price=$24, is_open_qty=$25, is_buy_as_case=$26, is_taxable=$27, is_age_restricted=$28, is_ebt=$29,
         is_deli_plu=$30, is_non_revenue=$31, is_non_discountable=$32, is_negative=$33,
         notes=$34, is_favourite=$35, print_label_copies=$36, external_ref_code=$37
       WHERE item_id = $38
       RETURNING *`,
      [
        f.sku, f.name, f.departmentId, f.categoryId, f.subCategoryId, f.size, f.pack, f.itemType,
        f.itemBrand, f.scanData, f.distName, f.itemAgeRestriction,
        f.unitCost, f.caseCost, f.buydown, f.marginPct, f.markupPct,
        f.retailPrice, f.salePrice, f.qtyOnHand, f.reorderQty, f.maxQty, f.minWarnQty,
        f.isOpenPrice, f.isOpenQty, f.isBuyAsCase, f.isTaxable, f.isAgeRestricted, f.isEbt,
        f.isDeliPlu, f.isNonRevenue, f.isNonDiscountable, f.isNegative,
        f.notes, f.isFavourite, f.printLabelCopies, f.externalRefCode,
        req.params.id,
      ]
    );
    const item = rows[0];

    if (Number(before.retail_price) !== Number(item.retail_price)) {
      await logPriceChange(client, {
        itemId: item.item_id, sku: item.sku, itemName: item.name, size: item.size, pack: item.pack,
        changeType: 'Price Change', oldPrice: before.retail_price, newPrice: item.retail_price, changedBy: req.body.changedBy,
      });
    }
    const beforeSale = before.sale_price === null ? null : Number(before.sale_price);
    const afterSale = item.sale_price === null ? null : Number(item.sale_price);
    if (beforeSale !== afterSale) {
      await logPriceChange(client, {
        itemId: item.item_id, sku: item.sku, itemName: item.name, size: item.size, pack: item.pack,
        changeType: 'Sale Price', oldPrice: before.sale_price, newPrice: item.sale_price, changedBy: req.body.changedBy,
      });
    }

    await client.query('COMMIT');
    res.json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'SKU already exists' });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/items/:id/quick-change  -> Quick Change: edit just price/qty without the full form
router.patch('/:id/quick-change', async (req, res) => {
  const { retailPrice, qtyOnHand, changedBy } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: beforeRows } = await client.query('SELECT * FROM items WHERE item_id = $1', [req.params.id]);
    if (!beforeRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }
    const before = beforeRows[0];

    const { rows } = await client.query(
      `UPDATE items SET
         retail_price = COALESCE($1, retail_price),
         qty_on_hand  = COALESCE($2, qty_on_hand)
       WHERE item_id = $3
       RETURNING *`,
      [retailPrice ?? null, qtyOnHand ?? null, req.params.id]
    );
    const item = rows[0];

    if (retailPrice != null && Number(before.retail_price) !== Number(item.retail_price)) {
      await logPriceChange(client, {
        itemId: item.item_id, sku: item.sku, itemName: item.name, size: item.size, pack: item.pack,
        changeType: 'Price Change', oldPrice: before.retail_price, newPrice: item.retail_price, changedBy,
      });
    }

    await client.query('COMMIT');
    res.json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/items/:id   (soft delete - keeps sales history intact)
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE items SET is_active = FALSE WHERE item_id = $1 RETURNING item_id',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/items/:id/clone   (CLONE button - copies the item under a new SKU)
router.post('/:id/clone', async (req, res) => {
  const { newSku } = req.body;
  if (!newSku) return res.status(400).json({ error: 'newSku is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO items (
         sku, name, department_id, category_id, sub_category_id, size, pack, item_type,
         item_brand, scan_data, dist_name, item_age_restriction,
         unit_cost, case_cost, buydown, margin_pct, markup_pct,
         retail_price, sale_price, qty_on_hand, reorder_qty, max_qty, min_warn_qty,
         is_open_price, is_open_qty, is_buy_as_case, is_taxable, is_age_restricted, is_ebt,
         is_deli_plu, is_non_revenue, is_non_discountable, is_negative,
         notes, is_favourite, print_label_copies, external_ref_code
       )
       SELECT
         $1, name || ' (Copy)', department_id, category_id, sub_category_id, size, pack, item_type,
         item_brand, scan_data, dist_name, item_age_restriction,
         unit_cost, case_cost, buydown, margin_pct, markup_pct,
         retail_price, sale_price, 0, reorder_qty, max_qty, min_warn_qty,
         is_open_price, is_open_qty, is_buy_as_case, is_taxable, is_age_restricted, is_ebt,
         is_deli_plu, is_non_revenue, is_non_discountable, is_negative,
         notes, is_favourite, print_label_copies, external_ref_code
       FROM items WHERE item_id = $2
       RETURNING *`,
      [newSku, req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source item not found' });
    }
    const item = rows[0];
    await logPriceChange(client, {
      itemId: item.item_id, sku: item.sku, itemName: item.name, size: item.size, pack: item.pack,
      changeType: 'New Item', oldPrice: null, newPrice: item.retail_price, changedBy: req.body.changedBy,
    });
    await client.query('COMMIT');
    res.status(201).json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'That SKU already exists' });
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// UPC management (list screen "Change UPC" + Add Item's UPC List panel)
// ---------------------------------------------------------------------------
router.post('/:id/upc', async (req, res) => {
  const { upc } = req.body;
  if (!upc) return res.status(400).json({ error: 'upc is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO item_upc (item_id, upc) VALUES ($1,$2) RETURNING *',
      [req.params.id, upc]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'UPC already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/upc/:upcId', async (req, res) => {
  try {
    await pool.query('DELETE FROM item_upc WHERE upc_id = $1', [req.params.upcId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Split-Pack (alternate packaging: e.g. "Each" vs "Case of 12", each with its
// own UPC/cost/price/margin/markup/QOH)
// ---------------------------------------------------------------------------
router.get('/:id/packs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM item_packs WHERE item_id = $1 ORDER BY pack_id',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/packs', async (req, res) => {
  const { packName, upc, cost, buydown, price, marginPct, markupPct, qtyOnHand } = req.body;
  if (!packName) return res.status(400).json({ error: 'packName is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO item_packs (item_id, pack_name, upc, cost, buydown, price, margin_pct, markup_pct, qty_on_hand)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, packName, upc || null, cost || 0, buydown || 0, price || 0, marginPct ?? null, markupPct ?? null, qtyOnHand || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'That UPC is already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/packs/:packId', async (req, res) => {
  try {
    await pool.query('DELETE FROM item_packs WHERE pack_id = $1', [req.params.packId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Price-Level (named price tiers per item: "Level 1", "Wholesale", etc.)
// ---------------------------------------------------------------------------
router.get('/:id/price-levels', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM item_price_levels WHERE item_id = $1 ORDER BY price_level_id',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/price-levels', async (req, res) => {
  const { levelName, price } = req.body;
  if (!levelName) return res.status(400).json({ error: 'levelName is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO item_price_levels (item_id, level_name, price) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, levelName, price || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/price-levels/:levelId', async (req, res) => {
  const { levelName, price } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE item_price_levels SET level_name = COALESCE($1, level_name), price = COALESCE($2, price) WHERE price_level_id = $3 RETURNING *',
      [levelName ?? null, price ?? null, req.params.levelId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Price level not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/price-levels/:levelId', async (req, res) => {
  try {
    await pool.query('DELETE FROM item_price_levels WHERE price_level_id = $1', [req.params.levelId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Special Pricing (named promotions: qty break, sale price, min purchase)
// ---------------------------------------------------------------------------
router.get('/:id/promotions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM item_promotions WHERE item_id = $1 ORDER BY promotion_id',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/promotions', async (req, res) => {
  const { promotionName, pack, quantity, salePrice, minPurchase, minQty } = req.body;
  if (!promotionName) return res.status(400).json({ error: 'promotionName is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO item_promotions (item_id, promotion_name, pack, quantity, sale_price, min_purchase, min_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, promotionName, pack || null, quantity || 1, salePrice || 0, minPurchase || 0, minQty || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/promotions/:promotionId', async (req, res) => {
  try {
    await pool.query('DELETE FROM item_promotions WHERE promotion_id = $1', [req.params.promotionId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Tag Along / Bottle Deposit - one add-on record per item (upsert-style)
// ---------------------------------------------------------------------------
router.get('/:id/tag-along', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM item_tag_along WHERE item_id = $1', [req.params.id]);
    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/tag-along', async (req, res) => {
  const { upc, tagItemName, price, qty, multiplyByPack } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO item_tag_along (item_id, upc, tag_item_name, price, qty, multiply_by_pack)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (item_id) DO UPDATE SET
         upc = EXCLUDED.upc,
         tag_item_name = EXCLUDED.tag_item_name,
         price = EXCLUDED.price,
         qty = EXCLUDED.qty,
         multiply_by_pack = EXCLUDED.multiply_by_pack
       RETURNING *`,
      [req.params.id, upc || null, tagItemName || null, price || 0, qty || 1, !!multiplyByPack]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/tag-along', async (req, res) => {
  try {
    await pool.query('DELETE FROM item_tag_along WHERE item_id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Distributors
// ---------------------------------------------------------------------------
router.get('/meta/distributors', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM distributors ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/meta/distributors', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO distributors (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      const { rows } = await pool.query('SELECT * FROM distributors WHERE name = $1', [name]);
      return res.status(200).json(rows[0]);
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/distributors', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT itd.*, d.name AS distributor_name
       FROM item_distributors itd
       JOIN distributors d ON d.distributor_id = itd.distributor_id
       WHERE itd.item_id = $1
       ORDER BY itd.is_primary DESC, itd.item_distributor_id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/distributors', async (req, res) => {
  const { distributorId, distributorProductCode, purchaseCost, minOrderQty } = req.body;
  if (!distributorId) return res.status(400).json({ error: 'distributorId is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query(
      'SELECT 1 FROM item_distributors WHERE item_id = $1',
      [req.params.id]
    );
    const isFirst = existing.length === 0;

    const { rows } = await client.query(
      `INSERT INTO item_distributors (item_id, distributor_id, distributor_product_code, purchase_cost, min_order_qty, last_cost, is_primary)
       VALUES ($1,$2,$3,$4,$5,$4,$6)
       ON CONFLICT (item_id, distributor_id) DO UPDATE SET
         distributor_product_code = EXCLUDED.distributor_product_code,
         purchase_cost = EXCLUDED.purchase_cost,
         min_order_qty = EXCLUDED.min_order_qty,
         last_cost = EXCLUDED.purchase_cost
       RETURNING *`,
      [req.params.id, distributorId, distributorProductCode || null, purchaseCost || 0, minOrderQty || 0, isFirst]
    );
    const link = rows[0];

    if (isFirst) {
      const { rows: distRows } = await client.query('SELECT name FROM distributors WHERE distributor_id = $1', [distributorId]);
      await client.query('UPDATE items SET dist_name = $1 WHERE item_id = $2', [distRows[0]?.name, req.params.id]);
    }

    await client.query('COMMIT');
    res.status(201).json(link);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Mark one distributor link as Primary for this item (drives the list
// screen's "Dist. Name" column) - unsets any other primary on the same item.
router.put('/distributors/:linkId/set-primary', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: linkRows } = await client.query(
      'SELECT item_id, distributor_id FROM item_distributors WHERE item_distributor_id = $1',
      [req.params.linkId]
    );
    if (!linkRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Distributor link not found' });
    }
    const { item_id, distributor_id } = linkRows[0];

    await client.query('UPDATE item_distributors SET is_primary = FALSE WHERE item_id = $1', [item_id]);
    await client.query('UPDATE item_distributors SET is_primary = TRUE WHERE item_distributor_id = $1', [req.params.linkId]);
    const { rows: distRows } = await client.query('SELECT name FROM distributors WHERE distributor_id = $1', [distributor_id]);
    await client.query('UPDATE items SET dist_name = $1 WHERE item_id = $2', [distRows[0]?.name, item_id]);

    await client.query('COMMIT');
    res.json({ updated: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.delete('/distributors/:linkId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: linkRows } = await client.query(
      'SELECT item_id, is_primary FROM item_distributors WHERE item_distributor_id = $1',
      [req.params.linkId]
    );
    if (!linkRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Distributor link not found' });
    }
    const { item_id, is_primary } = linkRows[0];
    await client.query('DELETE FROM item_distributors WHERE item_distributor_id = $1', [req.params.linkId]);

    if (is_primary) {
      // Promote another remaining link to primary if one exists, else clear dist_name.
      const { rows: remaining } = await client.query(
        `SELECT itd.item_distributor_id, d.name
         FROM item_distributors itd JOIN distributors d ON d.distributor_id = itd.distributor_id
         WHERE itd.item_id = $1 ORDER BY itd.item_distributor_id LIMIT 1`,
        [item_id]
      );
      if (remaining.length) {
        await client.query('UPDATE item_distributors SET is_primary = TRUE WHERE item_distributor_id = $1', [remaining[0].item_distributor_id]);
        await client.query('UPDATE items SET dist_name = $1 WHERE item_id = $2', [remaining[0].name, item_id]);
      } else {
        await client.query('UPDATE items SET dist_name = NULL WHERE item_id = $1', [item_id]);
      }
    }

    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// E-commerce (per-channel price adjustment, e.g. Doordash)
// ---------------------------------------------------------------------------
router.get('/:id/ecommerce', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM item_ecommerce_channels WHERE item_id = $1 AND channel_name = 'Doordash'`,
      [req.params.id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/ecommerce', async (req, res) => {
  const { addAmount, overridePrice, overrideAmount } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO item_ecommerce_channels (item_id, channel_name, add_amount, override_price, override_amount)
       VALUES ($1, 'Doordash', $2, $3, $4)
       ON CONFLICT (item_id, channel_name) DO UPDATE SET
         add_amount = EXCLUDED.add_amount,
         override_price = EXCLUDED.override_price,
         override_amount = EXCLUDED.override_amount
       RETURNING *`,
      [req.params.id, addAmount || 0, !!overridePrice, overrideAmount ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Availability (weekly hours grid + special date-range hours)
// ---------------------------------------------------------------------------
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

router.get('/:id/availability', async (req, res) => {
  try {
    const { rows: weeklyRows } = await pool.query(
      'SELECT * FROM item_availability_hours WHERE item_id = $1 ORDER BY day_of_week',
      [req.params.id]
    );
    // Fill in any missing days with the default 00:00-23:59 (always open) so
    // the UI always has all 7 days to render, even before the first save.
    const byDay = new Map(weeklyRows.map((r) => [r.day_of_week, r]));
    const weeklyHours = DAY_NAMES.map((name, i) => ({
      dayOfWeek: i,
      dayName: name,
      startTime: byDay.get(i)?.start_time ?? '00:00:00',
      endTime: byDay.get(i)?.end_time ?? '23:59:00',
    }));

    const { rows: specialHours } = await pool.query(
      'SELECT * FROM item_special_hours WHERE item_id = $1 ORDER BY start_date',
      [req.params.id]
    );

    res.json({ weeklyHours, specialHours });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk upsert all 7 days at once (the UI saves the whole grid together).
router.put('/:id/availability/weekly', async (req, res) => {
  const { hours } = req.body; // [{ dayOfWeek, startTime, endTime }, ...]
  if (!Array.isArray(hours)) return res.status(400).json({ error: 'hours must be an array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const h of hours) {
      await client.query(
        `INSERT INTO item_availability_hours (item_id, day_of_week, start_time, end_time)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (item_id, day_of_week) DO UPDATE SET
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time`,
        [req.params.id, h.dayOfWeek, h.startTime, h.endTime]
      );
    }
    await client.query('COMMIT');
    res.json({ saved: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.post('/:id/availability/special', async (req, res) => {
  const { startDate, endDate, isAvailable, note } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO item_special_hours (item_id, start_date, end_date, is_available, note)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, startDate, endDate, isAvailable !== false, note || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/availability/special/:specialHoursId', async (req, res) => {
  try {
    await pool.query('DELETE FROM item_special_hours WHERE special_hours_id = $1', [req.params.specialHoursId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Item Groups (Add to Group bottom-bar action)
// ---------------------------------------------------------------------------
router.get('/meta/item-groups', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, COUNT(m.item_id)::int AS item_count
       FROM item_groups g
       LEFT JOIN item_group_members m ON m.group_id = g.group_id
       GROUP BY g.group_id
       ORDER BY g.name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/meta/item-groups', async (req, res) => {
  const { name, message, groupType } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO item_groups (name, message, group_type) VALUES ($1,$2,$3) RETURNING *',
      [name, message || null, groupType || 'ITEM_GROUP']
    );
    res.status(201).json({ ...rows[0], item_count: 0 });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A group with that name already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/groups', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.* FROM item_groups g
       JOIN item_group_members m ON m.group_id = g.group_id
       WHERE m.item_id = $1 ORDER BY g.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/add-to-group', async (req, res) => {
  const { groupId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO item_group_members (group_id, item_id) VALUES ($1,$2)
       ON CONFLICT (group_id, item_id) DO NOTHING
       RETURNING *`,
      [groupId, req.params.id]
    );
    res.status(201).json(rows[0] || { alreadyInGroup: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/groups/:groupId', async (req, res) => {
  try {
    await pool.query('DELETE FROM item_group_members WHERE item_id = $1 AND group_id = $2', [req.params.id, req.params.groupId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Order Details (recent sales transactions containing this item)
// ---------------------------------------------------------------------------
router.get('/:id/orders', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         st.transaction_id, st.pos_order_id, st.created_at, st.payment_type, st.status,
         sti.qty, sti.unit_price, sti.tax_amount, sti.line_total
       FROM sales_transaction_items sti
       JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
       WHERE sti.item_id = $1
       ORDER BY st.created_at DESC
       LIMIT 50`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Meta: departments / categories / sub-categories (dropdowns + "+" quick-add)
// ---------------------------------------------------------------------------
router.get('/meta/departments', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM departments ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/meta/departments', async (req, res) => {
  const { storeId, name, taxPct, ageRestriction, surchargePct, isFavourite } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO departments (store_id, name, tax_pct, age_restriction, surcharge_pct, is_favourite)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [storeId || 1, name, taxPct || 0, ageRestriction || null, surchargePct || 0, !!isFavourite]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/meta/categories', async (req, res) => {
  const { departmentId } = req.query;
  try {
    let query = 'SELECT * FROM categories';
    const params = [];
    if (departmentId) {
      params.push(departmentId);
      query += ' WHERE department_id = $1';
    }
    query += ' ORDER BY name';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/meta/categories', async (req, res) => {
  const { departmentId, name } = req.body;
  if (!departmentId || !name) return res.status(400).json({ error: 'departmentId and name are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO categories (department_id, name) VALUES ($1,$2) RETURNING *',
      [departmentId, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/meta/subcategories', async (req, res) => {
  const { categoryId } = req.query;
  try {
    let query = 'SELECT * FROM sub_categories';
    const params = [];
    if (categoryId) {
      params.push(categoryId);
      query += ' WHERE category_id = $1';
    }
    query += ' ORDER BY name';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/meta/subcategories', async (req, res) => {
  const { categoryId, name } = req.body;
  if (!categoryId || !name) return res.status(400).json({ error: 'categoryId and name are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO sub_categories (category_id, name) VALUES ($1,$2) RETURNING *',
      [categoryId, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
