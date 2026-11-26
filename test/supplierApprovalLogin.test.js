const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

function load(file, mocks) {
  const filename = path.join(__dirname, '..', file), native = createRequire(filename), module = { exports:{} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(filename, 'utf8'))(
    name => Object.hasOwn(mocks,name) ? mocks[name] : native(name), module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

async function setup(t) {
  process.env.JWT_SECRET = 'isolated-supplier-approval-test';
  process.env.UPLOAD_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'onpart-approval-'));
  const uploadPath = process.env.UPLOAD_PATH;
  const state = { id:42, company:'test supplier', name:'test owner', mobile:'09120000000', status:'pending', portal_enabled:0, user_id:null, brands:'ايساكو، سایپایدک' };
  const users = [{id:9,role:'admin',status:'active'},{id:101,role:'user',status:'active'}];
  const writes = [], smsCalls = [], scopes = [], catalog = [{brand:'ISACO | ایساکو'}, {brand:'سایپا یدک'}, {brand:'بوش'}];
  let before, failBrand = false;
  const conn = {
    beginTransaction:async () => { before={state:{...state},scopes:structuredClone(scopes)}; },
    commit:async () => { before=null; },
    rollback:async () => { if(before){Object.assign(state,before.state);scopes.splice(0,scopes.length,...before.scopes);before=null;} },
    release:() => {},
    execute:(sql,params) => db.execute(sql,params)
  };
  const db = { execute:async (sql, params) => {
    if (sql.startsWith('SELECT id,role,status FROM users')) return [users.filter(user => user.id === Number(params[0]))];
    if (sql.startsWith('SELECT * FROM suppliers WHERE id=')) return [[...(Number(params[0]) === state.id ? [{...state}] : [])]];
    if(sql.startsWith('SELECT DISTINCT TRIM(brand)')) return [catalog];
    if(sql.startsWith('DELETE FROM supplier_product_scopes')){writes.push({sql,params});for(let i=scopes.length-1;i>=0;i--)if(scopes[i].supplier_id===Number(params[0])&&scopes[i].scope_type==='brand')scopes.splice(i,1);return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO supplier_product_scopes')){
      if(failBrand) throw new Error('isolated insert failure');
      writes.push({sql,params});scopes.push({supplier_id:Number(params[0]),scope_type:'brand',scope_value:params[1],created_by:params[2]});return [{affectedRows:1}];
    }
    if(sql.includes('SELECT p.id,COALESCE(inv.manufacturer_code')) return [[...catalog.map((p,i)=>({id:i+1,brand:p.brand,available:1})).filter(p=>scopes.some(s=>s.supplier_id===Number(params[0])&&s.scope_value===p.brand))]];
    if(sql.startsWith('SELECT scope_value FROM supplier_product_scopes'))return [scopes.filter(s=>s.supplier_id===Number(params[0])&&s.scope_type==='brand')];
    if(sql.includes('FROM supplier_new_product_requests')) return [[]];
    if (sql.startsWith('SELECT u.id FROM users')) return [[{id:101}]];
    if (sql.startsWith('UPDATE suppliers SET status="approved"')) {
      writes.push({sql,params});state.status='approved';
      if (sql.includes('portal_enabled=1')) state.portal_enabled=1;
      state.user_id ??= params[0];return [{affectedRows:1}];
    }
    if (sql.startsWith('SELECT id,company,name,mobile,status,portal_enabled')) {
      const matches = sql.includes('WHERE id=?') ? Number(params[0]) === state.id : params[0] === state.mobile;
      return [matches ? [{...state}] : []];
    }
    throw new Error('Unexpected test SQL: ' + sql);
  }};
  db.getConnection=async()=>conn;
  const sms = {
    supplierApproved:async (...args) => smsCalls.push(['approved',...args]),
    sendOTP:async phone => smsCalls.push(['otp',phone]),
    verifyOTP:async (phone, code) => phone === state.mobile && code === '12345'
  };
  const auth = load('middleware/auth.js', {'../config/database':db});
  const common = {'../config/database':db,'../config/sms':sms,'../middleware/auth':auth,'../config/notif':{createNotif:async()=>{}}};
  const supplierRoutes = load('routes/suppliers.js',common);
  const inventory = require('../lib/supplierInventory');
  const portalRoutes = load('routes/supplierPortal.js',{...common,'../lib/marketplace':{...require('../lib/marketplace'),marketplaceSchema:()=>async()=>{},publishOffer:async()=>{}},'../lib/supplierInventory':{...inventory,supplierInventorySchema:()=>async()=>{}},'../lib/supplierImages':{photoStore:()=>({ready:async()=>{}})},'../lib/adminNotifications':{resolveAdminNotification:async()=>{},notifyAdminNotificationsChanged:()=>{}}});
  const app = express();app.use(express.json());app.use('/api/suppliers',supplierRoutes);app.use('/api/supplier-portal',portalRoutes);
  const server = await new Promise(resolve => {const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(uploadPath,{recursive:true,force:true});});
  const sign = claims => jwt.sign(claims,process.env.JWT_SECRET);
  const request = async (url,{method='GET',body,token}={}) => {
    const response = await fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  return {state,users,writes,smsCalls,scopes,catalog,sms,failInsert:()=>{failBrand=true;},request,sign,admin:sign({id:9,role:'admin',context:'management'})};
}

test('one management approval enables OTP login and the supplier own-account endpoint',async t=>{
  const e=await setup(t),phone=e.state.mobile;
  assert.equal((await e.request('/api/supplier-portal/auth/send-otp',{method:'POST',body:{phone}})).status,403);
  assert.equal((await e.request('/api/supplier-portal/auth/verify-otp',{method:'POST',body:{phone,code:'12345'}})).status,403);
  assert.equal(e.smsCalls.length,0);
  assert.equal((await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin})).status,200);
  assert.equal(e.state.status,'approved');assert.equal(e.state.portal_enabled,1);
  assert.equal((await e.request('/api/supplier-portal/auth/send-otp',{method:'POST',body:{phone}})).status,200);
  const login=await e.request('/api/supplier-portal/auth/verify-otp',{method:'POST',body:{phone,code:'12345'}});
  assert.equal(login.status,200);assert.equal(login.data.supplier.id,42);
  const claims=jwt.verify(login.data.token,process.env.JWT_SECRET);
  assert.equal(claims.role,'supplier');assert.equal(claims.supplier_id,42);
  const me=await e.request('/api/supplier-portal/me',{token:login.data.token});
  assert.equal(me.status,200);assert.equal(me.data.id,42);
  assert.equal(e.users.find(user=>user.id===101).role,'user');
  assert.equal(e.writes.length,4);
  assert.ok(e.writes.every(write=>!/\b(orders|payments|UPDATE users|UPDATE products|INSERT INTO products)\b/i.test(write.sql)));
  assert.deepEqual(e.scopes.map(s=>s.scope_value),['ISACO | ایساکو','سایپا یدک']);
  const products=await e.request('/api/supplier-portal/products',{token:login.data.token});
  assert.equal(products.status,200);
  assert.deepEqual(products.data.brands,['ISACO | ایساکو','سایپا یدک']);
  assert.equal(products.data.products.length,2);
  assert.ok(!products.data.products.some(p=>p.brand==='بوش'));
});

test('a missing, buyer or supplier session cannot approve or activate an account',async t=>{
  const e=await setup(t);
  for (const token of [null,e.sign({id:101,role:'user',context:'shop'}),e.sign({supplier_id:42,role:'supplier'})]) {
    const result=await e.request('/api/suppliers/42/approve',{method:'PATCH',token});
    assert.ok([401,403].includes(result.status));
  }
  assert.equal(e.state.status,'pending');assert.equal(e.state.portal_enabled,0);assert.equal(e.writes.length,0);
});

test('approval does not bypass OTP or allow another supplier to read the account',async t=>{
  const e=await setup(t);
  await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin});
  const invalid=await e.request('/api/supplier-portal/auth/verify-otp',{method:'POST',body:{phone:e.state.mobile,code:'wrong'}});
  assert.equal(invalid.status,400);assert.equal(invalid.data.token,undefined);
  const other=await e.request('/api/supplier-portal/me',{token:e.sign({supplier_id:77,role:'supplier'})});
  assert.equal(other.status,403);assert.equal(other.data.id,undefined);
});

test('approving a nonexistent supplier does not activate any existing account',async t=>{
  const e=await setup(t);
  assert.equal((await e.request('/api/suppliers/999/approve',{method:'PATCH',token:e.admin})).status,404);
  assert.equal(e.state.status,'pending');assert.equal(e.state.portal_enabled,0);assert.equal(e.writes.length,0);
});


test('unknown or ambiguous brands cannot partially activate the account',async t=>{
  const e=await setup(t);
  for(const brands of ['ایساکو، نام ناشناس','', 'نام مشترک']){
    e.state.brands=brands;
    if(brands==='نام مشترک') e.catalog.push({brand:'A | نام مشترک'},{brand:'B | نام مشترک'});
    const result=await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin});
    assert.equal(result.status,400);
    assert.equal(e.state.status,'pending');assert.equal(e.state.portal_enabled,0);
    assert.equal(e.scopes.length,0);assert.equal(e.writes.length,0);assert.equal(e.smsCalls.length,0);
  }
});

test('a failed scope write rolls back permissions and account activation',async t=>{
  const e=await setup(t);e.failInsert();
  const result=await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin});
  assert.equal(result.status,500);assert.equal(e.state.status,'pending');assert.equal(e.state.portal_enabled,0);
  assert.equal(e.scopes.length,0);assert.equal(e.smsCalls.length,0);
});

test('approval rejects an outdated brand review and never trusts client-supplied extra permissions',async t=>{
  const e=await setup(t);
  const stale=await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin,body:{expected_brands:'بوش'}});
  assert.equal(stale.status,409);assert.equal(e.state.status,'pending');assert.equal(e.writes.length,0);
  const good=await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin,body:{expected_brands:e.state.brands,brands:['بوش']}});
  assert.equal(good.status,200);assert.ok(!e.scopes.some(s=>s.scope_value==='بوش'));
});

test('repeated approval preserves permissions revoked by management and sends no second SMS',async t=>{
  const e=await setup(t);
  await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin});
  e.scopes.splice(0);e.state.portal_enabled=0;const writes=e.writes.length,calls=e.smsCalls.length;
  assert.equal((await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin})).status,200);
  assert.equal(e.scopes.length,0);assert.equal(e.state.portal_enabled,0);
  assert.equal(e.writes.length,writes);assert.equal(e.smsCalls.length,calls);
});

test('SMS failure after commit does not misreport successful approval as failed',async t=>{
  const e=await setup(t);e.sms.supplierApproved=async()=>{throw new Error('isolated SMS unavailable');};
  const result=await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin});
  assert.equal(result.status,200);assert.equal(e.state.status,'approved');assert.equal(e.scopes.length,2);
});


test('management can explicitly confirm declared brands for an existing approved account',async t=>{
  const e=await setup(t);e.state.status='approved';e.state.portal_enabled=1;
  const absent=await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin,body:{confirm_brands:true}});
  assert.equal(absent.status,400);assert.equal(e.scopes.length,0);
  const result=await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin,body:{confirm_brands:true,expected_brands:e.state.brands}});
  assert.equal(result.status,200);assert.equal(e.scopes.length,2);assert.equal(e.smsCalls.length,0);
});


test('approval changes only the reviewed supplier brand scopes and retains company permissions',async t=>{
  const e=await setup(t);
  const existing=[{supplier_id:77,scope_type:'brand',scope_value:'بوش'},{supplier_id:42,scope_type:'assigned_company',scope_value:''}];
  e.scopes.push(...structuredClone(existing));
  const result=await e.request('/api/suppliers/42/approve',{method:'PATCH',token:e.admin});
  assert.equal(result.status,200);assert.deepEqual(e.scopes.slice(0,2),existing);
  assert.equal(e.scopes.filter(s=>s.supplier_id===42&&s.scope_type==='brand').length,2);
});
