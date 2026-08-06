const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(path.join(__dirname,'../migrations/015_create_payment_allocations.sql'),'utf8');

test('migration 015 creates idempotent allocation ledger and FIFO backfill',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS payment_allocations/);
  assert.match(sql,/UNIQUE KEY uq_payment_allocation_order \(payment_id,order_id\)/);
  assert.match(sql,/ON DUPLICATE KEY UPDATE amount=VALUES\(amount\)/);
  assert.match(sql,/ORDER BY paid_at,payment_id/);
  assert.match(sql,/ORDER BY created_at,order_id/);
  assert.match(sql,/UPDATE payments p[\s\S]*WHERE p\.order_id IS NULL/);
  assert.match(sql,/UPDATE users u[\s\S]*SET u\.debt=/);
});

test('migration preserves excess as payment balance rather than inventing credit',()=>{
  assert.doesNotMatch(sql,/UPDATE users SET credit|credit_limit/);
  assert.match(sql,/GREATEST\(p\.amount-COALESCE\(a\.allocated_amount,0\),0\) remaining_amount/);
});
