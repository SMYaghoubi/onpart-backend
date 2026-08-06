const { PAYABLE_STATUSES, reconcileOrderDebt } = require('./debtReconciliation');

async function getPaymentAllocations(connection, paymentId) {
  const [rows] = await connection.execute(
    `SELECT pa.order_id,pa.amount,o.status order_status,o.debt_remaining
     FROM payment_allocations pa
     JOIN orders o ON o.id=pa.order_id
     WHERE pa.payment_id=? ORDER BY pa.id`,
    [paymentId]
  );
  return rows;
}

async function allocateApprovedPayment(connection, payment) {
  const existing = await getPaymentAllocations(connection, payment.id);
  if (existing.length) {
    return {
      allocations: existing,
      allocatedAmount: existing.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      unallocatedAmount: Math.max(0, Number(payment.amount || 0) - existing.reduce((sum, row) => sum + Number(row.amount || 0), 0))
    };
  }

  const placeholders = PAYABLE_STATUSES.map(() => '?').join(',');
  const [orders] = await connection.execute(
    `SELECT id,status,total,created_at FROM orders
     WHERE user_id=? AND status IN (${placeholders})
     ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,created_at,id FOR UPDATE`,
    [payment.user_id, ...PAYABLE_STATUSES, Number(payment.order_id) || 0]
  );
  if (!orders.length) return { allocations: [], allocatedAmount: 0, unallocatedAmount: Number(payment.amount || 0) };

  const orderIds = orders.map(order => Number(order.id));
  const marks = orderIds.map(() => '?').join(',');
  const [usedRows] = await connection.execute(
    `SELECT order_id,COALESCE(SUM(amount),0) allocated_amount
     FROM payment_allocations WHERE order_id IN (${marks}) GROUP BY order_id`,
    orderIds
  );
  const used = new Map(usedRows.map(row => [Number(row.order_id), Number(row.allocated_amount || 0)]));
  let available = Math.max(0, Number(payment.amount || 0));
  const allocations = [];
  for (const order of orders) {
    if (available <= 0) break;
    const debt = Math.max(0, Number(order.total || 0) - (used.get(Number(order.id)) || 0));
    const amount = Math.min(available, debt);
    if (amount <= 0) continue;
    await connection.execute(
      'INSERT INTO payment_allocations (payment_id,order_id,amount) VALUES (?,?,?)',
      [payment.id, order.id, amount]
    );
    allocations.push({ order_id: Number(order.id), amount });
    available -= amount;
  }

  if (!payment.order_id && allocations.length) {
    await connection.execute('UPDATE payments SET order_id=? WHERE id=? AND order_id IS NULL', [allocations[0].order_id, payment.id]);
    payment.order_id = allocations[0].order_id;
  }

  for (const allocation of allocations) {
    const reconciled = await reconcileOrderDebt(connection, allocation.order_id);
    if (!reconciled) continue;
    if (reconciled.debt_remaining === 0 && reconciled.status === 'pending_payment') {
      await connection.execute('UPDATE orders SET status="preparing" WHERE id=?', [allocation.order_id]);
    }
  }
  return {
    allocations,
    allocatedAmount: allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    unallocatedAmount: available
  };
}

async function reconcileOrdersAfterAllocationRemoval(connection, orderIds) {
  const restored=[];
  for (const orderId of [...new Set((orderIds || []).map(Number).filter(Boolean))]) {
    const reconciled=await reconcileOrderDebt(connection,orderId);
    if (!reconciled) continue;
    if(reconciled.debt_remaining>0 && reconciled.status==='preparing') {
      await connection.execute('UPDATE orders SET status="pending_payment" WHERE id=?',[orderId]);
      reconciled.status='pending_payment';
    }
    restored.push({order_id:orderId,debt_remaining:reconciled.debt_remaining,status:reconciled.status});
  }
  return restored;
}

module.exports = { getPaymentAllocations, allocateApprovedPayment, reconcileOrdersAfterAllocationRemoval };
