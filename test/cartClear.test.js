const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','routes','cart.js'),'utf8');

test('clear cart requires shop auth and deletes only the current user cart',()=>{
  const route=source.slice(source.indexOf("router.delete('/', auth"),source.indexOf('module.exports'));
  assert.match(route,/router\.delete\('\/', auth/);
  assert.match(route,/DELETE FROM cart_items WHERE user_id=\?/);
  assert.match(route,/\[req\.user\.id\]/);
  assert.doesNotMatch(route,/req\.body|req\.params/);
});

test('clear cart is idempotent and does not require an affected row',()=>{
  const route=source.slice(source.indexOf("router.delete('/', auth"),source.indexOf('module.exports'));
  assert.match(route,/res\.json\(\{ message: 'سبد خرید خالی شد' \}\)/);
  assert.doesNotMatch(route,/affectedRows|404|409/);
});
