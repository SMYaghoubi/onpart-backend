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
test('unchecked supplier is untouched because absent fields are not generated',()=>{
  const normalized=normalizeBulkProductUpdate([1],{stock:8});
  const query=buildBulkProductUpdate(normalized.fields);
  assert.deepEqual(query.assignments,['stock=?']);assert.deepEqual(query.values,[8]);assert.equal('supplier_id' in normalized.fields,false);
});
