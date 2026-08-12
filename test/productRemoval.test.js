const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {safelyRemoveProduct}=require('../lib/productRemoval');
const {managementAccessStatus}=require('../lib/managementAccess');

function mockDb({product={id:5,status:'active'},orders=0,supplier=0,pending=[]}={}){
  const calls=[];
  const conn={
    beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),
    execute:async(sql,args=[])=>{calls.push({sql,args});
      if(sql.startsWith('SELECT id,status FROM products'))return [[product].filter(Boolean)];
      if(sql.includes('has_order_history'))return [[{has_order_history:orders,has_supplier_history:supplier}]];
      if(sql.startsWith('SELECT DISTINCT batch_id'))return [pending.map(batch_id=>({batch_id}))];
      return [{affectedRows:1}];
    }
  };
  return {db:{getConnection:async()=>conn},calls};
}
const sqlCalls=calls=>calls.filter(call=>call&&call.sql);

test('product without history is deleted after cart cleanup',async()=>{
  const {db,calls}=mockDb();const result=await safelyRemoveProduct(db,5,1);
  assert.equal(result.action,'deleted');
  const sql=sqlCalls(calls).map(call=>call.sql);
  assert.ok(sql.some(query=>query==='DELETE FROM cart_items WHERE product_id=?'));
  assert.ok(sql.some(query=>query==='DELETE FROM products WHERE id=?'));
  assert.ok(calls.includes('commit'));assert.ok(calls.includes('release'));
});

test('historical order archives product and preserves order records',async()=>{
  const {db,calls}=mockDb({orders:1});const result=await safelyRemoveProduct(db,5,9);
  assert.equal(result.action,'archived');assert.match(result.message,/سوابق سفارش و مالی/);
  const sql=sqlCalls(calls).map(call=>call.sql);
  assert.ok(sql.some(query=>query.includes('UPDATE products SET status="inactive",stock=0')));
  assert.equal(sql.some(query=>query.startsWith('DELETE FROM order_items')),false);
  assert.equal(sql.some(query=>query==='DELETE FROM products WHERE id=?'),false);
});

test('supplier pending relation is rejected safely and its audit row remains',async()=>{
  const {db,calls}=mockDb({supplier:1,pending:[17]});await safelyRemoveProduct(db,5,3);
  const sql=sqlCalls(calls).map(call=>call.sql);
  assert.ok(sql.some(query=>query.startsWith('UPDATE supplier_update_items')));
  assert.ok(sql.some(query=>query.startsWith('UPDATE supplier_update_batches')));
  assert.equal(sql.some(query=>query.startsWith('DELETE FROM supplier_update_items')),false);
});

test('repeated removal of archived product is idempotent',async()=>{
  const {db,calls}=mockDb({product:{id:5,status:'inactive'}});const result=await safelyRemoveProduct(db,5,1);
  assert.equal(result.action,'archived');assert.match(result.message,/قبلاً/);
  assert.equal(sqlCalls(calls).some(call=>call.sql.includes('has_order_history')),false);
  assert.ok(calls.includes('commit'));
});

test('invalid or missing product returns a clear error',async()=>{
  await assert.rejects(()=>safelyRemoveProduct({},'bad',1),error=>error.status===400&&/شناسه/.test(error.message));
  const {db}=mockDb({product:null});await assert.rejects(()=>safelyRemoveProduct(db,5,1),error=>error.status===404&&/یافت نشد/.test(error.message));
});

test('DELETE route remains admin protected and storefront queries only active products',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../routes/products.js'),'utf8');
  assert.match(source,/router\.delete\('\/:id', adminAuth/);
  assert.equal(managementAccessStatus('user','user',true),403);
  assert.equal(managementAccessStatus('supplier',null,true),403);
  assert.equal(managementAccessStatus('admin','admin',true),200);
  assert.match(source,/where = \['p\.status="active"'\]/);
  assert.doesNotMatch(source,/DELETE FROM order_items/);
});