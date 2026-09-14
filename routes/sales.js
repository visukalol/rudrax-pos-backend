const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// POST /api/sales   - post a completed sale (Cash Register checkout)
// body: { storeId, registerId, employeeId, customerId, paymentType,
//         amountTendered, items: [{itemId, sku, itemName, qty, unitPrice, taxAmount}] }
router.post('/', async (req, res) => {
  const {
    storeId, registerId, employeeId, customerId,
    paymentType, amountTendered, items,
  } = req.body;

  if (!items || !items.length) return res.status(400).json({ error: 'Cart is empty' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let subtotal = 0, taxTotal = 0;
    items.forEach((i) => {
      subtotal += i.qty * i.unitPrice;
      taxTotal += i.taxAmount || 0;
    });
    const grandTotal = subtotal + taxTotal;
    const changeDue = amountTendered ? Math.max(0, amountTendered - grandTotal) : 0;
    const posOrderId = `POC-${Date.now()}`;

    const { rows } = await client.query(
      `INSERT INTO sales_transactions
        (pos_order_id, store_id, register_id, employee_id, customer_id,
         subtotal, tax_total, grand_total, amount_tendered, change_due, payment_type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'COMPLETE')
       RETURNING *`,
      [posOrderId, storeId, registerId, employeeId, customerId || null,
        subtotal, taxTotal, grandTotal, amountTendered || grandTotal, changeDue, paymentType || 'CASH']
    );
    const txn = rows[0];

    for (const i of items) {
      const lineTotal = i.qty * i.unitPrice + (i.taxAmount || 0);
      await client.query(
        `INSERT INTO sales_transaction_items
          (transaction_id, item_id, sku, item_name, qty, unit_price, tax_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [txn.transaction_id, i.itemId || null, i.sku, i.itemName, i.qty, i.unitPrice, i.taxAmount || 0, lineTotal]
      );
      if (i.itemId) {
        await client.query('UPDATE items SET qty_on_hand = qty_on_hand - $1 WHERE item_id = $2', [i.qty, i.itemId]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ ...txn, items });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/sales?registerId=1&limit=20&search=xxx   - reprint / transaction list / return lookup
router.get('/', async (req, res) => {
  const { registerId, limit, search } = req.query;
  try {
    let query = 'SELECT * FROM sales_transactions';
    const where = [];
    const params = [];
    if (registerId) {
      params.push(registerId);
      where.push(`register_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`pos_order_id ILIKE $${params.length}`);
    }
    if (where.length) query += ' WHERE ' + where.join(' AND ');
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit || 25);
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/sales/:id  - single receipt detail, including its line items
router.get('/:id', async (req, res) => {
  try {
    const txn = await pool.query('SELECT * FROM sales_transactions WHERE transaction_id = $1', [req.params.id]);
    if (!txn.rows.length) return res.status(404).json({ error: 'Not found' });
    const lines = await pool.query('SELECT * FROM sales_transaction_items WHERE transaction_id = $1 ORDER BY line_id', [req.params.id]);
    res.json({ ...txn.rows[0], items: lines.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sales/:id/return   - Item Return (Multi or Single Return both use this;
// Single Return just sends one line). Creates a new transaction with status RETURN,
// negative amounts, restores stock for each returned item, and links back to the
// original sale via related_transaction_id.
// body: { storeId, registerId, employeeId, lines: [{ lineId, qty }] }
router.post('/:id/return', async (req, res) => {
  const { storeId, registerId, employeeId, lines } = req.body;
  if (!lines || !lines.length) return res.status(400).json({ error: 'No lines selected to return' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: origRows } = await client.query('SELECT * FROM sales_transactions WHERE transaction_id = $1', [req.params.id]);
    if (!origRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Original transaction not found' });
    }
    const original = origRows[0];

    const { rows: origLines } = await client.query('SELECT * FROM sales_transaction_items WHERE transaction_id = $1', [req.params.id]);
    const origLineMap = new Map(origLines.map((l) => [l.line_id, l]));

    let subtotal = 0, taxTotal = 0;
    const returnLines = [];
    for (const req_line of lines) {
      const orig = origLineMap.get(req_line.lineId);
      if (!orig) continue;
      const qty = Math.min(req_line.qty, orig.qty); // can't return more than was sold
      const unitPrice = Number(orig.unit_price);
      const taxPerUnit = Number(orig.tax_amount) / Number(orig.qty);
      const lineTax = taxPerUnit * qty;
      const lineTotal = unitPrice * qty + lineTax;
      subtotal += unitPrice * qty;
      taxTotal += lineTax;
      returnLines.push({ ...orig, returnQty: qty, lineTax, lineTotal });
    }

    if (!returnLines.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'None of the selected lines matched the original sale' });
    }

    const grandTotal = subtotal + taxTotal;
    const posOrderId = `RTN-${Date.now()}`;

    const { rows: newTxnRows } = await client.query(
      `INSERT INTO sales_transactions
        (pos_order_id, store_id, register_id, employee_id,
         subtotal, tax_total, grand_total, amount_tendered, change_due, payment_type, status,
         is_return, related_transaction_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'COMPLETE',TRUE,$11)
       RETURNING *`,
      [
        posOrderId, storeId || original.store_id, registerId || original.register_id, employeeId || original.employee_id,
        -subtotal, -taxTotal, -grandTotal, -grandTotal, 0, original.payment_type,
        original.transaction_id,
      ]
    );
    const returnTxn = newTxnRows[0];

    for (const rl of returnLines) {
      await client.query(
        `INSERT INTO sales_transaction_items
          (transaction_id, item_id, sku, item_name, qty, unit_price, tax_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [returnTxn.transaction_id, rl.item_id, rl.sku, rl.item_name, -rl.returnQty, rl.unit_price, -rl.lineTax, -rl.lineTotal]
      );
      if (rl.item_id) {
        await client.query('UPDATE items SET qty_on_hand = qty_on_hand + $1 WHERE item_id = $2', [rl.returnQty, rl.item_id]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ ...returnTxn, items: returnLines });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
