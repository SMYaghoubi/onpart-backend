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

test('supplier price and availability are validated without accepting quantities', () => {
  assert.deepEqual(validateSupplierValues(120000,true,9),{supplierPrice:120000,stock:9,available:true});
  assert.deepEqual(validateSupplierValues(120000,false,9),{supplierPrice:120000,stock:0,available:false});
  assert.deepEqual(validateSupplierValues(120000,true,0),{supplierPrice:120000,stock:1,available:true});
  assert.throws(() => validateSupplierValues(-1,true,4));
  assert.throws(() => validateSupplierValues(120000,4,4),/فقط باید/);
});