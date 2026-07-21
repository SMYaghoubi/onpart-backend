const router = require('express').Router();
const db     = require('../config/database');
const { auth, adminAuth } = require('../middleware/auth');

// ── GET /api/reports/sales ── (admin)
router.get('/sales', adminAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = from && to ? 'WHERE o.created_at BETWEEN ? AND ?' : '';
    const params = from && to ? [from, to] : [];

    const [[totals]] = await db.execute(
      `SELECT COUNT(*) as total_orders, SUM(total) as total_sales, AVG(total) as avg_order
       FROM orders ${dateFilter}`, params
    );

    const [byStatus] = await db.execute(
      `SELECT status, COUNT(*) as count FROM orders ${dateFilter} GROUP BY status`, params
    );

    const [topProducts] = await db.execute(
      `SELECT p.description, p.code, SUM(oi.quantity) as total_qty, SUM(oi.total) as revenue
       FROM order_items oi JOIN products p ON oi.product_id=p.id
       GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 10`
    );

    const [topUsers] = await db.execute(
      `SELECT u.name, u.phone, COUNT(o.id) as orders, SUM(o.total) as total
       FROM orders o JOIN users u ON o.user_id=u.id
       GROUP BY o.user_id ORDER BY total DESC LIMIT 10`
    );

    const [monthly] = await db.execute(
      `SELECT DATE_FORMAT(created_at,'%Y-%m') as month, COUNT(*) as orders, SUM(total) as sales
       FROM orders GROUP BY month ORDER BY month DESC LIMIT 12`
    );

    res.json({ totals, byStatus, topProducts, topUsers, monthly });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/reports/finance ── (admin)
router.get('/finance', adminAuth, async (req, res) => {
  try {
    const [[payments]] = await db.execute(
      `SELECT SUM(CASE WHEN status="approved" THEN amount ELSE 0 END) as total_received,
              COUNT(CASE WHEN status="pending" THEN 1 END) as pending_count
       FROM payments`
    );
    const [[debts]] = await db.execute('SELECT SUM(debt) as total_debt FROM users');

    res.json({ payments, debts });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/reports/account-statement ── (user's own)
router.get('/account-statement', auth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [req.user.id];
    let dateFilter = '';
    if (from && to) { dateFilter = 'AND created_at BETWEEN ? AND ?'; params.push(from, to); }

    const [orders] = await db.execute(
      `SELECT id, total, status, created_at FROM orders WHERE user_id=? ${dateFilter} ORDER BY id DESC`,
      params
    );
    const [payments] = await db.execute(
      `SELECT id, amount, bank, status, pay_date, created_at FROM payments WHERE user_id=? ${dateFilter} ORDER BY id DESC`,
      params
    );
    const [[user]] = await db.execute('SELECT debt, credit_limit FROM users WHERE id=?', [req.user.id]);

    res.json({ orders, payments, debt: user.debt, credit_limit: user.credit_limit });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
