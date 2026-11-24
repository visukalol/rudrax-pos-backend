// routes/cash_drawer.js
//
// Cash Register -> Drawer: Drop / Pay out / Pay in / History.
// Drop this file in backend/routes/cash_drawer.js and mount it in server.js
// the same way items.js, sales.js and customers.js are mounted, e.g.:
//
//   app.use('/api/cash-drawer', require('./routes/cash_drawer'));
//
// ASSUMPTIONS TO VERIFY: your `cash_drawer_log` table already exists in
// the Neon schema (12-table list), but I don't have its exact column
// names — this file guesses a conventional shape:
//   log_id (PK), register_id, employee_id, entry_type
//   ('drop' | 'pay_in' | 'pay_out'), amount (numeric), method, reason,
//   distributor, notes, created_at (timestamptz, default now())
// Open the table in DBeaver and tell me the real column names if these
// don't match — this file is a starting point, not a verified fit.

const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');

const VALID_TYPES = ['drop', 'pay_in', 'pay_out'];

// POST /api/cash-drawer
// { entryType, amount, method?, reason?, distributor?, notes?, employeeId?, registerId? }
router.post('/', async (req, res) => {
  try {
    const { entryType, amount, method, reason, distributor, notes, employeeId, registerId } = req.body;
    if (!VALID_TYPES.includes(entryType)) {
      return res.status(400).json({ error: `entryType must be one of ${VALID_TYPES.join(', ')}` });
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Amount must be greater than 0' });

    const result = await pool.query(
      `INSERT INTO cash_drawer_log
         (register_id, employee_id, entry_type, amount, method, reason, distributor, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       RETURNING log_id, register_id, employee_id, entry_type, amount, method, reason, distributor, notes, created_at`,
      [registerId || null, employeeId || null, entryType, amt, method || null, reason || null, distributor || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /cash-drawer failed:', err);
    res.status(500).json({ error: 'Failed to record cash drawer entry' });
  }
});

// GET /api/cash-drawer?entryType=drop&limit=50
router.get('/', async (req, res) => {
  try {
    const { entryType } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    let result;
    if (entryType && VALID_TYPES.includes(entryType)) {
      result = await pool.query(
        `SELECT log_id, register_id, employee_id, entry_type, amount, method, reason, distributor, notes, created_at
           FROM cash_drawer_log
          WHERE entry_type = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [entryType, limit]
      );
    } else {
      result = await pool.query(
        `SELECT log_id, register_id, employee_id, entry_type, amount, method, reason, distributor, notes, created_at
           FROM cash_drawer_log
          ORDER BY created_at DESC
          LIMIT $1`,
        [limit]
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error('GET /cash-drawer failed:', err);
    res.status(500).json({ error: 'Failed to load cash drawer history' });
  }
});

module.exports = router;
