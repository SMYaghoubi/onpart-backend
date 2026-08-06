const test=require('node:test');
const assert=require('node:assert/strict');
const {calculateOrderDebt}=require('../lib/debtReconciliation');

test('canonical debt is order total minus approved payments',()=>{
  assert.equal(calculateOrderDebt(100000,0,'pending_payment'),100000);
  assert.equal(calculateOrderDebt(100000,35000,'pending_payment'),65000);
  assert.equal(calculateOrderDebt(100000,100000,'preparing'),0);
  assert.equal(calculateOrderDebt(100000,130000,'preparing'),0);
});

test('draft, rejected/cancelled workflow does not create debt',()=>{
  assert.equal(calculateOrderDebt(100000,0,'pending_customer'),0);
  assert.equal(calculateOrderDebt(100000,0,'cancelled'),0);
});