const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'orders.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '016_order_item_vehicle_snapshot.sql'), 'utf8');

test('order item APIs prefer the vehicle snapshot and fall back to the current product', () => {
  const matches = routeSource.match(/COALESCE\(NULLIF\(oi\.car_name,''\),p\.car\)\s+car/g) || [];
  assert.ok(matches.length >= 3, 'customer, detail and invoice queries must expose the same car field');
});

test('new and edited order items retain the vehicle in their immutable item snapshot', () => {
  const {itemSnapshot}=require('../lib/orderItemSnapshots');
  assert.equal(itemSnapshot({car:'قدیمی',cost_price:10}).car,'قدیمی');
  assert.equal(itemSnapshot({car:'جدید',cost_price:20},{car_name:'قدیمی',cost_price:10}).car,'قدیمی');
  assert.match(routeSource,/insertOrderItem\(conn,orderId/);
  assert.match(routeSource,/itemSnapshot\(costRow,previousByProduct/);
});

test('migration 016 is idempotent and backfills existing items', () => {
  assert.match(migration, /information_schema\.COLUMNS/);
  assert.match(migration, /COLUMN_NAME='car_name'/);
  assert.match(migration, /UPDATE order_items oi[\s\S]*JOIN products p/);
});
