const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isAllowedReceiptUpload, canReadReceipt, resolveReceiptPath, receiptMime } = require('../lib/paymentReceipts');

test('receipt upload accepts supported image/PDF MIME pairs only', () => {
  assert.equal(isAllowedReceiptUpload('receipt.png','image/png'), true);
  assert.equal(isAllowedReceiptUpload('receipt.webp','image/webp'), true);
  assert.equal(isAllowedReceiptUpload('receipt.pdf','application/pdf'), true);
  assert.equal(isAllowedReceiptUpload('receipt.png','text/html'), false);
  assert.equal(isAllowedReceiptUpload('receipt.exe','image/png'), false);
});

test('receipt retrieval allows admin/partner and owner but denies another user', () => {
  const payment={id:3,user_id:12};
  assert.equal(canReadReceipt({id:1,role:'admin'},payment),true);
  assert.equal(canReadReceipt({id:2,role:'partner'},payment),true);
  assert.equal(canReadReceipt({id:12,role:'user'},payment),true);
  assert.equal(canReadReceipt({id:13,role:'user'},payment),false);
  assert.equal(canReadReceipt(null,payment),false);
});

test('receipt path rejects traversal and unrelated upload names', () => {
  const root=path.resolve('safe-uploads');
  assert.equal(resolveReceiptPath(root,'../receipt_1.png'),null);
  assert.equal(resolveReceiptPath(root,'bank-logo-1.png'),null);
  assert.equal(resolveReceiptPath(root,'receipt_123.png'),path.join(root,'receipt_123.png'));
  assert.equal(receiptMime('receipt_123.pdf'),'application/pdf');
});
