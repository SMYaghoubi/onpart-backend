const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSupplierPhone, registerSupplier } = require('../lib/supplierRegistration');

function database(existing) {
  const calls = [];
  const conn = {
    beginTransaction:async () => calls.push('begin'),
    commit:async () => calls.push('commit'),
    rollback:async () => calls.push('rollback'),
    release:() => calls.push('release'),
    execute:async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('GET_LOCK')) return [[{ locked:1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{}]];
      if (sql.startsWith('SELECT id,status')) return [existing];
      if (sql.startsWith('SELECT u.id')) return [[]];
      if (sql.startsWith('INSERT')) return [{ insertId:21 }];
      throw new Error('Unexpected SQL');
    }
  };
  return { db:{ getConnection:async () => conn }, calls };
}

test('duplicate supplier registration cannot replace a previously approved account', async () => {
  const { db, calls } = database([{ id:11, status:'approved' }]);
  await assert.rejects(registerSupplier(db, { mobile:'۰۹۱۲ ۱۲۳۴۵۶۷' }), error => error.status === 409);
  assert.ok(calls.includes('rollback'));
  assert.ok(calls.some(call => call.sql?.includes('RELEASE_LOCK')));
  assert.ok(!calls.some(call => call.sql?.startsWith('INSERT')));
});

test('supplier registration serializes matching phones and commits once before releasing the lock', async () => {
  const { db, calls } = database([]);
  const result = await registerSupplier(db, { mobile:'0912-1234567', company:'Test', name:'Test', city:'Test' });
  assert.deepEqual(result, { id:21, mobile:'09121234567' });
  const insertion = calls.find(call => call.sql?.startsWith('INSERT'));
  assert.equal(insertion.params.length, 19);
  assert.ok(calls.indexOf('commit') < calls.findIndex(call => call.sql?.includes('RELEASE_LOCK')));
  assert.equal(normalizeSupplierPhone('۰۹۱۲ ۱۲۳۴۵۶۷'), '09121234567');
});
