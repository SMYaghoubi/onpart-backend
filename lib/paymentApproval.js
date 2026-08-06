const { syncUserDebt } = require('./orderDebt');
const { allocateApprovedPayment, getPaymentAllocations } = require('./paymentAllocations');

function calculateRemainingDebt(currentDebt, paymentAmount) {
  const debt = Math.max(0, Number(currentDebt) || 0);
  const amount = Math.max(0, Number(paymentAmount) || 0);
  return Math.max(0, debt - amount);
}

async function approvePayment(connection, paymentId, reviewerId) {
  const [[payment]] = await connection.execute('SELECT * FROM payments WHERE id=? FOR UPDATE', [paymentId]);
  if (!payment) return { notFound: true };
  if (payment.status === 'approved') {
    const allocations = await getPaymentAllocations(connection, payment.id);
    return { alreadyApproved: true, payment, allocations };
  }
  await connection.execute(
    'UPDATE payments SET status="approved", reviewed_by=?, reviewed_at=NOW() WHERE id=? AND status<>"approved"',
    [reviewerId, paymentId]
  );
  const allocationResult = await allocateApprovedPayment(connection, payment);
  const allocations = allocationResult.allocations;
  const primaryOrderId = payment.order_id || (allocations[0] && allocations[0].order_id);
  let order = null;
  let remaining = null;
  if (primaryOrderId) {
    const [[row]] = await connection.execute('SELECT id,status,total,debt_remaining FROM orders WHERE id=?', [primaryOrderId]);
    order = row || null;
    remaining = order ? Number(order.debt_remaining) : null;
  }
  const debt = await syncUserDebt(connection, payment.user_id);
  const [[user]] = await connection.execute('SELECT * FROM users WHERE id=?', [payment.user_id]);
  return { payment, order, remaining, debt, user, allocations, unallocatedAmount: allocationResult.unallocatedAmount, alreadyApproved: false };
}

module.exports = { calculateRemainingDebt, approvePayment };
