const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFinalPrice } = require('../lib/supplierPricing');

test('adds marketer markup to supplier price', () => {
  assert.equal(calculateFinalPrice(100000, 15), 115000);
  assert.equal(calculateFinalPrice(999, 2.5), 1024);
});

test('allows zero markup and rejects unsafe values', () => {
  assert.equal(calculateFinalPrice(75000, 0), 75000);
  assert.throws(() => calculateFinalPrice(-1, 10));
  assert.throws(() => calculateFinalPrice(1000, -1));
  assert.throws(() => calculateFinalPrice(1000, 1001));
});
