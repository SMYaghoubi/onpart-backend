const test = require('node:test');
const assert = require('node:assert/strict');
const { applyApiNoStore } = require('../lib/apiCachePolicy');
test('dynamic API responses are private and never cached', () => {
  const headers = {};
  const res = {setHeader(name,value){headers[name.toLowerCase()]=value},vary(value){headers.vary=value}};
  let continued=false;
  applyApiNoStore({method:'GET'},res,()=>{continued=true});
  assert.match(headers['cache-control'],/private/);
  assert.match(headers['cache-control'],/no-store/);
  assert.equal(headers.pragma,'no-cache');
  assert.equal(headers.expires,'0');
  assert.equal(headers.vary,'Authorization');
  assert.equal(continued,true);
});