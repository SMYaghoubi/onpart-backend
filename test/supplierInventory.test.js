const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuantity, parseSupplierPrice, proposedInventory, normalizeNewProduct, supplierInventorySchema, saveSupplierInventory } = require('../lib/supplierInventory');

test('supplier quantity is independent from shop availability and disabling preserves count', () => {
  const product = { stock:1, quantity:8, supplier_available:1 };
  assert.deepEqual(proposedInventory({available:false}, product), { quantity:null,stock:0 });
  assert.deepEqual(proposedInventory({quantity:3}, product), { quantity:3,stock:null });
  assert.deepEqual(proposedInventory({quantity:0}, product), { quantity:0,stock:0 });
  assert.deepEqual(proposedInventory({available:true}, {...product,stock:0,supplier_available:0}), { quantity:null,stock:1 });
  assert.throws(() => proposedInventory({available:true}, {...product,quantity:0}), /بیشتر از صفر/);
  assert.throws(() => proposedInventory({quantity:0,available:true}, product), /بیشتر از صفر/);
});

test('new product proposals require a code and allowed brand and zero remains unavailable', () => {
  const allowed = new Set(['خاتم','پولاسا']);
  const base = {code:'KH-106',description:'شلنگ',brand:'خاتم',quantity:0,supplier_price:200000};
  assert.deepEqual(normalizeNewProduct(base,allowed),{code:'KH-106',description:'شلنگ',brand:'خاتم',price:200000,quantity:0,available:false});
  assert.throws(() => normalizeNewProduct({...base,brand:'دیگر'},allowed), /برند/);
  assert.throws(() => normalizeNewProduct({...base,code:' '},allowed), /کد/);
  assert.throws(() => parseQuantity(-5));
  assert.throws(() => parseQuantity('3.4'));
  assert.throws(() => parseSupplierPrice(true));
  assert.equal(parseQuantity('0'),0);
});

test('supplier inventory upsert preserves false, zero and unmodified values', async () => {
  const calls = [];
  const conn = { execute: async (...args) => calls.push(args) };
  await saveSupplierInventory(conn, 5, 9, { available:false,quantity:0 });
  assert.match(calls[0][0],/COALESCE\(VALUES\(quantity\),quantity\)/);
  assert.deepEqual(calls[0][1],[5,9,0,null,false,null]);
});

test('inventory schema initializes once across concurrent authenticated calls', async () => {
  const calls = [];
  const ensure = supplierInventorySchema({query: async statement => calls.push(statement)});
  await Promise.all([ensure(),ensure()]);
  assert.equal(calls.length,4);
  assert.ok(calls.every(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS')));
});
