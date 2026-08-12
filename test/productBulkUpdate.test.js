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