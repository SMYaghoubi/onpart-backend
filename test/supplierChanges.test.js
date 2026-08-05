const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSupplierChange } = require('../lib/supplierChanges');
const { batchRemovalAction } = require('../lib/supplierBatchPolicy');

test('drops unchanged Excel rows and keeps real price or stock diffs', () => {
  const product={price:1000,stock:5};
  assert.equal(buildSupplierChange(product,1000,5),null);
  assert.deepEqual(buildSupplierChange(product,1000,0),{supplierPrice:1000,stock:0,priceChanged:false,stockChanged:true});
  assert.deepEqual(buildSupplierChange(product,1200,5),{supplierPrice:1200,stock:null,priceChanged:true,stockChanged:false});
});

test('pending and rejected batches delete while approved batches archive', () => {
  assert.equal(batchRemovalAction('pending'),'delete');
  assert.equal(batchRemovalAction('rejected'),'delete');
  assert.equal(batchRemovalAction('approved'),'archive');
});
