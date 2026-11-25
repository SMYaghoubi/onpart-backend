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
  const state = { id:42, company:'test supplier', name:'test owner', mobile:'09120000000', status:'pending', portal_enabled:0, user_id:null };
  const users = [{id:9,role:'admin',status:'active'},{id:101,role:'user',status:'active'}];
  const writes = [], smsCalls = [];
  const db = { execute:async (sql, params) => {
    if (sql.startsWith('SELECT id,role,status FROM users')) return [users.filter(user => user.id === Number(params[0]))];
    if (sql.startsWith('SELECT * FROM suppliers WHERE id=')) return [[...(Number(params[0]) === state.id ? [{...state}] : [])]];
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
  const sms = {
    supplierApproved:async (...args) => smsCalls.push(['approved',...args]),
    sendOTP:async phone => smsCalls.push(['otp',phone]),
    verifyOTP:async (phone, code) => phone === state.mobile && code === '12345'
  };
  const auth = load('middleware/auth.js', {'../config/database':db});
  const common = {'../config/database':db,'../config/sms':sms,'../middleware/auth':auth,'../config/notif':{createNotif:async()=>{}}};
  const supplierRoutes = load('routes/suppliers.js',common);
  const portalRoutes = load('routes/supplierPortal.js',{...common,'../lib/adminNotifications':{resolveAdminNotification:async()=>{},notifyAdminNotificationsChanged:()=>{}}});
  const app = express();app.use(express.json());app.use('/api/suppliers',supplierRoutes);app.use('/api/supplier-portal',portalRoutes);
  const server = await new Promise(resolve => {const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(uploadPath,{recursive:true,force:true});});
  const sign = claims => jwt.sign(claims,process.env.JWT_SECRET);
  const request = async (url,{method='GET',body,token}={}) => {
    const response = await fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  return {state,users,writes,smsCalls,request,sign,admin:sign({id:9,role:'admin',context:'management'})};
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
  assert.equal(e.writes.length,1);
  assert.ok(e.writes.every(write=>!/(product_scopes|products|orders|payments|UPDATE users)/i.test(write.sql)));
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
