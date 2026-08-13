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
test('bulk available preserves positive stock and revives zero without a numeric value',async()=>{
  const {db,conn}=mockDb({products:[{id:1},{id:2}]});
  await bulkUpdateProducts(db,{ids:[1,2],fields:{available:true}});
  const update=conn.calls.find(call=>call.sql?.startsWith('UPDATE'));
  assert.match(update.sql,/stock=CASE WHEN stock>0 THEN stock ELSE 1 END/);
  assert.deepEqual(update.args,[1,2]);
});
test('bulk unavailable clears stock and absent availability leaves stock untouched',async()=>{
  const first=mockDb({products:[{id:1}],affectedRows:1});
  await bulkUpdateProducts(first.db,{ids:[1],fields:{available:false}});
  assert.match(first.conn.calls.find(call=>call.sql?.startsWith('UPDATE')).sql,/stock=0/);
  const second=mockDb({products:[{id:1}],affectedRows:1});
  await bulkUpdateProducts(second.db,{ids:[1],fields:{brand:'Bosch'}});
  assert.doesNotMatch(second.conn.calls.find(call=>call.sql?.startsWith('UPDATE')).sql,/stock=/);
});
test('bulk flow writes both 1 and 0 and combines with existing fields',async()=>{
  const enabled=mockDb({products:[{id:1},{id:2}]});
  await bulkUpdateProducts(enabled.db,{ids:[1,2],fields:{has_flow:1,brand:'Bosch'}});
  const enabledUpdate=enabled.conn.calls.find(call=>call.sql?.startsWith('UPDATE'));
  assert.match(enabledUpdate.sql,/has_flow=\?,brand=\?/);
  assert.deepEqual(enabledUpdate.args,[1,'Bosch',1,2]);

  const disabled=mockDb({products:[{id:3}],affectedRows:1});
  await bulkUpdateProducts(disabled.db,{ids:[3],fields:{has_flow:0}});
  const disabledUpdate=disabled.conn.calls.find(call=>call.sql?.startsWith('UPDATE'));
  assert.match(disabledUpdate.sql,/has_flow=\?/);
  assert.deepEqual(disabledUpdate.args,[0,3]);
});

test('bulk flow is untouched when has_flow was not enabled',async()=>{
  const unchanged=mockDb({products:[{id:1}],affectedRows:1});
  await bulkUpdateProducts(unchanged.db,{ids:[1],fields:{brand:'Bosch'}});
  assert.doesNotMatch(unchanged.conn.calls.find(call=>call.sql?.startsWith('UPDATE')).sql,/has_flow=/);
});
