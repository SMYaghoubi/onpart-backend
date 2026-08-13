const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBulkProductUpdate,buildBulkProductUpdate}=require('../lib/productBulkUpdate');

test('bulk supplier can be set or explicitly cleared',()=>{
  assert.deepEqual(normalizeBulkProductUpdate([3,3,4],{supplier_id:12}),{ids:[3,4],fields:{supplier_id:12}});
  assert.deepEqual(normalizeBulkProductUpdate([3],{supplier_id:null}).fields,{supplier_id:null});
});
test('invalid supplier and unsafe product ids are rejected',()=>{
  assert.throws(()=>normalizeBulkProductUpdate([1],{supplier_id:-2}),/تأمین‌کننده/);
  assert.throws(()=>normalizeBulkProductUpdate(['x'],{supplier_id:2}),/شناسه محصول/);
});
test('bulk availability accepts only a boolean and numeric stock is rejected',()=>{
  const normalized=normalizeBulkProductUpdate([1],{available:true});
  const query=buildBulkProductUpdate({});
  assert.deepEqual(normalized.fields,{available:true});
  assert.deepEqual(query.assignments,[]);
  assert.throws(()=>normalizeBulkProductUpdate([1],{stock:8}),/قابل ویرایش گروهی نیست/);
  assert.equal('supplier_id' in normalized.fields,false);
});
test('bulk flow supports both دارد and ندارد without dropping false',()=>{
  assert.deepEqual(normalizeBulkProductUpdate([1,1,2],{has_flow:true}),{ids:[1,2],fields:{has_flow:1}});
  assert.deepEqual(normalizeBulkProductUpdate([3],{has_flow:false}).fields,{has_flow:0});
  assert.deepEqual(normalizeBulkProductUpdate([4],{has_flow:0,brand:'Bosch'}).fields,{has_flow:0,brand:'Bosch'});
  assert.throws(()=>normalizeBulkProductUpdate([1],{has_flow:2}),/فقط باید/);
});

test('bulk flow remains untouched when the field is absent',()=>{
  const normalized=normalizeBulkProductUpdate([1],{brand:'Bosch'});
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.fields,'has_flow'),false);
});
test('bulk edit endpoint remains admin protected',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'..','routes','products.js'),'utf8');
  assert.match(source,/router\.patch\('\/bulk', adminAuth/);
});
