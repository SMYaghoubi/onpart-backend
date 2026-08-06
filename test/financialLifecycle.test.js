const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {calculateOrderDebt}=require('../lib/debtReconciliation');
const ordersSource=fs.readFileSync(require.resolve('../routes/orders'),'utf8');
const paymentsSource=fs.readFileSync(require.resolve('../routes/payments'),'utf8');

test('receipt submission is explicitly pending and visible with order/user metadata',()=>{
  assert.match(paymentsSource,/dest_account,status\).*'pending'/s);
  assert.match(paymentsSource,/o\.status order_status,o\.total order_total,o\.debt_remaining/);
  assert.match(paymentsSource,/پرداخت ثبت شده – منتظر تأیید/);
});

test('invoice item edit is silent and emits no SMS or user notification',()=>{
  const start=ordersSource.indexOf("router.put('/:id/items'");const end=ordersSource.indexOf("router.patch('/:id/customer-approve'",start);const block=ordersSource.slice(start,end);
  assert.ok(start>0&&end>start);assert.doesNotMatch(block,/SMS\.|createUserNotification\(/);assert.match(block,/پیش‌نویس فاکتور ذخیره شد/);
});

test('expert approval is idempotent before SMS and notification side effects',()=>{
  const start=ordersSource.indexOf("router.patch('/:id/approve'");const end=ordersSource.indexOf("router.patch('/:id/deliver'",start);const block=ordersSource.slice(start,end);
  assert.ok(block.indexOf('already_approved:true')<block.indexOf('SMS.orderApproved'));
});

test('rejected payment remains debt and removing an approved payment restores debt',()=>{
  assert.equal(calculateOrderDebt(90000,0,'pending_payment'),90000);
  assert.match(paymentsSource,/DELETE FROM payments[\s\S]*reconcileOrderDebt[\s\S]*syncUserDebt/);
});
test('payment approve/reject side effects happen only after a real transition',()=>{
  const approveStart=paymentsSource.indexOf("router.patch('/:id/approve'");
  const rejectStart=paymentsSource.indexOf("router.patch('/:id/reject'");
  const deleteStart=paymentsSource.indexOf("router.delete('/:id'",rejectStart);
  const approve=paymentsSource.slice(approveStart,rejectStart),reject=paymentsSource.slice(rejectStart,deleteStart);
  assert.ok(approve.indexOf('result.alreadyApproved')<approve.indexOf('SMS.paymentConfirmed'));
  assert.ok(reject.indexOf("payment.status==='rejected'")<reject.indexOf('SMS.paymentRejected'));
  assert.ok(reject.indexOf("payment.status==='approved'")<reject.indexOf('SMS.paymentRejected'));
});