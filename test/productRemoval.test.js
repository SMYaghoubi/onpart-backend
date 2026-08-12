const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {safelyRemoveProduct,safelyRemoveProducts,normalizeProductIds,BULK_REMOVE_CHUNK_SIZE}=require('../lib/productRemoval');
const {managementAccessStatus}=require('../lib/managementAccess');

function mockDb({products=[{id:5,status:'active'}],orderIds=[],supplierIds=[],pendingByProduct={},failChunks=[]}={}){
  const calls=[],productMap=new Map(products.map(product=>[Number(product.id),{...product}]));
  const conn={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),execute:async(sql,args=[])=>{
    calls.push({sql,args});
    if(sql.startsWith('SELECT id,status FROM products')){
      if(failChunks.some(id=>args.includes(id)))throw new Error('خطای آزمایشی بخش');
      return [args.filter(id=>productMap.has(Number(id))).map(id=>productMap.get(Number(id)))];
    }
    if(sql.startsWith('DELETE FROM cart_items'))return [{affectedRows:args.length}];
    if(sql.includes('SELECT DISTINCT product_id FROM order_items')){
      const half=args.length/2,ids=args.slice(0,half),history=new Set([...orderIds,...supplierIds]);
      return [ids.filter(id=>history.has(Number(id))).map(product_id=>({product_id}))];
    }
    if(sql.startsWith('DELETE FROM products')){args.forEach(id=>productMap.delete(Number(id)));return [{affectedRows:args.length}]}
    if(sql.startsWith('SELECT DISTINCT batch_id'))return [args.flatMap(id=>(pendingByProduct[id]||[]).map(batch_id=>({batch_id})))];
    if(sql.startsWith('UPDATE products SET status=')){args.forEach(id=>{const p=productMap.get(Number(id));if(p){p.status='inactive'}});return [{affectedRows:args.length}]}
    return [{affectedRows:1}];
  }};
  return {db:{getConnection:async()=>conn},calls,productMap};
}
const sqlCalls=calls=>calls.filter(call=>call&&call.sql);

test('bulk normalizes and deduplicates ids with a safe upper limit',()=>{
  assert.deepEqual(normalizeProductIds([3,'3',4]),[3,4]);
  assert.throws(()=>normalizeProductIds([]),/حداقل/);assert.throws(()=>normalizeProductIds([0]),/نامعتبر/);
  assert.throws(()=>normalizeProductIds(Array.from({length:5001},(_,i)=>i+1)),/حداکثر/);
});

test('product without history is deleted after cart cleanup',async()=>{
  const {db,calls}=mockDb();const result=await safelyRemoveProduct(db,5,1);
  assert.equal(result.action,'deleted');const sql=sqlCalls(calls).map(call=>call.sql);
  assert.ok(sql.some(query=>query.startsWith('DELETE FROM cart_items')));assert.ok(sql.some(query=>query.startsWith('DELETE FROM products')));
});

test('historical orders archive products and preserve order and financial records',async()=>{
  const {db,calls}=mockDb({orderIds:[5]});const result=await safelyRemoveProduct(db,5,9);
  assert.equal(result.action,'archived');assert.match(result.message,/سوابق سفارش و مالی/);
  const sql=sqlCalls(calls).map(call=>call.sql);assert.ok(sql.some(query=>query.startsWith('UPDATE products SET status=')));
  assert.equal(sql.some(query=>query.startsWith('DELETE FROM order_items')),false);assert.equal(sql.some(query=>query.startsWith('DELETE FROM invoices')),false);
});

test('supplier pending relations are rejected safely while audit rows remain',async()=>{
  const {db,calls}=mockDb({supplierIds:[5],pendingByProduct:{5:[17]}});await safelyRemoveProduct(db,5,3);
  const sql=sqlCalls(calls).map(call=>call.sql);assert.ok(sql.some(query=>query.startsWith('UPDATE supplier_update_items')));
  assert.ok(sql.some(query=>query.startsWith('UPDATE supplier_update_batches')));assert.equal(sql.some(query=>query.startsWith('DELETE FROM supplier_update_items')),false);
});

test('bulk mixes hard delete, archive and already removed products with honest counts',async()=>{
  const {db,calls}=mockDb({products:[{id:1,status:'active'},{id:2,status:'active'},{id:3,status:'inactive'}],orderIds:[2]});
  const result=await safelyRemoveProducts(db,[1,2,3,999],7,{chunkSize:100});
  assert.deepEqual({deleted:result.deleted,archived:result.archived,skipped:result.skipped,failed:result.failed},{deleted:1,archived:2,skipped:1,failed:0});
  assert.match(result.message,/حذف کامل/);assert.match(result.message,/آرشیو/);
  assert.equal(calls.filter(call=>call==='begin').length,1);
});

test('2512 products are processed in bounded chunks without per-product transactions',async()=>{
  const products=Array.from({length:2512},(_,i)=>({id:i+1,status:'active'}));const {db,calls}=mockDb({products});
  const result=await safelyRemoveProducts(db,products.map(p=>p.id),1);
  assert.equal(result.deleted,2512);assert.equal(result.failed,0);
  assert.equal(calls.filter(call=>call==='begin').length,Math.ceil(2512/BULK_REMOVE_CHUNK_SIZE));
  assert.ok(sqlCalls(calls).every(call=>!call.sql.includes('DELETE FROM order_items')));
});

test('one failed chunk produces a partial result and later chunks continue',async()=>{
  const products=Array.from({length:205},(_,i)=>({id:i+1,status:'active'}));const {db}=mockDb({products,failChunks:[101]});
  const result=await safelyRemoveProducts(db,products.map(p=>p.id),1,{chunkSize:100});
  assert.deepEqual({deleted:result.deleted,failed:result.failed},{deleted:105,failed:100});assert.equal(result.errors.length,1);assert.match(result.errors[0].message,/آزمایشی/);
});

test('repeated bulk removal is idempotent and missing ids are skipped',async()=>{
  const state=mockDb({products:[{id:1,status:'active'}]});const first=await safelyRemoveProducts(state.db,[1],1);const second=await safelyRemoveProducts(state.db,[1],1);
  assert.equal(first.deleted,1);assert.equal(second.skipped,1);assert.equal(second.failed,0);
});

test('single invalid or missing product returns a clear error',async()=>{
  await assert.rejects(()=>safelyRemoveProduct({},'bad',1),error=>error.status===400&&/شناسه/.test(error.message));
  const {db}=mockDb({products:[]});await assert.rejects(()=>safelyRemoveProduct(db,5,1),error=>error.status===404&&/یافت نشد/.test(error.message));
});

test('bulk route precedes parameter route, stays admin protected and storefront is active-only',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../routes/products.js'),'utf8');
  const bulk=source.indexOf("router.post('/bulk-delete', adminAuth"),single=source.indexOf("router.delete('/:id', adminAuth");
  assert.ok(bulk>0&&single>bulk);assert.match(source,/safelyRemoveProducts\(db,req\.body\.ids,req\.user\.id\)/);
  assert.equal(managementAccessStatus('user','user',true),403);assert.equal(managementAccessStatus('supplier',null,true),403);assert.equal(managementAccessStatus('admin','admin',true),200);
  assert.match(source,/where = \['p\.status="active"'\]/);assert.doesNotMatch(source,/DELETE FROM order_items/);
});