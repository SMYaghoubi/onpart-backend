const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboard, mergeActivities } = require('../lib/dashboardService');

test('dashboard keeps responding when optional schema is unavailable', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const db = { execute: async sql => {
      if (sql.includes('reviewed_at') || sql.includes('cost_price') || sql.includes('supplier_update_batches')) throw Object.assign(new Error('missing optional schema'), { code:'ER_BAD_FIELD_ERROR' });
      if (sql.includes('COUNT(*) total_orders')) return [[{ total_orders:2 }]];
      if (sql.includes('COUNT(*) active_users')) return [[{ active_users:3 }]];
      if (sql.includes('month_sales')) return [[{ month_sales:400 }]];
      if (sql.includes('COUNT(*) active_partners')) return [[{ active_partners:1 }]];
      return [[]];
    }};
    const data = await buildDashboard(db, new Date('2026-08-06T12:00:00Z'));
    assert.equal(data.metrics.total_orders, 2);
    assert.equal(data.metrics.month_sales, 400);
    assert.equal(data.sales_7d.length, 7);
    assert.equal(data.profit_7d.profit, 0);
    assert.equal(data.partial, true);
    assert.ok(data.unavailable_sections.includes('supplier_activities'));
  } finally {
    console.error = originalError;
  }
});

test('activities merge by date and remain limited', () => {
  const merged = mergeActivities([[{ entity_id:1,created_at:'2026-08-01' }],[{ entity_id:2,created_at:'2026-08-03' }]]);
  assert.deepEqual(merged.map(item => item.entity_id), [2,1]);
});