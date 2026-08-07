const TRANSITIONS = Object.freeze({
  pending_expert: Object.freeze(['pending_customer', 'cancelled']),
  pending_customer: Object.freeze(['pending_payment', 'cancelled']),
  pending_payment: Object.freeze(['preparing', 'cancelled']),
  preparing: Object.freeze(['shipping', 'cancelled']),
  shipping: Object.freeze(['delivered']),
  delivered: Object.freeze([]),
  cancelled: Object.freeze([])
});

const VALID_STATUSES = Object.freeze(Object.keys(TRANSITIONS));
const PAID_STAGES = new Set(['preparing', 'shipping', 'delivered']);

function isOrderFinanciallySettled(order) {
  const total = Math.max(0, Number(order && order.total) || 0);
  if (total === 0) return true;
  const debtRemaining = Math.max(0, Number(order && order.debt_remaining) || 0);
  const approvedAmount = Math.max(0, Number(order && order.approved_amount) || 0);
  const hasApprovedPayment = Boolean(Number(order && order.has_approved_payment)) || order.payment_status === 'approved';
  return debtRemaining === 0 && (approvedAmount >= total || hasApprovedPayment);
}

function validateOrderTransition(order, nextStatus) {
  const currentStatus = order && order.status;
  if (!VALID_STATUSES.includes(nextStatus)) {
    return { ok: false, code: 'INVALID_STATUS', statusCode: 400 };
  }
  if (!VALID_STATUSES.includes(currentStatus)) {
    return { ok: false, code: 'INVALID_CURRENT_STATUS', statusCode: 409 };
  }
  if (currentStatus === nextStatus) return { ok: true, unchanged: true };
  if (!TRANSITIONS[currentStatus].includes(nextStatus)) {
    return { ok: false, code: 'INVALID_TRANSITION', statusCode: 409 };
  }
  if (PAID_STAGES.has(nextStatus) && !isOrderFinanciallySettled(order)) {
    return { ok: false, code: 'PAYMENT_REQUIRED', statusCode: 409 };
  }
  return { ok: true, unchanged: false };
}

module.exports = { TRANSITIONS, VALID_STATUSES, isOrderFinanciallySettled, validateOrderTransition };
