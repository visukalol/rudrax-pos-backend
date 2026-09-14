const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

// POST /api/auth/sign-in  { pin: "1234" }
router.post('/sign-in', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN is required' });

  try {
    const { rows } = await pool.query(
      'SELECT employee_id, full_name, pin_hash, role, store_id FROM employees WHERE is_active = TRUE'
    );

    for (const emp of rows) {
      const match = await bcrypt.compare(pin, emp.pin_hash);
      if (match) {
        return res.json({
          employeeId: emp.employee_id,
          fullName: emp.full_name,
          role: emp.role,
          storeId: emp.store_id,
        });
      }
    }
    return res.status(401).json({ error: 'Invalid PIN' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/clock-in  { employeeId, registerId }
router.post('/clock-in', async (req, res) => {
  const { employeeId, registerId } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO time_card (employee_id, register_id, clock_in)
       VALUES ($1, $2, now()) RETURNING time_card_id, clock_in`,
      [employeeId, registerId || null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/clock-out { timeCardId }
router.post('/clock-out', async (req, res) => {
  const { timeCardId } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE time_card SET clock_out = now() WHERE time_card_id = $1 RETURNING *`,
      [timeCardId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
