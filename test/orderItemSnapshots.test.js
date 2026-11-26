const test=require('node:test'),assert=require('node:assert/strict');
const {itemSnapshot,orderItemSnapshotSchema}=require('../lib/orderItemSnapshots');
test('a draft edit retains the original supplier, agreed unit cost and product labels',()=>{
 const old={supplier_id:1,supplier_price_known:1,cost_price:'100000',snapshot_code:'OLD',snapshot_name:'نام قبلی',snapshot_brand:'برند قبلی',car_name:'خودروی قبلی'};
 assert.deepEqual(itemSnapshot({supplier_id:2,cost_price:50000,code:'NEW'},old),{supplierId:1,priceKnown:1,costPrice:'100000',code:'OLD',name:'نام قبلی',brand:'برند قبلی',car:'خودروی قبلی'});
});
test('a catalog selling-price fallback is not presented as a confirmed supplier price',()=>{
 assert.equal(itemSnapshot({supplier_id:1,cost_price:50000}).priceKnown,0);
 assert.equal(itemSnapshot({supplier_id:1,cost_price:0,supplier_cost_price:0}).priceKnown,1);
 assert.equal(itemSnapshot({cost_price:50000,supplier_cost_price:30000}).supplierId,null);
 assert.equal(itemSnapshot({supplier_id:2,cost_price:100},{supplier_id:null,cost_price:50}).supplierId,null);
});
test('schema initialization shares one connection/lock and retries after transient failure',async()=>{
 let attempts=0,released=0,fail=true;
 const db={getConnection:async()=>{attempts++;return {query:async sql=>{if(sql.includes('GET_LOCK'))return [[{acquired:1}]];if(fail&&!sql.includes('RELEASE_LOCK')){fail=false;throw new Error('isolated failure');}return [[]];},release:()=>{released++;}};}};
 const ensure=orderItemSnapshotSchema(db);
 await assert.rejects(ensure(),/isolated failure/);
 await Promise.all([ensure(),ensure()]);
 assert.equal(attempts,2);assert.equal(released,2);
});
