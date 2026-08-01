const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCartItem, normalizeCartItems } = require('../lib/cartValidation');

test('accepts a valid cart item', () => {
  assert.deepEqual(normalizeCartItem({ product_id: '12', quantity: '3' }), {
    valid: true,
    item: { product_id: 12, quantity: 3 }
  });
});

test('rejects invalid identifiers and quantities', () => {
  assert.equal(normalizeCartItem({ product_id: 0, quantity: 1 }).valid, false);
  assert.equal(normalizeCartItem({ product_id: 1, quantity: -1 }).valid, false);
  assert.equal(normalizeCartItem({ product_id: 1, quantity: 1.5 }).valid, false);
});

test('rejects duplicate products in a replacement cart', () => {
  const result = normalizeCartItems([
    { product_id: 7, quantity: 1 },
    { product_id: 7, quantity: 2 }
  ]);
  assert.equal(result.valid, false);
});

test('removes zero-quantity lines from a replacement cart', () => {
  const result = normalizeCartItems([
    { product_id: 1, quantity: 0 },
    { product_id: 2, quantity: 4 }
  ]);
  assert.deepEqual(result.items, [{ product_id: 2, quantity: 4 }]);
});
