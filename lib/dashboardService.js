const { calculateProfit, fillSevenDays } = require('./dashboardMetrics');

function logSectionError(section, err, fallback = false) {
  console.error(`[Dashboard:${section}${fallback ? ':fallback' : ''}]`, err?.code || '', err?.message || err);
}

async function rowsWithFallback(db, section, primarySql, fallbackSql, warnings) {
  try {
    const [rows] = await db.execute(primarySql);
    return rows || [];
  } catch (err) {
    warnings.add(section);
    logSectionError(section, err);
    if (!fallbackSql) return [];
    try {
      const [rows] = await db.execute(fallbackSql);
      return rows || [];
    } catch (fallbackErr) {
      logSectionError(section, fallbackErr, true);
      return [];
    }
  }
}

function mergeActivities(groups) {
  return groups.flat().sort((a, b) => {
    const right = new Date(b.created_at || 0).getTime() || 0;
    const left = new Date(a.created_at || 0).getTime() || 0;
    return right - left;
  }).slice(0, 12);
}

async function buildDashboard(db, now = new Date()) {
  const warnings = new Set();
  const queries = [
    rowsWithFallback(db, 'total_orders', 'SELECT COUNT(*) total_orders FROM orders', null, warnings),
    rowsWithFallback(db, 'active_users', "SELECT COUNT(*) active_users FROM users WHERE role='user' AND status='active'", "SELECT COUNT(*) active_users FROM users WHERE role='user'", warnings),
    rowsWithFallback(db, 'month_sales', "SELECT COALESCE(SUM(amount),0) month_sales FROM payments WHERE status='approved' AND reviewed_at>=DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')", "SELECT COALESCE(SUM(amount),0) month_sales FROM payments WHERE status='approved' AND created_at>=DATE_FORMAT(CURRENT_DATE,'%Y-%m-01')", warnings),
    rowsWithFallback(db, 'active_partners', "SELECT COUNT(*) active_partners FROM users WHERE role='partner' AND status='active'", "SELECT COUNT(*) active_partners FROM users WHERE role='partner'", warnings),
    rowsWithFallback(db, 'latest_orders', 'SELECT o.id,o.total,o.status,o.created_at,u.name user_name FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 8', null, warnings),
    rowsWithFallback(db, 'pending_payments', "SELECT p.id,p.order_id,p.amount,p.created_at,u.name user_name FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE p.status='pending' ORDER BY p.created_at DESC LIMIT 8", null, warnings),
    rowsWithFallback(db, 'order_activities', "SELECT 'order' type,o.id entity_id,CONCAT('سفارش #',o.id) title,o.created_at,'/admin/orders' link FROM orders o ORDER BY o.created_at DESC LIMIT 12", null, warnings),
    rowsWithFallback(db, 'payment_activities', "SELECT 'payment' type,p.id entity_id,CONCAT('پرداخت #',p.id) title,p.created_at,'/admin/payments' link FROM payments p ORDER BY p.created_at DESC LIMIT 12", null, warnings),
    rowsWithFallback(db, 'supplier_activities', "SELECT 'supplier' type,b.id entity_id,CONCAT('درخواست تأمین‌کننده #',b.id) title,b.submitted_at created_at,'/admin/supplier-updates' link FROM supplier_update_batches b ORDER BY b.submitted_at DESC LIMIT 12", null, warnings),
    rowsWithFallback(db, 'sales_7d', "SELECT DATE_FORMAT(reviewed_at,'%Y-%m-%d') day,COALESCE(SUM(amount),0) sales FROM payments WHERE status='approved' AND reviewed_at>=CURRENT_DATE-INTERVAL 6 DAY GROUP BY DATE(reviewed_at) ORDER BY day", "SELECT DATE_FORMAT(created_at,'%Y-%m-%d') day,COALESCE(SUM(amount),0) sales FROM payments WHERE status='approved' AND created_at>=CURRENT_DATE-INTERVAL 6 DAY GROUP BY DATE(created_at) ORDER BY day", warnings),
    rowsWithFallback(db, 'profit_7d', "SELECT oi.quantity,oi.total,oi.cost_price FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.created_at>=CURRENT_DATE-INTERVAL 6 DAY AND EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='approved')", "SELECT oi.quantity,oi.total,oi.price cost_price FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.created_at>=CURRENT_DATE-INTERVAL 6 DAY AND EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='approved')", warnings)
  ];
  const [ordersCount, usersCount, monthSales, partnersCount, latestOrders, pendingPayments, orderActivities, paymentActivities, supplierActivities, salesRows, profitRows] = await Promise.all(queries);
  return {
    metrics: {
      total_orders: Number(ordersCount[0]?.total_orders) || 0,
      active_users: Number(usersCount[0]?.active_users) || 0,
      month_sales: Number(monthSales[0]?.month_sales) || 0,
      active_partners: Number(partnersCount[0]?.active_partners) || 0
    },
    latest_orders: latestOrders,
    pending_payments: pendingPayments,
    activities: mergeActivities([orderActivities, paymentActivities, supplierActivities]),
    sales_7d: fillSevenDays(salesRows, now),
    profit_7d: calculateProfit(profitRows),
    partial: warnings.size > 0,
    unavailable_sections: Array.from(warnings)
  };
}

module.exports = { buildDashboard, mergeActivities, rowsWithFallback };