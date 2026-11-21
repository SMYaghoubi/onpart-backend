const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'onpart-stage-one-local-test-secret';
let user = { id:7, role:'user', status:'active' };
let query;
let otpAccount;
const db = { execute:async (sql, params) => {
  query = { sql, params };
  if (sql.startsWith('SELECT id,role,status FROM users')) return [[user]];
  if (sql.startsWith('SELECT * FROM users WHERE phone=')) return [otpAccount ? [otpAccount] : []];
  if (sql.startsWith('INSERT INTO users (phone, role, status)')) {
    otpAccount = { id:7, phone:params[0], role:params[1], status:params[2] };
    return [{ insertId:7 }];
  }
  if (sql.startsWith('SELECT * FROM users WHERE id=')) return [[otpAccount]];
  return [[]];
} };
const databasePath = require.resolve('../config/database');
require.cache[databasePath] = { id:databasePath, filename:databasePath, loaded:true, exports:db };
const { auth, registrationAuth, adminAuth } = require('../middleware/auth');
const smsPath = require.resolve('../config/sms');
require.cache[smsPath] = { id:smsPath, filename:smsPath, loaded:true, exports:{ verifyOTP:async () => true } };

async function invoke(middleware, context, body = {}) {
  const token = jwt.sign({ id:7, role:user.role, context }, process.env.JWT_SECRET);
  const result = { status:200, next:false };
  const req = { method:'GET', headers:{ authorization:'Bearer ' + token }, body, query:{} };
  const res = { status(value) { result.status = value; return this; }, json(value) { result.body = value; return this; } };
  await middleware(req, res, () => { result.next = true; });
  return result;
}

test('shop access checks current approval on every call and rejects registration sessions', async () => {
  user = { id:7, role:'user', status:'active' };
  assert.equal((await invoke(auth, 'shop')).next, true);
  user = { ...user, status:'pending' };
  assert.equal((await invoke(auth, 'shop')).status, 403);
  assert.equal((await invoke(auth, 'registration')).status, 403);
  user = { ...user, status:'inactive' };
  assert.equal((await invoke(auth, 'shop')).status, 403);
});

test('pending registration can complete its own profile but has no management access', async () => {
  user = { id:7, role:'user', status:'pending' };
  assert.equal((await invoke(registrationAuth, 'registration', { isRegistration:true })).next, true);
  assert.equal((await invoke(registrationAuth, 'registration', { name:'overwrite' })).status, 403);
  assert.equal((await invoke(adminAuth, 'registration')).status, 403);
  user = { ...user, status:'active' };
  assert.equal((await invoke(registrationAuth, 'registration', { isRegistration:true })).status, 403);
});

test('a blocked manager loses API access even with a previously issued token', async () => {
  user = { id:7, role:'admin', status:'blocked' };
  assert.equal((await invoke(adminAuth, 'management')).status, 403);
});

test('invoice list binds the requesting owner and management must use its isolated context', async () => {
  const router = require('../routes/invoices');
  const route = router.stack.find(layer => layer.route?.path === '/').route;
  const req = { query:{}, user:{ id:31, role:'user' } };
  const res = { json() {}, status() { return this; } };
  await route.stack[1].handle(req, res);
  assert.match(query.sql, /AND o\.user_id=\?/);
  assert.deepEqual(query.params, [31]);
  req.query.admin = '1';
  await route.stack[1].handle(req, res);
  assert.doesNotMatch(query.sql, /AND o\.user_id=\?/);
  assert.deepEqual(query.params, []);
});

test('product GET endpoints require a current approved shop or management session', async () => {
  const router = require('../routes/products');
  const gate = router.stack.find(layer => !layer.route).handle;
  user = { id:7, role:'user', status:'pending' };
  assert.equal((await invoke(gate, 'shop')).status, 403);
  user = { ...user, status:'active' };
  assert.equal((await invoke(gate, 'shop')).next, true);
});

test('a new OTP registration is pending and receives only a registration token', async () => {
  otpAccount = null;
  const router = require('../routes/auth');
  const route = router.stack.find(layer => layer.route?.path === '/verify-otp').route;
  let response;
  let status = 200;
  await route.stack[0].handle({ body:{ phone:'09121234567', code:'12345' } }, {
    status(value) { status = value; return this; }, json(value) { response = value; }
  });
  assert.equal(status, 200);
  assert.equal(otpAccount.status, 'pending');
  assert.equal(response.registration_required, true);
  const claims = jwt.verify(response.token, process.env.JWT_SECRET);
  assert.equal(claims.context, 'registration');
  assert.equal(claims.exp - claims.iat, 30 * 60);
  user = { id:7, role:'user', status:'pending' };
  assert.equal((await invoke(auth, claims.context)).status, 403);
});
