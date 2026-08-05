const test = require('node:test');
const assert = require('node:assert/strict');
const { PAYMENT_SOUND_KEYS, orderStatusAfterPaymentRejection } = require('../lib/paymentStates');

test('payment submitted, approved and rejected have dedicated sounds', () => {
  assert.deepEqual(PAYMENT_SOUND_KEYS,{submitted:'payment_submitted',approved:'payment_approved',rejected:'payment_rejected'});
});

test('rejected payment keeps order in pending payment workflow', () => {
  assert.equal(orderStatusAfterPaymentRejection(),'pending_payment');
});
