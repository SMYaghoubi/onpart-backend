const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const retryPath=require.resolve('../lib/databaseRetry');
const route=fs.readFileSync(path.join(__dirname,'..','routes/products.js'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

test('fresh retry module reconnects through the pool after a transient cold-start failure',async()=>{
  delete require.cache[retryPath];
  const {executeWithRetry}=require('../lib/databaseRetry');
  let calls=0;
  const pool={execute:async()=>{calls++;if(calls===1)throw Object.assign(new Error('server has gone away'),{code:'PROTOCOL_CONNECTION_LOST',fatal:true});return [[{id:1,status:'active'}]]}};
  const result=await executeWithRetry(pool,'SELECT * FROM products',[],{attempts:2,baseDelayMs:0,waitFn:async()=>{}});
  assert.equal(calls,2);assert.equal(result[0][0].id,1);
});

test('non-transient database errors are not retried',async()=>{
  const {executeWithRetry}=require('../lib/databaseRetry');let calls=0;
  await assert.rejects(()=>executeWithRetry({execute:async()=>{calls++;throw Object.assign(new Error('bad column'),{code:'ER_BAD_FIELD_ERROR'})}},'SELECT bad',[],{attempts:3,waitFn:async()=>{}}),/bad column/);
  assert.equal(calls,1);
});

test('product and metadata reads retry independently and require no warm in-memory state',()=>{
  assert.match(route,/executeWithRetry\(db,sql,params\)/);
  assert.match(route,/executeWithRetry\(db,`[\s\S]*SELECT DISTINCT 'car'/);
  assert.match(route,/p\.status="active"/);
  const readRoutes=route.slice(0,route.indexOf("// GET /api/products/:id"));
  assert.doesNotMatch(readRoutes,/cache\.get|new Map\(/i);
  assert.match(route,/PRODUCTS_UNAVAILABLE/);assert.match(route,/PRODUCT_METADATA_UNAVAILABLE/);
});

test('health checks the database and reports degraded readiness without resetting data',()=>{
  assert.match(server,/app\.get\('\/health', async/);
  assert.match(server,/executeWithRetry\(db,'SELECT 1 AS ok'/);
  assert.match(server,/status:'degraded',database:'unavailable'/);
  assert.doesNotMatch(server,/schema\.sql|INSERT INTO products|DELETE FROM products/);
});
