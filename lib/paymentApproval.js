const { syncUserDebt } = require('./orderDebt');

function calculateRemainingDebt(currentDebt, paymentAmount) {
  const debt = Math.max(0, Number(currentDebt) || 0);
  const amount = Math.max(0, Number(paymentAmount) || 0);
  return Math.max(0, debt - amount);
}

async function approvePayment(connection, paymentId, reviewerId) {
  const [[payment]] = await connection.execute('SELECT * FROM payments WHERE id=? FOR UPDATE', [paymentId]);
  if (!payment) return { notFound: true };
  if (payment.status === 'approved') return { alreadyApproved: true, payment };
  let order = null;
  let remaining = null;
  if (payment.order_id) {
    [[order]] = await connection.execute(
      'SELECT id,status,debt_remaining FROM orders WHERE id=? AND user_id=? FOR UPDATE',
      [payment.order_id, payment.user_id]
    );
    if (order) {
      remaining = calculateRemainingDebt(order.debt_remaining, payment.amount);
      const nextStatus = remaining === 0 ? 'preparing' : order.status;
      await connection.execute('UPDATE orders SET status=?,debt_remaining=? WHERE id=?', [nextStatus, remaining, order.id]);
      order = { ...order, status: nextStatus, debt_remaining: remaining };
    }
  }
  await connection.execute(
    'UPDATE payments SET status="approved", reviewed_by=?, reviewed_at=NOW() WHERE id=? AND status<>"approved"',
    [reviewerId, paymentId]
  );
  const debt = await syncUserDebt(connection, payment.user_id);
  const [[user]] = await connection.execute('SELECT * FROM users WHERE id=?', [payment.user_id]);
  return { payment, order, remaining, debt, user, alreadyApproved: false };
}

module.exports = { calculateRemainingDebt, approvePayment };
