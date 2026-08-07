const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOrderTransition, isOrderFinanciallySettled } = require('../lib/orderWorkflow');

const paid = { status:'preparing', total:1000, debt_remaining:0, approved_amount:1000 };

test('approved order can move through the explicit fulfilment workflow', () => {
  assert.equal(validateOrderTransition(paid, 'shipping').ok, true);
  assert.equal(validateOrderTransition({ ...paid, status:'shipping' }, 'delivered').ok, true);
});

test('pending or unpaid order cannot enter a paid fulfilment stage', () => {
  const result = validateOrderTransition({ status:'pending_payment', total:1000, debt_remaining:1000, approved_amount:0 }, 'preparing');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PAYMENT_REQUIRED');
});

test('invalid jumps are rejected and repeating the same state is idempotent', () => {
  assert.equal(validateOrderTransition({ ...paid, status:'pending_customer' }, 'shipping').code, 'INVALID_TRANSITION');
  assert.deepEqual(validateOrderTransition(paid, 'preparing'), { ok:true, unchanged:true });
});

test('payment status fallback keeps the workflow compatible with allocated legacy payments', () => {
  assert.equal(isOrderFinanciallySettled({ total:1000, debt_remaining:0, payment_status:'approved' }), true);
  assert.equal(isOrderFinanciallySettled({ total:1000, debt_remaining:0, payment_status:'pending' }), false);
});

test('the same workflow rules apply independently of an authorized admin or partner role', () => {
  for (const role of ['admin','partner']) {
    assert.equal(validateOrderTransition({ ...paid, role }, 'shipping').ok, true);
  }
});