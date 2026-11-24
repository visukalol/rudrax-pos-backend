// RudraX POS - Customers route
// GET  /api/customers?search=      -> list/search (used by CustomerPickScreen)
// GET  /api/customers/:id          -> one customer
// POST /api/customers              -> add (used by the new Add Customer dialog)
// PUT  /api/customers/:id          -> update
//
// ASSUMPTIONS TO VERIFY: this assumes ../db/pool exports a `pool` with a
// `.query(sql, params)` method, matching the style your other route files
// (auth.js, items.js, sales.js) already use. If your pool.js exports
// something different, adjust the `require` line and the `pool.query(...)`
// calls to match your existing pattern.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// ---------------------------------------------------------------------
// GET /api/customers?search=
// ---------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    let result;
    if (search) {
      result = await pool.query(
        `SELECT * FROM customers
         WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1
            OR first_name ILIKE $1 OR last_name ILIKE $1
         ORDER BY name NULLS LAST
         LIMIT 50`,
        [`%${search}%`]
      );
    } else {
      result = await pool.query('SELECT * FROM customers ORDER BY customer_id DESC LIMIT 50');
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load customers' });
  }
});

// ---------------------------------------------------------------------
// GET /api/customers/:id
// ---------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load customer' });
  }
});

// ---------------------------------------------------------------------
// POST /api/customers
// Accepts both the old flat shape (name, phone, email, address, notes) and
// the new granular one (firstName, lastName, creditLimit, address1,
// address2, city, state, zip, country) that the redesigned Add Customer
// dialog sends — the Flutter side sends both together, so either backend
// shape keeps working.
// ---------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const name = b.name || [b.firstName, b.lastName].filter(Boolean).join(' ');
    const address = b.address || [b.address1, b.address2, b.city, b.state, b.zip].filter(Boolean).join(', ');

    // This project runs a single demo store, and `customers.store_id` is
    // NOT NULL — default to store 1 (your seeded demo store) unless the
    // caller sends a real one.
    const storeId = b.storeId || 1;

    const result = await pool.query(
      `INSERT INTO customers
        (store_id, name, phone, email, address, notes, first_name, last_name, credit_limit,
         address1, address2, city, state, zip, country)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        storeId,
        name || null,
        b.phone || null,
        b.email || null,
        address || null,
        b.notes || null,
        b.firstName || null,
        b.lastName || null,
        b.creditLimit != null ? Number(b.creditLimit) : 0,
        b.address1 || null,
        b.address2 || null,
        b.city || null,
        b.state || null,
        b.zip || null,
        b.country || 'United States',
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add customer' });
  }
});

// ---------------------------------------------------------------------
// PUT /api/customers/:id
// ---------------------------------------------------------------------
router.put('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const name = b.name || [b.firstName, b.lastName].filter(Boolean).join(' ');
    const address = b.address || [b.address1, b.address2, b.city, b.state, b.zip].filter(Boolean).join(', ');

    const result = await pool.query(
      `UPDATE customers SET
         name = COALESCE($1, name),
         phone = COALESCE($2, phone),
         email = COALESCE($3, email),
         address = COALESCE($4, address),
         notes = COALESCE($5, notes),
         first_name = COALESCE($6, first_name),
         last_name = COALESCE($7, last_name),
         credit_limit = COALESCE($8, credit_limit),
         address1 = COALESCE($9, address1),
         address2 = COALESCE($10, address2),
         city = COALESCE($11, city),
         state = COALESCE($12, state),
         zip = COALESCE($13, zip),
         country = COALESCE($14, country)
       WHERE customer_id = $15
       RETURNING *`,
      [
        name || null,
        b.phone || null,
        b.email || null,
        address || null,
        b.notes || null,
        b.firstName || null,
        b.lastName || null,
        b.creditLimit != null ? Number(b.creditLimit) : null,
        b.address1 || null,
        b.address2 || null,
        b.city || null,
        b.state || null,
        b.zip || null,
        b.country || null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

module.exports = router;