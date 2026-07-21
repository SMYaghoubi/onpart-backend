const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { auth, adminAuth } = require('../middleware/auth');

// GET /api/invoices
router.get('/', auth, async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const offset = (page - 1) * limit;
    const [rows] = await db.execute(
      `SELECT o.id, o.total, o.status, o.created_at,
        u.name as user_name, u.phone as user_phone,
        COUNT(oi.id) as items_count
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.status != 'cancelled'
       GROUP BY o.id
       ORDER BY o.id DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
    );
    res.json(rows);
  } catch(err) {
    res.status(500).json({ message: 'خطای سرور', error: err.message });
  }
});

// DELETE /api/invoices/:id
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await db.execute('UPDATE orders SET status="cancelled" WHERE id=?', [req.params.id]);
    res.json({ message: 'فاکتور حذف شد' });
  } catch(err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
