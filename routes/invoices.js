const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { auth, adminAuth } = require('../middleware/auth');
const { syncUserDebt } = require('../lib/orderDebt');
const { deleteUserNotificationsForEntity, broadcastUserNotificationsChanged } = require('../lib/userNotifications');

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
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.execute(
      'SELECT id,user_id FROM orders WHERE id=? FOR UPDATE',
      [req.params.id]
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ message: 'فاکتور یا سفارش یافت نشد' });
    }
    await conn.execute('DELETE FROM invoices WHERE order_id=?', [order.id]);
    await deleteUserNotificationsForEntity(conn, order.user_id, 'order', order.id, '/orders');
    await conn.execute('UPDATE orders SET status="cancelled",debt_remaining=0 WHERE id=?', [order.id]);
    const debt = await syncUserDebt(conn, order.user_id);
    await conn.commit();
    broadcastUserNotificationsChanged();
    res.json({ message: 'فاکتور و اعلان‌های مرتبط حذف شدند', debt });
  } catch(err) {
    try { await conn.rollback(); } catch (_) {}
    res.status(500).json({ message: 'خطای سرور' });
  } finally { conn.release(); }
});

module.exports = router;
