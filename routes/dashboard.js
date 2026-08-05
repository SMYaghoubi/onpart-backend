const router = require('express').Router();
const db = require('../config/database');
const { adminAuth } = require('../middleware/auth');
const { calculateProfit, fillSevenDays } = require('../lib/dashboardMetrics');

router.get('/', adminAuth, async (req, res) => {
  try {
    const results = await Promise.all([
      db.execute("SELECT (SELECT COUNT(*) FROM orders) total_orders,(SELECT COUNT(*) FROM users WHERE role='user' AND status='active') active_users,(SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='approved' AND reviewed_at>=DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')) month_sales,(SELECT COUNT(*) FROM users WHERE role='partner' AND status='active') active_partners"),
      db.execute('SELECT o.id,o.total,o.status,o.created_at,u.name user_name FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 8'),
      db.execute("SELECT p.id,p.order_id,p.amount,p.created_at,u.name user_name FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE p.status='pending' ORDER BY p.created_at DESC LIMIT 8"),
      db.execute("(SELECT 'order' type,o.id entity_id,CONCAT('سفارش #',o.id) title,o.created_at,'/admin/orders.html' link FROM orders o) UNION ALL (SELECT 'payment',p.id,CONCAT('پرداخت #',p.id),p.created_at,'/admin/payments.html' FROM payments p) UNION ALL (SELECT 'supplier',b.id,CONCAT('درخواست تأمین‌کننده #',b.id),b.submitted_at,'/admin/supplier-updates.html' FROM supplier_update_batches b) ORDER BY created_at DESC LIMIT 12"),
      db.execute("SELECT DATE_FORMAT(reviewed_at,'%Y-%m-%d') day,COALESCE(SUM(amount),0) sales FROM payments WHERE status='approved' AND reviewed_at>=CURRENT_DATE-INTERVAL 6 DAY GROUP BY DATE(reviewed_at) ORDER BY day"),
      db.execute("SELECT oi.quantity,oi.total,oi.cost_price FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.created_at>=CURRENT_DATE-INTERVAL 6 DAY AND EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='approved')")
    ]);
    res.json({ metrics:results[0][0][0],latest_orders:results[1][0],pending_payments:results[2][0],activities:results[3][0],sales_7d:fillSevenDays(results[4][0]),profit_7d:calculateProfit(results[5][0]) });
  } catch (err) { console.error('Dashboard error:',err.message);res.status(500).json({ message:'خطا در دریافت اطلاعات داشبورد' }); }
});

module.exports = router;
