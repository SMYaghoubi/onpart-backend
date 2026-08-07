const test=require('node:test');
const assert=require('node:assert/strict');
const {bulkUpdateProducts}=require('../lib/bulkProductsService');
function mockDb({supplier=true,products=[{id:1},{id:2}],affectedRows=2}={}){
  const calls=[];const conn={calls,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),execute:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT id FROM suppliers'))return [supplier?[{id:args[0]}]:[]];if(sql.startsWith('SELECT id FROM products'))return [products];return [{affectedRows}]}};
  return {db:{getConnection:async()=>conn},conn};
}
test('sets an approved supplier transactionally',async()=>{
  const {db,conn}=mockDb();const result=await bulkUpdateProducts(db,{ids:[1,2],fields:{supplier_id:7}});
  const update=conn.calls.find(call=>call.sql?.startsWith('UPDATE'));
  assert.match(update.sql,/supplier_id=\?/);assert.deepEqual(update.args,[7,1,2]);assert.equal(result.updated,2);assert.ok(conn.calls.includes('commit'));assert.ok(conn.calls.includes('release'));
});
test('clears nullable supplier without supplier lookup',async()=>{
  const {db,conn}=mockDb({products:[{id:3}],affectedRows:1});await bulkUpdateProducts(db,{ids:[3],fields:{supplier_id:null}});
  assert.equal(conn.calls.some(call=>call.sql?.startsWith('SELECT id FROM suppliers')),false);
  assert.deepEqual(conn.calls.find(call=>call.sql?.startsWith('UPDATE')).args,[null,3]);
});
test('rejects an invalid supplier and rolls back',async()=>{
  const {db,conn}=mockDb({supplier:false});await assert.rejects(()=>bulkUpdateProducts(db,{ids:[1],fields:{supplier_id:999}}),error=>error.status===400);
  assert.ok(conn.calls.includes('rollback'));assert.equal(conn.calls.some(call=>call.sql?.startsWith('UPDATE')),false);
});