const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IRANIAN_BANKS,
  normalizeDigits,
  isValidCardNumber,
  resolveIranianBank,
  protectCardNumber,
  revealCardNumber,
  publicCard
} = require('../lib/bankCards');

test('normalizes Persian digits and validates a card with Luhn', () => {
  assert.equal(normalizeDigits('۶۲۷۴-۱۲۹۰-۰۰۰۰-۰۰۰۳'), '6274129000000003');
  assert.equal(isValidCardNumber('6274129000000003'), true);
  assert.equal(isValidCardNumber('1111111111111111'), false);
});

test('accepts only server-side allowlisted Iranian bank codes', () => {
  assert.equal(IRANIAN_BANKS.mellat, 'بانک ملت');
  assert.deepEqual(resolveIranianBank(' MELLAT '), { bankCode:'mellat', bankName:'بانک ملت' });
  assert.throws(() => resolveIranianBank('made-up-bank'), /معتبر نیست/);
  assert.throws(() => resolveIranianBank(''), /معتبر نیست/);
});

test('encrypts card and returns only masked value plus persisted bank identity', () => {
  process.env.CARD_ENCRYPTION_KEY = 'test-only-card-encryption-secret';
  const protectedCard = protectCardNumber('6274129000000003');
  assert.equal(revealCardNumber({ encrypted_number:protectedCard.encryptedNumber,number_iv:protectedCard.iv,number_tag:protectedCard.tag }), '6274129000000003');
  const exposed = publicCard({ id:1,last4:protectedCard.last4,title:'اصلی',bank_code:'mellat',bank_name:'بانک ملت' });
  assert.equal(exposed.masked_number, '****-****-****-0003');
  assert.equal(exposed.bank_code, 'mellat');
  assert.equal(exposed.bank_name, 'بانک ملت');
  assert.equal(JSON.stringify(exposed).includes('62741290'), false);
  assert.equal(Object.hasOwn(exposed, 'encrypted_number'), false);
});

test('keeps pre-migration cards readable without exposing extra data', () => {
  const exposed = publicCard({ id:2,last4:'1234',title:null });
  assert.equal(exposed.bank_code, '');
  assert.equal(exposed.bank_name, '');
  assert.equal(exposed.masked_number, '****-****-****-1234');
});
