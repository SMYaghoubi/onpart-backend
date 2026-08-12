const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('supplier capability migration links membership without mutating primary roles',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../migrations/017_link_suppliers_to_users.sql'),'utf8');
  assert.match(sql,/ADD COLUMN user_id/);
  assert.match(sql,/FOREIGN KEY \(user_id\) REFERENCES users\(id\)/);
  assert.doesNotMatch(sql,/UPDATE\s+users\s+SET\s+role/i);
  assert.match(sql,/COUNT\(\*\)=1/);
});
test('supplier login issues an isolated supplier context and never writes users.role',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../routes/supplierPortal.js'),'utf8');
  assert.match(source,/supplier_id:\s*supplier\.id/);
  assert.match(source,/role:\s*'supplier'/);
  assert.doesNotMatch(source,/UPDATE\s+users\s+SET\s+role/i);
  assert.match(source,/supplier\.status\s*!==\s*'approved'/);
  assert.match(source,/!supplier\.portal_enabled/);
});
test('promoting a linked supplier user does not remove supplier membership',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../routes/users.js'),'utf8');
  assert.doesNotMatch(source,/DELETE\s+FROM\s+suppliers/i);
  assert.doesNotMatch(source,/UPDATE\s+suppliers\s+SET\s+user_id\s*=\s*NULL/i);
});