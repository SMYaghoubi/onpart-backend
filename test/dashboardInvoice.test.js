const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProfit, fillSevenDays } = require('../lib/dashboardMetrics');
const { invoiceTotals } = require('../lib/invoiceData');

test('calculates dashboard profit from historical item cost', () => {
  assert.deepEqual(calculateProfit([{quantity:2,total:3000,cost_price:1000},{quantity:1,total:2000,cost_price:1200}]),{sales:5000,cost:3200,profit:1800,percent:36});
});

test('calculates invoice subtotal and discount consistently', () => {
  assert.deepEqual(invoiceTotals([{quantity:2,price:1000},{quantity:1,price:500}],2200),{subtotal:2500,discount:300,total:2200});
});

test('dashboard always returns all seven sales days including zero days', () => {
  const days=fillSevenDays([{day:'2026-08-05',sales:100}],new Date('2026-08-05T12:00:00Z'));
  assert.equal(days.length,7);
  assert.equal(days.at(-1).sales,100);
  assert.equal(days[0].sales,0);
});