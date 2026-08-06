const test = require('node:test');
const assert = require('node:assert/strict');
const { syncUserDebt } = require('../lib/orderDebt');

test('synchronizes cached user debt from canonical approved-payment formula', async () => {
  const calls = [];
  const connection = { async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('SELECT COALESCE(SUM(')) return [[{ debt: 245000 }]];
    return [{ affectedRows: 1 }];
  }};
  const debt = await syncUserDebt(connection, 12);
  assert.equal(debt, 245000);
  assert.ok(calls[0].sql.startsWith('UPDATE orders'));
  assert.deepEqual(calls.at(-1).params, [245000, 12]);
});

test('never stores a negative or invalid canonical debt', async () => {
  const writes = [];
  const connection = { async execute(sql, params) {
    if (sql.includes('SELECT COALESCE(SUM(')) return [[{ debt: -20 }]];
    writes.push(params);return [{ affectedRows: 1 }];
  }};
  assert.equal(await syncUserDebt(connection, 7), 0);
  assert.deepEqual(writes.at(-1), [0, 7]);
});