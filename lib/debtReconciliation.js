const PAYABLE_STATUSES = Object.freeze(['pending_payment','preparing','shipping','delivered']);

function calculateOrderDebt(total, approvedPayments, status) {
  if (!PAYABLE_STATUSES.includes(String(status || ''))) return 0;
  return Math.max(0, (Number(total) || 0) - (Number(approvedPayments) || 0));
}

async function getCanonicalUserDebt(connection, userId) {
  const [[row]] = await connection.execute(
    `SELECT COALESCE(SUM(
       CASE WHEN o.status IN ('pending_payment','preparing','shipping','delivered')
       THEN GREATEST(COALESCE(o.total,0)-COALESCE(p.approved_amount,0),0) ELSE 0 END
     ),0) debt
     FROM orders o
     LEFT JOIN (
       SELECT order_id,SUM(amount) approved_amount FROM payment_allocations GROUP BY order_id
     ) p ON p.order_id=o.id
     WHERE o.user_id=?`,
    [userId]
  );
  return Math.max(0, Number(row && row.debt) || 0);
}

async function reconcileOrderDebt(connection, orderId) {
  const [[order]] = await connection.execute(
    `SELECT o.id,o.user_id,o.total,o.status,
      COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.order_id=o.id),0) approved_amount
     FROM orders o WHERE o.id=? FOR UPDATE`,
    [orderId]
  );
  if (!order) return null;
  const debtRemaining = calculateOrderDebt(order.total, order.approved_amount, order.status);
  await connection.execute('UPDATE orders SET debt_remaining=? WHERE id=?', [debtRemaining, order.id]);
  return { ...order, debt_remaining: debtRemaining };
}

async function reconcileUserOrderDebts(connection, userId) {
  await connection.execute(
    `UPDATE orders o
     LEFT JOIN (
       SELECT order_id,SUM(amount) approved_amount FROM payment_allocations GROUP BY order_id
     ) p ON p.order_id=o.id
     SET o.debt_remaining=CASE
       WHEN o.status IN ('pending_payment','preparing','shipping','delivered')
       THEN GREATEST(COALESCE(o.total,0)-COALESCE(p.approved_amount,0),0)
       ELSE 0 END
     WHERE o.user_id=?`,
    [userId]
  );
}

module.exports={PAYABLE_STATUSES,calculateOrderDebt,getCanonicalUserDebt,reconcileOrderDebt,reconcileUserOrderDebts};