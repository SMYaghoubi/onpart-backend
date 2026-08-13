const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeProductCode,productCodeSqlExpression}=require('../lib/productCode');
const {MAX_ITEM_QUANTITY,isProductAvailable,normalizeCartItem}=require('../lib/cartValidation');
const {isProductInAllowedBrands}=require('../lib/supplierPricing');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('binary sentinel means purchasable, not a quantity cap',()=>{
  assert.equal(isProductAvailable({status:'active',stock:1}),true);
  assert.deepEqual(normalizeCartItem({product_id:5,quantity:2}),{valid:true,item:{product_id:5,quantity:2}});
  assert.deepEqual(normalizeCartItem({product_id:5,quantity:MAX_ITEM_QUANTITY}),{valid:true,item:{product_id:5,quantity:MAX_ITEM_QUANTITY}});
  assert.equal(normalizeCartItem({product_id:5,quantity:MAX_ITEM_QUANTITY+1}).valid,false);
  assert.equal(isProductAvailable({status:'active',stock:0}),false);
});

test('cart and order routes check availability without comparing or decrementing sentinel stock',()=>{
  const cart=read('routes/cart.js'),orders=read('routes/orders.js');
  assert.match(cart,/isProductAvailable\(product\)/);assert.doesNotMatch(cart,/quantity\s*>\s*Number\(product\.stock\)|quantity\s*>\s*stockById/);
  assert.match(orders,/p\.stock>0/);assert.match(orders,/normalizeCartItems/);
  assert.doesNotMatch(orders,/UPDATE products SET stock=stock-\?/);
});

test('product codes normalize case, Persian and Arabic digits, spaces, half-spaces and visual dashes',()=>{
  for(const value of ['ABC123','abc123','ABC\u06f1\u06f2\u06f3','ABC\u0661\u0662\u0663',' A B C 1 2 3 ','ABC\u200c123','ABC\u2014123'])assert.equal(normalizeProductCode(value),'abc123');
  assert.equal(normalizeProductCode('001-AbC'),'001abc');
  const sql=productCodeSqlExpression('p.code');assert.match(sql,/LOWER\(p\.code\)/);assert.match(sql,/REPLACE/);assert.throws(()=>productCodeSqlExpression('p.code;DROP'));
});

test('supplier lookup is canonical, retains original error code, enforces scope and approval updates matched product',()=>{
  const portal=read('routes/supplierPortal.js');
  assert.match(portal,/originalCode = String\(raw\.code/);assert.match(portal,/normalizeProductCode\(originalCode\)/);
  assert.match(portal,/productCodeSqlExpression\('code'\)/);assert.match(portal,/خارج از برندهای مجاز/);assert.match(portal,/محصول با کد «/);
  assert.equal(isProductInAllowedBrands({brand:'Bosch'},new Set(['Bosch'])),true);assert.equal(isProductInAllowedBrands({brand:'Valeo'},new Set(['Bosch'])),false);
  assert.match(portal,/UPDATE products SET price=\?,stock=CASE WHEN stock>0 THEN stock ELSE 1 END,supplier_id=\?/);
});
test('admin import and public search use canonical parameterized code matching',()=>{
  const products=read('routes/products.js');
  assert.match(products,/productCodeSqlExpression\('p\.code'\).*LIKE \?/);assert.match(products,/params\.push\(`%\$\{normalizedCode\}%`,\.\.\.Array\(3\)\.fill\(`%\$\{normalizedText\}%`\)\)/);
  assert.match(products,/productCodeSqlExpression\('code'\).*\?`/);assert.match(products,/\[normalizedCode\]/);
});