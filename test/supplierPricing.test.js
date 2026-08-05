const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFinalPrice, validateSupplierValues, isProductInAllowedBrands } = require('../lib/supplierPricing');

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

test('supplier access is limited to explicitly assigned brands', () => {
  const brands = new Set(['Bosch']);
  assert.equal(isProductInAllowedBrands({ brand: 'Bosch' }, brands), true);
  assert.equal(isProductInAllowedBrands({ brand: 'Valeo' }, brands), false);
});

test('supplier price and stock reject negative or non-integer values', () => {
  assert.deepEqual(validateSupplierValues(120000, 4), { supplierPrice: 120000, stock: 4 });
  assert.throws(() => validateSupplierValues(-1, 4));
  assert.throws(() => validateSupplierValues(120000, -1));
});