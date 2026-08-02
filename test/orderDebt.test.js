const test = require('node:test');
const assert = require('node:assert/strict');
const { syncUserDebt } = require('../lib/orderDebt');

test('synchronizes user debt from remaining order debt', async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT')) return [[{ debt: 245000 }]];
      return [{ affectedRows: 1 }];
    }
  };
  const debt = await syncUserDebt(connection, 12);
  assert.equal(debt, 245000);
  assert.deepEqual(calls[1].params, [245000, 12]);
});

test('never stores a negative or invalid debt', async () => {
  const writes = [];
  const connection = {
    async execute(sql, params) {
      if (sql.startsWith('SELECT')) return [[{ debt: -20 }]];
      writes.push(params);
      return [{ affectedRows: 1 }];
    }
  };
  assert.equal(await syncUserDebt(connection, 7), 0);
  assert.deepEqual(writes[0], [0, 7]);
});

