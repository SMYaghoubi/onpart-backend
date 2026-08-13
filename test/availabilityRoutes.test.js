const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const products=fs.readFileSync(path.join(__dirname,'../routes/products.js'),'utf8');
const supplier=fs.readFileSync(path.join(__dirname,'../routes/supplierPortal.js'),'utf8');

test('admin product APIs accept availability, reject numeric stock and hide internal quantities',()=>{
  assert.match(products,/req\.query\.admin==='1'\?adminAuth/);
  assert.match(products,/const \{stock,min_stock,\.\.\.managementProduct\}=row/);
  assert.match(products,/hasOwnProperty\.call\(req\.body,'stock'\)/);
  assert.match(products,/stockForAvailability\(current\.stock/);
  assert.match(products,/stockForAvailability\((?:existing\[0\]|current)\.stock/);
});
test('supplier submit and review APIs accept availability only and approval preserves positives',()=>{
  assert.match(supplier,/raw\.available/);assert.match(supplier,/req\.body\.available/);
  assert.match(supplier,/proposed_available/);assert.match(supplier,/previous_available/);
  assert.match(supplier,/stock=CASE WHEN stock>0 THEN stock ELSE 1 END/);
  assert.match(supplier,/hasOwnProperty\.call\(raw,'stock'\)/);
  assert.match(supplier,/hasOwnProperty\.call\(req\.body,'stock'\)/);
});