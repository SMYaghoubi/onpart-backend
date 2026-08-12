const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSupplierChange } = require('../lib/supplierChanges');
const { batchRemovalAction } = require('../lib/supplierBatchPolicy');

test('drops unchanged Excel rows and keeps real price or availability diffs', () => {
  const product={price:1000,stock:5};
  assert.equal(buildSupplierChange(product,1000,true),null);
  assert.deepEqual(buildSupplierChange(product,1000,false),{supplierPrice:1000,stock:0,available:false,priceChanged:false,availabilityChanged:true});
  assert.deepEqual(buildSupplierChange(product,1200,true),{supplierPrice:1200,stock:null,available:null,priceChanged:true,availabilityChanged:false});
});

test('supplier availability preserves positive internal quantity and safely revives zero',()=>{
  assert.equal(buildSupplierChange({price:1,stock:27},1,true),null);
  assert.equal(buildSupplierChange({price:1,stock:27},1,false).stock,0);
  assert.equal(buildSupplierChange({price:1,stock:0},1,true).stock,1);
  assert.throws(()=>buildSupplierChange({price:1,stock:2},1,5),/فقط باید/);
});

test('pending and rejected batches delete while approved batches archive', () => {
  assert.equal(batchRemovalAction('pending'),'delete');
  assert.equal(batchRemovalAction('rejected'),'delete');
  assert.equal(batchRemovalAction('approved'),'archive');
});