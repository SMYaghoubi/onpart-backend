const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
let orderStatus = 'pending_customer';
const conn = {
  beginTransaction:async () => calls.push('begin'),
  commit:async () => calls.push('commit'),
  rollback:async () => calls.push('rollback'),
  release() {},
  execute:async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id,user_id,status')) return [[{ id:1, user_id:7, status:orderStatus }]];
    if (sql.startsWith('SELECT p.*')) {
      assert.match(sql, /SELECT inv\.supplier_price FROM supplier_inventory/);
      assert.match(sql, /inv\.supplier_id=p\.supplier_id/);
      assert.match(sql, /batch\.supplier_id=p\.supplier_id/);
      return [[{ id:3, price:105000, cost_price:100000, car:'Test' }]];
    }
    if (sql.startsWith('INSERT INTO orders')) return [{ insertId:1 }];
    return [{ affectedRows:1 }];
  }
};
function stub(name, value) {
  const file = require.resolve(name);
  require.cache[file] = { id:file, filename:file, loaded:true, exports:value };
}
const snapshots = require('../lib/orderItemSnapshots');
stub('../lib/orderItemSnapshots',{...snapshots,orderItemSnapshotSchema:()=>async()=>{}});
stub('../config/database', { getConnection:async () => conn, execute:async () => [[]] });
stub('../config/sms', {});
stub('../config/notif', { createNotif:async () => {} });
stub('../lib/userNotifications', { createUserNotification:async () => {} });
const router = require('../routes/orders');

test('new supplier products snapshot the purchase price from the current supplier inventory', async () => {
  calls.length = 0;
  const route = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route;
  let response;
  await route.stack[1].handle({ body:{ items:[{ product_id:3, quantity:2 }] }, user:{ id:7 } }, {
    status() { return this; }, json(value) { response = value; }
  });
  assert.equal(response.total, 210000);
  const item = calls.find(call => call.sql?.startsWith('INSERT INTO order_items'));
  assert.equal(item.params[5], 100000);
  assert.ok(calls.includes('commit'));
});

test('accepted or paid invoices cannot have their historical item prices replaced', async () => {
  const route = router.stack.find(layer => layer.route?.path === '/:id/items').route;
  for (const status of ['pending_payment', 'preparing', 'shipping', 'delivered', 'cancelled']) {
    orderStatus = status;
    calls.length = 0;
    let responseStatus;
    await route.stack[1].handle({ params:{ id:1 }, body:{ items:[{ product_id:3, quantity:2, price:105000 }] } }, {
      status(value) { responseStatus = value; return this; }, json() {}
    });
    assert.equal(responseStatus, 409, status);
    assert.ok(calls.includes('rollback'));
    assert.ok(!calls.some(call => call.sql?.startsWith('DELETE FROM order_items')));
  }
});
