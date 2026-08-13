const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeProductText,mapProductFilterMetadata}=require('../lib/productSearch');
const route=fs.readFileSync(path.join(__dirname,'..','routes/products.js'),'utf8');

test('Persian product text normalization handles digits, Arabic letters, spacing and dashes',()=>{
  assert.equal(normalizeProductText('  كيت  ياتاق ۱۲٣ '),'کیت یاتاق 123');
  assert.equal(normalizeProductText('گروه‌ کالا',{compact:true}),'گروهکالا');
  assert.equal(normalizeProductText('ABC—۱۲۳',{compact:true}),'abc123');
});

test('free search is OR across code, description, brand and category but excludes car',()=>{
  const searchBlock=route.slice(route.indexOf('if (search)'),route.indexOf('if (car)'));
  for(const field of ['p.code','p.description','p.brand','p.category'])assert.match(searchBlock,new RegExp(field.replace('.','\\.')));
  assert.doesNotMatch(searchBlock,/p\.car/);
  assert.match(searchBlock,/params\.push\([^;]+Array\(3\)\.fill/);
});

test('selected car, brand and category filters are normalized, parameterized and ANDed',()=>{
  for(const field of ['car','brand','category']){
    assert.match(route,new RegExp(`if \\(${field}\\)[^\\n]+where\\.push\\([^\\n]+\\?`));
    assert.match(route,new RegExp(`normalizeProductText\\(${field},\\{compact:true\\}\\)`));
  }
});

test('metadata deduplicates normalized labels, drops blanks and sorts naturally in Persian',()=>{
  const metadata=mapProductFilterMetadata([
    {type:'car',value:'  پژو ۲۰۶ '},{type:'car',value:'پژو ٢٠٦'},{type:'car',value:'—'},
    {type:'brand',value:' سايپا '},{type:'brand',value:'سایپا'},{type:'brand',value:null},
    {type:'category',value:'گروه ۱۰'},{type:'category',value:'گروه ۲'},{type:'category',value:'  '}
  ]);
  assert.deepEqual(metadata.cars,['پژو ۲۰۶']);
  assert.deepEqual(metadata.brands,['سايپا']);
  assert.deepEqual(metadata.categories,['گروه ۲','گروه ۱۰']);
});

test('metadata endpoint reads only active products and disables response caching',()=>{
  const metadataRoute=route.slice(route.indexOf("router.get('/metadata'"),route.indexOf("router.get('/:id'"));
  assert.match(metadataRoute,/status='active'/);
  assert.match(metadataRoute,/SELECT DISTINCT 'car'.+UNION ALL.+SELECT DISTINCT 'brand'.+UNION ALL.+SELECT DISTINCT 'category'/s);
  assert.match(metadataRoute,/Cache-Control','no-store, private'/);
});
