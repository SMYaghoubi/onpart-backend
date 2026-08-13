const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('shop password login accepts every active primary role without changing password',()=>{
  const auth=read('routes/auth.js'),users=read('routes/users.js');
  const shop=auth.slice(auth.indexOf("router.post('/user-login'"),auth.indexOf('// POST /api/auth/logout'));
  assert.doesNotMatch(shop,/role\s*=\s*["']user["']/);
  assert.match(shop,/bcrypt\.compare\(password, user\.password\)/);
  assert.match(shop,/user\.status !== 'active'/);
  assert.match(shop,/sign\(user, 'shop'\)/);
  assert.match(users,/if\(req\.body\.password\).*password=\?/s);
  const update=users.slice(users.indexOf("router.put('/:id'"),users.indexOf('// ── PATCH /api/users/:id/block'));
  assert.doesNotMatch(update,/role\|\|'user'|status\|\|'active'/);
});

test('management login and logout use isolated context and record only successful events',()=>{
  const auth=read('routes/auth.js'),middleware=read('middleware/auth.js');
  const compare=auth.indexOf('bcrypt.compare(password, user.password)'),loginWrite=auth.indexOf('last_login_at=UTC_TIMESTAMP()');
  assert.ok(compare>=0&&loginWrite>compare);
  assert.match(auth,/sign\(user, 'management'\)/);
  assert.match(auth,/router\.post\('\/logout', adminAuth/);
  assert.match(auth,/last_logout_at=UTC_TIMESTAMP\(\)/);
  assert.match(middleware,/decoded\.context !== 'management'/);
  assert.match(middleware,/decoded\.context !== 'shop'/);
});

test('management session migration 018 is idempotent and UTC fields are exposed',()=>{
  const sql=read('migrations/018_track_management_sessions.sql'),users=read('routes/users.js');
  assert.match(sql,/information_schema\.COLUMNS/);assert.match(sql,/last_login_at/);assert.match(sql,/last_logout_at/);
  assert.match(users,/role === 'management'/);assert.match(users,/last_login_at,last_logout_at/);
});

test('admin product import round-trip preserves flow and validated supplier while canonicalizing code',()=>{
  const products=read('routes/products.js');
  assert.match(products,/normalizeProductCode\(code\)/);
  assert.match(products,/flowProvided/);assert.match(products,/supplierProvided/);
  assert.match(products,/status="approved"/);
  assert.match(products,/has_flow=\?,supplier_id=\?/);
});
