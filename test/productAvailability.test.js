const test=require('node:test');
const assert=require('node:assert/strict');
const {parseAvailability,stockForAvailability,availabilityLabel}=require('../lib/productAvailability');

test('availability mapping preserves positive quantity, revives zero and clears unavailable',()=>{
  assert.equal(stockForAvailability(42,true),42);
  assert.equal(stockForAvailability(0,true),1);
  assert.equal(stockForAvailability(42,false),0);
  assert.equal(availabilityLabel(7),'موجود');
  assert.equal(availabilityLabel(0),'ناموجود');
});
test('new APIs reject numeric stock while explicit legacy parsing warns and becomes boolean',()=>{
  assert.deepEqual(parseAvailability('موجود'),{available:true,legacy:false});
  assert.deepEqual(parseAvailability(false),{available:false,legacy:false});
  assert.throws(()=>parseAvailability(12),/فقط باید/);
  const legacy=parseAvailability(12,{allowLegacy:true});
  assert.equal(legacy.available,true);assert.equal(legacy.legacy,true);assert.match(legacy.warning,/ذخیره نشد/);
});