const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRemainingDebt, approvePayment } = require('../lib/paymentApproval');

test('full payment clears the order debt', () => assert.equal(calculateRemainingDebt(100000, 100000), 0));
test('partial payment only reduces the paid amount', () => assert.equal(calculateRemainingDebt(100000, 35000), 65000));

test('approving an approved payment is idempotent', async () => {
  let writes = 0;
  const connection = { execute: async sql => {
    if (sql.startsWith('SELECT * FROM payments')) {
      return [[{ id: 7, status: 'approved', amount: 50000, user_id: 2, order_id: 3 }]];
    }
    writes += 1;
    return [{}];
  }};
  const result = await approvePayment(connection, 7, 1);
  assert.equal(result.alreadyApproved, true);
  assert.equal(writes, 0);
});
