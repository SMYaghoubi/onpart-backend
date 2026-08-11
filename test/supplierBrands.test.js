const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrand,brandKey,mapSupplierBrands}=require('../lib/supplierBrands');

test('real product brands are normalized, deduplicated, counted and Persian-sorted',()=>{
  const rows=[
    {brand:'  بوش ',product_count:2},
    {brand_name:'بوش',product_count:3},
    {brand:'ایساکو',product_count:1},
    {brand:'  ',product_count:10},
    {brand:null,product_count:1}
  ];
  const result=mapSupplierBrands(rows);
  assert.equal(result.length,2);
  assert.equal(result.find(row=>brandKey(row.brand)===brandKey('بوش')).product_count,5);
  assert.equal(normalizeBrand('  ایساکو  '),'ایساکو');
  assert.deepEqual([...result].sort((a,b)=>a.brand.localeCompare(b.brand,'fa',{sensitivity:'base',numeric:true})),result);
});
