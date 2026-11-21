const test = require('node:test');
const assert = require('node:assert/strict');
const { documentType, documentOwner, isPrivateUploadPath } = require('../lib/privateDocuments');

test('public upload protection handles encoded filenames and normalized paths', () => {
  for (const value of ['/user_1.png', '/%75ser_1.png', '//user_1.png', '/bank/../user_1.png', '/%72eceipt_1.pdf', '/credit_1.pdf']) {
    assert.equal(isPrivateUploadPath(value), true, value);
  }
  assert.equal(isPrivateUploadPath('/bank-logo-123.png'), false);
  assert.equal(isPrivateUploadPath('/%E0%A4'), true);
});

test('private document lookup accepts only known document filenames and types', () => {
  assert.equal(documentType('../user_123.png'), null);
  assert.equal(documentType('user_123.html'), null);
  assert.equal(documentType('bank-logo-123.png'), null);
  assert.equal(documentType('user_123.png'), 'image/png');
  assert.equal(documentType('credit_123_id_card_file.pdf'), 'application/pdf');
});

test('document ownership is bound in the database query and unrelated files are rejected', async () => {
  const calls = [];
  const db = { execute:async (sql, params) => { calls.push({ sql, params }); return [[]]; } };
  assert.equal(await documentOwner(db, 'user_123.png', { id:7, role:'user' }), null);
  assert.match(calls[0].sql, /AND id=\?/);
  assert.deepEqual(calls[0].params, ['user_123.png', 'user_123.png', 7]);
  await documentOwner(db, 'credit_123_other_file.pdf', { id:8, role:'user' });
  assert.match(calls[1].sql, /AND user_id=\?/);
  assert.equal(calls[1].params.at(-1), 8);
  await documentOwner(db, 'user_123.png', { id:9, role:'admin' });
  assert.doesNotMatch(calls[2].sql, /AND id=\?/);
  assert.equal(calls[2].params.length, 2);
});
