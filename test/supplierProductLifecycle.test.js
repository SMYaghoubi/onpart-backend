const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const jwt = require('jsonwebtoken');
const secret = 'supplier-product-visibility-local-test-only';

function loadModule(relative, overrides) {
  const filename = require.resolve(relative);
  const realRequire = createRequire(filename);
  const module = { exports:{} };
  const script = new vm.Script('(function(require,module,exports){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename });
  script.runInNewContext({ console, process:{ env:{ JWT_SECRET:secret } } })(
    name => Object.hasOwn(overrides, name) ? overrides[name] : realRequire(name), module, module.exports
  );
  return module.exports;
}

function fixture() {
  const state = { products:[], inventory:[], batches:[], proposals:[] };
  const calls = [];
  let snapshot;
  const clone = value => structuredClone(value);
  const conn = {
    beginTransaction:async () => { snapshot = clone(state); },
    commit:async () => { snapshot = null; },
    rollback:async () => { if (snapshot) Object.assign(state, snapshot); snapshot = null; },
    release() {},
    query:async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) return [[]];
      if (sql.includes('INSERT INTO supplier_new_product_requests')) {
        for (const row of params[0]) {
          const [batch_id, code, description, brand, supplier_price, quantity, available] = row;
          state.proposals.push({ id:state.proposals.length+1, batch_id, code, description, brand, supplier_price, quantity, available, product_id:null });
        }
        return [{ affectedRows:params[0].length }];
      }
      throw new Error('Unexpected test query: ' + sql);
    },
    execute:async (original, params = []) => {
      const sql = original.replace(/\s+/g, ' ').trim();
      if(sql.startsWith('SELECT r.quantity FROM market_reservations')||sql.startsWith('SELECT im.*,n.product_id resolved_product_id'))return [[]];
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id,role,status FROM users')) return [[{ id:params[0], role:params[0] === 1 ? 'admin' : 'user', status:'active' }]];
      if (sql.startsWith('SELECT id,company,name,mobile,status,portal_enabled FROM suppliers')) return [[{ id:params[0], company:'Test', status:'approved', portal_enabled:1 }]];
      if (sql.startsWith('SELECT id FROM suppliers')) return [[{ id:params[0] }]];
      if (sql.startsWith('SELECT scope_value FROM supplier_product_scopes')) return [[{ scope_value:'GISP' }]];
      if (sql.startsWith('SELECT p.id,COALESCE(inv.manufacturer_code')) {
        const rows = state.products.filter(p => p.status === 'active').map(p => ({ ...p,
          ...state.inventory.find(inv => inv.supplier_id === params[0] && inv.product_id === p.id) }));
        return [clone(rows)];
      }
      if (sql.startsWith('SELECT n.id,n.batch_id')) {
        assert.match(sql, /b\.supplier_id=\? AND b\.status='pending'/);
        return [clone(state.proposals.filter(n => state.batches.some(b => b.id === n.batch_id && b.supplier_id === params[0] && b.status === 'pending')))];
      }
      if (sql.startsWith('INSERT INTO supplier_update_batches')) {
        const id = state.batches.length + 1;
        state.batches.push({ id, supplier_id:params[0], status:'pending', source:params[1] });
        return [{ insertId:id }];
      }
      if (sql.startsWith('SELECT * FROM supplier_update_batches WHERE id=')) return [clone(state.batches.filter(b => b.id === Number(params[0])))];
      if (sql.startsWith('SELECT id,status,submitted_at,reviewed_at,note FROM supplier_update_batches')) return [clone(state.batches.filter(b => b.id === Number(params[0]) && b.supplier_id === params[1]))];
      if (sql.startsWith('SELECT b.id,b.status,b.source')) return [clone(state.batches.filter(b => b.supplier_id === params[0]).map(b => ({ ...b, item_count:state.proposals.filter(n => n.batch_id === b.id).length })))];
      if (sql.startsWith('SELECT i.*,p.brand') || sql.startsWith('SELECT COALESCE(inv.manufacturer_code')) return [[]];
      if (sql.startsWith('SELECT * FROM supplier_new_product_requests') || sql.startsWith('SELECT code,description,brand,supplier_price') || sql.startsWith('SELECT n.code,n.description')) return [clone(state.proposals.filter(n => n.batch_id === params[0]))];
      if (sql.startsWith('SELECT error_message FROM supplier_update_errors')) return [[]];
      if (sql.startsWith('SELECT COUNT(*) count FROM supplier_update_errors')) return [[{ count:0 }]];
      if (sql.startsWith('SELECT p.id,p.code,p.brand,p.status FROM products')) return [clone(state.products.filter(p => p.code.toLowerCase().replace(/-/g, '') === params[0]))];
      if (sql.startsWith('INSERT INTO products (code,description,brand,price,stock)')) {
        const id = state.products.length + 1;
        state.products.push({ id, code:params[0], description:params[1], brand:params[2], price:0, stock:0, status:'active' });
        return [{ insertId:id }];
      }
      if (sql.startsWith('UPDATE products SET price=?,stock=?,supplier_id=?')) {
        Object.assign(state.products.find(p => p.id === params[3]), { price:params[0], stock:params[1], supplier_id:params[2] });
        return [{ affectedRows:1 }];
      }
      if (sql.startsWith('INSERT INTO supplier_inventory')) {
        const [supplier_id, product_id, quantity, supplier_price, available, manufacturer_code] = params;
        state.inventory.push({ supplier_id, product_id, quantity, supplier_price, available, manufacturer_code });
        return [{ affectedRows:1 }];
      }
      if (sql.startsWith('UPDATE supplier_new_product_requests SET product_id=')) {
        state.proposals.find(n => n.id === params[1]).product_id = params[0];
        return [{ affectedRows:1 }];
      }
      if (sql.startsWith('UPDATE supplier_update_batches SET status="approved"')) {
        Object.assign(state.batches.find(b => b.id === Number(params[3])), { status:'approved', reviewed_by:params[2] });
        return [{ affectedRows:1 }];
      }
      if (sql.startsWith('SELECT p.id,p.code,p.description')) {
        assert.match(sql, /p\.status="active"/);
        return [clone(state.products.filter(p => p.status === 'active').map(p=>({...p,offer_count:1,available:1})))];
      }
      if (sql.startsWith('SELECT COUNT(*) as total FROM products')) return [[{ total:state.products.filter(p => p.status === 'active').length }]];
      throw new Error('Unexpected test SQL: ' + sql);
    }
  };
  const db = { execute:conn.execute, query:conn.query, getConnection:async () => conn };
  const auth = loadModule('../middleware/auth', { '../config/database':db });
  const portal = loadModule('../routes/supplierPortal', {
    '../config/database':db, '../middleware/auth':auth, '../lib/marketplace':{...require('../lib/marketplace'),marketplaceSchema:()=>async()=>{},publishOffer:async()=>{}},'../config/sms':{},
    '../config/notif':{ createNotif:async () => {} },
    '../lib/adminNotifications':{ resolveAdminNotification:async () => {}, notifyAdminNotificationsChanged() {} }
  });
  const shop = loadModule('../routes/products', {
    '../config/database':db, '../middleware/auth':auth,'../lib/marketplace':{...require('../lib/marketplace'),marketplaceSchema:()=>async()=>{}},
    '../lib/userNotifications':{ broadcastUserDataChanged() {} }
  });
  async function invoke(router, method, path, { supplierId = null, userRole = null, body = {}, params = {} } = {}) {
    const claims = supplierId ? { supplier_id:supplierId, role:'supplier' }
      : userRole ? { id:userRole === 'admin' ? 1 : 2, role:userRole, context:userRole === 'admin' ? 'management' : 'shop' } : null;
    const req = { method:method.toUpperCase(), query:{}, params, body,
      headers:claims ? { authorization:'Bearer ' + jwt.sign(claims, secret) } : {} };
    const result = { status:200 };
    const res = { status(value) { result.status = value; return this; }, json(value) { result.body = value; return this; } };
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    const middleware = [...router.stack.filter(layer => !layer.route), ...route.stack];
    for (const layer of middleware) {
      let next = false;
      await layer.handle(req, res, () => { next = true; });
      if (!next) break;
    }
    return result;
  }
  return { state, calls, portal, shop, invoke };
}

const item = { new_product:true, code:'GI-200', description:'کالای آزمایشی', brand:'GISP', supplier_price:200000, quantity:5, available:true };

test('new product is private and pending until an authenticated manager approves, then appears once in catalog and shop', async () => {
  const f = fixture();
  const submit = await f.invoke(f.portal, 'post', '/updates', { supplierId:42, body:{ items:[item] } });
  assert.equal(submit.status, 201);
  assert.equal(f.state.products.length, 0);
  const before = await f.invoke(f.portal, 'get', '/products', { supplierId:42 });
  assert.equal(before.status, 200);
  assert.equal(before.body.products.length, 0);
  assert.equal(before.body.pending_products.length, 1);
  assert.equal(before.body.pending_products[0].description, item.description);
  assert.equal((await f.invoke(f.shop, 'get', '/', { userRole:'user' })).body.products.length, 0);

  const approval = { params:{ id:submit.body.id }, body:{ markup_percent:5 } };
  const denied = await f.invoke(f.portal, 'post', '/admin/updates/:id/approve', { ...approval, supplierId:42 });
  assert.equal(denied.status, 403);
  assert.equal(f.state.products.length, 0);
  const accepted = await f.invoke(f.portal, 'post', '/admin/updates/:id/approve', { ...approval, userRole:'admin' });
  assert.equal(accepted.status, 200, accepted.body.message);
  const after = await f.invoke(f.portal, 'get', '/products', { supplierId:42 });
  assert.equal(after.body.pending_products.length, 0);
  assert.equal(after.body.products.length, 1);
  assert.equal(after.body.products[0].quantity, 5);
  assert.equal(after.body.products[0].supplier_price, 200000);
  assert.equal((await f.invoke(f.shop, 'get', '/', { userRole:'user' })).body.products[0].price, 210000);
  assert.equal((await f.invoke(f.portal, 'post', '/admin/updates/:id/approve', { ...approval, userRole:'admin' })).status, 400);
  assert.equal(f.state.products.length, 1);
});

test('pending product lists and request details are supplier scoped and require login', async () => {
  const f = fixture();
  await f.invoke(f.portal, 'post', '/updates', { supplierId:42, body:{ items:[item] } });
  await f.invoke(f.portal, 'post', '/updates', { supplierId:84, body:{ items:[{ ...item, code:'GI-300', description:'کالای تأمین‌کننده دیگر' }] } });
  assert.equal((await f.invoke(f.portal, 'get', '/products')).status, 401);
  for (const supplierId of [42, 84]) {
    const result = await f.invoke(f.portal, 'get', '/products', { supplierId });
    assert.equal(result.body.pending_products.length, 1);
    assert.equal(result.body.pending_products[0].batch_id, supplierId === 42 ? 1 : 2);
  }
  const forbidden = await f.invoke(f.portal, 'get', '/updates/:id', { supplierId:84, params:{ id:1 } });
  assert.equal(forbidden.status, 404);
  const owned = await f.invoke(f.portal, 'get', '/updates/:id', { supplierId:42, params:{ id:1 } });
  assert.equal(owned.body.items[0].status, 'pending');
  assert.equal(owned.body.items[0].description, item.description);
});

test('invalid product submissions roll back without publishing or creating a pending row', async () => {
  const f = fixture();
  const result = await f.invoke(f.portal, 'post', '/updates', { supplierId:42, body:{ items:[{ ...item, brand:'غیرمجاز' }] } });
  assert.equal(result.status, 400);
  assert.equal(f.state.batches.length, 0);
  assert.equal(f.state.proposals.length, 0);
  assert.equal(f.state.products.length, 0);
});
